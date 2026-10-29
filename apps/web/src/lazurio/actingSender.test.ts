import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  ACTING_SENDER_WAIT_MS,
  type ActingSender,
  type ActingSenderMessage,
  type ActingSendersView,
  actingSenderLabel,
  actingSenderRequestOf,
  actingSenderStateIn,
  makeActingSenderLoader,
  parseActingSenders,
  visibleActingSenderRows,
} from "./actingSender";
import { actingSenderMessageKey } from "./actingSenderVisibility";

// Root decision 0210, evening addendum, point 5: what Buddy writes or decides shows „Buddy za
// <user>“, Delegace's wake is not shown, and the person's own steps show nothing new. The web only
// reads the server's record, for the rows Buddy or Delegace could have written or decided.

describe("the server's answer", () => {
  it("is no answer unless it has its shape, and a sender the mark cannot carry is skipped", () => {
    for (const answer of [
      null,
      [],
      "Buddy za Alenu",
      { messages: [], requests: [] },
      { at: "now", messages: [], requests: [] },
      { at: Number.NaN, messages: [], requests: [] },
      { at: 1, messages: {}, requests: [] },
    ])
      expect(parseActingSenders(answer)).toBeNull();

    const parsed = parseActingSenders({
      at: 1000,
      messages: [
        { messageId: "m1", sender: { kind: "buddy", for: "Alena", forAccusative: "Alenu" } },
        { messageId: "m2", sender: { kind: "buddy", for: "" } },
        { messageId: "m3", sender: { kind: "buddy", for: "Alena\nAdmin" } },
        { messageId: "m4", sender: { kind: "buddy", for: "\u202EšámoT" } },
        { messageId: "m5", sender: { kind: "agent", for: "Alena" } },
        { messageId: "m6", sender: { kind: "buddy", for: "Alena", forAccusative: 7 } },
        { messageId: 7, sender: { kind: "delegace" } },
        { messageId: "m8", sender: { kind: "delegace" } },
        // The kind's earlier name is no alias.
        { messageId: "m9", sender: { kind: "budicek" } },
      ],
      requests: [{ requestId: "r1", sender: { kind: "buddy", for: "Bob" } }, { requestId: "r2" }],
    });
    expect(parsed?.at).toBe(1000);
    expect([...(parsed?.senders ?? [])]).toEqual([
      ["message:m1", { kind: "buddy", for: "Alena", forAccusative: "Alenu" }],
      ["message:m8", { kind: "delegace" }],
      ["request:r1", { kind: "buddy", for: "Bob" }],
    ]);
  });
});

describe("the rows Buddy or Delegace could have written or decided", () => {
  const agentMessage = {
    id: "m1",
    role: "user",
    createdBy: "agent",
    creationSource: "mcp",
  } as const;

  it("are never the person's own message, an automation's, T3's or another thread's agent's", () => {
    expect(
      actingSenderMessageKey({ ...agentMessage, createdBy: "user", creationSource: "web" }),
    ).toBeNull();
    expect(actingSenderMessageKey({ ...agentMessage, scheduledTaskId: "task-1" })).toBeNull();
    expect(actingSenderMessageKey({ ...agentMessage, creationSource: "server" })).toBeNull();
    expect(actingSenderMessageKey({ ...agentMessage, senderThreadId: "thread-1" })).toBeNull();
    expect(actingSenderMessageKey({ ...agentMessage, role: "assistant" })).toBeNull();
  });

  it("are a message an agent sent from outside any thread, and a request someone decided", () => {
    expect(actingSenderMessageKey(agentMessage)).toBe("message:m1");

    // As the web holds a turn item: decoded, with its times as DateTime.
    const item = {
      type: "approval_request",
      requestId: "r1",
      completedAt: DateTime.makeUnsafe("2026-10-22T10:00:00.000Z"),
    };
    expect(actingSenderRequestOf(item)).toEqual({
      key: "request:r1",
      decidedAt: Date.parse("2026-10-22T10:00:00.000Z"),
    });
    expect(actingSenderRequestOf({ ...item, type: "user_input_request" })?.key).toBe("request:r1");
    // Still waiting: no one has decided it yet.
    expect(actingSenderRequestOf({ ...item, completedAt: null })).toBeNull();
    expect(actingSenderRequestOf({ ...item, type: "command_execution" })).toBeNull();
    expect(actingSenderRequestOf(undefined)).toBeNull();
  });
});

