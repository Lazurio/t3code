import { assert, describe, it } from "@effect/vitest";
import { MessageId, RunId, ScheduledTaskId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  type BuddySignalInput,
  type BuddySignalStarterMessage,
  buddySignalMessageIds,
  buddySignalOf,
} from "./buddySignal.ts";

const THREAD = ThreadId.make("buddy-thread");
const at = (minute: number) =>
  DateTime.makeUnsafe(`2026-11-18T20:${String(minute).padStart(2, "0")}:00.000Z`);
const iso = (minute: number) => DateTime.formatIso(at(minute));

type Status = BuddySignalInput["runs"][number]["status"];
/** A run started by `by`'s message `m<ordinal>`, settled at `minute` (null while it runs). */
const run = (ordinal: number, status: Status, minute: number | null) => ({
  id: RunId.make(`run-${ordinal}`),
  ordinal,
  status,
  userMessageId: MessageId.make(`m${ordinal}`),
  completedAt: minute === null ? null : at(minute),
});
const person = { createdBy: "user" as const };
const agent = { createdBy: "agent" as const };
const otherThread = { createdBy: "user" as const, senderThreadId: ThreadId.make("other") };
const task = { createdBy: "user" as const, scheduledTaskId: ScheduledTaskId.make("task-1") };

const signal = (
  input: Partial<Omit<BuddySignalInput, "messages">> & {
    readonly senders?: Record<number, BuddySignalStarterMessage>;
  },
) => {
  const full = {
    threadId: THREAD,
    lastVisitedAt: null,
    runs: [],
    pendingRequests: [],
    stopRequested: new Set<RunId>(),
    failedTaskRuns: [],
    ...input,
  };
  const messages = new Map(
    Object.entries(input.senders ?? {}).map(([ordinal, sender]) => [
      MessageId.make(`m${ordinal}`),
      sender,
    ]),
  );
  // The reader loads exactly the senders the signal names, so a test that leaves one out fails.
  for (const id of buddySignalMessageIds(full))
    assert.isTrue(messages.has(id), `the test names the sender of ${id}`);
  const { version, threadId, ...rest } = buddySignalOf({ ...full, messages });
  assert.strictEqual(version, 1);
  assert.strictEqual(threadId, THREAD);
  return rest;
};

