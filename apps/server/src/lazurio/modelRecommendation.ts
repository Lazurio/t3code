/**
 * Lazurio overlay (LazurioPlatform F51): the Platform recommends Chat's model, T3 keeps the
 * person's own choice. The recommendation becomes the managed Folder project's own model, through
 * upstream's per-project override of the default model
 * (`projectSettingsOverrides[<project>].defaultModelSelection`, "Projects can override it"), never
 * the Environment's default. What the overlay last wrote there, and for which project, it keeps in
 * a file of its own beside the settings, so T3's settings stay upstream's: a Folder project with no
 * model of its own, or still with the overlay's last write, follows the next recommendation, while
 * a model the person chose for it stays.
 */
import { ModelSelection, ProjectId, type ServerSettings } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { fromJsonStringPretty, fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type { ServerSettingsService } from "../serverSettings.ts";

export const MODEL_RECOMMENDATION_ROUTE = "/api/lazurio/model-recommendation";
export const ModelRecommendationRequest = Schema.Struct({
  folder: Schema.String,
  selection: ModelSelection,
});

/** The Folder's project, and the model the overlay last wrote as its own (null before any). */
const ModelRecommendationRecord = Schema.Struct({
  projectId: ProjectId,
  selection: Schema.NullOr(ModelSelection),
});
type ModelRecommendationRecord = typeof ModelRecommendationRecord.Type;
const decodeRecord = Schema.decodeUnknownOption(fromLenientJson(ModelRecommendationRecord));
const encodeRecord = Schema.encodeEffect(fromJsonStringPretty(ModelRecommendationRecord));

/**
 * `<userdata>/lazurio/model-recommendation.json`: in the server's state directory beside
 * `settings.json`, where the read-only `t3 lazurio model --base-dir` finds it without the server,
 * in a directory of the overlay's own that upstream never writes.
 */
const recordPath = (path: Path.Path, stateDir: string) =>
  path.join(stateDir, "lazurio", "model-recommendation.json");

/** The record, or none when it is missing or unreadable. Never creates anything. */
export const readModelRecommendationRecord = (stateDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const text = yield* fs.readFileString(recordPath(path, stateDir)).pipe(Effect.option);
    return Option.flatMap(text, decodeRecord);
  });

const writeRecord = (stateDir: string, record: ModelRecommendationRecord) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    yield* writeFileStringAtomically({
      filePath: recordPath(path, stateDir),
      contents: `${yield* encodeRecord(record)}\n`,
    });
  });

/**
 * Records the Folder's project, which the startup adopted or created. A last write for this
 * project stays; a record of another project is replaced without one.
 */
export const recordFolderProject = (stateDir: string, projectId: ProjectId) =>
  Effect.gen(function* () {
    const current = yield* readModelRecommendationRecord(stateDir);
    if (Option.isSome(current) && current.value.projectId === projectId) return;
    yield* writeRecord(stateDir, { projectId, selection: null });
  });

/** The Folder project's own model: its override of the default model, null when it has none. */
export const folderModel = (
  settings: Pick<ServerSettings, "projectSettingsOverrides">,
  projectId: ProjectId,
): ModelSelection | null =>
  settings.projectSettingsOverrides[projectId]?.defaultModelSelection ?? null;

/**
 * The settings with the recommendation as the Folder project's model where the project has no
 * model of its own: no override, or still the overlay's last write. An override the person set,
 * a model or explicitly none, stays, and the Environment's default is never touched.
 */
export function reconcileRecommendedModel(
  current: ServerSettings,
  projectId: ProjectId,
  lastWrite: ModelSelection | null,
  selection: ModelSelection,
): ServerSettings {
  const overrides = current.projectSettingsOverrides[projectId];
  const own = overrides?.defaultModelSelection;
  return own === undefined || (own !== null && lastWrite !== null && Equal.equals(own, lastWrite))
    ? {
        ...current,
        projectSettingsOverrides: {
          ...current.projectSettingsOverrides,
          [projectId]: { ...overrides, defaultModelSelection: selection },
        },
      }
    : current;
}

/**
 * Reconciles `selection` as the Folder project's model through the settings writer, then records
 * it when it was written, and answers what the route and `t3 lazurio model` print. None while the
 * Folder's project is not recorded. Callers run it one at a time: it reads the record first.
 */
export const applyModelRecommendation = (input: {
  readonly stateDir: string;
  readonly updateSettingsWith: NonNullable<ServerSettingsService["Service"]["updateSettingsWith"]>;
  readonly selection: ModelSelection;
}) =>
  Effect.gen(function* () {
    const record = yield* readModelRecommendationRecord(input.stateDir);
    if (Option.isNone(record)) return Option.none();
    const { projectId, selection: lastWrite } = record.value;
    let written = false;
    // Written and recorded together: a client that stops waiting never leaves a write unrecorded.
    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const updated = yield* input.updateSettingsWith((current) => {
          const next = reconcileRecommendedModel(current, projectId, lastWrite, input.selection);
          written = next !== current;
          return next;
        });
        if (written) yield* writeRecord(input.stateDir, { projectId, selection: input.selection });
        return Option.some({
          version: 1 as const,
          current: folderModel(updated, projectId),
          lastManaged: written ? input.selection : lastWrite,
        });
      }),
    );
  });
