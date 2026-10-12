/**
 * Lazurio overlay (plan DEV-6646, task 501): what the threads' tabs need of T3 Code's
 * orchestration, behind one adapter, so a port to another orchestration rewrites only this file.
 * The live threads are those the projection shows: neither archived nor deleted.
 */

import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";

/** A live thread: its id and title. */
export interface LiveThread {
  readonly id: ThreadId;
  readonly title: string;
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
    /** The live thread with this id, or none for an unknown, archived or deleted one. */
    readonly liveThread: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<LiveThread>, ThreadLifecycleReadError>;
    /** Every live thread. */
    readonly liveThreads: Effect.Effect<ReadonlyArray<LiveThread>, ThreadLifecycleReadError>;
  }
>()("t3/lazurio/threadLifecycle") {}

const make = Effect.gen(function* () {
  const projection = yield* ProjectionSnapshotQuery;
  return ThreadLifecycle.of({
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
