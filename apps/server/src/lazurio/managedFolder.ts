/**
 * Lazurio overlay, the managed Lazurio Folder (LazurioPlatform F51). With `T3CODE_LAZURIO_FOLDER`
 * (managedFolderConfig.ts) a hosted Environment's chats start in its Lazurio Folder: the engine,
 * the provider reactor and the VCS service keep commands, agent turns and repositories there
 * through the guards below, and the startup (managedFolderStartup.ts) gives the Folder its
 * project. This is an entry-context contract, not a filesystem sandbox: agents start at the Folder
 * and can then work in its repositories with their normal tools. Without the variable nothing here
 * refuses anything.
 */
import type { OrchestrationCommand, OrchestrationReadModel } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { ServerConfig } from "../config.ts";
import { OrchestrationCommandInvariantError } from "../orchestration/Errors.ts";

type CommandState = Pick<OrchestrationReadModel, "projects" | "threads">;

/** Why the engine refuses a command in a managed Environment, or null. */
export function managedFolderRefusal(
  folder: string | undefined,
  command: OrchestrationCommand,
  state: CommandState,
): string | null {
  if (folder === undefined) return null;
  const message =
    "Start a new chat in the Lazurio project. Agents in this Environment work in its Lazurio Folder; your earlier chats stay here as history.";
  const project = (id: string) => state.projects.find((item) => item.id === id);
  const allowedProject = (id: string) => project(id)?.workspaceRoot === folder;
  switch (command.type) {
    case "project.create":
      return command.workspaceRoot === folder
        ? null
        : "In this Environment, the Lazurio project is the Lazurio Folder itself.";
    case "project.meta.update":
      if (
        allowedProject(command.projectId) &&
        command.title !== undefined &&
        command.title !== "Lazurio"
      )
        return "This project keeps the name Lazurio.";
      return command.workspaceRoot !== undefined &&
        command.workspaceRoot !== project(command.projectId)?.workspaceRoot
        ? "In this Environment a project cannot point to another folder. Use the Lazurio project."
        : null;
    case "project.delete":
      return allowedProject(command.projectId)
        ? "The Lazurio project belongs to this Environment and cannot be removed."
        : null;
    case "thread.create":
      return allowedProject(command.projectId) && command.worktreePath === null ? null : message;
    case "thread.meta.update":
      return command.worktreePath != null
        ? "Chats in this Environment start in the Lazurio Folder, without a separate worktree."
        : null;
    case "thread.turn.start": {
      const thread = state.threads.find((item) => item.id === command.threadId);
      const target = command.bootstrap?.createThread ?? thread;
      return target !== undefined &&
        allowedProject(target.projectId) &&
        target.worktreePath === null &&
        command.bootstrap?.prepareWorktree === undefined
        ? null
        : message;
    }
    default:
      return null;
  }
}

/** The engine's guard: fails a command `managedFolderRefusal` refuses, before it is decided. */
export const makeCommandGuard = Effect.map(
  ServerConfig,
  ({ lazurioFolder }) =>
    (command: OrchestrationCommand, state: CommandState) => {
      const refusal = managedFolderRefusal(lazurioFolder, command, state);
      return refusal === null
        ? Effect.void
        : Effect.fail(
            new OrchestrationCommandInvariantError({ commandType: command.type, detail: refusal }),
          );
    },
);

const turnOutsideFolder =
  "Agents in this Environment work in its Lazurio Folder. Start a new chat in the Lazurio project.";
const repositoryAtFolder =
  "The Lazurio Folder holds separate repositories, so it cannot become a repository itself.";

/**
 * The guard of the provider reactor, the VCS service and the model recommendation route, read once
 * from the server config: why an agent turn or a new repository is refused in a managed
 * Environment, or null, and whether a path names the Folder. A path counts as the Folder when it
 * resolves to it, symlinks followed.
 */
export const makeFolderGuard = Effect.gen(function* () {
  const { lazurioFolder: folder } = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  /** `path` with its symlinks resolved, or null when it does not resolve. */
  const canonical = (path: string) => fs.realPath(path).pipe(Effect.orElseSucceed(() => null));
  return {
    /** An agent turn runs only in the Folder itself; anywhere else, or nowhere, is refused. */
    turnRefusal: (cwd: string | undefined): Effect.Effect<string | null> =>
      folder === undefined
        ? Effect.succeed(null)
        : (cwd === undefined ? Effect.succeed(null) : canonical(cwd)).pipe(
            Effect.map((path) => (path === folder ? null : turnOutsideFolder)),
          ),
    /** The Folder holds repositories, so it never becomes one; a path that does not resolve is compared as it is. */
    repositoryRefusal: (cwd: string): Effect.Effect<string | null> =>
      folder === undefined
        ? Effect.succeed(null)
        : canonical(cwd).pipe(
            Effect.map((path) => ((path ?? cwd) === folder ? repositoryAtFolder : null)),
          ),
    /** Whether `path` is the Folder itself; never without a managed Folder. */
    isFolder: (path: string): Effect.Effect<boolean> =>
      folder === undefined
        ? Effect.succeed(false)
        : canonical(path).pipe(Effect.map((resolved) => resolved === folder)),
  };
});

/** The managed Folder in the config the server gives its clients (`server.getConfig`), if any. */
export const managedFolderClientConfig = (config: {
  readonly lazurioFolder?: string;
  readonly lazurioToolsUrl?: string;
}) => ({
  ...(config.lazurioFolder === undefined ? {} : { lazurioFolder: config.lazurioFolder }),
  ...(config.lazurioToolsUrl === undefined ? {} : { lazurioToolsUrl: config.lazurioToolsUrl }),
});
