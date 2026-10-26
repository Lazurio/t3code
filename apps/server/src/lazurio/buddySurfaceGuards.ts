/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): Buddy keeps one conversation. In Buddy's T3
 * Code these decorators of upstream's services, applied where the server composes them, hold that
 * for every client and agent, not only for Buddy's surface:
 *
 * - commands (guardBuddyCommands): no fork, no rollback and no thread other than Buddy's own, and
 *   Buddy's thread is never deleted. A fork or a rollback would start Hermes on a new session and
 *   fork Buddy's memory; another thread would be a second conversation. Buddy's own thread is made
 *   only by Buddy's thread route (`MakingBuddysThread`), never by a client's `thread.create`, even
 *   one with Buddy's ids: that would spend the route's fixed command on a thread of its own. And
 *   Buddy's thread keeps full access: Buddy always works with it (root decision 0210, addendum of
 *   HumanAndMachines/Lazurio#648), so no client sets it a lower runtime mode.
 * - checkpoints (withoutBuddyCheckpoints): none in Buddy's project. Buddy's layer lives in the
 *   Lazurio Folder, which may be inside a Git repository; T3 would otherwise write its hidden
 *   checkpoint refs there on every turn, for a rollback that Buddy never offers.
 *
 * Without `T3CODE_LAZURIO_BUDDY=1` each returns upstream's service as it is.
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
        dispatch: (command) =>
          Effect.flatMap(Effect.service(MakingBuddysThread), (makingBuddysThread) => {
            const refusal = buddyCommandRefusal(command, makingBuddysThread);
            return refusal === null
              ? orchestrator.dispatch(command)
              : Effect.fail(
                  new Orchestrator.OrchestratorCommandRejectedError({
                    commandId: command.commandId,
                    commandType: command.type,
                    cause: refusal,
                  }),
                );
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
        isGitRepository: (cwd) =>
          inBuddyProject(cwd) ? Effect.succeed(false) : store.isGitRepository(cwd),
      });
    }),
  ).pipe(Layer.provide(live));
