/**
 * Lazurio overlay: the threads' tabs reach orchestration only through this adapter. Archive and
 * delete retire a thread's tabs, unarchive restores none; live threads are neither archived nor
 * deleted. `streamDomainEvents` is a live tail that can fail, so it resubscribes after a failure.
 */

import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import * as ServerRuntimeStartup from "../serverRuntimeStartup.ts";

export type ThreadLifecycleEvent =
  | { readonly type: "retired"; readonly threadId: string }
  | { readonly type: "restored"; readonly threadId: string }
  | { readonly type: "titled"; readonly threadId: string; readonly title: string };

/** A live thread: its id and title. */
export interface LiveThread {
  readonly id: ThreadId;
  readonly title: string;
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/** The lifecycle meaning of an orchestration event, or null for any other. */
export function threadLifecycleEvent(event: {
  readonly type: string;
  readonly threadId?: unknown;
  readonly payload?: unknown;
}): ThreadLifecycleEvent | null {
  if (!nonEmpty(event.threadId)) return null;
  const threadId = event.threadId;
  switch (event.type) {
    case "thread.archived":
    case "thread.deleted":
      return { type: "retired", threadId };
    case "thread.unarchived":
      return { type: "restored", threadId };
    case "thread.created":
    case "thread.metadata-updated": {
      const title =
        typeof event.payload === "object" && event.payload !== null && "title" in event.payload
          ? event.payload.title
          : undefined;
      return nonEmpty(title) ? { type: "titled", threadId, title } : null;
    }
    default:
      return null;
  }
}

/** The projection could not be read. */
export class ThreadLifecycleReadError extends Schema.TaggedError<ThreadLifecycleReadError>()(
  "ThreadLifecycleReadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The threads could not be read.";
  }
}

export class ThreadLifecycle extends Context.Service<
  ThreadLifecycle,
  {
    /** Settles once the server takes commands, after its startup recovery (command readiness). */
    readonly ready: Effect.Effect<void>;
    /** The lifecycle of every thread from now on (a hot stream, no replay). */
    readonly events: Stream.Stream<ThreadLifecycleEvent>;
    /** The live thread with this id, or none for an unknown, archived or deleted one. */
    readonly liveThread: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<LiveThread>, ThreadLifecycleReadError>;
    /** Every live thread. */
    readonly liveThreads: Effect.Effect<ReadonlyArray<LiveThread>, ThreadLifecycleReadError>;
  }
>()("t3/lazurio/threadLifecycle") {}

/** How soon a failed event stream is subscribed again. */
const RESUBSCRIBE = Schedule.spaced("1 second");

const make = Effect.gen(function* () {
  const orchestrator = yield* OrchestratorV2;
  const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
  return ThreadLifecycle.of({
    ready: startup.awaitCommandReady.pipe(Effect.ignore),
    events: orchestrator.streamDomainEvents.pipe(
      Stream.tapError((cause) =>
        Effect.logWarning("The threads' lifecycle stream failed; subscribing again", { cause }),
      ),
      Stream.retry(RESUBSCRIBE),
      // The schedule never ends, so no failure gets past it.
      Stream.orDie,
      Stream.map(threadLifecycleEvent),
      Stream.filter((event): event is ThreadLifecycleEvent => event !== null),
    ),
    liveThread: Effect.fn("ThreadLifecycle.liveThread")(function (threadId) {
      return orchestrator.getThreadShell(threadId).pipe(
        Effect.map((thread) =>
          thread === null || thread.archivedAt !== null
            ? Option.none()
            : Option.some({ id: thread.id, title: thread.title }),
        ),
        Effect.mapError((cause) => new ThreadLifecycleReadError({ cause })),
      );
    }),
    liveThreads: orchestrator.getShellSnapshot({ location: "active" }).pipe(
      Effect.map((snapshot) =>
        snapshot.threads.map((thread) => ({ id: thread.id, title: thread.title })),
      ),
      Effect.mapError((cause) => new ThreadLifecycleReadError({ cause })),
    ),
  });
});

export const layer = Layer.effect(ThreadLifecycle, make);
