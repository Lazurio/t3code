/**
 * Lazurio overlay (root decision 0191, plan DEV-6646): where the Environment browser's view is.
 *
 * The web client has no browser of its own. On a Lazurio Remote Environment one shared Chromium
 * runs on the Environment, the agents of every thread drive a window of their own in it through
 * the agent-browser CLI, and a person watches and takes over through a view on the Environment's
 * gateway. The Environment's Launchpad says where that view is at `/.lazurio/browser.json` on
 * this page's own origin, which the gateway forwards behind the same sign-in. Anything but an
 * available view at an absolute https: URL means unavailable, and the right panel keeps
 * upstream's disabled Browser. The view URL carries a short-lived access token in its fragment,
 * so it is asked for each time the browser opens and never stored.
 */

export interface EnvironmentBrowserView {
  /** The view, an absolute https: URL with its access token in the fragment. */
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
