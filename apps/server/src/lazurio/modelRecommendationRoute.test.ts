import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  ProjectId,
  ProviderInstanceId,
  WS_METHODS,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import { requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as Settings from "../serverSettings.ts";
import { layerManagedConfig, makeFolderDirectories } from "./managedFolder.testkit.ts";
import {
  folderModel,
  MODEL_RECOMMENDATION_ROUTE,
  recordFolderProject,
} from "./modelRecommendation.ts";
import * as Route from "./modelRecommendationRoute.ts";

const { folder, inside, link, parent } = makeFolderDirectories();
const folderProject = ProjectId.make("project-lazurio");
const layerAuth = EnvironmentAuth.layer.pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerEnvironment.layerIdentity),
  Layer.provideMerge(layerManagedConfig(folder)),
);
// The server's own settings layer: only it reconciles a recommendation.
const layerSettings = Settings.layer.pipe(
  Layer.provide(ServerSecretStore.layer),
  Layer.provideMerge(layerAuth),
);

it.layer(layerSettings.pipe(Layer.provideMerge(NodeServices.layer)), {
  excludeTestServices: true,
})("native model recommendation route", (it) => {
  it.effect("requires the settings scope and the exact Folder; the person's own model stays", () =>
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
      const session = (scope: Parameters<typeof auth.issueSession>[0]) =>
        auth.issueSession({ ...scope, label: "test" });
      const readOnly = yield* session({ scopes: [AuthOrchestrationReadScope] });
      // Upstream moved writing settings out of `orchestration:operate` (#9786).
      const operator = yield* session({ scopes: [AuthOrchestrationOperateScope] });
      const writer = yield* session({
        scopes: [requiredScopeForRpcMethod(WS_METHODS.serverUpdateSettings)],
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
        expect((await post({}, operator.token)).status).toBe(403);
        expect((await post({}, writer.token)).status).toBe(400);
        for (const elsewhere of [parent, inside, "relative"]) {
          expect((await post({ folder: elsewhere, selection }, writer.token)).status).toBe(409);
        }
        // Until the startup records the Folder's project, there is none to reconcile.
        expect((await post({ folder, selection }, writer.token)).status).toBe(503);
      });
      yield* recordFolderProject(config.stateDir, folderProject);
      yield* Effect.promise(async () => {
        // The Platform sends the Folder's realpath; a symlink or a trailing slash names it too.
        for (const sameFolder of [link, `${folder}/`]) {
          expect((await post({ folder: sameFolder, selection }, writer.token)).status).toBe(200);
        }
        const applied = await post({ folder, selection }, writer.token);
        expect(applied.status).toBe(200);
        // `t3 lazurio model` prints this answer as it is, and the Platform reads it.
        expect(await applied.text()).toBe(
          '{"version":1,"current":{"instanceId":"codex","model":"gpt-6.1-sol","options":[{"id":"reasoningEffort","value":"high"}]},"lastManaged":{"instanceId":"codex","model":"gpt-6.1-sol","options":[{"id":"reasoningEffort","value":"high"}]}}',
        );
      });
      // The recommendation is the Lazurio project's model, never the Environment's default.
      const reconciled = yield* settings.getSettings;
      expect(folderModel(reconciled, folderProject)).toEqual(selection);
      expect(reconciled.defaultModelSelection).toBeNull();
      const custom = { ...selection, options: [{ id: "reasoningEffort", value: "low" }] };
      yield* settings.updateSettings({
        projectSettingsOverrides: { [folderProject]: { defaultModelSelection: custom } },
      });
      const kept = yield* Effect.promise(() => post({ folder, selection }, writer.token));
      expect(yield* Effect.promise(() => kept.json())).toEqual({
        version: 1,
        current: custom,
        lastManaged: selection,
      });
      expect(folderModel(yield* settings.getSettings, folderProject)).toEqual(custom);

      // A settings service that cannot reconcile, such as upstream's test layer, refuses.
      const testSettings = yield* Effect.service(Settings.ServerSettingsService).pipe(
        Effect.provide(Settings.layerTest()),
      );
      const unavailable = handlerWith(testSettings);
      yield* Effect.addFinalizer(() => Effect.promise(() => unavailable.dispose()));
      const refused = yield* Effect.promise(() =>
        unavailable.handler(request({ folder, selection }, writer.token)),
      );
      expect(refused.status).toBe(503);
    }),
  );
});
