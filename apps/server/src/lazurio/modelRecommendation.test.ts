import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  ServerSettings,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as Settings from "../serverSettings.ts";
import {
  applyModelRecommendation,
  folderModel,
  readModelRecommendationRecord,
  reconcileRecommendedModel,
  recordFolderProject,
} from "./modelRecommendation.ts";

const decodeSettingsFile = Schema.decodeUnknownEffect(Schema.fromJsonString(ServerSettings));

const folderProject = ProjectId.make("project-lazurio");
const historyProject = ProjectId.make("project-history");
const first = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "model-one",
  options: [{ id: "reasoningEffort", value: "high" }],
};
const second = { ...first, model: "model-two" };
const personal = { ...first, options: [{ id: "reasoningEffort", value: "low" }] };
const claude = { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-model" };

/** The settings with `overrides` as the Folder project's override entry. */
const withFolderOverrides = (overrides: ServerSettings["projectSettingsOverrides"][ProjectId]) => ({
  ...DEFAULT_SERVER_SETTINGS,
  projectSettingsOverrides: { [folderProject]: overrides },
});

describe("the recommendation as the Folder project's model", () => {
  it("fills a project without a model of its own, never the Environment's default", () => {
    const written = reconcileRecommendedModel(DEFAULT_SERVER_SETTINGS, folderProject, null, first);
    assert.deepStrictEqual(folderModel(written, folderProject), first);
    assert.isNull(written.defaultModelSelection);
    assert.isNull(folderModel(written, historyProject));
    // The project's other overrides stay as they are.
    const kept = reconcileRecommendedModel(
      withFolderOverrides({ defaultAutoPull: true }),
      folderProject,
      null,
      first,
    );
    assert.deepStrictEqual(kept.projectSettingsOverrides[folderProject], {
      defaultAutoPull: true,
      defaultModelSelection: first,
    });
  });

  it("follows its own last write, whatever the Environment's default is", () => {
    const followed = reconcileRecommendedModel(
      { ...withFolderOverrides({ defaultModelSelection: first }), defaultModelSelection: claude },
      folderProject,
      first,
      second,
    );
    assert.deepStrictEqual(folderModel(followed, folderProject), second);
    assert.deepStrictEqual(followed.defaultModelSelection, claude);
  });

  it("keeps a model the person chose for the project, and an explicit none", () => {
    for (const own of [personal, claude, null]) {
      const chosen = withFolderOverrides({ defaultModelSelection: own });
      assert.strictEqual(reconcileRecommendedModel(chosen, folderProject, first, second), chosen);
    }
    // With no last write, any model the project has is the person's.
    const chosen = withFolderOverrides({ defaultModelSelection: first });
    assert.strictEqual(reconcileRecommendedModel(chosen, folderProject, null, first), chosen);
  });
});

const layerSettings = Settings.layer.pipe(
  Layer.provide(ServerSecretStore.layer),
  Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  Layer.provideMerge(
    Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3-model-recommendation-" })),
  ),
  Layer.provideMerge(NodeServices.layer),
);

it.effect("the settings writer applies recommendations and keeps the person's own choice", () =>
  Effect.gen(function* () {
    const settings = yield* Settings.ServerSettingsService;
    const { stateDir, settingsPath } = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const updateSettingsWith = settings.updateSettingsWith;
    assert.isDefined(updateSettingsWith);
    const apply = (selection: typeof first) =>
      applyModelRecommendation({ stateDir, updateSettingsWith, selection });

    // Until the startup records the Folder's project there is nothing to apply it to.
    assert.isTrue(Option.isNone(yield* apply(first)));
    yield* recordFolderProject(stateDir, folderProject);
    assert.deepStrictEqual(Option.getOrThrow(yield* readModelRecommendationRecord(stateDir)), {
      projectId: folderProject,
      selection: null,
    });

    // No override: written. Its own last write: updated. Both persist with the record.
    assert.deepStrictEqual(Option.getOrThrow(yield* apply(first)), {
      version: 1,
      current: first,
      lastManaged: first,
    });
    assert.deepStrictEqual(Option.getOrThrow(yield* apply(second)), {
      version: 1,
      current: second,
      lastManaged: second,
    });
    const disk = yield* decodeSettingsFile(yield* fs.readFileString(settingsPath));
    assert.deepStrictEqual(folderModel(disk, folderProject), second);
    assert.isNull(disk.defaultModelSelection);
    assert.deepStrictEqual(Option.getOrThrow(yield* readModelRecommendationRecord(stateDir)), {
      projectId: folderProject,
      selection: second,
    });

    // The person's own model for the project stays, and so does their Environment default.
    yield* settings.updateSettings({
      defaultModelSelection: claude,
      projectSettingsOverrides: { [folderProject]: { defaultModelSelection: personal } },
    });
    assert.deepStrictEqual(Option.getOrThrow(yield* apply(first)), {
      version: 1,
      current: personal,
      lastManaged: second,
    });
    assert.deepStrictEqual((yield* settings.getSettings).defaultModelSelection, claude);

    // Back to inheriting (the settings' reset), the project follows the recommendation again.
    yield* settings.updateSettings({ projectSettingsOverrides: { [folderProject]: null } });
    assert.deepStrictEqual(Option.getOrThrow(yield* apply(first)), {
      version: 1,
      current: first,
      lastManaged: first,
    });
    assert.deepStrictEqual((yield* settings.getSettings).defaultModelSelection, claude);

    // A startup that finds another project as the Folder's starts its record over.
    yield* recordFolderProject(stateDir, folderProject);
    assert.deepStrictEqual(
      Option.getOrThrow(yield* readModelRecommendationRecord(stateDir)).selection,
      first,
    );
    yield* recordFolderProject(stateDir, historyProject);
    assert.deepStrictEqual(Option.getOrThrow(yield* readModelRecommendationRecord(stateDir)), {
      projectId: historyProject,
      selection: null,
    });
  }).pipe(Effect.provide(layerSettings)),
);