describe("a thread's messages while the server says who sent them", () => {
  const sent = Date.parse("2026-10-22T12:00:00.000Z");
  const message = (id: string, overrides: Partial<ActingSenderMessage> = {}) =>
    ({
      id,
      role: "user",
      createdAt: new Date(sent).toISOString(),
      createdBy: "agent",
      creationSource: "mcp",
      ...overrides,
    }) satisfies ActingSenderMessage;
  interface Row {
    readonly id: string;
    readonly message?: ActingSenderMessage;
  }
  const messageOf = (row: Row) => row.message;
  const ids = (rows: ReadonlyArray<Row>) => rows.map((row) => row.id);
  const answered = (
    at: number,
    senders: Record<string, ActingSender> = {},
    rest: Partial<ActingSendersView> = {},
  ): ActingSendersView => ({
    answer: { at, senders: new Map(Object.entries(senders)) },
    stopped: false,
    expired: new Set(),
    ...rest,
  });
  const buddy = { kind: "buddy", for: "Alena", forAccusative: "Alenu" } as const;

  it("hides Delegace's wake, and keeps Buddy's reply after it", () => {
    const rows: Row[] = [
      { id: "own", message: message("own", { createdBy: "user", creationSource: "web" }) },
      { id: "wake", message: message("wake") },
      { id: "reply", message: message("reply", { role: "assistant" }) },
      { id: "work" },
    ];
    const view = answered(sent + 1_000, { "message:wake": { kind: "delegace" } });
    expect(ids(visibleActingSenderRows(rows, messageOf, view))).toEqual(["own", "reply", "work"]);
    expect(actingSenderStateIn(view, "message:wake", sent)).toEqual({ kind: "delegace" });
  });

  it("holds an agent's message back until an answer covers it, then shows it as who sent it", () => {
    const rows: Row[] = [
      { id: "buddy", message: message("buddy") },
      { id: "agent", message: message("agent") },
    ];
    // Nothing asked yet, and an answer from before the messages: both wait.
    expect(ids(visibleActingSenderRows(rows, messageOf, undefined))).toEqual([]);
    const early = answered(sent - 1);
    expect(ids(visibleActingSenderRows(rows, messageOf, early))).toEqual([]);
    expect(actingSenderStateIn(early, "message:agent", sent)).toBe("pending");

    // The answer covers them: Buddy's shows with its mark, the other as upstream shows it.
    const covered = answered(sent + 1, { "message:buddy": buddy });
    expect(ids(visibleActingSenderRows(rows, messageOf, covered))).toEqual(["buddy", "agent"]);
    expect(actingSenderStateIn(covered, "message:buddy", sent)).toEqual(buddy);
    expect(actingSenderStateIn(covered, "message:agent", sent)).toBeNull();
    expect(actingSenderLabel(buddy, true)).toBe("Buddy za Alenu");
  });

  it("shows an agent's message at once when no answer comes: an older T3, or an error", () => {
    const rows: Row[] = [{ id: "agent", message: message("agent") }];
    const stopped: ActingSendersView = { answer: null, stopped: true, expired: new Set() };
    expect(visibleActingSenderRows(rows, messageOf, stopped)).toBe(rows);
    expect(actingSenderStateIn(stopped, "message:agent", sent)).toBe("unavailable");
  });

  it("never holds back the person's own messages, nor T3's, an automation's or a thread's", () => {
    const rows: Row[] = [
      { id: "own", message: message("own", { createdBy: "user", creationSource: "web" }) },
      { id: "t3", message: message("t3", { createdBy: "system", creationSource: "server" }) },
      { id: "automation", message: message("automation", { scheduledTaskId: "task-1" }) },
      { id: "thread", message: message("thread", { senderThreadId: "thread-2" }) },
      { id: "reply", message: message("reply", { role: "assistant" }) },
    ];
    // Even before any answer: they are never anyone's acting step.
    expect(visibleActingSenderRows(rows, messageOf, undefined)).toBe(rows);
  });

  it("shows a message that waited too long as upstream does, unless an answer later hides it", () => {
    const rows: Row[] = [{ id: "agent", message: message("agent") }];
    const expired = answered(sent - 1, {}, { expired: new Set(["message:agent"]) });
    expect(ids(visibleActingSenderRows(rows, messageOf, expired))).toEqual(["agent"]);
    expect(actingSenderStateIn(expired, "message:agent", sent)).toBe("unavailable");
    const later = answered(
      sent + 1,
      { "message:agent": { kind: "delegace" } },
      { expired: expired.expired },
    );
    expect(ids(visibleActingSenderRows(rows, messageOf, later))).toEqual([]);
  });
});

describe("the mark's words", () => {
  it("say „Buddy za <user>“ in Czech and Buddy for <user> otherwise; Delegace has none", () => {
    const buddy = { kind: "buddy", for: "Alena", forAccusative: "Alenu" } as const;
    expect(actingSenderLabel(buddy, true)).toBe("Buddy za Alenu");
    expect(actingSenderLabel(buddy, false)).toBe("Buddy for Alena");
    // Without the form after „za“ Czech shows the name as given.
    expect(actingSenderLabel({ kind: "buddy", for: "Bob" }, true)).toBe("Buddy za Bob");
  });
});

