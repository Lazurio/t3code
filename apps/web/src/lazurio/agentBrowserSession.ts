/**
 * Lazurio overlay (root decision 0191, plan DEV-6646): the agent-browser session of a thread.
 *
 * The server starts every provider process of a thread with this name in AGENT_BROWSER_SESSION,
 * and the web asks the Environment for the view of the same session. This is a copy of
 * `agentBrowserSessionName` in `apps/server/src/lazurio/agentBrowserSession.ts`; the release
 * contract test keeps the two equal.
 */

import { sha256 } from "@noble/hashes/sha2";

/** agent-browser accepts [A-Za-z0-9_-] in a session name; its dashboard takes 64 characters. */
const SESSION_NAME_LIMIT = 64;

/** Hex digits of the id's SHA-256 kept in a cut or rewritten name. */
const DIGEST_LENGTH = 32;

/** SHA-256 of the UTF-8 bytes, as hex (@noble/hashes; the server copy computes the same with
 * node:crypto, and the release contract test compares the two). */
const sha256Hex = (value: string): string =>
  Array.from(sha256(new TextEncoder().encode(value)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

/**
 * `t3-` and the thread id. An id with characters outside [A-Za-z0-9_-], or too long to fit, has
 * them replaced by `-`, is cut, and ends in 32 hex digits (128 bits) of the SHA-256 of the exact
 * id, so that two threads never share a session, and with it a window: a shorter, non-
 * cryptographic suffix let two imported thread ids of the same instance collide.
 */
export function agentBrowserSessionName(threadId: string): string {
  const sanitized = threadId.replace(/[^A-Za-z0-9_-]/g, "-");
  const name = `t3-${sanitized}`;
  if (sanitized === threadId && name.length <= SESSION_NAME_LIMIT) return name;
  const digest = sha256Hex(threadId).slice(0, DIGEST_LENGTH);
  return `${name.slice(0, SESSION_NAME_LIMIT - DIGEST_LENGTH - 1)}-${digest}`;
}
