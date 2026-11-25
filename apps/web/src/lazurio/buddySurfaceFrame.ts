/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): Buddy's surface as the frame of the bubble
 * (buddySurfaceProtocol.ts). The host sees no keys inside the frame, so Escape asks for the panel
 * unless something in the surface took it (the composer's editor marks every Escape handled, so that
 * alone does not count). The frame keeps the size it asked for or the host said last.
 */
import {
  acceptBuddyContext,
  acceptBuddyLayout,
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
  /** The size the frame asked for or the host said last; the panel until either. */
  readonly layout: () => Exclude<BuddyLayout, "closed">;
  /** Whether the host's window shows the frame; null until the host says (an older Lazurio never does). */
  readonly shown: () => boolean | null;
  /** The size the host's window shows; null until the host says (an older Lazurio never does). */
  readonly mode: () => BuddyLayout | null;
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
 * Whether Buddy's window offers the right panel and the terminal: in his full-screen window, never in
 * the small one (LazurioPlatform F47, addendum of 2026-11-20). Before the host says its size (an older
 * Lazurio), a frame too narrow for the panels reads as the small window.
 */
export const buddyPanelsOffered = (
  framed: boolean,
  mode: BuddyLayout | null,
  narrow: boolean,
): boolean => !framed || (mode === null ? !narrow : mode === "fullscreen");

/**
 * Whether the right panel covers Buddy's whole window: only where the window offers it and is narrow,
 * as a phone's (the Owner's decision of 2026-11-25). A wide window keeps T3's column beside the chat.
 */
export const buddyPanelOverWindow = (framed: boolean, offered: boolean, narrow: boolean): boolean =>
  framed && offered && narrow;

/**
 * Whether a page an agent reveals may open the right panel by itself: never in Buddy's window,
 * where nothing opens over his conversation (F60); its tab still joins the strip.
 */
export const buddyPanelOpensItself = (inlinePanel: boolean, framed: boolean): boolean =>
  inlinePanel && !framed;

const overWholeWindow = new WeakMap<object, object>();

/**
 * A thread's right panel read as covering the whole window, its stored size untouched; the same
 * object for the same state, since the chat reads it inside a store selector.
 */
export function buddyPanelOverWholeWindow<T extends { readonly maximized?: true }>(state: T): T {
  if (state.maximized === true) return state;
  let whole = overWholeWindow.get(state) as T | undefined;
  if (whole === undefined) {
    whole = { ...state, maximized: true };
    overWholeWindow.set(state, whole);
  }
  return whole;
}

const OPEN_TAKERS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * Whether an open menu, dialog or list the person sees takes Escape: a narrow window keeps T3's
 * closed sheets mounted as hidden dialogs, which take nothing.
 */
export const buddyEscapeTaken = (doc: Pick<Document, "querySelectorAll">): boolean =>
  [...doc.querySelectorAll(OPEN_TAKERS)].some(
    (element) => typeof element.checkVisibility !== "function" || element.checkVisibility(),
  );

/** A right panel over the whole window takes it too: Escape there goes back to the conversation. */
const PANEL_OVER_WINDOW = '[data-chat-column-maximized-away="true"]';

/** The host page around this one, if a host of the bubble frames it; read without side effects. */
export const buddyHostOfWindow = (win: Window): string | null =>
  win.parent === win
    ? null
    : buddyHostOriginOf(win.location.ancestorOrigins?.[0], win.document.referrer);

/**
 * Whether the browser's own PDF viewer can show a document in this window. Not where a host of the
 * bubble frames it: the host's frame is sandboxed, a nested frame inherits that, and Chromium then
 * shows its "blocked" placeholder in place of the PDF. The files viewer uses PDF.js there instead.
 */
export const buddyFrameAllowsNativePdf = (win: Window): boolean => buddyHostOfWindow(win) === null;

export function startBuddyFrame(win: Window): BuddyFrame {
  const hostOrigin = buddyHostOfWindow(win);
  let context: BuddyContext | null = null;
  let layout: Exclude<BuddyLayout, "closed"> = "panel";
  let shown: boolean | null = null;
  let mode: BuddyLayout | null = null;
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
    const nowMode = acceptBuddyLayout(received, hostOrigin);
    if (nowMode !== null) {
      if (nowMode === mode) return;
      mode = nowMode;
      // The host's size is the one to leave from, also after it changed the size by itself.
      if (nowMode !== "closed") layout = nowMode;
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
      buddyEscapeTaken(win.document) ||
      win.document.querySelector(PANEL_OVER_WINDOW) !== null
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
    mode: () => mode,
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
