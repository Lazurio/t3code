import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { LayoutDashboard } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { Button } from "~/components/ui/button";
import { useComposerDraftStore } from "~/composerDraftStore";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";

import {
  CONTROL_PLANE_NAME,
  CONTROL_PLANE_ROUTE,
  type ControlPlaneAnswer,
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

/** The last answer the Control Plane put into a thread's composer, kept beside the composer draft. */
type StoredInsertion = ControlPlaneInsertion & { readonly label: string };

const insertionKey = (thread: string) => `lazurio:control-plane-insertion:v1:${thread}`;
const insertions = new Map<string, StoredInsertion | null>();
const insertionListeners = new Set<() => void>();

function readStoredInsertion(thread: string): StoredInsertion | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(insertionKey(thread)) ?? "null");
    if (typeof value !== "object" || value === null) return null;
    const { prompt, start, end, label } = value as Record<string, unknown>;
    return typeof prompt === "string" &&
      typeof start === "number" &&
      typeof end === "number" &&
      typeof label === "string"
      ? { prompt, start, end, label }
      : null;
  } catch {
    return null;
  }
}

/** The thread's record: read from storage once per page, then held here, so without storage too. */
function insertionOf(thread: string): StoredInsertion | null {
  if (!insertions.has(thread)) insertions.set(thread, readStoredInsertion(thread));
  return insertions.get(thread) ?? null;
}

function setInsertion(thread: string, value: StoredInsertion | null) {
  insertions.set(thread, value);
  try {
    if (value === null) localStorage.removeItem(insertionKey(thread));
    else localStorage.setItem(insertionKey(thread), JSON.stringify(value));
  } catch {
    // Without storage the record lasts until the page reloads.
  }
  for (const listener of insertionListeners) listener();
}

function subscribeInsertions(listener: () => void) {
  insertionListeners.add(listener);
  return () => insertionListeners.delete(listener);
}

/**
 * The Control Plane's sentences go into the composer of Buddy's thread, never sent (C3). The
 * record of the last one is the thread's and is kept beside the composer draft, so a new revision
 * and a reload keep it; once the person changes the composer, it is gone and their text stays as
 * it is. `pending` is the label of the answer whose sentence still stands untouched there.
 */
function useControlPlaneInsert(threadRef: ScopedThreadRef | null) {
  const environmentId = threadRef?.environmentId ?? null;
  const threadId = threadRef?.threadId ?? null;
  const thread =
    environmentId === null || threadId === null ? null : `${environmentId}:${threadId}`;
  const record = useSyncExternalStore(subscribeInsertions, () =>
    thread === null ? null : insertionOf(thread),
  );
  const prompt = useComposerDraftStore((state) =>
    threadRef === null ? "" : (state.getComposerDraft(threadRef)?.prompt ?? ""),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- forgets the record once the person edits the composer
  useEffect(() => {
    if (environmentId === null || threadId === null || thread === null) return;
    const ref = scopeThreadRef(environmentId, threadId);
    const forgetIfEdited = () => {
      const last = insertionOf(thread);
      const now = useComposerDraftStore.getState().getComposerDraft(ref)?.prompt ?? "";
      if (last !== null && now !== last.prompt) setInsertion(thread, null);
    };
    forgetIfEdited();
    return useComposerDraftStore.subscribe(forgetIfEdited);
  }, [environmentId, threadId, thread]);
  const insert = (answer: ControlPlaneAnswer) => {
    if (environmentId === null || threadId === null || thread === null) return;
    const ref = scopeThreadRef(environmentId, threadId);
    const drafts = useComposerDraftStore.getState();
    const current = drafts.getComposerDraft(ref)?.prompt ?? "";
    const next = withControlPlaneSentence(current, insertionOf(thread), answer.sentence);
    // Recorded first: the store tells its listeners while `setPrompt` runs.
    setInsertion(thread, { ...next, label: answer.label });
    drafts.setPrompt(ref, next.prompt);
  };
  return { insert, pending: record !== null && record.prompt === prompt ? record.label : null };
}

const ORIGIN = { cs: "Návrh z Control Plane", en: "Proposal from the Control Plane" } as const;
const IN_COMPOSER = {
  cs: "V poli je návrh z Control Plane",
  en: "The chat field holds a proposal from the Control Plane",
} as const;

/**
 * The answers of the Control Plane the person is looking at, as the app's own buttons under Buddy's
 * header: drawn and clicked here, never by the page, and marked as coming from the Control Plane.
 * While an answer's sentence stands untouched in the composer, the same place says where it came
 * from, also once the panel is closed.
 */
export function ControlPlaneAnswers(props: {
  readonly threadRef: ScopedThreadRef | null;
  readonly snapshot: ControlPlaneSnapshot | null;
  readonly czech: boolean;
  /** The panel covers the whole window: after a click, back to the conversation to see the sentence. */
  readonly overWindow: boolean;
}) {
  const { snapshot, threadRef } = props;
  const { insert, pending } = useControlPlaneInsert(threadRef);
  const shown = useRightPanelStore((state) => {
    if (snapshot === null || threadRef === null) return false;
    const panel = selectThreadRightPanelState(state.byThreadKey, threadRef);
    return panel.isOpen && panel.activeSurfaceId === controlPlaneSurfaceId(snapshot.attachmentId);
  });
  const language = props.czech ? "cs" : "en";
  if (!shown || snapshot === null || snapshot.answers.length === 0) {
    if (pending === null) return null;
    return (
      <div
        className="shrink-0 truncate border-b px-3 py-1.5 text-muted-foreground text-xs"
        role="status"
      >
        {IN_COMPOSER[language]}: {pending}
      </div>
    );
  }
  return (
    <div
      aria-label={ORIGIN[language]}
      className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2"
      role="group"
    >
      <span className="text-muted-foreground text-xs">{ORIGIN[language]}</span>
      {snapshot.answers.map((answer, index) => (
        <Button
          className="max-w-full"
          // oxlint-disable-next-line react/no-array-index-key -- a revision's answers are a fixed list in its order
          key={index}
          onClick={() => {
            insert(answer);
            if (props.overWindow && threadRef !== null) {
              useRightPanelStore.getState().setMaximized(threadRef, false);
              useRightPanelStore.getState().close(threadRef);
            }
          }}
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
