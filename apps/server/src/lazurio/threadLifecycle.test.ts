import { assert, describe, it } from "@effect/vitest";
import { ThreadId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import * as ServerRuntimeStartup from "../serverRuntimeStartup.ts";
import * as ThreadLifecycle from "./threadLifecycle.ts";

const threadId = "4a1f9c2e-7b3d-4e5f-8a6b-9c0d1e2f3a4b";

/** Orchestration v2 events (orchestrationV2.ts): the thread on the event, the whole thread as the
 * payload. */
const appThread = (title: string) => ({ id: threadId, projectId: "p", title, branch: null });
const events = {
  created: { type: "thread.created", threadId, payload: appThread("Web") },
  renamed: { type: "thread.metadata-updated", threadId, payload: appThread("Web shop") },
  archived: { type: "thread.archived", threadId, payload: appThread("Web shop") },
  unarchived: { type: "thread.unarchived", threadId, payload: appThread("Web shop") },
  deleted: { type: "thread.deleted", threadId, payload: appThread("Web shop") },
};

describe("the threads' lifecycle", () => {
  it("reads retired, restored and titled from the orchestration's events", () => {
    assert.deepStrictEqual(ThreadLifecycle.threadLifecycleEvent(events.created), {
      type: "titled",
      threadId,
      title: "Web",
    });
    assert.deepStrictEqual(ThreadLifecycle.threadLifecycleEvent(events.renamed), {
      type: "titled",
      threadId,
      title: "Web shop",
    });
    assert.deepStrictEqual(ThreadLifecycle.threadLifecycleEvent(events.archived), {
      type: "retired",
      threadId,
    });
    assert.deepStrictEqual(ThreadLifecycle.threadLifecycleEvent(events.deleted), {
      type: "retired",
      threadId,
    });
    assert.deepStrictEqual(ThreadLifecycle.threadLifecycleEvent(events.unarchived), {
      type: "restored",
      threadId,
    });
  });

  it("ignores every other event, and one without a thread or a title", () => {
    assert.isNull(
      ThreadLifecycle.threadLifecycleEvent({ type: "thread.pinned", threadId, payload: {} }),
    );
    assert.isNull(ThreadLifecycle.threadLifecycleEvent({ type: "run.created", threadId }));
    assert.isNull(ThreadLifecycle.threadLifecycleEvent({ type: "thread.archived", payload: {} }));
    assert.isNull(
      ThreadLifecycle.threadLifecycleEvent({
        type: "thread.created",
        threadId,
        payload: appThread(" "),
      }),
    );
  });
});

/** A thread shell as the projection has it; the adapter reads only these fields. */
const shell = (id: string, title: string, archived: boolean) =>
  ({
    id: ThreadId.make(id),
    title,
    archivedAt: archived ? DateTime.makeUnsafe(0) : null,
  }) as unknown as OrchestrationV2ThreadShell;

const live = "11111111-1111-4111-8111-111111111111";
const archived = "22222222-2222-4222-8222-222222222222";

/** The adapter on an orchestrator that knows one live and one archived thread. */
const adapterOn = (streamDomainEvents: OrchestratorV2["Service"]["streamDomainEvents"]) => {
  const snapshotOptions: Array<unknown> = [];
  const orchestrator = Layer.mock(OrchestratorV2)({
    getThreadShell: (id) =>
      Effect.succeed(
        id === live
          ? shell(live, "Web", false)
          : id === archived
            ? shell(archived, "Old", true)
            : null,
      ),
    getShellSnapshot: (options) =>
      Effect.sync(() => {
        snapshotOptions.push(options);
        return {
          schemaVersion: 1,
          snapshotSequence: 0,
          threads: [shell(live, "Web", false)],
          archivedThreads: [],
        };
      }),
    streamDomainEvents,
  });
  const startup = Layer.mock(ServerRuntimeStartup.ServerRuntimeStartup)({
    awaitCommandReady: Effect.void,
  });
  return {
    snapshotOptions,
    layer: ThreadLifecycle.layer.pipe(Layer.provide(Layer.mergeAll(orchestrator, startup))),
  };
};

describe("the lifecycle adapter on orchestration v2", () => {
  it.effect("counts neither an archived nor a deleted thread as live", () => {
    const { layer, snapshotOptions } = adapterOn(Stream.never);
    return Effect.gen(function* () {
      const lifecycle = yield* ThreadLifecycle.ThreadLifecycle;
      yield* lifecycle.ready;

      assert.deepStrictEqual(
        yield* lifecycle.liveThread(ThreadId.make(live)),
        Option.some({ id: ThreadId.make(live), title: "Web" }),
      );
      assert.isTrue(Option.isNone(yield* lifecycle.liveThread(ThreadId.make(archived))));
      // Deleted or unknown: the projection has no shell for it.
      assert.isTrue(
        Option.isNone(
          yield* lifecycle.liveThread(ThreadId.make("33333333-3333-4333-8333-333333333333")),
        ),
      );
      // Every live thread: the projection's active ones, which leave out the archived.
      assert.deepStrictEqual(yield* lifecycle.liveThreads, [
        { id: ThreadId.make(live), title: "Web" },
      ]);
      assert.deepStrictEqual(snapshotOptions, [{ location: "active" }]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("subscribes again when the orchestration's event stream fails", () => {
    let subscriptions = 0;
    const { layer } = adapterOn(
      Stream.suspend(() => {
        subscriptions += 1;
        return subscriptions === 1
          ? Stream.concat(
              Stream.make(events.archived as never),
              Stream.fail({ _tag: "ProjectionStoreReadError" } as never),
            )
          : Stream.concat(Stream.make(events.unarchived as never), Stream.never);
      }),
    );
    return Effect.gen(function* () {
      const lifecycle = yield* ThreadLifecycle.ThreadLifecycle;
      const received = yield* lifecycle.events.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* TestClock.adjust("1 second");

      assert.deepStrictEqual(yield* Fiber.join(received), [
        { type: "retired", threadId },
        { type: "restored", threadId },
      ]);
      assert.strictEqual(subscriptions, 2);
    }).pipe(Effect.provide(layer));
  });
});
