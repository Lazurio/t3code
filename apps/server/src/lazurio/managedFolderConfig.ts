/**
 * Lazurio overlay (LazurioPlatform F51): `T3CODE_LAZURIO_FOLDER` (its canonical path becomes the cwd
 * and `lazurioFolder`), `T3CODE_LAZURIO_BUDDY_FOLDER` (Buddy's folder beside it, LZD-0033) and
 * `T3CODE_LAZURIO_TOOLS_URL` (HTTPS, no credentials). Unset, each leaves upstream's config alone.
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
  buddyFolder: Config.String("T3CODE_LAZURIO_BUDDY_FOLDER").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  toolsUrl: Config.URL("T3CODE_LAZURIO_TOOLS_URL").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
});

/** The declared Folder's canonical path: absolute, existing, a directory, symlinks resolved. */
const canonicalFolder = Effect.fn("LazurioManagedFolder.canonicalFolder")(function* (
  variable: "T3CODE_LAZURIO_FOLDER" | "T3CODE_LAZURIO_BUDDY_FOLDER",
  declared: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!path.isAbsolute(declared))
    return yield* invalid(`${variable} must be an absolute existing directory.`);
  const root = yield* fs.realPath(declared);
  const info = yield* fs.stat(root);
  if (info.type !== "Directory") return yield* invalid(`${variable} must be a directory.`);
  return root;
});

/**
 * Where a missing path would be once made: links followed, also dangling ones, and the deepest
 * existing ancestor resolved, so a project created through a link keeps its root after a restart.
 */
const canonicalMissing = Effect.fn("LazurioManagedFolder.canonicalMissing")(function* (
  declared: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  let current = path.resolve(declared);
  const rest: Array<string> = [];
  for (let hop = 0; hop < 40; hop++) {
    const target = yield* fs.readLink(current).pipe(Effect.option);
    if (Option.isSome(target)) {
      current = path.resolve(path.dirname(current), target.value);
      continue;
    }
    if (yield* fs.exists(current).pipe(Effect.orElseSucceed(() => false)))
      return path.join(yield* fs.realPath(current), ...rest);
    const parent = path.dirname(current);
    if (parent === current) break;
    rest.unshift(path.basename(current));
    current = parent;
  }
  return path.resolve(declared);
});

/** Whether `inner` is `outer` or lies under it, compared by whole path components. */
const within = (path: Path.Path, outer: string, inner: string) => {
  const relative = path.relative(outer, inner);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

/**
 * The Buddy folder's canonical path, beside the Folder (not inside or around it), so its agents
 * load its own instructions. A missing folder keeps its declared path, so Chat runs and an earlier
 * Buddy project stays unlisted; nothing resolves to it, so no turn runs there.
 */
const canonicalBuddyFolder = Effect.fn("LazurioManagedFolder.canonicalBuddyFolder")(function* (
  folder: string | undefined,
  declared: string,
) {
  if (folder === undefined)
    return yield* invalid("T3CODE_LAZURIO_BUDDY_FOLDER needs T3CODE_LAZURIO_FOLDER.");
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const root =
    path.isAbsolute(declared) &&
    !(yield* fs.exists(declared).pipe(Effect.orElseSucceed(() => false)))
      ? yield* canonicalMissing(declared)
      : yield* canonicalFolder("T3CODE_LAZURIO_BUDDY_FOLDER", declared);
  if (within(path, folder, root) || within(path, root, folder))
    return yield* invalid(
      "T3CODE_LAZURIO_BUDDY_FOLDER must be beside the Lazurio Folder, not inside it or around it.",
    );
  return root;
});

export const resolveManagedFolderConfig = Effect.gen(function* () {
  const env = yield* ManagedFolderEnv;
  const folder =
    env.folder === undefined
      ? undefined
      : yield* canonicalFolder("T3CODE_LAZURIO_FOLDER", env.folder);
  const buddyFolder =
    env.buddyFolder === undefined
      ? undefined
      : yield* canonicalBuddyFolder(folder, env.buddyFolder);
  if (
    env.toolsUrl !== undefined &&
    (env.toolsUrl.protocol !== "https:" || env.toolsUrl.username || env.toolsUrl.password)
  )
    return yield* invalid("T3CODE_LAZURIO_TOOLS_URL must be an HTTPS URL without credentials.");
  return {
    ...(folder === undefined
      ? {}
      : { cwd: folder, lazurioFolder: folder, autoBootstrapProjectFromCwd: false }),
    ...(buddyFolder === undefined ? {} : { lazurioBuddyFolder: buddyFolder }),
    ...(env.toolsUrl === undefined ? {} : { lazurioToolsUrl: env.toolsUrl.toString() }),
  };
});
