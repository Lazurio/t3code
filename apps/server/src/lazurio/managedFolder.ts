/**
 * Lazurio overlay, the managed Lazurio Folder (LazurioPlatform F51). With `T3CODE_LAZURIO_FOLDER`
 * (managedFolderConfig.ts) a hosted Environment's chats start in its Lazurio Folder: decorators over
 * the services `orchestration-v2/runtimeLayer.ts` builds keep projects, commands and agent sessions
 * there (managedFolderGuards.ts), the VCS service never makes the Folder a repository, and the
 * startup (managedFolderStartup.ts) gives the Folder its project. This is an entry-context
 * contract, not a filesystem sandbox: agents start at the Folder and can then work in its
 * repositories with their normal tools. Without the variable nothing here refuses anything.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import * as ServerConfig from "../config.ts";

const turnOutsideFolder =
  "Agents in this Environment work in its Lazurio Folder. Start a new chat in the Lazurio project.";
const repositoryAtFolder =
  "The Lazurio Folder holds separate repositories, so it cannot become a repository itself.";

/**
 * The guard of the session manager, the VCS service and the model recommendation route, read once
 * from the server config: the Folder, why an agent turn or a new repository is refused in a
 * managed Environment, or null, and whether a path names the Folder. A path counts as the Folder
 * when it resolves to it, symlinks followed.
 */
export const makeFolderGuard = Effect.gen(function* () {
  const { lazurioFolder: folder } = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  /** `path` with its symlinks resolved, or null when it does not resolve. */
  const canonical = (path: string) => fs.realPath(path).pipe(Effect.orElseSucceed(() => null));
  return {
    /** The Folder's canonical path; undefined when the Environment is not managed. */
    folder,
    /** An agent turn runs only in the Folder itself; anywhere else, or nowhere, is refused. */
    turnRefusal: (cwd: string | null | undefined): Effect.Effect<string | null> =>
      folder === undefined
        ? Effect.succeed(null)
        : (cwd == null ? Effect.succeed(null) : canonical(cwd)).pipe(
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
