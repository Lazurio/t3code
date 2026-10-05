/**
 * Lazurio overlay (root decision 0191, plan DEV-6646): the agent-browser session of a thread.
 *
 * On a Lazurio Environment the agents of every thread work in the Environment browser, one
 * Chromium on the Environment, through the agent-browser CLI, each thread in a window of its
 * own. The CLI takes its session from AGENT_BROWSER_SESSION, so every provider process T3 starts
 * for a thread carries the thread's name. The web client asks the Environment for the view of
 * the same session, so `apps/web/src/lazurio/agentBrowserSession.ts` holds a copy of
 * `agentBrowserSessionName`: sharing it through packages/shared would take an entry in that
 * package's export map, which upstream rewrites every few days. The release contract test keeps
 * the two copies equal.
 */

export const AGENT_BROWSER_SESSION_ENV = "AGENT_BROWSER_SESSION";

/** agent-browser accepts [A-Za-z0-9_-] in a session name; its dashboard takes 64 characters. */
const SESSION_NAME_LIMIT = 64;

/**
 * `t3-` and the thread id. An id with characters outside [A-Za-z0-9_-], or too long to fit, has
 * them replaced by `-`, is cut, and ends in a hash of the exact id, so that two threads never
 * share a session, and with it a window.
 */
export function agentBrowserSessionName(threadId: string): string {
  const sanitized = threadId.replace(/[^A-Za-z0-9_-]/g, "-");
  const name = `t3-${sanitized}`;
  if (sanitized === threadId && name.length <= SESSION_NAME_LIMIT) return name;
  let hash = 0x811c9dc5;
  for (let index = 0; index < threadId.length; index += 1) {
    hash = Math.imul(hash ^ threadId.charCodeAt(index), 0x01000193);
  }
  const suffix = (hash >>> 0).toString(16).padStart(8, "0");
  return `${name.slice(0, SESSION_NAME_LIMIT - suffix.length - 1)}-${suffix}`;
}

/**
 * The provider-session config ProviderService records for a thread, with the thread's session
 * added to the environment every adapter spreads into the processes it starts for that thread
 * (`withAgentDeviceEnvironment`). The thread's own name wins over one T3 itself inherited.
 */
export function withAgentBrowserSession<
  Config extends {
    readonly threadId: string;
    readonly agentDeviceEnvironment?: Readonly<Record<string, string>>;
  },
>(config: Config): Config {
  return {
    ...config,
    agentDeviceEnvironment: {
      ...config.agentDeviceEnvironment,
      [AGENT_BROWSER_SESSION_ENV]: agentBrowserSessionName(config.threadId),
    },
  };
}
