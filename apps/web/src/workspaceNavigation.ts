const T3_HOST_LABEL = "t3code";
const LAUNCHPAD_HOST_LABEL = "launchpad";

/**
 * Hosted Team Workspaces expose T3 Code and Launchpad as sibling private DNS
 * names. Resolve that convention from the current origin so one immutable web
 * build can serve every Team without receiving a Team-specific URL at build
 * time. Local, public and unrelated T3 installations stay unchanged.
 */
export function resolveSiblingLaunchpadUrl(currentHref: string): string | null {
  let current: URL;
  try {
    current = new URL(currentHref);
  } catch {
    return null;
  }

  const labels = current.hostname.split(".");
  if (labels.length < 3 || labels[0]?.toLowerCase() !== T3_HOST_LABEL) {
    return null;
  }

  labels[0] = LAUNCHPAD_HOST_LABEL;
  // Preserve the private T3 origin's transport. A tailnet pilot can begin on
  // HTTP and later adopt HTTPS without a different web build or stale link.
  current.protocol = current.protocol === "https:" ? "https:" : "http:";
  current.hostname = labels.join(".");
  current.port = "";
  current.pathname = "/";
  current.search = "";
  current.hash = "";
  return current.toString();
}
