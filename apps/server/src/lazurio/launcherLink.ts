import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import packageJson from "../../package.json" with { type: "json" };
import { repointLauncher, resolveLauncherPath } from "../cli/update.ts";
import { pinnedRuntimePaths } from "../cloud/pinnedRuntime.ts";
import { parseServiceState, SERVICE_STATE_FILE } from "../cloud/serviceProtocol.ts";

/**
 * An in-app Update moves only the launcher's `activeVersion`; an older `t3` would write pairings
 * into a database the newer server does not read (Lazurio/t3code#30). A trial that can still roll
 * back never moves the link, and only a link into this home's `runtime/versions` moves, never a
 * foreign `t3`, by the same rules `t3 update` repoints by.
 */
export const repointLauncherLink = Effect.fn("lazurio.launcher_link.repoint")(function* (input: {
  /** Whether the boot-service launcher runs this server. */
  readonly managed: boolean;
  readonly baseDir: string;
  readonly version?: string;
}) {
  const version = input.version ?? packageJson.version;
  const platform = yield* HostProcess.Platform;
  // Windows has no boot service, and its `t3.cmd` shim is rewritten only by `t3 update`.
  if (!input.managed || platform === "win32") return [];
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const state = yield* fs
    .readFileString(path.join(input.baseDir, "runtime", SERVICE_STATE_FILE))
    .pipe(
      Effect.map(parseServiceState),
      Effect.orElseSucceed(() => undefined),
    );
  if (state?.activeVersion !== version || state.update?.status === "pending") return [];

  const runtime = pinnedRuntimePaths(path, input.baseDir, version, platform);
  const environment = yield* HostProcess.Environment;
  // Where a bare `t3` resolves, and where the install scripts put the link.
  const links = new Set<string>();
  const onPath = yield* resolveLauncherPath.pipe(
    Effect.provideService(HostProcess.InvokedAs, "t3"),
  );
  if (onPath !== undefined) links.add(onPath);
  const binDir =
    environment["T3CODE_INSTALL_BIN_DIR"]?.trim() ||
    path.join(yield* HostProcess.HomeDirectory, ".local", "bin");
  links.add(path.join(binDir, "t3"));

  const repointed: Array<string> = [];
  for (const link of links) {
    const target = yield* fs.readLink(link).pipe(Effect.option);
    if (
      Option.isSome(target) &&
      path.resolve(path.dirname(link), target.value) === runtime.entryPath
    ) {
      continue;
    }
    const moved = yield* repointLauncher({
      launchedAs: link,
      versionsDir: path.dirname(runtime.versionDir),
      targetEntryPath: runtime.entryPath,
    }).pipe(
      Effect.catchTags({
        CliUpdateError: (error) =>
          Effect.logWarning("Could not point the t3 command at this server's runtime", {
            reason: error.reason,
          }).pipe(Effect.as(Option.none<string>())),
      }),
    );
    if (Option.isSome(moved)) {
      yield* Effect.logInfo("Pointed the t3 command at this server's runtime", { link, version });
      repointed.push(moved.value);
    }
  }
  return repointed;
});
