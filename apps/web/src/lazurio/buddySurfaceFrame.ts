/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): Buddy's surface as the frame of the bubble
 * (buddySurfaceProtocol.ts). The host draws no controls over the frame and sees no keys inside it,
 * so Escape asks for the panel unless something in the surface took it (the composer's editor marks
 * every Escape handled, so that alone does not count). The frame keeps the size it asked for last.
 */
import {
  acceptBuddyContext,
  acceptBuddyShown,
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
  /** Whether the host's window shows the frame; null until the host says (an older Lazurio never does). */
  readonly shown: () => boolean | null;
  readonly subscribe: (listener: () => void) => () => void;
  readonly requestLayout: (mode: BuddyLayout) => void;
  readonly stop: () => void;
}

/**
 * Whether the frame's thread counts as seen. In a host's frame only once the host says it shows the
 * window: a hidden frame, also one loaded anew, would otherwise read Buddy's answers first. A host
 * that sends a context without `shown` first (an older Lazurio) never says, so then as before.
 */
export const buddyWindowInView = (
  framed: boolean,
  shown: boolean | null,
  heardContext: boolean,
): boolean => !framed || shown === true || (shown === null && heardContext);

/**
 * Whether Buddy's window offers the right panel and the terminal: not in a host's frame too narrow
 * for them, where the right panel would only cover the conversation (the small window). The full
 * window offers both (LazurioPlatform F47, addendum of 2026-11-20).
 */
export const buddyPanelsOffered = (framed: boolean, narrow: boolean): boolean => !framed || !narrow;

/** An open menu, dialog or list inside the surface takes Escape before the frame does. */
const ESCAPE_TAKERS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** The host page around this one, if a host of the bubble frames it; read without side effects. */
export const buddyHostOfWindow = (win: Window): string | null =>
  win.parent === win
    ? null
    : buddyHostOriginOf(win.location.ancestorOrigins?.[0], win.document.referrer);

export function startBuddyFrame(win: Window): BuddyFrame {
  const hostOrigin = buddyHostOfWindow(win);
  let context: BuddyContext | null = null;
  let layout: Exclude<BuddyLayout, "closed"> = "panel";
  let shown: boolean | null = null;
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
    const received = {
      data: event.data,
      origin: event.origin,
      fromParent: event.source === win.parent,
    };
    const accepted = acceptBuddyContext(received, hostOrigin);
    if (accepted !== null) {
      context = accepted;
      notify();
      return;
    }
    const nowShown = acceptBuddyShown(received, hostOrigin);
    if (nowShown === null || nowShown === shown) return;
    shown = nowShown;
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
    shown: () => shown,
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
