import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { LayoutDashboard } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { useRightPanelStore } from "~/rightPanelStore";

import {
  CONTROL_PLANE_NAME,
  CONTROL_PLANE_ROUTE,
  type ControlPlaneSnapshot,
  controlPlaneAttachment,
  parseControlPlaneSnapshot,
  withControlPlaneOpen,
  withControlPlaneRevision,
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
  readonly threadRef: ScopedThreadRef;
  readonly snapshot: ControlPlaneSnapshot | null;
  readonly panelsOffered: boolean;
  readonly requestFullscreen: () => void;
}) {
  const { snapshot } = props;
  return (
    <Button
      aria-label={CONTROL_PLANE_NAME}
      disabled={snapshot === null}
      onClick={() => {
        if (snapshot === null) return;
        if (!props.panelsOffered) props.requestFullscreen();
        useRightPanelStore
          .getState()
          .lazurio(props.threadRef, false, (current) =>
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
