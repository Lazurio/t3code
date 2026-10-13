import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/unstable/http";
import * as ServerConfig from "../config.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as Settings from "../serverSettings.ts";
import * as Route from "./modelRecommendationRoute.ts";
import { MODEL_RECOMMENDATION_ROUTE } from "./modelRecommendation.ts";
const configLayer = Layer.effect(
  ServerConfig.ServerConfig,
  Effect.map(ServerConfig.ServerConfig, (config) => ({
    ...config,
    lazurioFolder: "/workspace/Lazurio",
  })),
).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-model-route-" })));
const authLayer = EnvironmentAuth.layer.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerEnvironment.identityLayer),
  Layer.provideMerge(configLayer),
);
// The server's own settings layer: only it reconciles a recommendation.
const settingsLayer = Settings.layer.pipe(
  Layer.provide(ServerSecretStore.layer),
  Layer.provideMerge(authLayer),
);
it.layer(settingsLayer.pipe(Layer.provide(NodeServices.layer)), {
  excludeTestServices: true,
})("native model recommendation route", (it) => {
  it.effect(
    "requires native authorization and the exact Folder; preserves custom preferences",
    () =>
      Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const config = yield* ServerConfig.ServerConfig;
        const handlerWith = (settings: Settings.ServerSettingsService["Service"]) =>
          HttpRouter.toWebHandler(
            Route.layer.pipe(
              Layer.provideMerge(Layer.succeed(EnvironmentAuth.EnvironmentAuth, auth)),
              Layer.provideMerge(Layer.succeed(Settings.ServerSettingsService, settings)),
              Layer.provideMerge(ServerConfig.layer(config)),
              Layer.provideMerge(NodeHttpPlatform.layer),
              Layer.provideMerge(NodeServices.layer),
            ),
            { disableLogger: true },
          );
        const settings = yield* Settings.ServerSettingsService;
        const handler = handlerWith(settings);
        yield* Effect.addFinalizer(() => Effect.promise(() => handler.dispose()));
        const readOnly = yield* auth.issueSession({
          scopes: [AuthOrchestrationReadScope],
          label: "test",
        });
        const writer = yield* auth.issueSession({
          scopes: [AuthOrchestrationOperateScope],
          label: "test",
        });
        const selection = {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-6.1-sol",
          options: [{ id: "reasoningEffort", value: "high" }],
        };
        const request = (body: unknown, token?: string) =>
          new Request(`http://localhost${MODEL_RECOMMENDATION_ROUTE}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(body),
          });
        const post = (body: unknown, token?: string) => handler.handler(request(body, token));
        yield* Effect.promise(async () => {
          expect((await post({})).status).toBe(401);
          expect((await post({}, readOnly.token)).status).toBe(403);
          expect((await post({}, writer.token)).status).toBe(400);
          expect((await post({ folder: "/elsewhere", selection }, writer.token)).status).toBe(409);
          const applied = await post({ folder: config.lazurioFolder, selection }, writer.token);
          expect(applied.status).toBe(200);
          // `t3 lazurio model` prints this answer as it is, and the Platform reads it.
          expect(await applied.text()).toBe(
            '{"version":1,"current":{"instanceId":"codex","model":"gpt-6.1-sol","options":[{"id":"reasoningEffort","value":"high"}]},"lastManaged":{"instanceId":"codex","model":"gpt-6.1-sol","options":[{"id":"reasoningEffort","value":"high"}]}}',
          );
        });
        expect((yield* settings.getSettings).defaultModelSelection).toEqual(selection);
        const custom = { ...selection, options: [{ id: "reasoningEffort", value: "low" }] };
        yield* settings.updateSettings({ defaultModelSelection: custom });
        yield* Effect.promise(() =>
          post({ folder: config.lazurioFolder, selection }, writer.token),
        );
        expect((yield* settings.getSettings).defaultModelSelection).toEqual(custom);

        // A settings service that cannot reconcile, such as upstream's test layer, refuses.
        const testSettings = yield* Effect.service(Settings.ServerSettingsService).pipe(
          Effect.provide(Settings.layerTest()),
        );
        const unavailable = handlerWith(testSettings);
        yield* Effect.addFinalizer(() => Effect.promise(() => unavailable.dispose()));
        const refused = yield* Effect.promise(() =>
          unavailable.handler(request({ folder: config.lazurioFolder, selection }, writer.token)),
        );
        expect(refused.status).toBe(503);
      }),
  );
});
