import { type SessionGrantInput, sessionHasLegacyPermissions } from "@t3tools/contracts";

/**
 * Lazurio overlay (the Admin's decision of 2026-10-17): a page without a T3 session asks its own
 * HTTPS origin for a one-time credential (`GET /.lazurio/chat/pairing`, which the gateway forwards
 * to the Launchpad after admission) and exchanges it like any bootstrap credential. Anything but
 * the exact answer pairs nothing and leaves upstream's pairing page; the desktop app never asks.
 */

const ENVIRONMENT_PAIRING_PATH = "/.lazurio/chat/pairing";
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
