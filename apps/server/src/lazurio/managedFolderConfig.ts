/**
 * Lazurio overlay, the managed Lazurio Folder (LazurioPlatform F51): its part of the server's
 * config, which `resolveServerConfig` (cli/config.ts) spreads over its own.
 *
 * - `T3CODE_LAZURIO_FOLDER`: the Environment's Lazurio Folder, an absolute existing directory,
 *   declared by Machines. Its canonical path (symlinks resolved) becomes the server's cwd and
 *   `lazurioFolder`, and the server bootstraps no project from the cwd: the managed startup
 *   (managedFolderStartup.ts) adopts or creates the Folder's own project instead.
 * - `T3CODE_LAZURIO_TOOLS_URL`: the Environment's page where people connect agent accounts, an
 *   HTTPS URL without credentials, linked from the managed welcome.
 *
 * Unset, both leave the config as upstream resolves it.
 */
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

const invalid = (message: string) =>
  Effect.fail(
    new Config.ConfigError(new Schema.SchemaError(new SchemaIssue.InvalidValue({ message }))),
  );

const ManagedFolderEnv = Config.all({
  folder: Config.String("T3CODE_LAZURIO_FOLDER").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  toolsUrl: Config.URL("T3CODE_LAZURIO_TOOLS_URL").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
});

/** The declared Folder's canonical path: absolute, existing, a directory, symlinks resolved. */
const canonicalFolder = (declared: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if (!path.isAbsolute(declared))
      return yield* invalid("T3CODE_LAZURIO_FOLDER must be an absolute existing directory.");
    const root = yield* fs.realPath(declared);
    const info = yield* fs.stat(root);
    if (info.type !== "Directory")
      return yield* invalid("T3CODE_LAZURIO_FOLDER must be a directory.");
    return root;
  });

export const resolveManagedFolderConfig = Effect.gen(function* () {
  const env = yield* ManagedFolderEnv;
  const folder = env.folder === undefined ? undefined : yield* canonicalFolder(env.folder);
  if (
    env.toolsUrl !== undefined &&
    (env.toolsUrl.protocol !== "https:" || env.toolsUrl.username || env.toolsUrl.password)
  )
    return yield* invalid("T3CODE_LAZURIO_TOOLS_URL must be an HTTPS URL without credentials.");
  return {
    ...(folder === undefined
      ? {}
      : { cwd: folder, lazurioFolder: folder, autoBootstrapProjectFromCwd: false }),
    ...(env.toolsUrl === undefined ? {} : { lazurioToolsUrl: env.toolsUrl.toString() }),
  };
});
