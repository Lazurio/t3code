/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): Buddy's defaults, applied once before
 * recovery reads them: no "Continue where you left off." (T3's words in Buddy's memory), no agent
 * browser, Codex and Claude off. `<state>/lazurio/buddy-surface.json` records it, so later changes
 * stay; a failed write is retried at the next start.
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
