// @effect-diagnostics nodeBuiltinImport:off - the server's state is a temporary folder.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { MessageId, RunId, ScheduledTaskId, ThreadId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import { ScheduledTaskService } from "../scheduledTasks/ScheduledTaskService.ts";
import { buddySignalOf } from "./buddySignal.ts";
import {
  BuddyTaskFailures,
  failuresOf,
  layer as layerBuddyTaskFailures,
  recordTaskFailures,
} from "./buddyTaskFailures.ts";

const THREAD = ThreadId.make("buddy");
const at = (minute: number) => `2026-11-18T20:${String(minute).padStart(2, "0")}:00.000Z`;
const task = (
  runCount: number,
  lastRunStatus: "failed" | "succeeded" | "running" | "never",
  lastRunAt = at(4),
) => ({
  id: ScheduledTaskId.make("task-1"),
  threadId: THREAD,
  lastRunStatus,
  lastRunAt,
  runCount,
});

describe("when a task bound to Buddy's thread last failed", () => {
  it("is when the list first reported the failed run, not the run's start, and an edit keeps it", () => {
    // Started at :04, reported failed at :07.
    const failed = recordTaskFailures({}, [task(1, "failed")], at(7));
    assert.deepStrictEqual(failuresOf(failed, THREAD), [DateTime.makeUnsafe(at(7))]);
    // Saving or disabling the task at :09 reports the list again with the same run.
    const edited = recordTaskFailures(failed, [task(1, "failed")], at(9));
    assert.deepStrictEqual(failuresOf(edited, THREAD), [DateTime.makeUnsafe(at(7))]);
  });

  it("keeps a failure through a later start and success until a completed turn clears it", () => {
    // Failed at :05; the next occurrence starts at :10 (running) and succeeds at :12.
    const failed = recordTaskFailures({}, [task(1, "failed")], at(5));
    const running = recordTaskFailures(failed, [task(1, "running")], at(10));
    const succeeded = recordTaskFailures(running, [task(2, "succeeded")], at(12));
    assert.deepStrictEqual(failuresOf(succeeded, THREAD), [DateTime.makeUnsafe(at(5))]);
    const completed = (minute: number) => ({
      id: RunId.make(`run-${minute}`),
      ordinal: minute,
      status: "completed" as const,
      userMessageId: MessageId.make(`m${minute}`),
      completedAt: DateTime.makeUnsafe(at(minute)),
    });
    const state = (runs: ReadonlyArray<ReturnType<typeof completed>>) =>
      buddySignalOf({
        threadId: THREAD,
        lastVisitedAt: DateTime.makeUnsafe(at(59)),
        runs,
        pendingRequests: [],
        stopRequested: new Set(),
        failedTaskRuns: failuresOf(succeeded, THREAD),
        messages: new Map(),
      }).state;
    // No Buddy turn completed after :05: still failed.
    assert.strictEqual(state([completed(3)]), "failed");
    // A Buddy turn completed at :15 clears it.
    assert.strictEqual(state([completed(3), completed(15)]), "quiet");
  });

  it("dates a later failed run anew, and drops a deleted task's failure", () => {
    const first = recordTaskFailures({}, [task(1, "failed")], at(5));
    const again = recordTaskFailures(first, [task(2, "failed", at(10))], at(12));
    assert.deepStrictEqual(failuresOf(again, THREAD), [DateTime.makeUnsafe(at(12))]);
    assert.deepStrictEqual(recordTaskFailures(again, [], at(15)), {});
  });

  it("dates a failure the record does not know by the reading that finds it, also after a start", () => {
    // Started at :04, a Buddy turn completed at :05, failed at :07; the server starts at :30
    // with no record: the failure is dated :30, after the turn, so the sign shows it.
    const seen = recordTaskFailures({}, [task(1, "failed", at(4))], at(30));
    const failedTaskRuns = failuresOf(seen, THREAD);
    assert.deepStrictEqual(failedTaskRuns, [DateTime.makeUnsafe(at(30))]);
    const sign = buddySignalOf({
      threadId: THREAD,
      lastVisitedAt: DateTime.makeUnsafe(at(6)),
      runs: [
        {
          id: RunId.make("run-1"),
          ordinal: 1,
          status: "completed",
          userMessageId: MessageId.make("m1"),
          completedAt: DateTime.makeUnsafe(at(5)),
        },
      ],
      pendingRequests: [],
      stopRequested: new Set(),
      failedTaskRuns,
      messages: new Map(),
    });
    assert.strictEqual(sign.state, "failed");
    // A failure the file already holds keeps its time across the restart.
    const kept = recordTaskFailures(
      { "task-1": { threadId: THREAD, runCount: 1, failedAt: at(7) } },
      [task(1, "failed", at(4))],
      at(30),
    );
    assert.deepStrictEqual(failuresOf(kept, THREAD), [DateTime.makeUnsafe(at(7))]);
  });

  it("raises a stale failure once, on the first start without a record, until the next completed turn", () => {
    // The known cost (Lazurio/t3code#232): failed at :04, cleared by a turn at :05, and this
    // version first starts at :30 with no record. The failure is dated :30 and shows ...
    const completed = (ordinal: number, minute: number) => ({
      id: RunId.make(`run-${ordinal}`),
      ordinal,
      status: "completed" as const,
      userMessageId: MessageId.make(`m${ordinal}`),
      completedAt: DateTime.makeUnsafe(at(minute)),
    });
    const state = (runs: ReadonlyArray<ReturnType<typeof completed>>, recordedAt: number) =>
      buddySignalOf({
        threadId: THREAD,
        lastVisitedAt: DateTime.makeUnsafe(at(59)),
        runs,
        pendingRequests: [],
        stopRequested: new Set(),
        failedTaskRuns: failuresOf(
          recordTaskFailures({}, [task(1, "failed", at(3))], at(recordedAt)),
          THREAD,
        ),
        messages: new Map(),
      }).state;
    assert.strictEqual(state([completed(1, 5)], 30), "failed");
    // ... only until the next completed turn, at :31.
    assert.strictEqual(state([completed(1, 5), completed(2, 31)], 30), "quiet");
    // A later start reads the record back, so it raises nothing again.
    const recorded = recordTaskFailures({}, [task(1, "failed", at(3))], at(30));
    const restarted = recordTaskFailures(recorded, [task(1, "failed", at(3))], at(45));
    assert.deepStrictEqual(failuresOf(restarted, THREAD), [DateTime.makeUnsafe(at(30))]);
  });

  it("belongs only to the thread the task is bound to", () => {
    const other = recordTaskFailures(
      {},
      [{ ...task(1, "failed"), threadId: ThreadId.make("other") }],
      at(7),
    );
    assert.deepStrictEqual(failuresOf(other, THREAD), []);
  });
});

