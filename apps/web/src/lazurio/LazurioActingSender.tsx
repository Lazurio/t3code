/**
 * Lazurio overlay (root decision 0210, evening addendum, point 5): who acted in a thread
 * (actingSender.ts) in the timeline's three places: rows without Delegace's wake, „Buddy za <user>“
 * on an agent's folded message, and the same mark beside a request Buddy decided. Only for threads
 * of the Environment that serves the page; elsewhere everything shows as upstream shows it.
 */
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { type ReactNode, useEffect, useSyncExternalStore } from "react";

import type { MessagesTimelineRow } from "../components/chat/MessagesTimeline.logic";
import { usePrimaryEnvironmentId } from "../state/environments";
import {
  type ActingSenderMessage,
  type ActingSenderState,
  actingSenderLabel,
  actingSenderLoader,
  actingSenderRequestOf,
  actingSenderStateIn,
  visibleActingSenderRows,
} from "./actingSender";
import { actingSenderMessageKey } from "./actingSenderVisibility";
import { prefersCzech } from "./threadTabs";

/** The thread, when it is of the Environment that serves the page; else none to ask about. */
function useServedThread(environmentId: EnvironmentId | undefined, threadId: string | undefined) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  return environmentId === primaryEnvironmentId ? threadId : undefined;
}

function useThreadSenders(threadId: string | undefined) {
  return useSyncExternalStore(actingSenderLoader.subscribe, () =>
    threadId === undefined ? undefined : actingSenderLoader.view(threadId),
  );
}

function useActingSenderState(
  environmentId: EnvironmentId,
  threadId: string | undefined,
  key: string | null,
  time: number,
): ActingSenderState {
  const thread = useServedThread(environmentId, threadId);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the server's record for a step the row shows
  useEffect(() => {
    if (thread !== undefined && key !== null) actingSenderLoader.want(thread, key, time);
  }, [thread, key, time]);
  const view = useThreadSenders(thread);
  return thread === undefined || key === null
    ? "unavailable"
    : actingSenderStateIn(view, key, time);
}

const userMessageOf = (row: MessagesTimelineRow): ActingSenderMessage | undefined =>
  row.kind === "message" && row.message.role === "user" ? row.message : undefined;

/**
 * The timeline's rows without Delegace's wakes, and without an agent's message the server has not
 * answered for yet (ACTING_SENDER_WAIT_MS at most). The rows around them stay as they are.
 */
export function useLazurioActingSenderRows(
  rows: MessagesTimelineRow[],
  thread: ScopedThreadRef | null,
): MessagesTimelineRow[] {
  const threadId = useServedThread(thread?.environmentId, thread?.threadId);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the server's record for the agent messages the rows hold
  useEffect(() => {
    if (threadId === undefined) return;
    for (const row of rows) {
      const message = userMessageOf(row);
      const key = message === undefined ? null : actingSenderMessageKey(message);
      if (message !== undefined && key !== null)
        actingSenderLoader.want(threadId, key, Date.parse(message.createdAt));
    }
  }, [threadId, rows]);
  const view = useThreadSenders(threadId);
  return threadId === undefined ? rows : visibleActingSenderRows(rows, userMessageOf, view);
}

/** Above a message an agent sent: „Buddy za <user>“ where it was Buddy, else `children`. */
export function LazurioActingSenderLabel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string | undefined;
  readonly message: ActingSenderMessage;
  readonly children: ReactNode;
}) {
  const sender = useActingSenderState(
    props.environmentId,
    props.threadId,
    actingSenderMessageKey(props.message),
    Date.parse(props.message.createdAt),
  );
  return typeof sender === "object" && sender?.kind === "buddy" ? (
    <span data-acting-sender={sender.kind}>{actingSenderLabel(sender, prefersCzech())}</span>
  ) : (
    props.children
  );
}

/**
 * Beside a question or permission request: who decided it, when it was Buddy. Every other work row
 * renders nothing and subscribes to nothing.
 */
export function LazurioActingSenderMark(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string | undefined;
  readonly item: Parameters<typeof actingSenderRequestOf>[0];
}) {
  const decided = actingSenderRequestOf(props.item);
  return decided === null ? null : (
    <DecidedRequestMark
      environmentId={props.environmentId}
      threadId={props.threadId}
      requestKey={decided.key}
      decidedAt={decided.decidedAt}
    />
  );
}

function DecidedRequestMark(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string | undefined;
  readonly requestKey: string;
  readonly decidedAt: number;
}) {
  const sender = useActingSenderState(
    props.environmentId,
    props.threadId,
    props.requestKey,
    props.decidedAt,
  );
  return typeof sender === "object" && sender?.kind === "buddy" ? (
    <span className="shrink-0 text-2xs text-muted-foreground/70" data-acting-sender={sender.kind}>
      {actingSenderLabel(sender, prefersCzech())}
    </span>
  ) : null;
}
