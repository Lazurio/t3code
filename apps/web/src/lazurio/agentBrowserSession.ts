/**
 * Lazurio overlay (root decision 0191, plan DEV-6646): the agent-browser session of a thread.
 *
 * The server starts every provider process of a thread with this name in AGENT_BROWSER_SESSION,
 * and the web asks the Environment for the view of the same session. This is a copy of
 * `agentBrowserSessionName` in `apps/server/src/lazurio/agentBrowserSession.ts`; the release
 * contract test keeps the two equal.
 */

/** agent-browser accepts [A-Za-z0-9_-] in a session name; its dashboard takes 64 characters. */
const SESSION_NAME_LIMIT = 64;

/** `t3-` and the thread id with every character outside [A-Za-z0-9_-] as `-`, at most 64 long. */
export function agentBrowserSessionName(threadId: string): string {
  return `t3-${threadId.replace(/[^A-Za-z0-9_-]/g, "-")}`.slice(0, SESSION_NAME_LIMIT);
}