describe("the sign by Buddy's avatar", () => {
  it("is quiet for a new thread and once the person read every answer", () => {
    assert.deepStrictEqual(signal({}), {
      state: "quiet",
      since: null,
      request: null,
      startedBy: null,
    });
    assert.strictEqual(
      signal({
        runs: [run(1, "completed", 5)],
        lastVisitedAt: at(6),
        senders: { 1: person },
      }).state,
      "quiet",
    );
  });

  it("waits on a pending request, before a failure and an unread answer", () => {
    const pendingRequests = [
      { kind: "user_input" as const, createdAt: at(9), runId: RunId.make("run-3") },
      { kind: "command" as const, createdAt: at(8), runId: RunId.make("run-3") },
    ];
    assert.deepStrictEqual(
      signal({
        runs: [run(1, "completed", 2), run(2, "failed", 4), run(3, "running", null)],
        pendingRequests,
        senders: { 1: person, 2: person, 3: agent },
      }),
      // The oldest request is the one it waits on; the run that asked is an agent's.
      { state: "waiting", since: iso(8), request: { kind: "command" }, startedBy: "other" },
    );
  });

  it("fails for a failed last turn or an interrupt nobody asked for, and a completed turn clears it", () => {
    const failed = signal({
      runs: [run(1, "completed", 2), run(2, "failed", 4)],
      lastVisitedAt: at(1),
      senders: { 1: person, 2: person },
    });
    // The unread answer before it waits behind the failure.
    assert.deepStrictEqual(failed, {
      state: "failed",
      since: iso(4),
      request: null,
      startedBy: "person",
    });
    assert.strictEqual(
      signal({ runs: [run(1, "interrupted", 3)], senders: { 1: task } }).state,
      "failed",
    );
    // Stopped on request: no fault, and nothing new either.
    assert.strictEqual(
      signal({
        runs: [run(1, "interrupted", 3)],
        stopRequested: new Set([RunId.make("run-1")]),
        lastVisitedAt: at(2),
        senders: { 1: person },
      }).state,
      "quiet",
    );
    // A turn still running after the failure keeps it; a completed one clears it.
    assert.strictEqual(
      signal({
        runs: [run(1, "failed", 3), run(2, "running", null)],
        senders: { 1: person },
      }).state,
      "failed",
    );
    assert.deepStrictEqual(
      signal({
        runs: [run(1, "failed", 3), run(2, "completed", 5)],
        lastVisitedAt: at(4),
        senders: { 1: person, 2: person },
      }),
      { state: "answered", since: iso(5), request: null, startedBy: "person" },
    );
    // A cancelled queued turn or a rollback settles nothing.
    assert.strictEqual(
      signal({
        runs: [run(1, "failed", 3), run(2, "cancelled", 4), run(3, "rolled_back", 5)],
        senders: { 1: person },
      }).state,
      "failed",
    );
  });

  it("fails for a bound task that failed after the last completed turn", () => {
    assert.deepStrictEqual(
      signal({
        runs: [run(1, "completed", 2)],
        lastVisitedAt: at(3),
        failedTaskRuns: [at(7), at(5)],
        senders: { 1: person },
      }),
      { state: "failed", since: iso(5), request: null, startedBy: "other" },
    );
    assert.strictEqual(
      signal({
        runs: [run(1, "completed", 6)],
        lastVisitedAt: at(7),
        failedTaskRuns: [at(5)],
        senders: { 1: person },
      }).state,
      "quiet",
    );
  });

  it("keeps a task's failure cleared by a completed turn when a later turn was stopped on request", () => {
    // The task fails at :05, a turn completes at :06, another is stopped on request at :07.
    assert.strictEqual(
      signal({
        runs: [run(1, "completed", 6), run(2, "interrupted", 7)],
        stopRequested: new Set([RunId.make("run-2")]),
        lastVisitedAt: at(8),
        failedTaskRuns: [at(5)],
        senders: { 1: person, 2: person },
      }).state,
      "quiet",
    );
  });

  it("answers from the oldest unread answer, the person's if they started any of them", () => {
    // The person writes, Buddy answers, then three turns of another thread follow.
    const runs = [
      run(1, "completed", 2),
      run(2, "completed", 3),
      run(3, "completed", 4),
      run(4, "completed", 5),
    ];
    assert.deepStrictEqual(
      signal({
        runs,
        lastVisitedAt: at(1),
        senders: { 1: person, 2: otherThread, 3: otherThread, 4: task },
      }),
      { state: "answered", since: iso(2), request: null, startedBy: "person" },
    );
    // All unread turns are others'; then the person's own turn completes.
    const others = signal({
      runs: runs.slice(1),
      lastVisitedAt: at(1),
      senders: { 2: otherThread, 3: otherThread, 4: task },
    });
    assert.deepStrictEqual(others, {
      state: "answered",
      since: iso(3),
      request: null,
      startedBy: "other",
    });
    assert.deepStrictEqual(
      signal({
        runs: [...runs.slice(1), run(5, "completed", 8)],
        lastVisitedAt: at(1),
        senders: { 2: otherThread, 3: otherThread, 4: task, 5: person },
      }),
      { ...others, startedBy: "person" },
    );
    // An agent's message, sent from outside any thread, is not the person's.
    assert.strictEqual(
      signal({ runs: [run(1, "completed", 2)], senders: { 1: agent } }).startedBy,
      "other",
    );
  });

  it("reading while a turn runs leaves that turn's answer unread", () => {
    const runs = [run(1, "completed", 2), run(2, "running", null)];
    assert.strictEqual(
      signal({ runs, lastVisitedAt: at(3), senders: { 1: person } }).state,
      "quiet",
    );
    assert.deepStrictEqual(
      signal({
        runs: [run(1, "completed", 2), run(2, "completed", 6)],
        lastVisitedAt: at(3),
        senders: { 1: person, 2: person },
      }),
      { state: "answered", since: iso(6), request: null, startedBy: "person" },
    );
  });

  it("names no starter it could not read, rather than guessing one", () => {
    assert.strictEqual(
      buddySignalOf({
        threadId: THREAD,
        lastVisitedAt: null,
        runs: [run(1, "failed", 2)],
        pendingRequests: [],
        stopRequested: new Set(),
        failedTaskRuns: [],
        messages: new Map(),
      }).startedBy,
      null,
    );
  });
});
