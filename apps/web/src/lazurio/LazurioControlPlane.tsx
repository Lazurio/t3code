import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { LayoutDashboard } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { useComposerDraftStore } from "~/composerDraftStore";
import { isConfirmDialogActive, requestConfirmDialog } from "~/confirmDialog";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";

import {
  acceptsControlPlaneDraft,
  CONTROL_PLANE_NAME,
  type ControlPlaneInsertion,
  controlPlaneSurfaceId,
  needsParentConfirmation,
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

/** The Control Plane frame in the right panel a message came from, if any; never one in the thread. */
const controlPlaneFrameOf = (source: MessageEventSource | null) =>
  source === null
    ? undefined
    : [
        ...document.querySelectorAll<HTMLIFrameElement>(
          `[data-right-panel-surface-content] iframe[title="${CONTROL_PLANE_NAME}"]`,
        ),
      ].find((frame) => frame.contentWindow === source);

/**
 * A Control Plane page's sentence goes into the composer of Buddy's thread, never sent: only from
 * its own frame, while the person's input to it is the window's transient activation (C3).
 */
export function useControlPlaneDrafts(
  threadRef: ScopedThreadRef | null,
  snapshot: ControlPlaneSnapshot | null,
  czech: boolean,
): void {
  const previous = useRef<ControlPlaneInsertion | null>(null);
  const environmentId = threadRef?.environmentId ?? null;
  const threadId = threadRef?.threadId ?? null;
  const attachmentId = snapshot?.attachmentId ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens to messages from the Control Plane's sandboxed frame
  useEffect(() => {
    if (environmentId === null || threadId === null) return;
    const ref = scopeThreadRef(environmentId, threadId);
    previous.current = null;
    // The person's last input the parent saw itself; input inside the page never reaches it.
    let parentInputAt = Number.NEGATIVE_INFINITY;
    const onInput = (event: Event) => {
      if (event.isTrusted) parentInputAt = performance.now();
    };
    const inputs = ["pointerdown", "keydown", "touchstart"] as const;
    for (const type of inputs) window.addEventListener(type, onInput, true);
    const insert = (sentence: string) => {
      const drafts = useComposerDraftStore.getState();
      const prompt = drafts.getComposerDraft(ref)?.prompt ?? "";
      const inserted = withControlPlaneSentence(prompt, previous.current, sentence);
      drafts.setPrompt(ref, inserted.prompt);
      previous.current = inserted;
      // The composer shows plain text, so where it came from is said beside it.
      toastManager.add({
        type: "info",
        title: czech
          ? "Návrh z Control Plane je v poli chatu"
          : "A Control Plane proposal is in the chat field",
        description: czech ? `Odešlete ho sami: ${sentence}` : `Send it yourself: ${sentence}`,
      });
    };
    const onMessage = (event: MessageEvent) => {
      const sentence = parseControlPlaneDraft(event.data);
      if (sentence === null) return;
      const frame = controlPlaneFrameOf(event.source);
      // The frame shows the thread's Control Plane as published now, not a same-named attachment.
      const panel = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref);
      const accepted = acceptsControlPlaneDraft({
        fromControlPlaneFrame: frame !== undefined,
        currentSurface:
          attachmentId !== null && panel.activeSurfaceId === controlPlaneSurfaceId(attachmentId),
        frameFocused: frame !== undefined && document.activeElement === frame,
        origin: event.origin,
        userActivation: navigator.userActivation,
      });
      if (!accepted) return;
      if (!needsParentConfirmation(performance.now() - parentInputAt)) {
        insert(sentence);
        return;
      }
      // The activation may be the person's input outside the page: the app asks them itself.
      if (isConfirmDialogActive()) return;
      const question = czech
        ? `Vložit tuto větu z Control Plane do pole chatu?\n${sentence}`
        : `Put this sentence from the Control Plane into the chat field?\n${sentence}`;
      void requestConfirmDialog(question)?.then((approved) => {
        if (approved) insert(sentence);
      });
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      for (const type of inputs) window.removeEventListener(type, onInput, true);
    };
  }, [environmentId, threadId, attachmentId, czech]);
}
