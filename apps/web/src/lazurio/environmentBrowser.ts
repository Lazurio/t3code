/**
 * Lazurio overlay (root decision 0191): one shared Chromium runs on the Environment and its view
 * at `https://browser.<…>/t/<target id>` shows one remote tab. The frame runs the view's scripts
 * in the view's origin (allow-scripts, allow-same-origin), safe only while that origin is not this
 * page's, so the view is never framed on the page's origin.
 */

import { lazurioBrowserView, type LazurioBrowserView } from "./browserView";

/** A tab of the panel's Environment browser: one remote tab. */
export interface EnvironmentBrowserTab {
  /** The panel surface, `environment-browser:<target id>`, so each remote tab is open once. */
  readonly id: `environment-browser:${string}`;
  /** The view of that tab, `https://<view host>/t/<target id>`. */
  readonly view: string;
}

/** The view of one remote tab names its DevTools target id: 32 hexadecimal digits. */
const TAB_VIEW_PATH = /^\/t\/([0-9A-Fa-f]{32})$/;

/**
 * Null unless exactly `https://<host>/t/<32 hex digits>`, with no credentials, query or fragment,
 * so a kept address names one remote tab and carries nothing else. With `pageOrigin`, the page's
 * own origin is refused too: the view is never framed on the page's origin.
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
 * tab (environmentBrowserTab) on the origin of this Environment's view, as T3 Code's server names
 * it. Any other address, or a view not named yet, is left to the browser.
 */
export function environmentBrowserLink(
  href: string,
  pageOrigin: string,
  viewOrigin: string | null,
): EnvironmentBrowserTab | null {
  const tab = viewOrigin === null ? null : environmentBrowserTab(href, pageOrigin);
  return tab !== null && originOf(tab.view) === viewOrigin ? tab : null;
}

/** A tab of the right panel that shows another Lazurio Environment's browser. */
export interface ForeignEnvironmentBrowserTab extends EnvironmentBrowserTab {
  /** Whose Environment it is, read from the view's address. */
  readonly environment: LazurioBrowserView;
}

/**
 * Another Environment's view of one remote tab, or null when it is on this Environment's view
 * origin or a sibling host of this page: an Environment's apps and view share one parent domain
 * (LazurioPlatform F39 point 8), so a foreign link is recognized without asking the Environment.
 */
export function foreignEnvironmentBrowserTab(
  address: unknown,
  pageOrigin: string,
  viewOrigin: string | null,
): ForeignEnvironmentBrowserTab | null {
  const tab = environmentBrowserTab(address, pageOrigin);
  const environment = tab === null ? null : lazurioBrowserView(tab.view);
  if (tab === null || environment === null || environment.origin === viewOrigin) return null;
  return parentDomainOf(environment.origin) === parentDomainOf(pageOrigin)
    ? null
    : { ...tab, environment };
}

/** The domain an origin's host is a name in: the host without its first label. */
function parentDomainOf(origin: string): string | null {
  try {
    const host = new URL(origin).hostname;
    return host.includes(".") ? host.slice(host.indexOf(".") + 1) : null;
  } catch {
    return null;
  }
}

/**
 * The id by which the Environment's shell names the Environment of a view: its view's host
 * between `browser.` and `.lazurio.io` (`vm-02.acme`, or `example-person` for a person's own).
 * The panel hands it to the shell's `<lazurio-environment>`, which names that Environment as its switcher
 * does (LazurioPlatform F39, addendum of 2026-10-12); the fork has no naming rule of its own.
 */
export const viewEnvironmentId = (environment: LazurioBrowserView): string =>
  new URL(environment.origin).hostname.slice("browser.".length, -".lazurio.io".length);

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

/** What the view in a panel frame says (LazurioPlatform F39, F47 point 6): its tab's title, a
 * page's new tab, or that its tab ended. The frame that says it is the tab it speaks of. */
export type EnvironmentBrowserMessage =
  | {
      readonly type: "info";
      /** The page's title, else its host; null for a page with neither, such as a new tab. */
      readonly title: string | null;
    }
  | { readonly type: "new-tab"; readonly tab: EnvironmentBrowserTab }
  | { readonly type: "closed" };

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
  if (message.type === "lazurio-browser:closed") return { type: "closed" };
  return null;
}

/** The origin of an address, or null when it is none. */
export function originOf(url: string): string | null {
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
