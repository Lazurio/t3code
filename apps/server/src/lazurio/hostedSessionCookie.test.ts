import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentHttpApi } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as AuthHttp from "../auth/http.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";

// A hosted Environment serves T3 on loopback behind its own HTTPS origin (T3CODE_EXTERNAL_ORIGIN).
const EXTERNAL_ORIGIN = new URL("https://t3code.management.example.test/");

class AuthTestApi extends HttpApi.make("environment").add(EnvironmentHttpApi.groups.auth) {}

// Production builds never set `devUrl`, and neither does this config: a dev server keeps upstream's cookie.
const layerEnvironmentAuth = (overrides: Partial<ServerConfig.ServerConfig["Service"]>) =>
  EnvironmentAuth.layer.pipe(
    Layer.provide(SqlitePersistence.layerMemory),
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provide(ServerEnvironment.layerIdentity),
    Layer.provideMerge(
      Layer.effect(
        ServerConfig.ServerConfig,
        Effect.gen(function* () {
          const config = yield* ServerConfig.ServerConfig;
          return { ...config, ...overrides } satisfies ServerConfig.ServerConfig["Service"];
        }),
      ).pipe(
        Layer.provide(
          ServerConfig.layerTest(process.cwd(), { prefix: "t3-hosted-session-cookie-test-" }),
        ),
      ),
    ),
  );

/** Serves the auth routes on the EnvironmentAuth that mints the pairing credential. */
const serveAuthRoutes = Effect.fn("serveAuthRoutes")(function* (
  overrides: Partial<ServerConfig.ServerConfig["Service"]>,
) {
  const services = yield* Layer.build(layerEnvironmentAuth(overrides));
  const pairing = yield* Context.get(
    services,
    EnvironmentAuth.EnvironmentAuth,
  ).issuePairingCredential();
  const routes = HttpApiBuilder.layer(AuthTestApi).pipe(
    Layer.provide(AuthHttp.layer),
    Layer.provide(AuthHttp.layerAuthenticatedAuth),
    Layer.provide(Layer.succeedContext(services)),
    Layer.provideMerge(
      HttpPlatform.layer.pipe(
        Layer.provideMerge(NodeServices.layer),
        Layer.provideMerge(Etag.layerWeak),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );
  const web = yield* Effect.acquireRelease(
    Effect.sync(() => HttpRouter.toWebHandler(routes, { disableLogger: true })),
    (web) => Effect.promise(() => web.dispose()),
  );
  const context = Context.make(Crypto.Crypto, yield* Crypto.Crypto).pipe(
    Context.add(
      ServerSecretStore.ServerSecretStore,
      Context.get(services, ServerSecretStore.ServerSecretStore),
    ),
  );
  return {
    credential: pairing.credential,
    handle: (request: Request) => Effect.promise(() => web.handler(request, context)),
  };
});

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const postJson = (path: string, body: unknown) =>
  new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: encodeJson(body),
  });

// Live clock: the pairing credential is minted here and redeemed inside the router.
it.live("sets a Secure host-only session cookie behind an external origin", () =>
  Effect.gen(function* () {
    const { credential, handle } = yield* serveAuthRoutes({
      mode: "web",
      host: "127.0.0.1",
      externalOrigin: EXTERNAL_ORIGIN,
    });

    const response = yield* handle(postJson("/api/auth/browser-session", { credential }));

    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/^__Host-t3_session=/);
    expect(cookies[0]).toContain("; Secure");
    expect(cookies[0]).toContain("; Path=/");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("migrates a legacy cookie to a Secure host-only cookie behind an external origin", () =>
  Effect.gen(function* () {
    const { credential, handle } = yield* serveAuthRoutes({
      mode: "web",
      host: "192.168.1.50",
      externalOrigin: EXTERNAL_ORIGIN,
    });
    const bootstrap = yield* handle(postJson("/api/auth/browser-session", { credential }));
    const currentCookie = bootstrap.headers.getSetCookie()[0]?.split(";", 1)[0] ?? "";
    const legacyCookie = currentCookie.replace(/^__Host-t3_session=/, "t3_session=");
    expect(legacyCookie).toMatch(/^t3_session=./);

    const response = yield* handle(
      new Request("http://127.0.0.1/api/auth/session", { headers: { cookie: legacyCookie } }),
    );

    expect(response.status).toBe(200);
    expect(yield* Effect.promise(() => response.json())).toMatchObject({ authenticated: true });
    const migrated = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("__Host-t3_session="));
    expect(migrated).toContain("; Secure");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
