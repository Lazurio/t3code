/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): Buddy's surface as the frame of the bubble
 * (buddySurfaceProtocol.ts). The host draws no controls over the frame and sees no keys inside it,
 * so Escape asks for the panel unless something in the surface took it (the composer's editor marks
 * every Escape handled, so that alone does not count). The frame keeps the size it asked for last.
 */
import {
  acceptBuddyContext,
  type BuddyContext,
  type BuddyLayout,
  buddyHostOriginOf,
  buddyLayoutRequest,
  buddyReady,
} from "./buddySurfaceProtocol";

export interface BuddyFrame {
  /** The page around the frame, a host of the bubble; null outside a frame or another page. */
  readonly hostOrigin: string | null;
  readonly context: () => BuddyContext | null;
  /** The size the frame asked for last; the panel until it asks. */
  readonly layout: () => Exclude<BuddyLayout, "closed">;
  readonly subscribe: (listener: () => void) => () => void;
  readonly requestLayout: (mode: BuddyLayout) => void;
  readonly stop: () => void;
}

/** An open menu, dialog or list inside the surface takes Escape before the frame does. */
const ESCAPE_TAKERS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

export function startBuddyFrame(win: Window): BuddyFrame {
  const hostOrigin =
    win.parent === win
      ? null
      : buddyHostOriginOf(win.location.ancestorOrigins?.[0], win.document.referrer);
  let context: BuddyContext | null = null;
  let layout: Exclude<BuddyLayout, "closed"> = "panel";
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const post = (message: object) => {
    if (hostOrigin !== null) win.parent.postMessage(message, hostOrigin);
  };
  const requestLayout = (mode: BuddyLayout) => {
    const request = buddyLayoutRequest(mode);
    if (request === null) return;
    if (mode !== "closed") layout = mode;
    post(request);
    notify();
  };
  const onMessage = (event: MessageEvent) => {
    const accepted = acceptBuddyContext(
      { data: event.data, origin: event.origin, fromParent: event.source === win.parent },
      hostOrigin,
    );
    if (accepted === null) return;
    context = accepted;
    notify();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.key !== "Escape" ||
      event.isComposing ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      win.document.querySelector(ESCAPE_TAKERS) !== null
    )
      return;
    requestLayout("panel");
  };
  if (hostOrigin !== null) {
    win.addEventListener("message", onMessage);
    win.addEventListener("keydown", onKeyDown);
    post(buddyReady());
  }
  return {
    hostOrigin,
    context: () => context,
    layout: () => layout,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestLayout,
    stop: () => {
      win.removeEventListener("message", onMessage);
      win.removeEventListener("keydown", onKeyDown);
      listeners.clear();
    },
  };
}
