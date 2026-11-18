/**
 * Lazurio overlay (LazurioPlatform F51): with `T3CODE_LAZURIO_FOLDER` chats start in the Lazurio
 * Folder, an entry context, not a sandbox; `T3CODE_LAZURIO_BUDDY_FOLDER` adds Buddy's folder beside it
 * (LZD-0033). Without the Folder nothing here refuses anything.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import * as ServerConfig from "../config.ts";

/** The name the server's startup gives Buddy's project (managedFolderStartup.ts). */
export const BUDDY_PROJECT_TITLE = "Buddy";

const turnOutsideFolder =
  "Agents in this Environment work in its Lazurio Folder. Start a new chat in the Lazurio project.";
const repositoryAtBuddyFolder =
  "Buddy's folder holds Buddy's instructions and notes, so it does not become a repository.";
const repositoryAtFolder =
  "The Lazurio Folder holds separate repositories, so it cannot become a repository itself.";

/**
 * The guard of the session manager, the VCS service and the model recommendation route, read once
 * from the server config: the Folder, why an agent turn or a new repository is refused in a
 * managed Environment, or null, and whether a path names the Folder or the Buddy folder. A path
 * counts as one when it resolves to it, symlinks followed.
 */
export const makeFolderGuard = Effect.gen(function* () {
  const { lazurioFolder: folder, lazurioBuddyFolder } = yield* ServerConfig.ServerConfig;
  // Only beside a Folder: the config never sets one alone, and a test's mock answers with a function.
  const buddyFolder =
    folder !== undefined && typeof lazurioBuddyFolder === "string" ? lazurioBuddyFolder : undefined;
  const fs = yield* FileSystem.FileSystem;
  /** `path` with its symlinks resolved, or null when it does not resolve. */
  const canonical = (path: string) => fs.realPath(path).pipe(Effect.orElseSucceed(() => null));
  return {
    /** The Folder's canonical path; undefined when the Environment is not managed. */
    folder,
    /** The Buddy folder's canonical path; undefined unless declared beside the Folder. */
    buddyFolder,
    /** An agent turn runs only in the Folder or the Buddy folder itself; anywhere else, or nowhere, is refused. */
    turnRefusal: (cwd: string | null | undefined): Effect.Effect<string | null> =>
      folder === undefined
        ? Effect.succeed(null)
        : (cwd == null ? Effect.succeed(null) : canonical(cwd)).pipe(
            Effect.map((path) =>
              path === folder || (path !== null && path === buddyFolder) ? null : turnOutsideFolder,
            ),
          ),
    /** The Folder holds repositories, so it never becomes one; a path that does not resolve is compared as it is. */
    repositoryRefusal: (cwd: string): Effect.Effect<string | null> =>
      folder === undefined
        ? Effect.succeed(null)
        : canonical(cwd).pipe(
            Effect.map((path) =>
              (path ?? cwd) === folder
                ? repositoryAtFolder
                : buddyFolder !== undefined && (path ?? cwd) === buddyFolder
                  ? repositoryAtBuddyFolder
                  : null,
            ),
          ),
    /** Whether `path` is the Folder itself; never without a managed Folder. */
    isFolder: (path: string): Effect.Effect<boolean> =>
      folder === undefined
        ? Effect.succeed(false)
        : canonical(path).pipe(Effect.map((resolved) => resolved === folder)),
    /** Whether `path` is the Buddy folder itself; never without one. */
    isBuddyFolder: (path: string): Effect.Effect<boolean> =>
      buddyFolder === undefined
        ? Effect.succeed(false)
        : canonical(path).pipe(Effect.map((resolved) => resolved === buddyFolder)),
  };
});

/** The managed Folder in the config the server gives its clients (`server.getConfig`), if any. */
export const managedFolderClientConfig = (config: {
  readonly lazurioFolder?: string;
  readonly lazurioBuddyFolder?: string;
  readonly lazurioBuddyOrigin?: string;
  readonly lazurioToolsUrl?: string;
}) => ({
  ...(config.lazurioFolder === undefined ? {} : { lazurioFolder: config.lazurioFolder }),
  ...(config.lazurioFolder === undefined || config.lazurioBuddyFolder === undefined
    ? {}
    : { lazurioBuddyFolder: config.lazurioBuddyFolder }),
  ...(config.lazurioFolder === undefined ||
  config.lazurioBuddyFolder === undefined ||
  config.lazurioBuddyOrigin === undefined
    ? {}
    : { lazurioBuddyOrigin: config.lazurioBuddyOrigin }),
  ...(config.lazurioToolsUrl === undefined ? {} : { lazurioToolsUrl: config.lazurioToolsUrl }),
});
