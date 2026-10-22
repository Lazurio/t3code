/**
 * Lazurio overlay (root decision 0210, evening addendum, point 5; plan DEV-6676): the mark of who
 * acted in a thread, „Buddy za <user>“ or „Delegace“ (actingSender.ts), in the two places
 * MessagesTimeline.tsx shows it: instead of upstream's "Sent by another agent" above a message an
 * agent sent from outside any thread, and beside a question or permission request someone decided.
 * Only for threads of the Environment that serves the page, whose route the session cookie
 * reaches; elsewhere, and until the server answers, upstream's own label stays.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import { type ReactNode, useEffect, useSyncExternalStore } from "react";

import { usePrimaryEnvironmentId } from "../state/environments";
import {
  type ActingSender,
  actingSenderLabel,
  actingSenderLoader,
  actingSenderMessageKey,
  actingSenderRequestOf,
} from "./actingSender";
import { prefersCzech } from "./threadTabs";

function useActingSender(
  environmentId: EnvironmentId,
  threadId: string | undefined,
  key: string | null,
  time: number,
): ActingSender | undefined {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const thread = environmentId === primaryEnvironmentId ? threadId : undefined;
  useEffect(() => {
    if (thread !== undefined && key !== null) actingSenderLoader.want(thread, key, time);
  }, [thread, key, time]);
  return useSyncExternalStore(actingSenderLoader.subscribe, () =>
    thread === undefined || key === null ? undefined : actingSenderLoader.sender(thread, key),
  );
}

/** Above a message an agent sent: who it acted as, where the server knows it, else `children`. */
export function LazurioActingSenderLabel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string | undefined;
  readonly message: Parameters<typeof actingSenderMessageKey>[0] & { readonly createdAt: string };
  readonly children: ReactNode;
}) {
  const sender = useActingSender(
    props.environmentId,
    props.threadId,
    actingSenderMessageKey(props.message),
    Date.parse(props.message.createdAt),
  );
  return sender === undefined ? (
    props.children
  ) : (
    <span data-acting-sender={sender.kind}>{actingSenderLabel(sender, prefersCzech())}</span>
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
  const sender = useActingSender(
    props.environmentId,
    props.threadId,
    props.requestKey,
    props.decidedAt,
  );
  return sender === undefined ? null : (
    <span className="shrink-0 text-2xs text-muted-foreground/70" data-acting-sender={sender.kind}>
      {actingSenderLabel(sender, prefersCzech())}
    </span>
  );
}
