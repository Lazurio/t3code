/**
 * Lazurio overlay (root decision 0210, evening addendum, point 5): what Buddy writes or decides
 * shows „Buddy za <user>“ and Delegace's wake in Buddy's thread is not shown. The web reads the
 * server's record (`/api/lazurio/acting-senders`); an agent's message waits for an answer so a wake
 * never flashes, and without one (ACTING_SENDER_WAIT_MS) it shows as upstream shows it.
 */
import type * as DateTime from "effect/DateTime";

import {
  actingSenderInRecord,
  actingSenderMessageKey,
  hidesActingSenderState,
  type MessageSenderFields,
} from "./actingSenderVisibility";

const ACTING_SENDERS_ROUTE = "/api/lazurio/acting-senders";

/** How long an agent's message waits for the answer before it shows as upstream shows it. */
export const ACTING_SENDER_WAIT_MS = 5_000;

export type ActingSender =
  | { readonly kind: "buddy"; readonly for: string; readonly forAccusative?: string }
  | { readonly kind: "delegace" };

/** What Buddy's mark says: „Buddy za Alenu“ in Czech, "Buddy for Alena" otherwise. */
export const actingSenderLabel = (
  sender: Extract<ActingSender, { readonly kind: "buddy" }>,
  czech: boolean,
): string => (czech ? `Buddy za ${sender.forAccusative ?? sender.for}` : `Buddy for ${sender.for}`);

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

/** A message as the timeline holds it, as far as its sender goes. */
export interface ActingSenderMessage extends MessageSenderFields {
  readonly createdAt: string;
}

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

/** A thread's answers so far. It is replaced, never changed, when they change. */
export interface ActingSendersView {
  readonly answer: ActingSendersAnswer | null;
  /** The server gave no record: an older T3 without the route, or an error. */
  readonly stopped: boolean;
  /** Rows that waited ACTING_SENDER_WAIT_MS without an answer that covers them. */
  readonly expired: ReadonlySet<string>;
}

/**
 * What the page knows of a row's sender: the sender, or `null` once an answer covers the row
 * without one. It is "pending" until then, and "unavailable" when no answer comes: the server has
 * no record to give, or the row waited longer than ACTING_SENDER_WAIT_MS.
 */
export type ActingSenderState = ActingSender | null | "pending" | "unavailable";

const covers = (answer: ActingSendersAnswer, key: string, time: number) =>
  actingSenderInRecord(answer, key, time) !== "pending";

/** A row's sender in the thread's answers: `time` is when its message or decision happened. */
export const actingSenderStateIn = (
  view: ActingSendersView | undefined,
  key: string,
  time: number,
): ActingSenderState => {
  if (view === undefined) return "pending";
  if (view.stopped) return "unavailable";
  const state = view.answer === null ? "pending" : actingSenderInRecord(view.answer, key, time);
  return state === "pending" && view.expired.has(key) ? "unavailable" : state;
};

/**
 * The rows without the messages the thread hides. `messageOf` gives a row's message, if it is one.
 * Rows of the person's own messages, of T3's and of everything else are never held back. The same
 * array comes back when none is hidden.
 */
export function visibleActingSenderRows<Row>(
  rows: Row[],
  messageOf: (row: Row) => ActingSenderMessage | undefined,
  view: ActingSendersView | undefined,
): Row[] {
  const visible = rows.filter((row) => {
    const message = messageOf(row);
    if (message === undefined) return true;
    const key = actingSenderMessageKey(message);
    return (
      key === null ||
      !hidesActingSenderState(actingSenderStateIn(view, key, Date.parse(message.createdAt)))
    );
  });
  return visible.length === rows.length ? rows : visible;
}

export interface ActingSenderLoader {
  readonly subscribe: (listener: () => void) => () => void;
  /** A row of the thread wants its sender: `time` is when its message or decision happened. */
  readonly want: (threadId: string, key: string, time: number) => void;
  /** The thread's answers so far: the same object until they change. */
  readonly view: (threadId: string) => ActingSendersView | undefined;
}

interface ThreadSenders {
  view: ActingSendersView;
  loading: boolean;
  /** A row that the answer under way may not cover wanted its sender meanwhile. */
  again: boolean;
  readonly wanted: Map<string, number>;
}

/**
 * One request per thread for the rows that want their sender, and one more for rows its answer
 * does not cover: a dispatch that still ran may have held them back, or they appeared while it was
 * out. A row no answer covers within ACTING_SENDER_WAIT_MS expires. A server that answers anything
 * but a record is not asked again.
 */
export function makeActingSenderLoader(
  load: (threadId: string) => Promise<unknown>,
  after: (milliseconds: number, run: () => void) => void = (milliseconds, run) =>
    void setTimeout(run, milliseconds),
): ActingSenderLoader {
  const threads = new Map<string, ThreadSenders>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const start = (threadId: string, thread: ThreadSenders, retry: boolean) => {
    thread.loading = true;
    thread.again = false;
    void load(threadId)
      .then(parseActingSenders, () => null)
      .then((answer) => {
        thread.loading = false;
        thread.view =
          answer === null ? { ...thread.view, stopped: true } : { ...thread.view, answer };
        notify();
        if (
          answer !== null &&
          (thread.again || !retry) &&
          [...thread.wanted].some(
            ([key, time]) => !covers(answer, key, time) && !thread.view.expired.has(key),
          )
        )
          start(threadId, thread, !thread.again);
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
        thread = {
          view: { answer: null, stopped: false, expired: new Set() },
          loading: false,
          again: false,
          wanted: new Map(),
        };
        threads.set(threadId, thread);
      }
      if (thread.view.stopped || thread.wanted.has(key)) return;
      thread.wanted.set(key, time);
      if (thread.view.answer !== null && covers(thread.view.answer, key, time)) return;
      const waiting = thread;
      after(ACTING_SENDER_WAIT_MS, () => {
        const { answer, stopped, expired } = waiting.view;
        if (stopped || (answer !== null && covers(answer, key, time))) return;
        waiting.view = { ...waiting.view, expired: new Set(expired).add(key) };
        notify();
      });
      if (thread.loading) thread.again = true;
      else start(threadId, thread, false);
    },
    view: (threadId) => threads.get(threadId)?.view,
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
