/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): the frame's side of `lazurio.buddy.*` v1,
 * which the Lazurio shell owns (LazurioPlatform F60). A context is taken only from the parent on the
 * exact origin of a Launchpad, T3 Code or MausBot of an Environment, and only about that page's own
 * Environment; a message with any defect (extra or missing member, another `v`) is dropped whole.
 */

const BUDDY_MESSAGE = {
  ready: "lazurio.buddy.ready",
  layout: "lazurio.buddy.layout",
  context: "lazurio.buddy.context",
} as const;

const BUDDY_PROTOCOL_VERSION = 1;

const BUDDY_LAYOUTS = ["panel", "fullscreen", "closed"] as const;
export type BuddyLayout = (typeof BUDDY_LAYOUTS)[number];

const KINDS = ["personal", "work", "team"] as const;
const APPS = ["chat", "apps", "automate", "settings"] as const;
const THEMES = ["light", "dark"] as const;
const LANGS = ["cs", "en"] as const;

/** Names up to 128 characters, a page's path up to 512, a guide's step from 1 to 16. */
const BUDDY_CONTEXT_CAPS = { name: 128, path: 512, step: 16 } as const;

export interface BuddyContext {
  readonly lang: (typeof LANGS)[number];
  readonly theme: (typeof THEMES)[number];
  readonly environment: {
    readonly id: string;
    readonly kind: (typeof KINDS)[number];
    readonly name: string;
  } | null;
  readonly organization: { readonly slug: string; readonly name: string } | null;
  readonly app: (typeof APPS)[number] | null;
  readonly page: { readonly path: string };
  readonly guide: { readonly explainer: string; readonly step: number } | null;
}

type Plain = Readonly<Record<string, unknown>>;

/** Data as `postMessage` delivers a plain object: not a list, a class instance or prototype-less. */
function isPlain(value: unknown): value is Plain {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** Exactly these own, enumerable data members: an extra `__proto__` or symbol key fails. */
function hasOnly(value: Plain, keys: ReadonlyArray<string>): boolean {
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable === true && "value" in descriptor;
  });
}

function isOneOf<T extends string>(values: ReadonlyArray<T>, value: unknown): value is T {
  return typeof value === "string" && (values as ReadonlyArray<string>).includes(value);
}

/** 1 to `max` characters, none of them a control character. */
function isText(value: unknown, max: number): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PAGE_PATH = /^\/(?!\/)[^\s\\?#]*$/;
const EXPLAINER = /^[a-z][a-z0-9-]{0,63}$/;
const HOST_APPS = new Set(["launchpad", "t3code", "mausbot"]);
const LAZURIO_DOMAIN = ".lazurio.io";

/** An Environment's id: its base host, one lowercase DNS label or two (`<machine>.<org>`). */
function isEnvironmentId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const labels = value.split(".");
  return labels.length >= 1 && labels.length <= 2 && labels.every((label) => DNS_LABEL.test(label));
}

/**
 * The Environment of an app origin of its own, `https://<app>.<base>.lazurio.io` (an Apps address
 * may end with `/`): its base host. Null for another scheme, a port, credentials, a path, query or
 * fragment, another domain, or a base of another depth.
 */
function environmentOfAppOrigin(origin: string): string | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  const written = origin.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    (written !== url.origin && written !== `${url.origin}/`) ||
    !url.hostname.endsWith(LAZURIO_DOMAIN)
  )
    return null;
  const labels = url.hostname.slice(0, -LAZURIO_DOMAIN.length).split(".");
  if (labels.length < 2 || labels.length > 3) return null;
  if (!labels.every((label) => DNS_LABEL.test(label))) return null;
  const id = labels.slice(1).join(".");
  return isEnvironmentId(id) ? id : null;
}

/**
 * The Environment of a page that may host Buddy's bubble: exactly its origin, lower case, the
 * Launchpad, T3 Code or MausBot of an Environment. Null for any other origin.
 */
function buddyHostEnvironment(origin: unknown): string | null {
  if (typeof origin !== "string") return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (!HOST_APPS.has(url.hostname.split(".")[0] ?? "")) return null;
  return environmentOfAppOrigin(origin);
}

const isBuddyHostOrigin = (origin: unknown): origin is string =>
  buddyHostEnvironment(origin) !== null;

/**
 * The origin of the page around the frame: `location.ancestorOrigins[0]`, else the origin of
 * `document.referrer` (the bubble frames Buddy with `referrerpolicy="origin"`); null unless it is a
 * host of the bubble. A frame that navigated itself hears nothing until framed again.
 */
