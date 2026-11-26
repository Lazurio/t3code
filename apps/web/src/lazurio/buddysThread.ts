/**
 * Lazurio overlay: which thread is Buddy's, as the window learned it from the server. The index
 * route asks when it opens; the window's own controls ask when the window opened directly on the
 * thread's address, where the index never runs (plan LZD-0051, C2).
 */
const BUDDY_THREAD_ROUTE = "/api/lazurio/buddy/thread";

let buddysThread: string | null = null;
let asking = false;
const listeners = new Set<() => void>();

export const subscribeBuddysThread = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Buddy's thread as the window knows it; null until the server answered. */
export const knownBuddysThread = (): string | null => buddysThread;

export function setBuddysThread(threadId: string): void {
  if (buddysThread === threadId) return;
  buddysThread = threadId;
  for (const listener of listeners) listener();
}

/** Asks the server for Buddy's thread: its id, or why there is none. */
export async function openBuddyThread(): Promise<
  { readonly threadId: string; readonly projectId: string } | "not-ready" | "failed"
> {
  const response = await fetch(BUDDY_THREAD_ROUTE, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: "{}",
  }).catch(() => null);
  const body = (await response?.json().catch(() => null)) as {
    threadId?: string;
    projectId?: string;
    error?: string;
  } | null;
  if (response?.ok && typeof body?.threadId === "string")
    return { threadId: body.threadId, projectId: body.projectId ?? "" };
  return body?.error === "no-project" ? "not-ready" : "failed";
}

/** Asks once at a time when the thread is not known yet; it never navigates. */
export async function knowBuddysThread(): Promise<void> {
  if (buddysThread !== null || asking) return;
  asking = true;
  const outcome = await openBuddyThread();
  asking = false;
  if (buddysThread === null && outcome !== "not-ready" && outcome !== "failed")
    setBuddysThread(outcome.threadId);
}
