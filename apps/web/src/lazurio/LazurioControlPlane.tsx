import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { LayoutDashboard } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { useComposerDraftStore } from "~/composerDraftStore";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";

import {
  CONTROL_PLANE_NAME,
  CONTROL_PLANE_ROUTE,
  type ControlPlaneInsertion,
  type ControlPlaneSnapshot,
  controlPlaneAttachment,
  controlPlaneSurfaceId,
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

/**
 * The Control Plane's sentences go into the composer of Buddy's thread, never sent (C3). The
 * record of the last one is the thread's, so a new revision keeps it; once the person changes the
 * composer, it is gone and their text stays as it is.
 */
function useControlPlaneInsert(threadRef: ScopedThreadRef | null) {
  const previous = useRef<ControlPlaneInsertion | null>(null);
  const environmentId = threadRef?.environmentId ?? null;
  const threadId = threadRef?.threadId ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- forgets the last sentence once the person edits the composer
  useEffect(() => {
    previous.current = null;
    if (environmentId === null || threadId === null) return;
    const ref = scopeThreadRef(environmentId, threadId);
    return useComposerDraftStore.subscribe((state) => {
      const last = previous.current;
      if (last !== null && (state.getComposerDraft(ref)?.prompt ?? "") !== last.prompt)
        previous.current = null;
    });
  }, [environmentId, threadId]);
  return (sentence: string) => {
    if (environmentId === null || threadId === null) return;
    const ref = scopeThreadRef(environmentId, threadId);
    const drafts = useComposerDraftStore.getState();
    const prompt = drafts.getComposerDraft(ref)?.prompt ?? "";
    const inserted = withControlPlaneSentence(prompt, previous.current, sentence);
    // Recorded first: the store tells its listeners while `setPrompt` runs.
    previous.current = inserted;
    drafts.setPrompt(ref, inserted.prompt);
  };
}

/**
 * The answers of the Control Plane the person is looking at, as the app's own buttons under Buddy's
 * header: drawn and clicked here, never by the page, and marked as coming from the Control Plane.
 */
export function ControlPlaneAnswers(props: {
  readonly threadRef: ScopedThreadRef | null;
  readonly snapshot: ControlPlaneSnapshot | null;
  readonly czech: boolean;
}) {
  const { snapshot, threadRef } = props;
  const insert = useControlPlaneInsert(threadRef);
  const shown = useRightPanelStore((state) => {
    if (snapshot === null || threadRef === null) return false;
    const panel = selectThreadRightPanelState(state.byThreadKey, threadRef);
    return panel.isOpen && panel.activeSurfaceId === controlPlaneSurfaceId(snapshot.attachmentId);
  });
  if (!shown || snapshot === null || snapshot.answers.length === 0) return null;
  const origin = props.czech ? "Návrh z Control Plane" : "Proposal from the Control Plane";
  return (
    <div
      aria-label={origin}
      className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2"
      role="group"
    >
      <span className="text-muted-foreground text-xs">{origin}</span>
      {snapshot.answers.map((answer, index) => (
        <Button
          className="max-w-full"
          // oxlint-disable-next-line react/no-array-index-key -- a revision's answers are a fixed list in its order
          key={index}
          onClick={() => insert(answer.sentence)}
          size="sm"
          title={answer.sentence}
          variant="outline"
        >
          <span className="truncate">{answer.label}</span>
        </Button>
      ))}
    </div>
  );
}
