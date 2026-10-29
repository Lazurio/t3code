/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): Buddy's T3 Code has no fork, rollback, other
 * thread or deleting Buddy's thread (each forks Hermes's session), no lower runtime mode, no guest
 * share or linked Environment (a Personalspace is never shared, 0091) and no checkpoints in Buddy's
 * project, for every client and agent; elsewhere upstream's services as is.
 */
import type { OrchestrationV2ServerCommand, ServerSettings as Settings } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ServerSettings from "../serverSettings.ts";
import { buddyProjectFolder, isBuddySurfaceEnvironment } from "./buddySurface.ts";
import {
  BUDDY_THREAD_CREATE_COMMAND_ID,
  BUDDY_THREAD_ID,
  MakingBuddysThread,
} from "./buddySurfaceThread.ts";

const oneConversation =
  "Buddy keeps one conversation: Buddy's T3 Code has no other threads, forks or rollbacks.";
const neverShared = "Buddy's conversation belongs to its person and is never shared with a guest.";
const fullAccess =
  "Buddy always works with full access: Buddy's thread keeps the full-access mode.";

/**
 * Why Buddy's T3 Code refuses `command`, or null when it runs. `makingBuddysThread` holds only
 * inside Buddy's thread route.
 */
export function buddyCommandRefusal(
  command: OrchestrationV2ServerCommand,
  makingBuddysThread: boolean,
): string | null {
  switch (command.type) {
    case "thread.fork":
    case "checkpoint.rollback":
      return oneConversation;
    case "thread.create":
      return makingBuddysThread &&
        command.threadId === BUDDY_THREAD_ID &&
        command.commandId === BUDDY_THREAD_CREATE_COMMAND_ID
        ? null
        : oneConversation;
    case "thread.delete":
      return command.threadId === BUDDY_THREAD_ID ? oneConversation : null;
    case "thread.guest-share.open":
    case "thread.guest-share.redeem":
    case "thread.guest-message.submit":
      return neverShared;
    case "thread.runtime-mode.set":
      return command.threadId === BUDDY_THREAD_ID && command.runtimeMode !== "full-access"
        ? fullAccess
        : null;
    default:
      return null;
  }
}

export const guardBuddyCommands = <E, R>(live: Layer.Layer<Orchestrator.OrchestratorV2, E, R>) =>
  Layer.effect(
    Orchestrator.OrchestratorV2,
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      if (!isBuddySurfaceEnvironment(yield* HostProcess.Environment)) return orchestrator;
      return Orchestrator.OrchestratorV2.of({
        ...orchestrator,
        dispatch: Effect.fn("LazurioBuddyGuards.dispatch")(function* (command) {
          const refusal = buddyCommandRefusal(command, yield* Effect.service(MakingBuddysThread));
          if (refusal === null) return yield* orchestrator.dispatch(command);
          return yield* new Orchestrator.OrchestratorCommandRejectedError({
            commandId: command.commandId,
            commandType: command.type,
            cause: refusal,
          });
        }),
      });
    }),
  ).pipe(Layer.provide(live));

export const withoutBuddyCheckpoints = <E, R>(
  live: Layer.Layer<CheckpointStore.CheckpointStore, E, R>,
) =>
  Layer.effect(
    CheckpointStore.CheckpointStore,
    Effect.gen(function* () {
      const store = yield* CheckpointStore.CheckpointStore;
      if (!isBuddySurfaceEnvironment(yield* HostProcess.Environment)) return store;
      const folder = yield* buddyProjectFolder;
      if (folder === null) return store;
      const path = yield* Path.Path;
      const inBuddyProject = (cwd: string) => {
        const resolved = path.resolve(cwd);
        return resolved === folder || resolved.startsWith(`${folder}${path.sep}`);
      };
      return CheckpointStore.CheckpointStore.of({
        ...store,
        isGitRepository: Effect.fn("LazurioBuddyGuards.isGitRepository")(function* (cwd) {
          return inBuddyProject(cwd) ? false : yield* store.isGitRepository(cwd);
        }),
      });
    }),
  ).pipe(Layer.provide(live));

/**
 * Every upstream gate of linked Environments (peer-link OAuth, a linked client's `/mcp`, outbound
 * links, link requests, remote tasks) reads this setting, so Buddy's reads it off whatever is stored
 * and every write stores it off.
 */
export const withoutLinkedEnvironments = <E, R>(
  live: Layer.Layer<ServerSettings.ServerSettingsService, E, R>,
) =>
  Layer.effect(
    ServerSettings.ServerSettingsService,
    Effect.gen(function* () {
      const settings = yield* ServerSettings.ServerSettingsService;
      if (!isBuddySurfaceEnvironment(yield* HostProcess.Environment)) return settings;
      const off = (current: Settings): Settings => ({
        ...current,
        linkedEnvironmentsEnabled: false,
      });
      const offPatch = <P extends object>(patch: P) => ({
        ...patch,
        linkedEnvironmentsEnabled: false,
      });
      const { updateSettingsWith } = settings;
      return ServerSettings.ServerSettingsService.of({
        start: settings.start,
        ready: settings.ready,
        getSettings: Effect.map(settings.getSettings, off),
        updateSettings: Effect.fn("LazurioBuddyGuards.updateSettings")(function* (patch) {
          return off(yield* settings.updateSettings(offPatch(patch)));
        }),
        updateProviderInstance: Effect.fn("LazurioBuddyGuards.updateProviderInstance")(
          function* (mutation, patch) {
            return off(yield* settings.updateProviderInstance(mutation, offPatch(patch ?? {})));
          },
        ),
        ...(updateSettingsWith === undefined
          ? {}
          : {
              updateSettingsWith: Effect.fn("LazurioBuddyGuards.updateSettingsWith")(
                function* (apply) {
                  return off(yield* updateSettingsWith((current) => off(apply(current))));
                },
              ),
            }),
        withSettingsSnapshot: Effect.fn("LazurioBuddyGuards.withSettingsSnapshot")(function* <
          A,
          E,
          R,
        >(use: (current: Settings) => Effect.Effect<A, E, R>) {
          return yield* settings.withSettingsSnapshot((current) => use(off(current)));
        }),
        // Upstream's are getters that subscribe on each read.
        get streamChanges() {
          return Stream.map(settings.streamChanges, off);
        },
        get subscribeChanges() {
          return Effect.map(settings.subscribeChanges, Stream.map(off));
        },
      });
    }),
  ).pipe(Layer.provide(live));
