import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthAccessWriteScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
  mcpClientScopes,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
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
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";

// An MCP client's approval code is a pairing code bound to an access level (upstream v0.1.8). A
// session issued with a runtime-mode ceiling (`t3 auth session issue --runtime-mode-ceiling`) must
// not reach past it with a code, so this checks who the HTTP API lets mint one.

const OWNER_TOKEN = "reusable-dev-auth-token-that-is-long-enough";
class AuthTestApi extends HttpApi.make("environment").add(EnvironmentHttpApi.groups.auth) {}

// The dev auth token stands in for the owner's session; it signs a browser in with every scope.
const layerConfig = Layer.effect(
  ServerConfig.ServerConfig,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    return {
      ...config,
      mode: "web",
      devUrl: new URL("http://127.0.0.1:5173"),
      devAuthToken: Redacted.make(OWNER_TOKEN),
    } satisfies ServerConfig.ServerConfig["Service"];
  }),
).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-approval-code-test-" })));

const layerRoutes = HttpApiBuilder.layer(AuthTestApi).pipe(
  Layer.provide(AuthHttp.layer),
  Layer.provide(AuthHttp.layerAuthenticatedAuth),
  Layer.provideMerge(
    EnvironmentAuth.layer.pipe(
      Layer.provide(ManagedPolicy.layerTest()),
      Layer.provide(SqlitePersistence.layerMemory),
      Layer.provide(ServerSecretStore.layer),
      Layer.provide(ServerEnvironment.layerIdentity),
      Layer.provide(layerConfig),
    ),
  ),
  Layer.provide(layerConfig),
  Layer.provideMerge(
    HttpPlatform.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
      Layer.provideMerge(Etag.layerWeak),
    ),
  ),
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const postJson = (path: string, body: unknown, headers?: Readonly<Record<string, string>>) =>
  new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: encodeJson(body),
  });

it.effect(
  "mints an approval code only for a session that may pair and holds its level's scopes",
  () =>
    Effect.gen(function* () {
      const unusedSecretStore = ServerSecretStore.ServerSecretStore.of({
        get: () => Effect.succeedNone,
        set: () => Effect.void,
        create: () => Effect.void,
        getOrCreateRandom: () => Effect.die("Not used by these routes."),
        remove: () => Effect.void,
      });
      const requestContext = Context.make(
        SecureRandom.SecureRandom,
        yield* SecureRandom.SecureRandom,
      ).pipe(Context.add(ServerSecretStore.ServerSecretStore, unusedSecretStore));
      return yield* Effect.acquireUseRelease(
        Effect.sync(() => HttpRouter.toWebHandler(layerRoutes, { disableLogger: true })),
        (environment) =>
          Effect.promise(async () => {
            const signIn = async (credential: string) => {
              const response = await environment.handler(
                postJson("/api/auth/browser-session", { credential }),
                requestContext,
              );
              expect(response.status).toBe(200);
              return response.headers
                .getSetCookie()
                .find((cookie) => /^t3_(dev_)?session_/.test(cookie))!
                .split(";", 1)[0]!;
            };
            const mintApprovalCode = (cookie: string, access: string) =>
              environment.handler(
                postJson("/api/auth/pairing-token", { access }, { cookie }),
                requestContext,
              );
            const sessionWith = async (owner: string, scopes: ReadonlyArray<string>) => {
              const pairing = await environment.handler(
                postJson("/api/auth/pairing-token", { scopes }, { cookie: owner }),
                requestContext,
              );
              expect(pairing.status).toBe(200);
              return signIn(((await pairing.json()) as { credential: string }).credential);
            };

            const owner = await signIn(OWNER_TOKEN);
            expect((await mintApprovalCode(owner, "approval-required")).status).toBe(200);

            // Every scope an approval-required code gives, but no right to pair.
            const operator = await sessionWith(owner, [...mcpClientScopes("approval-required")]);
            const operatorMint = await mintApprovalCode(operator, "approval-required");
            expect(operatorMint.status).toBe(403);
            expect(await operatorMint.json()).toMatchObject({ code: "insufficient_scope" });

            // The right to pair, but not the operate scope the level gives: no code above itself.
            const reader = await sessionWith(owner, [
              AuthOrchestrationReadScope,
              AuthAccessWriteScope,
            ]);
            expect((await mintApprovalCode(reader, "read-only")).status).toBe(200);
            const readerMint = await mintApprovalCode(reader, "approval-required");
            expect(readerMint.status).toBe(403);
            expect(await readerMint.json()).toMatchObject({ code: "insufficient_scope" });
          }),
        (environment) => Effect.promise(() => environment.dispose()),
      );
    }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);