export function buddyHostOriginOf(
  ancestor: string | null | undefined,
  referrer: string | null | undefined,
): string | null {
  if (typeof ancestor === "string" && ancestor !== "" && ancestor !== "null")
    return isBuddyHostOrigin(ancestor) ? ancestor : null;
  if (typeof referrer !== "string" || referrer === "") return null;
  try {
    const origin = new URL(referrer).origin;
    return isBuddyHostOrigin(origin) ? origin : null;
  } catch {
    return null;
  }
}

/** A page's path as a context names it: absolute, no `//`, whitespace, backslash, `?` or `#`. */
export const isBuddyPagePath = (value: unknown): value is string =>
  isText(value, BUDDY_CONTEXT_CAPS.path) && PAGE_PATH.test(value);

function parseEnvironment(value: unknown): BuddyContext["environment"] | undefined {
  if (value === null) return null;
  if (
    !isPlain(value) ||
    !hasOnly(value, ["id", "kind", "name"]) ||
    !isEnvironmentId(value.id) ||
    !isOneOf(KINDS, value.kind) ||
    !isText(value.name, BUDDY_CONTEXT_CAPS.name)
  )
    return undefined;
  return { id: value.id, kind: value.kind, name: value.name };
}

function parseOrganization(value: unknown): BuddyContext["organization"] | undefined {
  if (value === null) return null;
  if (
    !isPlain(value) ||
    !hasOnly(value, ["slug", "name"]) ||
    !isText(value.slug, 128) ||
    value.slug.trim() !== value.slug ||
    !isText(value.name, BUDDY_CONTEXT_CAPS.name)
  )
    return undefined;
  return { slug: value.slug, name: value.name };
}

function parseGuide(value: unknown): BuddyContext["guide"] | undefined {
  if (value === null) return null;
  if (
    !isPlain(value) ||
    !hasOnly(value, ["explainer", "step"]) ||
    typeof value.explainer !== "string" ||
    !EXPLAINER.test(value.explainer) ||
    typeof value.step !== "number" ||
    !Number.isInteger(value.step) ||
    value.step < 1 ||
    value.step > BUDDY_CONTEXT_CAPS.step
  )
    return undefined;
  return { explainer: value.explainer, step: value.step };
}

const CONTEXT_KEYS = [
  "type",
  "v",
  "lang",
  "theme",
  "environment",
  "organization",
  "app",
  "page",
  "guide",
];

/** A context message's data, member by member; null for anything else. */
function parseBuddyContext(data: unknown): BuddyContext | null {
  if (
    !isPlain(data) ||
    !hasOnly(data, CONTEXT_KEYS) ||
    data.type !== BUDDY_MESSAGE.context ||
    data.v !== BUDDY_PROTOCOL_VERSION ||
    !isOneOf(LANGS, data.lang) ||
    !isOneOf(THEMES, data.theme) ||
    !(data.app === null || isOneOf(APPS, data.app))
  )
    return null;
  const environment = parseEnvironment(data.environment);
  const organization = parseOrganization(data.organization);
  const guide = parseGuide(data.guide);
  const page = data.page;
  if (
    environment === undefined ||
    organization === undefined ||
    guide === undefined ||
    !isPlain(page) ||
    !hasOnly(page, ["path"]) ||
    !isBuddyPagePath(page.path)
  )
    return null;
  return {
    lang: data.lang,
    theme: data.theme,
    environment,
    organization,
    app: data.app,
    page: { path: page.path },
    guide,
  };
}

/**
 * The frame's side: the context of a message event, or null to drop it. Only from the parent
 * window (`fromParent`), on exactly `hostOrigin` (`buddyHostOriginOf`), which must be a host of the
 * bubble, and only about that page's own Environment: its id is the host's base host, and it is
 * personal exactly where that base host has one label.
 */
export function acceptBuddyContext(
  event: { readonly data: unknown; readonly origin: string; readonly fromParent: boolean },
  hostOrigin: string | null,
): BuddyContext | null {
  if (event.fromParent !== true) return null;
  const hostEnvironment = buddyHostEnvironment(hostOrigin);
  if (hostEnvironment === null || event.origin !== hostOrigin) return null;
  const context = parseBuddyContext(event.data);
  if (context === null || context.environment === null) return null;
  const { id, kind } = context.environment;
  if (id !== hostEnvironment || (kind === "personal") !== !id.includes(".")) return null;
  return context;
}

export const buddyReady = () => ({ type: BUDDY_MESSAGE.ready, v: BUDDY_PROTOCOL_VERSION });

/** A request for the window's size; null for a size there is none of. */
export function buddyLayoutRequest(mode: unknown) {
  return isOneOf(BUDDY_LAYOUTS, mode)
    ? { type: BUDDY_MESSAGE.layout, v: BUDDY_PROTOCOL_VERSION, mode }
    : null;
}
