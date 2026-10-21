import { type SessionGrantInput, sessionHasLegacyPermissions } from "@t3tools/contracts";

/**
 * Lazurio overlay: the Environment pairs its own browser (the Admin's decision of 2026-10-17,
 * which replaces the rule of 2026-09-21 that a direct visit shows T3's pairing page).
 *
 * A page that loads without a T3 session asks its own origin for a pairing credential:
 * `GET /.lazurio/chat/pairing`, which the Lazurio gateway forwards from T3's origin to the
 * Environment's Launchpad once it has admitted the request (the Lazurio account's sign-in). The
 * Launchpad mints a one-time token with `t3 lazurio pairing`, and `bootstrapServerAuth` exchanges
 * it like any bootstrap credential, so the person never sees a token and a deep link keeps its
 * place. A browser paired on 0.0.45 has what 0.1.0 calls legacy scopes, without the terminal,
 * files, Git, settings or the Environment browser's tab holds, and asks too; when that fails, it
 * keeps the session it has.
 *
 * Anything but the exact answer (T3's own index.html outside Lazurio or with an older Platform,
 * another status, a redirect, a network error, no answer within a few seconds) pairs nothing, and
 * the page stays as upstream has it, with its pairing page. The desktop app never asks: it pairs
 * with a bootstrap credential of its own. Nor does a page served over plain HTTP: a Lazurio
 * gateway serves T3 only over HTTPS, and a credential never travels without it.
 */

export const ENVIRONMENT_PAIRING_PATH = "/.lazurio/chat/pairing";
const ANSWER_KIND = "chat-pairing";
const ANSWER_KEYS = new Set(["kind", "credential", "expiresAt"]);
const CREDENTIAL = /^[A-Za-z0-9_-]{8,128}$/;
const TIMEOUT_MS = 5_000;

/** The credential of the Environment's answer, or null for anything but exactly its shape. */
export function readPairingAnswer(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const answer = value as Record<string, unknown>;
  if (Object.keys(answer).some((key) => !ANSWER_KEYS.has(key))) return null;
  const { kind, credential, expiresAt } = answer;
  if (kind !== ANSWER_KIND || typeof credential !== "string" || !CREDENTIAL.test(credential)) {
    return null;
  }
  return expiresAt === undefined || typeof expiresAt === "string" ? credential : null;
}

/** A pairing credential from `origin`'s Environment, or null on anything unexpected; never throws. */
export async function fetchPairingCredential(
  origin: string,
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
  timeoutMs = TIMEOUT_MS,
): Promise<string | null> {
  const url = new URL(ENVIRONMENT_PAIRING_PATH, origin);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url.href, {
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status !== 200 || new URL(response.url).origin !== url.origin) return null;
    if (!(response.headers.get("content-type") ?? "").startsWith("application/json")) return null;
    return readPairingAnswer(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The third source of `bootstrapServerAuth`, after a link's credential and the desktop app's:
 * this page's Environment pairs it. Null without asking in the desktop app and over plain HTTP.
 */
export function fetchEnvironmentPairingCredential(): Promise<string | null> {
  if (window.desktopBridge !== undefined || window.location.protocol !== "https:") {
    return Promise.resolve(null);
  }
  return fetchPairingCredential(window.location.origin, (url, init) => fetch(url, init));
}

/**
 * A session paired on 0.0.45, with what 0.1.0 calls legacy scopes, pairs again with its
 * Environment's credential, exchanged like any bootstrap credential. When the Environment has none
 * or the exchange fails, the session stays as it was.
 */
export async function pairAgainWithEnvironment(
  session: SessionGrantInput,
  exchange: (credential: string) => Promise<unknown>,
): Promise<void> {
  if (!sessionHasLegacyPermissions(session)) return;
  const credential = await fetchEnvironmentPairingCredential();
  if (credential !== null) await exchange(credential).catch(() => undefined);
}
