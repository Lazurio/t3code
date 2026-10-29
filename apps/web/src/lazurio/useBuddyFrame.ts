/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): Buddy's surface reads its frame here. The
 * frame (buddySurfaceFrame.ts) starts once per page, the first time Buddy's surface asks for it,
 * and then outlives the components that read it, so a page context is never lost between them.
 */
import { useSyncExternalStore } from "react";

import { type BuddyFrame, startBuddyFrame } from "./buddySurfaceFrame";

let frame: BuddyFrame | null = null;

/** The page's frame, started on first use. */
export function buddyFrame(): BuddyFrame {
  frame ??= startBuddyFrame(window);
  return frame;
}

/** Outside Buddy's T3 Code the page never talks to a host, even when it is framed. */
const NO_FRAME: Omit<BuddyFrame, "stop"> = {
  hostOrigin: null,
  context: () => null,
  layout: () => "panel",
  subscribe: () => () => {},
  requestLayout: () => {},
};

/** The last valid page context, and the size the surface asked for last. */
export function useBuddyFrame(buddy: boolean) {
  const current = buddy ? buddyFrame() : NO_FRAME;
  const context = useSyncExternalStore(current.subscribe, current.context, () => null);
  const layout = useSyncExternalStore(current.subscribe, current.layout, () => "panel" as const);
  return {
    framed: current.hostOrigin !== null,
    context,
    layout,
    requestLayout: current.requestLayout,
  };
}
