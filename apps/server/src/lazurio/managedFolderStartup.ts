/**
 * Lazurio overlay (LazurioPlatform F51): before the server takes commands, a managed Environment
 * adopts or creates the Folder's project (Lazurio), recorded for `t3 lazurio model`, and with a Buddy
 * folder also Buddy's project, which only this path makes. Nothing edits state offline.
 */
import { CommandId, ProjectId } from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { BUDDY_PROJECT_TITLE } from "./managedFolder.ts";
import { recordFolderProject } from "./modelRecommendation.ts";

/** The Folder's project, adopted or created; the welcome event names it. */
export const ensureManagedFolderProject = Effect.gen(function* () {
  const { lazurioFolder, lazurioBuddyFolder, stateDir } = yield* ServerConfig.ServerConfig;
  // Upstream's startup tests mock the config, and a mock answers a field it lacks, such as this
  // one, with a function: only a path is a Folder.
  if (typeof lazurioFolder !== "string") return {};
  const projects = yield* ProjectService.ProjectService;
  const random = yield* SecureRandom.SecureRandom;
  const id = yield* random.uuidV4();
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
  if (typeof lazurioBuddyFolder === "string") {
    // A missing Buddy folder gets no project; one made earlier keeps its threads unarchived.
    const fileSystemForBuddy = yield* Effect.serviceOption(FileSystem.FileSystem);
    const exists =
      Option.isNone(fileSystemForBuddy) ||
      (yield* fileSystemForBuddy.value
        .exists(lazurioBuddyFolder)
        .pipe(Effect.orElseSucceed(() => false)));
    if (exists) yield* ensureBuddyProject(lazurioBuddyFolder);
    else {
      const earlier = (yield* projects.snapshot).projects.find(
        (candidate) => candidate.workspaceRoot === lazurioBuddyFolder,
      );
      if (earlier !== undefined) yield* restoreBuddyThreads(earlier.id);
    }
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

/** Buddy's project over the Buddy folder, adopted or created, keeping the name Buddy. */
const ensureBuddyProject = Effect.fn("LazurioManagedFolder.ensureBuddyProject")(function* (
  buddyFolder: string,
) {
  const projects = yield* ProjectService.ProjectService;
  const random = yield* SecureRandom.SecureRandom;
  const id = yield* random.uuidV4();
  const { project } = yield* projects.bootstrap({
    commandId: CommandId.make(`lazurio-buddy-project:${id}`),
    projectId: ProjectId.make(id),
    title: BUDDY_PROJECT_TITLE,
    workspaceRoot: buddyFolder,
  });
  if (project.title !== BUDDY_PROJECT_TITLE) {
    yield* projects.update({
      commandId: CommandId.make(`lazurio-buddy-project-title:${id}`),
      projectId: project.id,
      title: BUDDY_PROJECT_TITLE,
    });
  }
  yield* restoreBuddyThreads(project.id);
});

/**
 * Buddy's threads are never archived (managedFolderGuards.ts); one archived while the folder was not
 * declared comes back, so the tasks it runs elsewhere follow a live parent again.
 */
const restoreBuddyThreads = Effect.fn("LazurioManagedFolder.restoreBuddyThreads")(function* (
  projectId: ProjectId,
) {
  const orchestrator = yield* Effect.serviceOption(Orchestrator.OrchestratorV2);
  if (Option.isNone(orchestrator)) return;
  const random = yield* SecureRandom.SecureRandom;
  const id = yield* random.uuidV4();
  const { archivedThreads } = yield* orchestrator.value.getShellSnapshot({
    location: "archive",
    projectId,
  });
  for (const thread of archivedThreads) {
    if (thread.projectId !== projectId) continue;
    yield* orchestrator.value.dispatch({
      type: "thread.unarchive",
      commandId: CommandId.make(`lazurio-buddy-unarchive:${id}:${thread.id}`),
      threadId: thread.id,
    });
  }
});
