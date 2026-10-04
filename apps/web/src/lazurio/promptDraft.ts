import type { ScopedProjectRef } from "@t3tools/contracts";

import type { DraftId } from "../composerDraftStore";

/**
 * Lazurio overlay: a prepared prompt opened by link, left unsent in a new
 * thread's composer (Lazurio/t3code#35).
 *
 * The Lazurio Launchpad of the Environment opens Chat with
 * `#lazurio-prompt=<id>&lazurio-org=<login>` in the fragment, after the
 * pairing token when there is one. A link never carries text: the text and
 * the project folder come from this page's own origin, where the
 * Environment's gateway serves `/.lazurio/prompts/<id>?org=<login>` from the
 * Launchpad behind the same sign-in. Anything else (an unknown id, a failed
 * or redirected fetch, an answer of another shape) puts nothing in the
 * composer, and nothing here ever sends a message.
 */

export interface PromptLink {
  readonly id: string;
  readonly organization: string;
}

export interface PreparedPrompt {
  readonly text: string;
  /** The absolute root of the project the new thread opens in. */
  readonly cwd: string;
}

const PROMPT_PARAM = "lazurio-prompt";
const ORGANIZATION_PARAM = "lazurio-org";
const PROMPT_ID = /^[a-z][a-z0-9-]{0,63}$/;
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const PROMPT_SCHEMA = "lazurio.prompt.v1";
const MAX_PROMPT_LENGTH = 16 * 1024;
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/])/;

const fragmentOf = (url: URL) => new URLSearchParams(url.hash.slice(1));

/** The prompt a link names, or null: exactly one id and one login, of their grammar. */
export function readPromptLink(url: URL): PromptLink | null {
  const fragment = fragmentOf(url);
  const ids = fragment.getAll(PROMPT_PARAM);
  const organizations = fragment.getAll(ORGANIZATION_PARAM);
  const [id] = ids;
  const [organization] = organizations;
  if (ids.length !== 1 || organizations.length !== 1 || !id || !organization) return null;
  if (!PROMPT_ID.test(id) || !GITHUB_LOGIN.test(organization)) return null;
  return { id, organization };
}

/** The same address without the prompt's parameters; everything else stays as it was. */
export function stripPromptLink(url: URL): URL {
  const next = new URL(url.href);
  const fragment = fragmentOf(next);
  if (!fragment.has(PROMPT_PARAM) && !fragment.has(ORGANIZATION_PARAM)) return next;
  fragment.delete(PROMPT_PARAM);
  fragment.delete(ORGANIZATION_PARAM);
  next.hash = fragment.toString();
  return next;
}

/**
 * Takes the prompt link off the address once, at boot, before the router or
 * the pairing read it. Returns the reader of the link taken: it hands it over
 * once and is empty afterwards. Kept in memory only.
 */
export function capturePromptLink(
  location: { readonly href: string },
  replace: (href: string) => void,
): () => PromptLink | null {
  const url = new URL(location.href);
  let pending = readPromptLink(url);
  const stripped = stripPromptLink(url);
  if (stripped.href !== url.href) replace(stripped.href);
  return () => {
    const taken = pending;
    pending = null;
    return taken;
  };
}

/** The prompt's text and project folder from this origin, or null on anything unexpected. */
export async function fetchPrompt(
  link: PromptLink,
  origin: string,
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
): Promise<PreparedPrompt | null> {
  const url = new URL(`/.lazurio/prompts/${encodeURIComponent(link.id)}`, origin);
  url.searchParams.set("org", link.organization);
  try {
    const response = await fetcher(url.href, {
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok || new URL(response.url).origin !== url.origin) return null;
    if (!(response.headers.get("content-type") ?? "").startsWith("application/json")) return null;
    const value: unknown = await response.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const { schema, id, text, cwd } = value as Record<string, unknown>;
    if (schema !== PROMPT_SCHEMA || id !== link.id) return null;
    if (typeof text !== "string" || text.trim().length === 0 || text.length > MAX_PROMPT_LENGTH) {
      return null;
    }
    if (typeof cwd !== "string" || !ABSOLUTE_PATH.test(cwd)) return null;
    return { text, cwd };
  } catch {
    return null;
  }
}

/** What opening a prompt needs from the app; none of it can send a message. */
export interface PromptDraftDependencies {
  readonly origin: string;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** The primary environment's project rooted exactly at `cwd`, if any. */
  readonly findProject: (cwd: string) => ScopedProjectRef | null;
  /** Adds `cwd` as a project of the primary environment, as "Add project" does. */
  readonly addProject: (cwd: string) => Promise<ScopedProjectRef | null>;
  /** Opens a new thread draft in the project; null when another navigation overtook it. */
  readonly openThread: (projectRef: ScopedProjectRef) => Promise<{ draftId: DraftId } | null>;
  readonly setPrompt: (draftId: DraftId, text: string) => void;
}

const OPEN_ATTEMPTS = 3;

/**
 * Opens the prompt a link named: a new thread in the project rooted at its
 * folder (added as a project when there is none), with the text in the
 * composer, unsent.
 */
export async function openPromptDraft(
  link: PromptLink,
  dependencies: PromptDraftDependencies,
): Promise<"opened" | "failed"> {
  const prompt = await fetchPrompt(link, dependencies.origin, dependencies.fetch);
  if (prompt === null) return "failed";
  try {
    const projectRef =
      dependencies.findProject(prompt.cwd) ?? (await dependencies.addProject(prompt.cwd));
    if (projectRef === null) return "failed";
    // The index route opens a draft of the latest project at the same time;
    // whichever navigation lands second makes the other one return null.
    for (let attempt = 0; attempt < OPEN_ATTEMPTS; attempt += 1) {
      const opened = await dependencies.openThread(projectRef);
      if (opened !== null) {
        dependencies.setPrompt(opened.draftId, prompt.text);
        return "opened";
      }
    }
    return "failed";
  } catch {
    return "failed";
  }
}

let takePending: () => PromptLink | null = () => null;

/** Call once in `main.tsx`, before the router is created. */
export function captureLazurioPromptLink(): void {
  takePending = capturePromptLink(window.location, (href) =>
    window.history.replaceState(window.history.state, "", href),
  );
}

/** The link taken at boot, once. */
export function takeLazurioPromptLink(): PromptLink | null {
  return takePending();
}
