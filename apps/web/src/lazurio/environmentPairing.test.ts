import {
  type AuthBrowserSessionResult,
  AuthRelayWriteScope,
  type AuthSessionState,
  AuthStandardClientScopes,
  EnvironmentAuthInvalidError,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { installEnvironmentHttpTest } from "../../test/environmentHttpTest";
import {
  __resetServerAuthBootstrapForTests,
  resolveInitialServerAuthGateState,
} from "../environments/primary";
import {
  fetchEnvironmentPairingCredential,
  fetchPairingCredential,
  readPairingAnswer,
} from "./environmentPairing";

const origin = "https://t3code.vm-01.example.lazurio.io";
const pairingUrl = `${origin}/.lazurio/chat/pairing`;
// A one-time token as `t3 lazurio pairing` mints it, and the Launchpad's answer around it.
const credential = "7Q4ZK2M9HXRB";
const pairing = { kind: "chat-pairing", credential, expiresAt: "2026-10-17T12:01:00.000Z" };

function answer(body: unknown, init: ResponseInit & { url?: string } = {}): Response {
  const response = new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
  Object.defineProperty(response, "url", { value: init.url ?? pairingUrl });
  return response;
}

/**
 * This page at `href`, in a browser or in the desktop app. The web runtime's HTTP client needs
 * Node's own buffers, so these tests stub the window as upstream's auth bootstrap tests do.
 */
function installPage(href: string, desktopBridge?: unknown) {
  const page = {
    location: new URL(href),
    history: {
      state: null as unknown,
      replaceState: (data: unknown, _unused: string, next?: string) => {
        page.history.state = data;
        if (next !== undefined) page.location = new URL(next, page.location.href);
      },
    },
    ...(desktopBridge === undefined ? {} : { desktopBridge }),
  };
  vi.stubGlobal("window", page);
  vi.stubGlobal("document", { title: "T3 Code (Lazurio)" });
  return page;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the Environment's answer", () => {
  it("is exactly a chat pairing with one credential, its expiry optional", () => {
    expect(readPairingAnswer(pairing)).toBe(credential);
    expect(readPairingAnswer({ kind: "chat-pairing", credential })).toBe(credential);
    expect(readPairingAnswer({ kind: "chat-pairing", credential: "a_b-C9d8" })).toBe("a_b-C9d8");
    expect(readPairingAnswer({ kind: "chat-pairing", credential: "x".repeat(128) })).toBe(
      "x".repeat(128),
    );
  });

  it("is nothing in any other shape", () => {
    for (const [name, value] of [
      ["null", null],
      ["the bare token", credential],
      ["an array", [pairing]],
      ["another kind", { ...pairing, kind: "pairing" }],
      ["no kind", { credential }],
      ["no credential", { kind: "chat-pairing" }],
      ["a short credential", { kind: "chat-pairing", credential: "abc1234" }],
      ["a long credential", { kind: "chat-pairing", credential: "x".repeat(129) }],
      ["a credential with spaces", { kind: "chat-pairing", credential: "7Q4Z K2M9 HXRB" }],
      [
        "a pairing link",
        { kind: "chat-pairing", credential: `${origin}/pair#token=${credential}` },
      ],
      ["a credential of dots", { kind: "chat-pairing", credential: "eyJh.eyJz.c2ln" }],
      ["a number", { kind: "chat-pairing", credential: 12_345_678 }],
      ["an expiry that is no text", { ...pairing, expiresAt: 1_792_000_000_000 }],
      ["one more key", { ...pairing, scopes: ["relay:write"] }],
    ] as const) {
      expect([name, readPairingAnswer(value)]).toEqual([name, null]);
    }
  });
});

