/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): in Buddy's T3 Code, for every client and
 * agent: no fork, rollback, other thread or deleting Buddy's thread (each would fork Hermes's
 * session and Buddy's memory), no guest share (a Personalspace is never shared, 0091) and no
 * checkpoints in Buddy's project. Otherwise each decorator returns upstream's service as it is.
 */
import type { OrchestrationV2ServerCommand } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { buddyProjectFolder, isBuddySurfaceEnvironment } from "./buddySurface.ts";
import {
  BUDDY_THREAD_CREATE_COMMAND_ID,
  BUDDY_THREAD_ID,
  MakingBuddysThread,
} from "./buddySurfaceThread.ts";

const oneConversation =
  "Buddy keeps one conversation: Buddy's T3 Code has no other threads, forks or rollbacks.";
const neverShared = "Buddy's conversation belongs to its person and is never shared with a guest.";

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
