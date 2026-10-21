/**
 * Lazurio overlay (LazurioPlatform F51): the managed startup. Before the server takes commands, a
 * managed Environment adopts the Folder's project or creates it, named Lazurio, through upstream's
 * project service; every other project stays as history. It records the Folder's project for the
 * model recommendation (modelRecommendation.ts), so `t3 lazurio model` finds it without the
 * running service. The server is the only writer: Machines declares the Folder in its unit, and
 * nothing here edits the database or the settings offline.
 */
import { CommandId, ProjectId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { recordFolderProject } from "./modelRecommendation.ts";

/** The Folder's project, adopted or created; the welcome event names it. */
export const ensureManagedFolderProject = Effect.gen(function* () {
  const { lazurioFolder, stateDir } = yield* ServerConfig.ServerConfig;
  // Upstream's startup tests mock the config, and a mock answers a field it lacks, such as this
  // one, with a function: only a path is a Folder.
  if (typeof lazurioFolder !== "string") return {};
  const projects = yield* ProjectService.ProjectService;
  const crypto = yield* Crypto.Crypto;
  const id = yield* crypto.randomUUIDv4();
  const { project, created } = yield* projects.bootstrap({
    commandId: CommandId.make(`lazurio-project:${id}`),
    projectId: ProjectId.make(id),
    title: "Lazurio",
    workspaceRoot: lazurioFolder,
  });
  if (project.title !== "Lazurio") {
    yield* projects.update({
      commandId: CommandId.make(`lazurio-project-title:${id}`),
      projectId: project.id,
      title: "Lazurio",
    });
  }
  // A server always runs on the platform's file system. Upstream's startup tests build this phase
  // without one, so it is read here rather than added to the startup's requirements.
  const fileSystem = yield* Effect.serviceOption(FileSystem.FileSystem);
  if (Option.isSome(fileSystem)) {
    yield* recordFolderProject(stateDir, project.id).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem.value),
    );
  }
  return { bootstrapProjectId: project.id, bootstrapProjectCreated: created };
});