describe("the request", () => {
  it("asks only this origin's /.lazurio/chat/pairing, never through a redirect or a cache", async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => answer(pairing));
    await expect(fetchPairingCredential(origin, fetcher)).resolves.toBe(credential);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(pairingUrl);
    expect(init).toMatchObject({
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  });

  it("pairs nothing outside Lazurio, with an older Platform or on any failure", async () => {
    const cases: Array<[string, () => Promise<Response>]> = [
      [
        "T3's own index.html",
        async () =>
          answer("<!doctype html><html><body></body></html>", {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      ],
      ["404", async () => answer({ error: "not-found" }, { status: 404 })],
      ["401", async () => answer({ error: "unauthorized" }, { status: 401 })],
      ["another success", async () => answer(pairing, { status: 201 })],
      ["a redirect", async () => answer("", { status: 302, headers: { location: "/sign-in" } })],
      [
        "a refused redirect or the network",
        async () => {
          throw new TypeError("Failed to fetch");
        },
      ],
      ["no JSON", async () => answer("{", { headers: { "content-type": "application/json" } })],
      ["another shape", async () => answer({ ...pairing, kind: "prompt" })],
      [
        "another origin",
        async () => answer(pairing, { url: "https://evil.example/.lazurio/chat/pairing" }),
      ],
    ];
    for (const [name, fetcher] of cases) {
      expect([name, await fetchPairingCredential(origin, fetcher)]).toEqual([name, null]);
    }
  });

  it("gives up after a few seconds without an answer", async () => {
    vi.useFakeTimers();
    const fetcher = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        );
      });
    let settled = false;
    const pending = fetchPairingCredential(origin, fetcher).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeNull();
  });

  it("goes to this page's own origin, never over plain HTTP or from the desktop app", async () => {
    const fetcher = vi.fn(async (url: string, _init: RequestInit) => answer(pairing, { url }));
    vi.stubGlobal("fetch", fetcher);
    installPage(`${origin}/environment-1/thread-1`);
    await expect(fetchEnvironmentPairingCredential()).resolves.toBe(credential);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([pairingUrl]);

    fetcher.mockClear();
    // No Lazurio gateway serves T3 over plain HTTP, and the desktop app pairs on its own.
    installPage("http://localhost:3773/");
    await expect(fetchEnvironmentPairingCredential()).resolves.toBeNull();
    installPage(`${origin}/`, { getLocalEnvironmentBootstraps: () => [] });
    await expect(fetchEnvironmentPairingCredential()).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

// Upstream's auth gate on a page load, against a fake T3 server through the web's own HTTP client.
describe("a page load", () => {
  const auth = {
    policy: "remote-reachable",
    bootstrapMethods: ["one-time-token"],
    sessionMethods: ["browser-session-cookie"],
    sessionCookieName: "__Host-t3_session",
  } as const;
  const expiresAt = DateTime.makeUnsafe("2027-10-17T00:00:00.000Z");
  // What `t3 lazurio pairing` grants: the standard scopes without relay:write.
  const operatorScopes = AuthStandardClientScopes.filter((scope) => scope !== AuthRelayWriteScope);
  // What a browser paired on 0.0.45 holds on 0.1.0: the old broad scopes only.
  const legacyScopes = ["orchestration:read", "orchestration:operate", "terminal:operate"] as const;
  const signedIn = (permissions: AuthSessionState["scopes"] = []): AuthSessionState => ({
    authenticated: true,
    auth,
    scopes: permissions,
    permissions,
    sessionMethod: "browser-session-cookie",
    expiresAt,
  });
  const paired: AuthBrowserSessionResult = {
    authenticated: true,
    scopes: operatorScopes,
    permissions: operatorScopes,
    sessionMethod: "browser-session-cookie",
    expiresAt,
  };
  const rejected = new EnvironmentAuthInvalidError({
    code: "auth_invalid",
    reason: "invalid_credential",
    traceId: "trace-rejected-environment-credential",
  });

  /** The Environment behind the gateway, which answers with a credential unless a test says not. */
  const launchpad = () =>
    vi.fn(async (url: string, _init: RequestInit) => answer(pairing, { url }));
  let environment = launchpad();
  let dispose: (() => Promise<void>) | undefined;

  /** T3's server with this session; a credential it accepts signs the browser in anew. */
  async function serve(
    session: AuthSessionState | null,
    exchange: Effect.Effect<AuthBrowserSessionResult, EnvironmentAuthInvalidError> = Effect.succeed(
      paired,
    ),
  ) {
    await dispose?.();
    __resetServerAuthBootstrapForTests();
    let current: AuthSessionState = session ?? { authenticated: false, auth };
    const server = await installEnvironmentHttpTest({
      session: () => Effect.sync(() => current),
      browserSession: () =>
        exchange.pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              current = signedIn(operatorScopes);
            }),
          ),
        ),
    });
    dispose = server.dispose;
    return server;
  }

  beforeEach(() => {
    environment = launchpad();
    vi.stubGlobal("fetch", environment);
  });
  afterEach(async () => {
    await dispose?.();
    dispose = undefined;
    __resetServerAuthBootstrapForTests();
  });

  it("without a session pairs with the Environment's credential, on the page it opened", async () => {
    const page = installPage(`${origin}/environment-1/thread-1`);
    const server = await serve(null);
    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "authenticated",
    });
    expect(environment.mock.calls.map(([url]) => url)).toEqual([pairingUrl]);
    expect(server.calls.browserSession).toEqual([{ credential }]);
    expect(page.location.href).toBe(`${origin}/environment-1/thread-1`);
  });

  it("without a session or the Environment's credential stays upstream's, with its pairing page", async () => {
    environment.mockImplementation(async (url) =>
      answer("<!doctype html>", { url, headers: { "content-type": "text/html" } }),
    );
    installPage(`${origin}/environment-1/thread-1`);
    const server = await serve(null);
    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "requires-auth",
      auth,
    });
    expect(server.calls.browserSession).toEqual([]);
  });

  it("asks nothing with a current session, with a link's credential or in the desktop app", async () => {
    installPage(`${origin}/environment-1/thread-1`);
    await serve(signedIn(operatorScopes));
    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "authenticated",
    });

    installPage(`${origin}/#token=LINKTOKEN234`);
    const linked = await serve(null);
    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "authenticated",
    });
    expect(linked.calls.browserSession).toEqual([{ credential: "LINKTOKEN234" }]);

    installPage(`${origin}/`, { getLocalEnvironmentBootstraps: () => [] });
    const desktop = await serve(null);
    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "requires-auth",
      auth,
    });
    expect(desktop.calls.browserSession).toEqual([]);
    expect(environment).not.toHaveBeenCalled();
  });

  it("with a session paired on 0.0.45 pairs again with the Environment's credential", async () => {
    installPage(`${origin}/environment-1/thread-1`);
    const server = await serve(signedIn(legacyScopes));
    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "authenticated",
    });
    expect(server.calls.browserSession).toEqual([{ credential }]);
  });

  it("with a session paired on 0.0.45 keeps it when the Environment cannot pair it again", async () => {
    installPage(`${origin}/environment-1/thread-1`);
    const refused = await serve(signedIn(legacyScopes), Effect.fail(rejected));
    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "authenticated",
    });
    expect(refused.calls.browserSession).toEqual([{ credential }]);

    environment.mockImplementation(async (url) =>
      answer({ error: "not-found" }, { url, status: 404 }),
    );
    const unanswered = await serve(signedIn(legacyScopes));
    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "authenticated",
    });
    expect(unanswered.calls.browserSession).toEqual([]);
  });
});
