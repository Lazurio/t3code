/**
 * Lazurio overlay (root decision 0191, plan DEV-6646): where the Environment browser's view is.
 *
 * The web client has no browser of its own. On a Lazurio Remote Environment one shared Chromium
 * runs on the Environment, the agents of every thread drive a window of their own in it through
 * the agent-browser CLI, and a person works along in the view on the Environment's gateway, where
 * `https://browser.<…>/t/<target id>` shows exactly one remote tab. The Environment's Launchpad
 * says which tab is the thread's own at `/.lazurio/browser.json` on this page's own origin, which
 * the gateway forwards behind the same sign-in. Anything but an available view at an absolute
 * https: URL means unavailable, and the right panel keeps upstream's disabled Browser. The
 * thread's own tab is asked for each time the browser opens; a tab that a page opens joins the
 * panel with the address of its view, which carries no token.
 */

export interface EnvironmentBrowserView {
  /** The view, an absolute https: URL. */
  readonly view: string;
  /** The session whose window the view shows, or null for a view of every window. */
  readonly session: string | null;
}

const BROWSER_VIEW_PATH = "/.lazurio/browser.json";
// A view that has to start first answers within seconds; a hung answer must not keep the panel.
const BROWSER_VIEW_TIMEOUT_MS = 10_000;

/** The view of `session` from this origin's Environment, or null when it offers none. */
export async function fetchEnvironmentBrowser(
  session: string,
  origin: string,
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
  timeoutMs = BROWSER_VIEW_TIMEOUT_MS,
): Promise<EnvironmentBrowserView | null> {
  const url = new URL(BROWSER_VIEW_PATH, origin);
  url.searchParams.set("session", session);
  try {
    const response = await fetcher(url.href, {
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status !== 200 || new URL(response.url).origin !== url.origin) return null;
    if (!(response.headers.get("content-type") ?? "").startsWith("application/json")) return null;
    return readView(await response.json(), session, url.origin);
  } catch {
    return null;
  }
}

function readView(
  value: unknown,
  session: string,
  pageOrigin: string,
): EnvironmentBrowserView | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { available, view, session: viewSession = null } = value as Record<string, unknown>;
  if (available !== true || typeof view !== "string") return null;
  if (viewSession !== null && viewSession !== session) return null;
  let viewUrl: URL;
  try {
    viewUrl = new URL(view);
  } catch {
    return null;
  }
  if (viewUrl.protocol !== "https:") return null;
  // The frame runs the view's scripts in the view's own origin (allow-scripts with
  // allow-same-origin), which keeps it out of this page only while that origin is another one.
  if (viewUrl.origin === pageOrigin) return null;
  return { view: viewUrl.href, session: viewSession };
}

/** A tab of the panel's Environment browser beside the thread's own: one remote tab. */
export interface EnvironmentBrowserTab {
  /** The panel surface, `environment-browser:<target id>`, so each remote tab is open once. */
  readonly id: `environment-browser:${string}`;
  /** The view of that tab, `https://<view host>/t/<target id>`. */
  readonly view: string;
}

/** The view of one remote tab names its DevTools target id: 32 hexadecimal digits. */
const TAB_VIEW_PATH = /^\/t\/([0-9A-Fa-f]{32})$/;

/**
 * The panel tab whose view is at `view`, or null unless it is exactly
 * `https://<host>/t/<32 hex digits>`: no credentials, query or fragment, not even an empty one,
 * so an address the panel keeps names one remote tab and carries nothing else. Where it frames
 * the view, the panel also refuses its own origin (`pageOrigin`), as for the thread's own tab.
 */
export function environmentBrowserTab(
  view: unknown,
  pageOrigin?: string,
): EnvironmentBrowserTab | null {
  if (typeof view !== "string") return null;
  let url: URL;
  try {
    url = new URL(view);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.href !== `${url.origin}${url.pathname}`) return null;
  if (url.origin === pageOrigin) return null;
  const target = TAB_VIEW_PATH.exec(url.pathname)?.[1];
  return target === undefined ? null : { id: `environment-browser:${target}`, view: url.href };
}

/**
 * The panel tab that a link in the chat opens instead of a new browser tab: the view of one remote
 * tab (environmentBrowserTab) on the origin of this Environment's view, as the Environment named it
 * at /.lazurio/browser.json. Any other address, or a view not named yet, is left to the browser.
 */
export function environmentBrowserLink(
  href: string,
  pageOrigin: string,
  viewOrigin: string | null,
): EnvironmentBrowserTab | null {
  const tab = viewOrigin === null ? null : environmentBrowserTab(href, pageOrigin);
  return tab !== null && originOf(tab.view) === viewOrigin ? tab : null;
}

/** A plain primary click follows a link in place; modifiers or other buttons open it elsewhere. */
export function isPlainPrimaryClick(
  event: Pick<
    MouseEvent,
    "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented"
  >,
): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.defaultPrevented
  );
}

/** What the view in a panel frame says (LazurioPlatform F39): its tab's title, or a new tab. */
export type EnvironmentBrowserMessage =
  | {
      readonly type: "info";
      /** The page's title, else its host; null for a page with neither, such as a new tab. */
      readonly title: string | null;
    }
  | { readonly type: "new-tab"; readonly tab: EnvironmentBrowserTab };

/**
 * The message of the view that `frame` (the panel frame's window) shows at `view`, or null for
 * any other message: from another window, from another origin than the view's, of another type,
 * or malformed. A page's new tab counts only on the view's own origin.
 */
export function readEnvironmentBrowserMessage(
  event: { readonly data: unknown; readonly origin: string; readonly source: unknown },
  frame: object | null,
  view: string,
): EnvironmentBrowserMessage | null {
  if (frame === null || event.source !== frame) return null;
  const origin = originOf(view);
  if (origin === null || event.origin !== origin) return null;
  if (typeof event.data !== "object" || event.data === null) return null;
  const message = event.data as Record<string, unknown>;
  if (message.type === "lazurio-browser:info") {
    const { title, url } = message;
    if (typeof title !== "string" || typeof url !== "string") return null;
    return { type: "info", title: title.trim() || hostOf(url) };
  }
  if (message.type === "lazurio-browser:new-tab") {
    const tab = environmentBrowserTab(message.view);
    return tab !== null && originOf(tab.view) === origin ? { type: "new-tab", tab } : null;
  }
  return null;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}
