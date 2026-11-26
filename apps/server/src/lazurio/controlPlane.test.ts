import { assert, describe, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import { layerBuddyServer } from "./buddySurface.testkit.ts";
import { BUDDY_THREAD_ID } from "./buddySurfaceThread.ts";
import * as ControlPlane from "./controlPlane.ts";
import { ThreadLifecycle, type ThreadLifecycleEvent } from "./threadLifecycle.ts";

const withControlPlane = <A, E, R>(test: () => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<ThreadLifecycleEvent>();
    const lifecycle = Layer.succeed(
      ThreadLifecycle,
      ThreadLifecycle.of({
        ready: Effect.void,
        events: Stream.fromQueue(events),
        liveThread: () => Effect.succeedNone,
        liveThreads: Effect.succeed([]),
      }),
    );
    return yield* test().pipe(Effect.provide(ControlPlane.layer.pipe(Layer.provide(lifecycle))));
  }).pipe(
    Effect.provide(layerBuddyServer),
    Effect.scoped,
    // Buddy's own T3 Code, whose one thread is BUDDY_THREAD_ID.
    Effect.provideService(HostProcess.Environment, { T3CODE_LAZURIO_BUDDY: "1" }),
  );

const pageOf = Effect.fn("test.controlPlane.pageOf")(function* (attachmentId: string) {
  const config = yield* ServerConfig.ServerConfig;
  return yield* (yield* FileSystem.FileSystem).readFileString(
    `${config.attachmentsDir}/${attachmentId}.html`,
  );
});

describe("Control Plane", () => {
  it.live("a second publish overwrites the page at the same id and reaches a follower", () =>
    withControlPlane(() =>
      Effect.gen(function* () {
        const controlPlane = yield* ControlPlane.ControlPlane;
        const first = yield* controlPlane.publish({
          threadId: BUDDY_THREAD_ID,
          html: "<!doctype html><p>first</p>",
          title: "Control Plane",
        });
        const subscribed = yield* Deferred.make<void>();
        const follower = yield* controlPlane.follow(BUDDY_THREAD_ID).pipe(
          Stream.tap(() => Deferred.succeed(subscribed, undefined)),
          Stream.take(2),
          Stream.runCollect,
          Effect.forkScoped,
        );
        // The follower got the page as it is now, so it is subscribed to what comes next.
        yield* Deferred.await(subscribed);
        const second = yield* controlPlane.publish({
          threadId: BUDDY_THREAD_ID,
          html: "<!doctype html><p>second</p>",
          title: "Control Plane",
        });

        assert.strictEqual(second.attachmentId, first.attachmentId);
        assert.isTrue(second.attachmentId.endsWith("-html"));
        assert.notStrictEqual(second.revision, first.revision);
        assert.include(yield* pageOf(second.attachmentId), "<p>second</p>");
        assert.deepStrictEqual(yield* controlPlane.read(BUDDY_THREAD_ID), second);
        assert.deepStrictEqual(
          (yield* Fiber.join(follower)).map((snapshot) => snapshot.revision),
          [first.revision, second.revision],
        );
      }),
    ),
  );

  it.live("only Buddy's thread has one", () =>
    withControlPlane(() =>
      Effect.gen(function* () {
        const controlPlane = yield* ControlPlane.ControlPlane;
        const other = ThreadId.make("thread-other");
        const refused = yield* controlPlane
          .publish({ threadId: other, html: "<p>x</p>", title: "x" })
          .pipe(Effect.flip);
        assert.strictEqual(refused.reason, "not-buddys-thread");
        assert.isNull(yield* controlPlane.read(other));
      }),
    ),
  );

  it.live("a forgotten thread's page and record go", () =>
    withControlPlane(() =>
      Effect.gen(function* () {
        const controlPlane = yield* ControlPlane.ControlPlane;
        const published = yield* controlPlane.publish({
          threadId: BUDDY_THREAD_ID,
          html: "<p>x</p>",
          title: "x",
        });
        yield* controlPlane.forget(BUDDY_THREAD_ID);
        const config = yield* ServerConfig.ServerConfig;
        assert.isFalse(
          yield* (yield* FileSystem.FileSystem).exists(
            `${config.attachmentsDir}/${published.attachmentId}.html`,
          ),
        );
        assert.isNull(yield* controlPlane.read(BUDDY_THREAD_ID));
      }),
    ),
  );
});
