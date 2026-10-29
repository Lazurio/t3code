import { CommandId, ProjectId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { layerProjects, makeFolderDirectories } from "./managedFolder.testkit.ts";
import { ensureManagedFolderProject } from "./managedFolderStartup.ts";
import { readModelRecommendationRecord } from "./modelRecommendation.ts";

it.effect("without T3CODE_LAZURIO_FOLDER the startup leaves projects alone", () =>
  Effect.gen(function* () {
    assert.deepStrictEqual(yield* ensureManagedFolderProject, {});
    const projects = yield* ProjectService.ProjectService;
    assert.lengthOf((yield* projects.snapshot).projects, 0);
  }).pipe(Effect.provide(layerProjects({ persistence: SqlitePersistence.layerMemory }))),
);

it.effect("creates the Folder's project once, named Lazurio, and records it", () => {
  const { folder } = makeFolderDirectories();
  return Effect.gen(function* () {
    const first = yield* ensureManagedFolderProject;
    const second = yield* ensureManagedFolderProject;
    assert.isTrue(first.bootstrapProjectCreated);
    assert.deepStrictEqual(second, { ...first, bootstrapProjectCreated: false });
    const projects = (yield* (yield* ProjectService.ProjectService).snapshot).projects;
    assert.lengthOf(projects, 1);
    assert.strictEqual(projects[0]?.id, first.bootstrapProjectId);
    assert.strictEqual(projects[0]?.workspaceRoot, folder);
    assert.strictEqual(projects[0]?.title, "Lazurio");
    // The read-only `t3 lazurio model` finds the Folder's project by this record.
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const record = Option.getOrThrow(yield* readModelRecommendationRecord(stateDir));
    assert.deepStrictEqual(record, { projectId: projects[0]!.id, selection: null });
  }).pipe(
    Effect.provide(
      layerProjects({ persistence: SqlitePersistence.layerMemory, lazurioFolder: folder }),
    ),
  );
});

it.effect(
  "adopts the Folder's existing project on restart, renames it Lazurio and keeps history",
  () => {
    const { folder, repository, database } = makeFolderDirectories();
    const persistence = SqlitePersistence.layerFromPath(database);
    return Effect.gen(function* () {
      // Before the Environment was managed: the Folder's project and another one.
      yield* Effect.gen(function* () {
        const projects = yield* ProjectService.ProjectService;
        for (const [id, workspaceRoot] of [
          ["folder", folder],
          ["history", repository],
        ] as const) {
          yield* projects.create({
            commandId: CommandId.make(`create-${id}`),
            projectId: ProjectId.make(id),
            title: id,
            workspaceRoot,
          });
        }
      }).pipe(Effect.provide(layerProjects({ persistence })));

      // Managed from here on, over the same database.
      yield* Effect.gen(function* () {
        const adopted = yield* ensureManagedFolderProject;
        assert.deepStrictEqual(adopted, {
          bootstrapProjectId: ProjectId.make("folder"),
          bootstrapProjectCreated: false,
        });
        assert.deepStrictEqual(yield* ensureManagedFolderProject, adopted);
        const projects = (yield* (yield* ProjectService.ProjectService).snapshot).projects;
        assert.deepStrictEqual(
          projects.map((project) => [project.id, project.title, project.workspaceRoot]),
          [
            ["folder", "Lazurio", folder],
            ["history", "history", repository],
          ],
        );
        const { stateDir } = yield* ServerConfig.ServerConfig;
        assert.strictEqual(
          Option.getOrThrow(yield* readModelRecommendationRecord(stateDir)).projectId,
          ProjectId.make("folder"),
        );
      }).pipe(Effect.provide(layerProjects({ persistence, lazurioFolder: folder })));
    });
  },
);
