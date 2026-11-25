/**
 * LazurioPlatform's C20 (F39 and F50, addenda of 2026-11-25): the pages the Environment browser
 * never opens, which belong in the person's own browser. A copy of
 * `apps/server/src/lazurio/ownBrowser.ts`, which the release contract test keeps equal.
 */

const accountDomains = ["lazurio.io", "auth.lazurio.ai", "dashboard.lazurio.ai"];
const ownSessionLabels = ["launchpad", "t3code", "mausbot", "browser", "buddy"];
const environmentId =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)?$/;

/**
 * The address to hand to the person's own browser when `url` is such a page, `environment` being
 * this Environment's id (`<machine>.<org>` or a person's slug) or null; without credentials, the
 * host in lower case without the root's dot. Null for every other address.
 */
export function ownBrowserAddress(url: unknown, environment: string | null): string | null {
  if (typeof url !== "string") return null;
  let address: URL;
  try {
    address = new URL(url);
  } catch {
    return null;
  }
  if (address.protocol !== "http:" && address.protocol !== "https:") return null;
  const host = address.hostname.toLowerCase().replace(/\.+$/, "");
  const under = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (!accountDomains.some(under)) return null;
  const own =
    environment !== null && environmentId.test(environment) ? `${environment}.lazurio.io` : null;
  if (own !== null && host !== own && host.endsWith(`.${own}`)) {
    const label =
      host
        .slice(0, -(own.length + 1))
        .split(".")
        .pop() ?? "";
    if (!ownSessionLabels.includes(label)) return null;
  }
  const port = address.port === "" ? "" : `:${address.port}`;
  return new URL(
    `${address.protocol}//${host}${port}${address.pathname}${address.search}${address.hash}`,
  ).href;
}

/** The Environment id of a view's origin, `https://browser.<id>.lazurio.io`, or null. */
export function environmentOfView(origin: string): string | null {
  const id = /^https:\/\/browser\.(.+)\.lazurio\.io$/.exec(origin)?.[1];
  return id !== undefined && environmentId.test(id) ? id : null;
}
