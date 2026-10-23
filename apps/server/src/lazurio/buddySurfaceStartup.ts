/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): Buddy's T3 Code at startup, once the
 * settings run and before recovery reads them.
 *
 * - Buddy's defaults, applied once: no "Continue where you left off." after an update, which would
 *   be T3's own words in Buddy's memory; no browser for the agent; Codex and Claude off, since
 *   Buddy's T3 Code runs only Buddy. `<state>/lazurio/buddy-surface.json` records that they were
 *   applied, so what the person changes afterwards stays. When they cannot be written, the server
 *   starts as upstream does with settings it cannot write, and tries again at its next start.
 *
 * Buddy's project needs nothing here: Machines declare Buddy's layer as the managed Folder of
 * Buddy's T3 Code, and the managed Folder's startup adopts or creates its project.
 */
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerSettings as Settings,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import { isBuddySurfaceEnvironment } from "./buddySurface.ts";

/** The instances Buddy's T3 Code turns off: the default instances of Codex and Claude. */
const OTHER_AGENTS = [
  { id: ProviderInstanceId.make("codex"), driver: ProviderDriverKind.make("codex") },
  { id: ProviderInstanceId.make("claudeAgent"), driver: ProviderDriverKind.make("claudeAgent") },
];

const recordPath = (path: Path.Path, stateDir: string) =>
  path.join(stateDir, "lazurio", "buddy-surface.json");

/** Buddy's defaults over `settings`. */
export const withBuddyDefaults = (settings: Settings): Settings => ({
  ...settings,
  continueThreadsAfterServerUpdate: false,
  enableAgentBrowserAccess: false,
  providerInstances: {
    ...settings.providerInstances,
    ...Object.fromEntries(
      OTHER_AGENTS.map(({ id, driver }) => [
        id,
        { ...settings.providerInstances[id], driver, enabled: false },
      ]),
    ),
  },
});

const applyDefaultsOnce = Effect.fn("LazurioBuddySurface.applyDefaultsOnce")(function* (
  fileSystem: FileSystem.FileSystem,
) {
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  const record = recordPath(path, stateDir);
  if (yield* fileSystem.exists(record)) return;
  const settings = yield* ServerSettings.ServerSettingsService;
  if (settings.updateSettingsWith === undefined) return;
  yield* settings.updateSettingsWith(withBuddyDefaults);
  yield* writeFileStringAtomically({
    filePath: record,
    contents: '{"version":1,"defaultsApplied":true}\n',
  }).pipe(Effect.provideService(FileSystem.FileSystem, fileSystem));
});

export const startBuddySurface = Effect.gen(function* () {
  if (!isBuddySurfaceEnvironment(yield* HostProcess.Environment)) return;
  // A server always runs on the platform's file system. Upstream's startup tests build this phase
  // without one, so it is read here rather than added to the startup's requirements.
  const fileSystem = yield* Effect.serviceOption(FileSystem.FileSystem);
  if (Option.isNone(fileSystem)) return;
  yield* applyDefaultsOnce(fileSystem.value).pipe(
    Effect.catch((cause) => Effect.logWarning("failed to apply Buddy's defaults", { cause })),
  );
});
