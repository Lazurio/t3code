import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerSettingsError,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProviderRefresh from "./providerRefresh.ts";
import * as Route from "./providerRefreshRoute.ts";

const authLayer = EnvironmentAuth.layer.pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerEnvironment.layerIdentity),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-provider-route-" })),
);

const answer = {
  version: 1 as const,
  providers: [
    {
      provider: "codex" as const,
      instanceId: ProviderInstanceId.make("codex"),
      enabled: true,
      status: "ready" as const,
      auth: "authenticated" as const,
    },
  ],
};

it.layer(authLayer.pipe(Layer.provide(NodeServices.layer)), { excludeTestServices: true })(
  "provider refresh route",
  (it) => {
    it.effect("requires a session that may refresh providers and change provider instances", () =>
      Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const requests: unknown[] = [];
        let outcome: Effect.Effect<
          typeof answer,
          | ProviderRefresh.ProviderRefreshUnavailableError
          | ProviderRefresh.ProviderRefreshDriverMismatchError
          | ServerSettingsError
        > = Effect.succeed(answer);
        const handler = HttpRouter.toWebHandler(
          Route.layer.pipe(
            Layer.provideMerge(Layer.succeed(EnvironmentAuth.EnvironmentAuth, auth)),
            Layer.provideMerge(
              Layer.succeed(ProviderRefresh.ProviderRefresh, {
                refresh: (request) =>
                  Effect.suspend(() => {
                    requests.push(request);
                    return outcome;
                  }),
              }),
            ),
            Layer.provideMerge(NodeHttpPlatform.layer),
            Layer.provideMerge(NodeServices.layer),
          ),
          { disableLogger: true },
        );
        yield* Effect.addFinalizer(() => Effect.promise(() => handler.dispose()));
        const readOnly = yield* auth.issueSession({
          scopes: [AuthOrchestrationReadScope],
          label: "test",
        });
        // Upstream split the scopes: writing settings alone may not turn providers on.
        const settingsOnly = yield* auth.issueSession({
          scopes: [
            AuthOrchestrationReadScope,
            AuthOrchestrationOperateScope,
            AuthSettingsWriteScope,
          ],
          label: "test",
        });
        const operator = yield* auth.issueSession({
          scopes: ProviderRefresh.PROVIDER_REFRESH_SCOPES,
          label: "test",
        });
        const post = (body: unknown, token?: string) =>
          handler.handler(
            new Request(`http://localhost${ProviderRefresh.PROVIDER_REFRESH_ROUTE}`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                ...(token ? { authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify(body),
            }),
          );
        yield* Effect.promise(async () => {
          expect((await post({ providers: ["codex"] })).status).toBe(401);
          expect((await post({ providers: ["codex"] }, readOnly.token)).status).toBe(403);
          expect(
            (await post({ providers: ["codex"], enable: true }, settingsOnly.token)).status,
          ).toBe(403);
          // Only Codex and Claude, and at least one of them.
          for (const body of [{}, { providers: [] }, { providers: ["cursor"] }, { enable: true }]) {
            expect((await post(body, operator.token)).status).toBe(400);
          }
          expect(requests).toEqual([]);

          const refreshed = await post({ providers: ["codex"], enable: true }, operator.token);
          expect(refreshed.status).toBe(200);
          // `t3 lazurio providers` prints this answer as it is, and the Launchpad reads it.
          expect(await refreshed.text()).toBe(
            '{"version":1,"providers":[{"provider":"codex","instanceId":"codex","enabled":true,"status":"ready","auth":"authenticated"}]}',
          );
          expect(requests).toEqual([{ providers: ["codex"], enable: true }]);
        });

        outcome = Effect.fail(
          new ProviderRefresh.ProviderRefreshDriverMismatchError({
            mismatches: [
              {
                provider: "codex",
                instanceId: ProviderInstanceId.make("codex"),
                driver: ProviderDriverKind.make("claudeAgent"),
              },
            ],
          }),
        );
        const mismatched = yield* Effect.promise(() =>
          post({ providers: ["codex"], enable: true }, operator.token),
        );
        expect(mismatched.status).toBe(409);
        // The CLI prints this body, so the Launchpad can say which instance is in the way.
        expect(yield* Effect.promise(() => mismatched.text())).toBe(
          '{"error":"driver-mismatch","mismatches":[{"provider":"codex","instanceId":"codex","driver":"claudeAgent"}]}',
        );
        outcome = Effect.fail(new ProviderRefresh.ProviderRefreshUnavailableError());
        const unavailable = yield* Effect.promise(() =>
          post({ providers: ["claude"], enable: true }, operator.token),
        );
        expect(unavailable.status).toBe(503);
        outcome = Effect.fail(
          new ServerSettingsError({
            settingsPath: "settings.json",
            operation: "write-file",
            cause: "disk",
          }),
        );
        const failed = yield* Effect.promise(() =>
          post({ providers: ["claude"], enable: true }, operator.token),
        );
        expect(failed.status).toBe(500);
      }),
    );
  },
);