const unused = () => Effect.die("unused in this test");
const tasksListing = (tasks: ReadonlyArray<ReturnType<typeof task>>) =>
  Layer.succeed(
    ScheduledTaskService,
    ScheduledTaskService.of({
      list: () => Effect.succeed({ tasks } as never),
      subscribeList: () => Stream.empty,
      upsert: unused,
      setEnabled: unused,
      delete: unused,
      deleteForThread: unused,
      moveThreadTasks: unused,
      runNow: unused,
      rotateWebhookToken: unused,
      listWebhookDeliveries: unused,
      getWebhookDelivery: unused,
      triggerWebhook: unused,
    }),
  );

describe("the record of a Buddy server's failed tasks", () => {
  it.effect("is kept in the server's state, and a restart reads it back", () => {
    const base = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "buddy-task-failures-"));
    const failedAt = (tasks: ReadonlyArray<ReturnType<typeof task>>) =>
      Effect.flatMap(BuddyTaskFailures, (failures) => failures.failedAt(THREAD)).pipe(
        Effect.provide(
          layerBuddyTaskFailures.pipe(
            Layer.provide(tasksListing(tasks)),
            Layer.provide(ServerConfig.layerTest(base, base)),
          ),
        ),
        Effect.provideService(HostProcess.Environment, { T3CODE_LAZURIO_BUDDY: "1" }),
        Effect.provide(NodeServices.layer),
        Effect.scoped,
      );
    return Effect.gen(function* () {
      // The start at :30 finds a failure the record does not know: dated by that reading.
      yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(at(30))));
      assert.deepStrictEqual(yield* failedAt([task(1, "failed", at(3))]), [
        DateTime.makeUnsafe(at(30)),
      ]);
      const file = NodeFS.readdirSync(base, { recursive: true }).find((entry) =>
        String(entry).endsWith("buddy-task-failures.json"),
      );
      assert.isDefined(file);
      // A restart at :40 keeps the recorded time.
      yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(at(40))));
      assert.deepStrictEqual(yield* failedAt([task(1, "failed", at(3))]), [
        DateTime.makeUnsafe(at(30)),
      ]);
    }).pipe(
      Effect.ensuring(Effect.sync(() => NodeFS.rmSync(base, { recursive: true, force: true }))),
    );
  });

  it.effect("watches nothing on a server without Buddy", () =>
    Effect.gen(function* () {
      const base = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "buddy-task-failures-"));
      const failures = yield* Effect.flatMap(BuddyTaskFailures, (service) =>
        service.failedAt(THREAD),
      ).pipe(
        Effect.provide(
          layerBuddyTaskFailures.pipe(
            Layer.provide(tasksListing([task(1, "failed")])),
            Layer.provide(ServerConfig.layerTest(base, base)),
          ),
        ),
        Effect.provideService(HostProcess.Environment, {}),
        Effect.provide(NodeServices.layer),
        Effect.scoped,
      );
      assert.deepStrictEqual(failures, []);
      NodeFS.rmSync(base, { recursive: true, force: true });
    }),
  );
});