describe("the loader", () => {
  const answerAt = (at: number, messages: ReadonlyArray<string> = []) => ({
    at,
    messages: messages.map((messageId) => ({ messageId, sender: { kind: "delegace" } })),
    requests: [],
  });
  const deferred = () => {
    let resolve: (value: unknown) => void = () => undefined;
    const promise = new Promise<unknown>((done) => (resolve = done));
    return { promise, resolve };
  };
  const settle = async () => {
    for (let turn = 0; turn < 12; turn++) await Promise.resolve();
  };
  const never = () => undefined;

  it("asks once for many rows, and once more only for rows its answer does not cover", async () => {
    const loads: Array<{ threadId: string; answer: ReturnType<typeof deferred> }> = [];
    const loader = makeActingSenderLoader((threadId) => {
      const answer = deferred();
      loads.push({ threadId, answer });
      return answer.promise;
    }, never);
    let notified = 0;
    loader.subscribe(() => notified++);

    // The thread opens: its rows each want their sender, and one request goes out.
    loader.want("thread-1", "message:m1", 10_000);
    loader.want("thread-1", "message:m2", 10_000);
    expect(loads.map((load) => load.threadId)).toEqual(["thread-1"]);
    // A row that appears while it is out, newer than its answer, gets one more request after it.
    loader.want("thread-1", "message:m3", 60_000);
    loads[0]?.answer.resolve(answerAt(59_000, ["m1"]));
    await settle();
    const first = loader.view("thread-1");
    expect(actingSenderStateIn(first, "message:m1", 10_000)).toEqual({ kind: "delegace" });
    expect(actingSenderStateIn(first, "message:m2", 10_000)).toBeNull();
    expect(actingSenderStateIn(first, "message:m3", 60_000)).toBe("pending");
    expect(notified).toBe(1);
    expect(loads).toHaveLength(2);
    loads[1]?.answer.resolve(answerAt(70_000, ["m1", "m3"]));
    await settle();
    expect(actingSenderStateIn(loader.view("thread-1"), "message:m3", 60_000)).toEqual({
      kind: "delegace",
    });
    // The answers are new objects, and nothing more is asked by itself.
    expect(loader.view("thread-1")).not.toBe(first);
    expect(loads).toHaveLength(2);

    // A row the last answer covers is not asked about; a newer one is.
    loader.want("thread-1", "message:m4", 10_000);
    expect(loads).toHaveLength(2);
    loader.want("thread-1", "message:m5", 70_000);
    expect(loads).toHaveLength(3);
    // Its answer leaves it out, as a dispatch that still ran held it back: one more request.
    loads[2]?.answer.resolve(answerAt(69_000));
    await settle();
    expect(loads).toHaveLength(4);
    loads[3]?.answer.resolve(answerAt(69_500));
    await settle();
    expect(loads).toHaveLength(4);
    // Another thread asks for its own.
    loader.want("thread-2", "request:r1", 1);
    expect(loads.map((load) => load.threadId).at(-1)).toBe("thread-2");
  });

  it("stops asking a server that gives no record, and its rows show at once", async () => {
    let loads = 0;
    const loader = makeActingSenderLoader(() => {
      loads++;
      return loads === 1 ? Promise.resolve(null) : Promise.reject(new Error("offline"));
    }, never);
    loader.want("thread-1", "request:r1", 1);
    await settle();
    loader.want("thread-1", "request:r2", 2);
    expect(loads).toBe(1);
    expect(actingSenderStateIn(loader.view("thread-1"), "request:r2", 2)).toBe("unavailable");
    loader.want("thread-2", "message:m1", 2);
    await settle();
    loader.want("thread-2", "message:m2", 2);
    expect(loads).toBe(2);
    expect(actingSenderStateIn(loader.view("thread-2"), "message:m1", 2)).toBe("unavailable");
  });

  it("lets a row no answer covers expire after its wait, so it shows as upstream shows it", async () => {
    const timers: Array<{ milliseconds: number; run: () => void }> = [];
    const answer = deferred();
    const loader = makeActingSenderLoader(
      () => answer.promise,
      (milliseconds, run) => timers.push({ milliseconds, run }),
    );
    let notified = 0;
    loader.subscribe(() => notified++);
    loader.want("thread-1", "message:slow", 10_000);
    loader.want("thread-1", "message:quick", 9_000);
    expect(timers.map((timer) => timer.milliseconds)).toEqual([
      ACTING_SENDER_WAIT_MS,
      ACTING_SENDER_WAIT_MS,
    ]);
    // The answer covers only the quick one before the wait ends.
    answer.resolve(answerAt(9_500));
    await settle();
    for (const timer of timers) timer.run();
    const view = loader.view("thread-1");
    expect(actingSenderStateIn(view, "message:quick", 9_000)).toBeNull();
    expect(actingSenderStateIn(view, "message:slow", 10_000)).toBe("unavailable");
    expect(view?.expired).toEqual(new Set(["message:slow"]));
    expect(notified).toBeGreaterThanOrEqual(2);
  });
});
