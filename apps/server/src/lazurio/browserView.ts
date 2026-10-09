/**
 * Lazurio overlay (plan DEV-6646): a Lazurio Environment browser's view of one remote tab.
 *
 * Every Remote Environment serves its people's view at `https://browser.<labels>.lazurio.io`:
 * `browser.<machine>.<org>.lazurio.io` for an Organization's Environment and
 * `browser.<login>.lazurio.io` for a person's own, where `/t/<DevTools target id>` shows exactly
 * one remote tab. The Environment browser host answers `preview_open` of another Environment's
 * view without loading it in this Environment's browser, and the web opens that view as a tab of
 * the right panel, so `apps/web/src/lazurio/browserView.ts` holds a copy of `lazurioBrowserView`.
 * The release contract test keeps the two copies equal.
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
