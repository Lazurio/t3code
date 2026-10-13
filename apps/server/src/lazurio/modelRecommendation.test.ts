import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_SERVER_SETTINGS, ProviderInstanceId, ServerSettings } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as Settings from "../serverSettings.ts";
import { reconcileRecommendedModel } from "./modelRecommendation.ts";

const first = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "model-one",
  options: [{ id: "reasoningEffort", value: "high" }],
};
const second = { ...first, model: "model-two" };
const personal = { ...first, options: [{ id: "reasoningEffort", value: "low" }] };

it("a recommendation fills an unset default and follows its own last write, nothing else", () => {
  const unset = reconcileRecommendedModel(DEFAULT_SERVER_SETTINGS, first);
  assert.deepStrictEqual(unset.defaultModelSelection, first);
  assert.deepStrictEqual(unset.lazurioManagedModelSelection, first);
  const followed = reconcileRecommendedModel(unset, second);
  assert.deepStrictEqual(followed.defaultModelSelection, second);
  assert.deepStrictEqual(followed.lazurioManagedModelSelection, second);
  const chosen = { ...followed, defaultModelSelection: personal };
  assert.strictEqual(reconcileRecommendedModel(chosen, first), chosen);
});

const settingsLayer = Settings.layer.pipe(
  Layer.provide(ServerSecretStore.layer),
  Layer.provideMerge(Layer.fresh(SqlitePersistenceMemory)),
  Layer.provideMerge(
    Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3-model-recommendation-" })),
  ),
  Layer.provideMerge(NodeServices.layer),
);

it.effect("the settings writer records recommendations atomically and keeps personal choices", () =>
  Effect.gen(function* () {
    const settings = yield* Settings.ServerSettingsService;
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const reconcile = settings.reconcileRecommendedModel;
    assert.isDefined(reconcile);
    yield* reconcile(first);
    assert.deepStrictEqual((yield* settings.getSettings).defaultModelSelection, first);
    yield* reconcile(second);
    assert.deepStrictEqual((yield* settings.getSettings).defaultModelSelection, second);
    const disk = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ServerSettings))(
      yield* fs.readFileString(config.settingsPath),
    );
    assert.deepStrictEqual(disk.defaultModelSelection, second);
    assert.deepStrictEqual(disk.lazurioManagedModelSelection, second);
    yield* settings.updateSettings({ defaultModelSelection: personal });
    yield* reconcile(first);
    const preserved = yield* settings.getSettings;
    assert.deepStrictEqual(preserved.defaultModelSelection, personal);
    assert.deepStrictEqual(preserved.lazurioManagedModelSelection, second);
    yield* settings.updateSettings({ defaultModelSelection: null });
    yield* reconcile(first);
    assert.deepStrictEqual((yield* settings.getSettings).defaultModelSelection, first);
  }).pipe(Effect.provide(settingsLayer)),
);
