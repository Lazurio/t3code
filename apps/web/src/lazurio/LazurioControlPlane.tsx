import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { LayoutDashboard } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useRightPanelStore } from "~/rightPanelStore";

import {
  acceptsControlPlaneDraft,
  CONTROL_PLANE_NAME,
  CONTROL_PLANE_ROUTE,
  type ControlPlaneSnapshot,
  controlPlaneAttachment,
  parseControlPlaneDraft,
  parseControlPlaneSnapshot,
  withControlPlaneOpen,
  withControlPlaneRevision,
  withControlPlaneSentence,
} from "./controlPlane";

const parseData = (data: unknown): unknown => {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
};

/** The thread's Control Plane as published now; each new revision replaces its open tab in place. */
export function useControlPlane(threadRef: ScopedThreadRef | null): ControlPlaneSnapshot | null {
  const [latest, setLatest] = useState<ControlPlaneSnapshot | null>(null);
  const environmentId = threadRef?.environmentId ?? null;
  const threadId = threadRef?.threadId ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the server's EventSource of the thread's Control Plane
  useEffect(() => {
    if (environmentId === null || threadId === null) return;
    const ref = scopeThreadRef(environmentId, threadId);
    const events = new EventSource(
      `${CONTROL_PLANE_ROUTE}/events?threadId=${encodeURIComponent(threadId)}`,
    );
    events.addEventListener("snapshot", (event) => {
      const next = parseControlPlaneSnapshot(parseData(event.data));
      if (next === null || next.threadId !== threadId) return;
      setLatest(next);
      useRightPanelStore
        .getState()
        .lazurio(ref, true, (current) =>
          withControlPlaneRevision(current, controlPlaneAttachment(next)),
        );
    });
    return () => events.close();
  }, [environmentId, threadId]);
  // Another thread's last page is not this one's.
  return latest !== null && latest.threadId === threadId ? latest : null;
}

/** Opens the Control Plane in the right panel; in Buddy's small window it first asks for the full one. */
export function ControlPlaneButton(props: {
  readonly threadRef: ScopedThreadRef | null;
  readonly snapshot: ControlPlaneSnapshot | null;
  readonly panelsOffered: boolean;
  readonly requestFullscreen: () => void;
}) {
  const { snapshot, threadRef } = props;
  return (
    <Button
      aria-label={CONTROL_PLANE_NAME}
      disabled={snapshot === null || threadRef === null}
      onClick={() => {
        if (snapshot === null || threadRef === null) return;
        if (!props.panelsOffered) props.requestFullscreen();
        useRightPanelStore
          .getState()
          .lazurio(threadRef, false, (current) =>
            withControlPlaneOpen(current, controlPlaneAttachment(snapshot)),
          );
      }}
      size="icon-sm"
      title={CONTROL_PLANE_NAME}
      variant="ghost"
    >
      <LayoutDashboard />
    </Button>
  );
}

/** The Control Plane frame of this window a message came from, if any. */
const controlPlaneFrameOf = (source: MessageEventSource | null) =>
  source === null
    ? undefined
    : [
        ...document.querySelectorAll<HTMLIFrameElement>(`iframe[title="${CONTROL_PLANE_NAME}"]`),
      ].find((frame) => frame.contentWindow === source);

/**
 * A Control Plane page's sentence goes into the composer of Buddy's thread, never sent: only from
 * its own frame, while the person's input to it is the window's transient activation (C3).
 */
export function useControlPlaneDrafts(threadRef: ScopedThreadRef | null): void {
  const previous = useRef<string | null>(null);
  const environmentId = threadRef?.environmentId ?? null;
  const threadId = threadRef?.threadId ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens to messages from the Control Plane's sandboxed frame
  useEffect(() => {
    if (environmentId === null || threadId === null) return;
    const ref = scopeThreadRef(environmentId, threadId);
    previous.current = null;
    const onMessage = (event: MessageEvent) => {
      const sentence = parseControlPlaneDraft(event.data);
      if (sentence === null) return;
      const frame = controlPlaneFrameOf(event.source);
      const accepted = acceptsControlPlaneDraft({
        fromControlPlaneFrame: frame !== undefined,
        frameFocused: frame !== undefined && document.activeElement === frame,
        origin: event.origin,
        userActivation: navigator.userActivation,
      });
      if (!accepted) return;
      const drafts = useComposerDraftStore.getState();
      const prompt = drafts.getComposerDraft(ref)?.prompt ?? "";
      drafts.setPrompt(ref, withControlPlaneSentence(prompt, previous.current, sentence));
      previous.current = sentence;
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [environmentId, threadId]);
}
