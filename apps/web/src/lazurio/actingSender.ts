/**
 * Lazurio overlay (root decision 0210, evening addendum, point 5; plan DEV-6676): who sent a
 * thread's message or decided its request when a session acted as someone. What Buddy writes or
 * decides shows „Buddy za <user>“ (in English "Buddy for <user>"), and Delegace's wake in Buddy's own
 * thread shows „Delegace“, its name in both languages. The person's own steps show nothing new.
 *
 * The server records it from the session a step was dispatched through
 * (apps/server/src/lazurio/actingSenders.ts) and answers a thread's record on
 * `GET /api/lazurio/acting-senders?threadId=<id>`. The web only reads it, for the rows Buddy or
 * Delegace could have written or decided: a message an agent sent from outside any thread, which
 * upstream labels "Sent by another agent", and a question or permission request someone decided.
 */
import type * as DateTime from "effect/DateTime";

export const ACTING_SENDERS_ROUTE = "/api/lazurio/acting-senders";

export type ActingSender =
  | { readonly kind: "buddy"; readonly for: string; readonly forAccusative?: string }
  | { readonly kind: "delegace" };

/** What the mark says: „Buddy za Tomáše“ in Czech, "Buddy for Tomáš" otherwise, or „Delegace“. */
export const actingSenderLabel = (sender: ActingSender, czech: boolean): string =>
  sender.kind === "delegace"
    ? "Delegace"
    : czech
      ? `Buddy za ${sender.forAccusative ?? sender.for}`
      : `Buddy for ${sender.for}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A name on one line, as the server's claim holds it (actingSender.ts there). */
const isName = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= 64 &&
  value === value.trim() &&
  !/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/u.test(value);

const parseSender = (value: unknown): ActingSender | null => {
  if (!isRecord(value)) return null;
  if (value.kind === "delegace") return { kind: "delegace" };
  if (value.kind !== "buddy" || !isName(value.for)) return null;
  if (value.forAccusative === undefined) return { kind: "buddy", for: value.for };
  return isName(value.forAccusative)
    ? { kind: "buddy", for: value.for, forAccusative: value.forAccusative }
    : null;
};

export interface ActingSendersAnswer {
  /** Every message and decision from before this time (epoch ms) is answered. */
  readonly at: number;
  /** By `message:<id>` and `request:<id>`. */
  readonly senders: ReadonlyMap<string, ActingSender>;
}

/** The server's answer, read field by field: anything else is no answer, a bad entry is skipped. */
export function parseActingSenders(value: unknown): ActingSendersAnswer | null {
  if (
    !isRecord(value) ||
    typeof value.at !== "number" ||
    !Number.isFinite(value.at) ||
    !Array.isArray(value.messages) ||
    !Array.isArray(value.requests)
  )
    return null;
  const senders = new Map<string, ActingSender>();
  const read = (entries: ReadonlyArray<unknown>, kind: "message" | "request") => {
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const id = kind === "message" ? entry.messageId : entry.requestId;
      const sender = parseSender(entry.sender);
      if (typeof id === "string" && sender !== null) senders.set(`${kind}:${id}`, sender);
    }
  };
  read(value.messages, "message");
  read(value.requests, "request");
  return { at: value.at, senders };
}

/**
 * The key of a message Buddy or Delegace could have sent: a user message an agent sent from outside
 * any thread, not an automation's or T3's own. Every other message is never theirs.
 */
export const actingSenderMessageKey = (message: {
  readonly id: string;
  readonly role: string;
  readonly createdBy?: string | undefined;
  readonly creationSource?: string | undefined;
  readonly senderThreadId?: string | undefined;
  readonly scheduledTaskId?: string | undefined;
}): string | null =>
  message.role === "user" &&
  message.createdBy === "agent" &&
  message.creationSource !== "server" &&
  message.senderThreadId === undefined &&
  message.scheduledTaskId === undefined
    ? `message:${message.id}`
    : null;

/** The key of a question or permission request someone decided, and when; else null. */
export const actingSenderRequestOf = (
  item:
    | {
        readonly type: string;
        readonly requestId?: string;
        readonly completedAt?: DateTime.DateTime | null;
      }
    | undefined,
): { readonly key: string; readonly decidedAt: number } | null =>
  item !== undefined &&
  (item.type === "approval_request" || item.type === "user_input_request") &&
  item.requestId !== undefined &&
  item.completedAt !== undefined &&
  item.completedAt !== null
    ? { key: `request:${item.requestId}`, decidedAt: item.completedAt.epochMilliseconds }
    : null;

export interface ActingSenderLoader {
  readonly subscribe: (listener: () => void) => () => void;
  /** A row of the thread wants its sender: `time` is when its message or decision happened. */
  readonly want: (threadId: string, key: string, time: number) => void;
  /** The row's sender, once the server named one. */
  readonly sender: (threadId: string, key: string) => ActingSender | undefined;
}

interface ThreadSenders {
  answer: ActingSendersAnswer | null;
  loading: boolean;
  /** A row that the answer under way may not cover wanted its sender meanwhile. */
  again: boolean;
  /** No answer comes: the server has no record to give, or no route for it. */
  stopped: boolean;
  readonly wanted: Map<string, number>;
}

const covers = (answer: ActingSendersAnswer | null, key: string, time: number) =>
  answer !== null && (answer.senders.has(key) || time < answer.at);

/**
 * One request per thread for the rows that want their sender, and one more only for rows that
 * appeared while it was out and that its answer does not cover. A row older than the last answer
 * without a sender has none. A server that answers anything but a record is not asked again.
 */
export function makeActingSenderLoader(
  load: (threadId: string) => Promise<unknown>,
): ActingSenderLoader {
  const threads = new Map<string, ThreadSenders>();
  const listeners = new Set<() => void>();
  const start = (threadId: string, thread: ThreadSenders) => {
    thread.loading = true;
    thread.again = false;
    void load(threadId)
      .then(parseActingSenders, () => null)
      .then((answer) => {
        thread.loading = false;
        if (answer === null) {
          thread.stopped = true;
          return;
        }
        thread.answer = answer;
        for (const listener of listeners) listener();
        if (thread.again && [...thread.wanted].some(([key, time]) => !covers(answer, key, time)))
          start(threadId, thread);
      });
  };
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    want: (threadId, key, time) => {
      let thread = threads.get(threadId);
      if (thread === undefined) {
        thread = { answer: null, loading: false, again: false, stopped: false, wanted: new Map() };
        threads.set(threadId, thread);
      }
      if (thread.stopped) return;
      thread.wanted.set(key, time);
      if (covers(thread.answer, key, time)) return;
      if (thread.loading) thread.again = true;
      else start(threadId, thread);
    },
    sender: (threadId, key) => threads.get(threadId)?.answer?.senders.get(key),
  };
}

/** The page's loader: its own origin's server, as the session cookie reaches it. */
export const actingSenderLoader = makeActingSenderLoader((threadId) =>
  window
    .fetch(`${ACTING_SENDERS_ROUTE}?threadId=${encodeURIComponent(threadId)}`, {
      credentials: "same-origin",
      cache: "no-store",
    })
    .then((response) => (response.ok ? response.json() : null)),
);
