/**
 * Lazurio overlay: a Remote Environment's people's view is at `https://browser.<base>.lazurio.io`,
 * where `/t/<DevTools target id>` shows one remote tab. `apps/web/src/lazurio/browserView.ts` holds
 * a copy of `lazurioBrowserView`; the release contract test keeps the two equal.
 */

/** One remote tab of a Lazurio Environment browser, read from the address of its view. */
export interface LazurioBrowserView {
  /** The view, `https://browser.<base>.lazurio.io/t/<target id>`. */
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
 * `https://browser.<base>.lazurio.io/t/<32 hex digits>`, `<base>` an Environment id of one or two
 * DNS labels (LazurioPlatform F50, `environmentIdOf` and `dnsLabel`): no port, credentials, query
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
  // A label starts and ends with a letter or digit and has at most 63 characters.
  const base =
    /^browser\.([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))?\.lazurio\.io$/.exec(
      url.hostname,
    );
  const targetId = /^\/t\/([0-9A-Fa-f]{32})$/.exec(url.pathname)?.[1];
  if (base === null || targetId === undefined) return null;
  const [, environment, owner] = base;
  return {
    view: url.href,
    origin: url.origin,
    targetId,
    owner: owner ?? environment!,
    environment: environment!,
    personal: owner === undefined,
  };
}
