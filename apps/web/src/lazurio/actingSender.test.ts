import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  actingSenderLabel,
  actingSenderMessageKey,
  actingSenderRequestOf,
  makeActingSenderLoader,
  parseActingSenders,
} from "./actingSender";

// Root decision 0210, evening addendum, point 5: what Buddy writes or decides in a thread shows
// „Buddy za <user>“, Delegace's wake shows „Delegace“, and the person's own steps show nothing new.
// The server records it from the session (apps/server/src/lazurio/actingSenders.ts); the web only
// reads it, for the rows Buddy or Delegace could have written or decided.

describe("the server's answer", () => {
  it("is no answer unless it has its shape, and a sender the mark cannot carry is skipped", () => {
    for (const answer of [
      null,
      [],
      "Buddy za Tomáše",
      { messages: [], requests: [] },
      { at: "now", messages: [], requests: [] },
      { at: Number.NaN, messages: [], requests: [] },
      { at: 1, messages: {}, requests: [] },
    ])
      expect(parseActingSenders(answer)).toBeNull();

    const parsed = parseActingSenders({
      at: 1000,
      messages: [
        { messageId: "m1", sender: { kind: "buddy", for: "Tomáš", forAccusative: "Tomáše" } },
        { messageId: "m2", sender: { kind: "buddy", for: "" } },
        { messageId: "m3", sender: { kind: "buddy", for: "Tomáš\nAdmin" } },
        { messageId: "m4", sender: { kind: "buddy", for: "\u202EšámoT" } },
        { messageId: "m5", sender: { kind: "agent", for: "Tomáš" } },
        { messageId: "m6", sender: { kind: "buddy", for: "Tomáš", forAccusative: 7 } },
        { messageId: 7, sender: { kind: "delegace" } },
        { messageId: "m8", sender: { kind: "delegace" } },
      ],
      requests: [{ requestId: "r1", sender: { kind: "buddy", for: "Petr" } }, { requestId: "r2" }],
    });
    expect(parsed?.at).toBe(1000);
    expect([...(parsed?.senders ?? [])]).toEqual([
      ["message:m1", { kind: "buddy", for: "Tomáš", forAccusative: "Tomáše" }],
      ["message:m8", { kind: "delegace" }],
      ["request:r1", { kind: "buddy", for: "Petr" }],
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

describe("the mark's words", () => {
  it("say „Buddy za <user>“ in Czech, Buddy for <user> otherwise, and Delegace in both", () => {
    const buddy = { kind: "buddy", for: "Tomáš", forAccusative: "Tomáše" } as const;
    expect(actingSenderLabel(buddy, true)).toBe("Buddy za Tomáše");
    expect(actingSenderLabel(buddy, false)).toBe("Buddy for Tomáš");
    // Without the form after „za“ Czech shows the name as given.
    expect(actingSenderLabel({ kind: "buddy", for: "Bob" }, true)).toBe("Buddy za Bob");
    expect(actingSenderLabel({ kind: "delegace" }, true)).toBe("Delegace");
    expect(actingSenderLabel({ kind: "delegace" }, false)).toBe("Delegace");
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
    for (let turn = 0; turn < 4; turn++) await Promise.resolve();
  };

  it("asks once for many rows, once more only for rows its answer cannot cover", async () => {
    const loads: Array<{ threadId: string; answer: ReturnType<typeof deferred> }> = [];
    const loader = makeActingSenderLoader((threadId) => {
      const answer = deferred();
      loads.push({ threadId, answer });
      return answer.promise;
    });
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
    expect(loader.sender("thread-1", "message:m1")).toEqual({ kind: "delegace" });
    expect(loader.sender("thread-1", "message:m2")).toBeUndefined();
    expect(notified).toBe(1);
    expect(loads).toHaveLength(2);
    loads[1]?.answer.resolve(answerAt(70_000, ["m1", "m3"]));
    await settle();
    expect(loader.sender("thread-1", "message:m3")).toEqual({ kind: "delegace" });
    // Nothing more is asked by itself.
    expect(loads).toHaveLength(2);

    // A row older than the last answer has no sender and is not asked again; a newer one is.
    loader.want("thread-1", "message:m2", 10_000);
    expect(loads).toHaveLength(2);
    loader.want("thread-1", "message:m4", 70_000);
    expect(loads).toHaveLength(3);
    // Another thread asks for its own.
    loader.want("thread-2", "request:r1", 1);
    expect(loads.map((load) => load.threadId)).toEqual([
      "thread-1",
      "thread-1",
      "thread-1",
      "thread-2",
    ]);
  });

  it("stops asking for a thread whose server gives no record", async () => {
    let loads = 0;
    const loader = makeActingSenderLoader(() => {
      loads++;
      return loads === 1 ? Promise.resolve(null) : Promise.reject(new Error("offline"));
    });
    loader.want("thread-1", "request:r1", 1);
    await settle();
    loader.want("thread-1", "request:r2", Date.now());
    expect(loads).toBe(1);
    loader.want("thread-2", "message:m1", Date.now());
    await settle();
    loader.want("thread-2", "message:m2", Date.now());
    expect(loads).toBe(2);
    expect(loader.sender("thread-1", "request:r1")).toBeUndefined();
  });
});
