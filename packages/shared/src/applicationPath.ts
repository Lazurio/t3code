/** Canonical mount prefix; the empty string denotes the root deployment. */
export function normalizeApplicationPath(value: string): string {
  if (value === "" || value === "/") return "";
  if (!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?$/.test(value)) {
    throw new Error("Application base path must contain only slash-separated names.");
  }
  return value.replace(/\/$/, "");
}
