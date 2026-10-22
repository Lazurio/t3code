/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): Buddy's surface as the frame of Buddy's
 * bubble (buddySurfaceProtocol.ts). In a frame it tells the host it is ready, keeps the last valid
 * page context the host sends, and asks the host for its window's size: the full-screen and close
 * buttons, and Escape. The host draws no controls over the frame and cannot see keys inside it, so
 * Escape asks for the panel unless a dialog, menu or list is open in the surface or what took the
 * key stopped it there, as the composer's menus do. The composer's editor marks every Escape as
 * handled, so a handled key alone does not count. The host never says which size it shows, so the
 * frame keeps the size it asked for last, and Escape asks for the panel whatever it believes: never
 * inferred from the window's width.
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
