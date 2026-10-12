/**
 * Lazurio overlay (plan DEV-6646, task 501): what the threads' tabs need of T3 Code's
 * orchestration, behind one adapter, so a port to another orchestration rewrites only this file.
 * A thread that is archived or deleted is `retired` and lets go of its tabs; one that is
 * unarchived is `restored` (its tabs ended and do not come back); a title is the label of the
 * thread's holder file. The live threads are those the projection shows: neither archived nor
 * deleted.
 *
 * v0.0.45 reads `OrchestrationEngineService.streamDomainEvents`, whose events carry the thread in
 * `payload.threadId` and a new title on `thread.created` / `thread.meta-updated`. Upstream's
 * orchestration v2 (`OrchestratorV2.streamDomainEvents`) carries it in `event.threadId`, and the
 * title on `thread.created` / `thread.metadata-updated`. `threadLifecycleEvent` reads both shapes
 * (threadLifecycle.test.ts), so the port swaps only the stream and the reads.
 */

import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
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

/** The lifecycle meaning of an orchestration event of either shape, or null for any other. */
export function threadLifecycleEvent(event: {
  readonly type: string;
  readonly threadId?: unknown;
  readonly payload?: unknown;
}): ThreadLifecycleEvent | null {
  const payload =
    typeof event.payload === "object" && event.payload !== null
      ? (event.payload as Record<string, unknown>)
      : {};
  const threadId = nonEmpty(event.threadId)
    ? event.threadId
    : nonEmpty(payload.threadId)
      ? payload.threadId
      : null;
  if (threadId === null) return null;
  switch (event.type) {
    case "thread.archived":
    case "thread.deleted":
      return { type: "retired", threadId };
    case "thread.unarchived":
      return { type: "restored", threadId };
    case "thread.created":
    case "thread.meta-updated":
    case "thread.metadata-updated":
      return nonEmpty(payload.title) ? { type: "titled", threadId, title: payload.title } : null;
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
    /** Settles once the projection has caught up with the event log (command readiness). */
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

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const projection = yield* ProjectionSnapshotQuery;
  const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
  return ThreadLifecycle.of({
    ready: startup.awaitCommandReady.pipe(Effect.ignore),
    events: engine.streamDomainEvents.pipe(
      Stream.map(threadLifecycleEvent),
      Stream.filter((event): event is ThreadLifecycleEvent => event !== null),
    ),
    liveThread: (threadId) =>
      projection.getThreadShellById(threadId).pipe(
        Effect.map(Option.map((thread) => ({ id: thread.id, title: thread.title }))),
        Effect.mapError((cause) => new ThreadLifecycleReadError({ cause })),
      ),
    liveThreads: projection.getShellSnapshot().pipe(
      Effect.map((snapshot) =>
        snapshot.threads.map((thread) => ({ id: thread.id, title: thread.title })),
      ),
      Effect.mapError((cause) => new ThreadLifecycleReadError({ cause })),
    ),
  });
});

export const layer = Layer.effect(ThreadLifecycle, make);
