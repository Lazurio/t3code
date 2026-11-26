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
import * as ThreadLifecycle from "./threadLifecycle.ts";

/** While set, the rename that commits a record fails, as a full disk or a lost mount would. */
const failRecordWrites = { on: false };
/** While set, the rename that commits a record waits: `reached` opens, then it waits for `release`. */
const holdRecordWrite: {
  gate: { reached: Deferred.Deferred<void>; release: Deferred.Deferred<void> } | null;
} = { gate: null };
const fileSystemFailingRecords = Layer.effect(
  FileSystem.FileSystem,
  Effect.map(FileSystem.FileSystem, (fileSystem) =>
    FileSystem.FileSystem.of({
      ...fileSystem,
      rename: (from, to) => {
        if (!to.endsWith(".json")) return fileSystem.rename(from, to);
        if (failRecordWrites.on)
          return fileSystem.rename(from, `${to}.missing-directory/record.json`);
        const gate = holdRecordWrite.gate;
        return gate === null
          ? fileSystem.rename(from, to)
          : Deferred.succeed(gate.reached, undefined).pipe(
              Effect.andThen(Deferred.await(gate.release)),
              Effect.andThen(fileSystem.rename(from, to)),
            );
      },
    }),
  ),
);

const withControlPlane = <A, E, R>(test: () => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    failRecordWrites.on = false;
    holdRecordWrite.gate = null;
    const events = yield* Queue.unbounded<ThreadLifecycle.ThreadLifecycleEvent>();
    const lifecycle = Layer.succeed(
      ThreadLifecycle.ThreadLifecycle,
      ThreadLifecycle.ThreadLifecycle.of({
        ready: Effect.void,
        events: Stream.fromQueue(events),
        liveThread: () => Effect.succeedNone,
        liveThreads: Effect.succeed([]),
      }),
    );
    return yield* test().pipe(
      Effect.provide(
        ControlPlane.layer.pipe(Layer.provide(lifecycle), Layer.provide(fileSystemFailingRecords)),
      ),
    );
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
  it.live("a second publish becomes the thread's page and reaches a follower", () =>
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

  it.live("a revision's URL keeps its own page: A, B, A again, then C", () =>
    withControlPlane(() =>
      Effect.gen(function* () {
        const controlPlane = yield* ControlPlane.ControlPlane;
        const config = yield* ServerConfig.ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;
        const publish = (body: string) =>
          controlPlane.publish({
            threadId: BUDDY_THREAD_ID,
            html: `<!doctype html><p>${body}</p>`,
            title: "Control Plane",
          });
        const exists = (id: string) => fileSystem.exists(`${config.attachmentsDir}/${id}.html`);
        const a = yield* publish("A");
        const b = yield* publish("B");
        // A client that read A before B was published still gets A at A's URL.
        assert.notStrictEqual(b.attachmentId, a.attachmentId);
        assert.include(yield* pageOf(a.attachmentId), "<p>A</p>");
        const again = yield* publish("A");
        assert.strictEqual(again.attachmentId, a.attachmentId);
        assert.include(yield* pageOf(again.attachmentId), "<p>A</p>");
        assert.isTrue(yield* exists(b.attachmentId));
        const c = yield* publish("C");
        // The record names C and, for a client still loading it, A; B is two revisions back.
        assert.isTrue(yield* exists(c.attachmentId));
        assert.isTrue(yield* exists(a.attachmentId));
        assert.isFalse(yield* exists(b.attachmentId));
        assert.deepStrictEqual(yield* controlPlane.read(BUDDY_THREAD_ID), c);
      }),
    ),
  );

  it.live("a failed record write leaves the published page and its record as they were", () =>
    withControlPlane(() =>
      Effect.gen(function* () {
        const controlPlane = yield* ControlPlane.ControlPlane;
        const config = yield* ServerConfig.ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;
        const first = yield* controlPlane.publish({
          threadId: BUDDY_THREAD_ID,
          html: "<!doctype html><p>first</p>",
          title: "Control Plane",
        });
        failRecordWrites.on = true;
        const failed = yield* controlPlane
          .publish({
            threadId: BUDDY_THREAD_ID,
            html: "<!doctype html><p>second</p>",
            title: "Control Plane",
          })
          .pipe(Effect.flip);
        failRecordWrites.on = false;
        assert.strictEqual(failed.reason, "store-failed");
        // A reader, then or later, gets the old pair; the new page did not stay behind.
        assert.deepStrictEqual(yield* controlPlane.read(BUDDY_THREAD_ID), first);
        assert.include(yield* pageOf(first.attachmentId), "<p>first</p>");
        const pages = (yield* fileSystem.readDirectory(config.attachmentsDir)).filter((name) =>
          name.endsWith("-html.html"),
        );
        assert.deepStrictEqual(pages, [`${first.attachmentId}.html`]);
      }),
    ),
  );

  it.live("a reader during a publish gets the old page and record", () =>
    withControlPlane(() =>
      Effect.gen(function* () {
        const controlPlane = yield* ControlPlane.ControlPlane;
        const first = yield* controlPlane.publish({
          threadId: BUDDY_THREAD_ID,
          html: "<!doctype html><p>first</p>",
          title: "Control Plane",
        });
        const gate = {
          reached: yield* Deferred.make<void>(),
          release: yield* Deferred.make<void>(),
        };
        holdRecordWrite.gate = gate;
        const publishing = yield* controlPlane
          .publish({
            threadId: BUDDY_THREAD_ID,
            html: "<!doctype html><p>second</p>",
            title: "Control Plane",
          })
          .pipe(Effect.forkScoped);
        // The new page is written and its record not yet: a read now still gets the old pair.
        yield* Deferred.await(gate.reached);
        assert.deepStrictEqual(yield* controlPlane.read(BUDDY_THREAD_ID), first);
        assert.include(yield* pageOf(first.attachmentId), "<p>first</p>");
        yield* Deferred.succeed(gate.release, undefined);
        const second = yield* Fiber.join(publishing);
        assert.deepStrictEqual(yield* controlPlane.read(BUDDY_THREAD_ID), second);
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
