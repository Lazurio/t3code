/**
 * Lazurio overlay (plan DEV-6646): a Lazurio Environment browser's view of one remote tab.
 *
 * The right panel opens another Environment's view as a tab of its own, marked as that
 * Environment's (environmentBrowser.ts). This is a copy of `lazurioBrowserView` in
 * `apps/server/src/lazurio/browserView.ts`, which the Environment browser host uses to answer
 * `preview_open` of another Environment's view; the release contract test keeps the two equal.
 */

/** One remote tab of a Lazurio Environment browser, read from the address of its view. */
export interface LazurioBrowserView {
  /** The view, `https://browser.<labels>.lazurio.io/t/<target id>`. */
  readonly view: string;
  readonly origin: string;
  /** The remote tab's DevTools target id: 32 hexadecimal digits. */
  readonly targetId: string;
  /** The label before `lazurio.io`: an Organization's GitHub login, or the person's own. */
  readonly owner: string;
  /** The label after `browser.`: the Machine, or the person's login on their own Environment. */
  readonly environment: string;
  /** A person's own Environment, `browser.<login>.lazurio.io`. */
  readonly personal: boolean;
}

/**
 * The remote tab whose view is at `address`, or null unless it is exactly
 * `https://browser.<one or more labels>.lazurio.io/t/<32 hex digits>`: no port, credentials, query
 * or fragment, not even an empty one.
 */
export function lazurioBrowserView(address: string): LazurioBrowserView | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.href !== `${url.origin}${url.pathname}`) {
    return null;
  }
  const labels = /^browser\.((?:[a-z0-9-]+\.)+)lazurio\.io$/.exec(url.hostname)?.[1]?.split(".");
  const targetId = /^\/t\/([0-9A-Fa-f]{32})$/.exec(url.pathname)?.[1];
  if (labels === undefined || targetId === undefined) return null;
  // The captured labels end in a dot, so the last item is empty.
  labels.pop();
  return {
    view: url.href,
    origin: url.origin,
    targetId,
    owner: labels.at(-1)!,
    environment: labels[0]!,
    personal: labels.length === 1,
  };
}
