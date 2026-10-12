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
it.layer(Layer.mergeAll(authLayer, Settings.layerTest()).pipe(Layer.provide(NodeServices.layer)), {
  excludeTestServices: true,
})("native model recommendation route", (it) => {
  it.effect(
    "requires native authorization and the exact Folder; preserves custom preferences",
    () =>
      Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const settings = yield* Settings.ServerSettingsService;
        const config = yield* ServerConfig.ServerConfig;
        const handler = HttpRouter.toWebHandler(
          Route.layer.pipe(
            Layer.provideMerge(Layer.succeed(EnvironmentAuth.EnvironmentAuth, auth)),
            Layer.provideMerge(Layer.succeed(Settings.ServerSettingsService, settings)),
            Layer.provideMerge(ServerConfig.layer(config)),
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
        const writer = yield* auth.issueSession({
          scopes: [AuthOrchestrationOperateScope],
          label: "test",
        });
        const selection = {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-6.1-sol",
          options: [{ id: "reasoningEffort", value: "high" }],
        };
        const post = (body: unknown, token?: string) =>
          handler.handler(
            new Request(`http://localhost${MODEL_RECOMMENDATION_ROUTE}`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                ...(token ? { authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify(body),
            }),
          );
        yield* Effect.promise(async () => {
          expect((await post({})).status).toBe(401);
          expect((await post({}, readOnly.token)).status).toBe(403);
          expect((await post({}, writer.token)).status).toBe(400);
          expect((await post({ folder: "/elsewhere", selection }, writer.token)).status).toBe(409);
          expect(
            (await post({ folder: config.lazurioFolder, selection }, writer.token)).status,
          ).toBe(200);
        });
        expect((yield* settings.getSettings).defaultModelSelection).toEqual(selection);
        const custom = { ...selection, options: [{ id: "reasoningEffort", value: "low" }] };
        yield* settings.updateSettings({ defaultModelSelection: custom });
        yield* Effect.promise(() =>
          post({ folder: config.lazurioFolder, selection }, writer.token),
        );
        expect((yield* settings.getSettings).defaultModelSelection).toEqual(custom);
      }),
  );
});
