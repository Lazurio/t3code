import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  migratePersistedRightPanelState,
  selectActiveRightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";
import { agentBrowserSessionName } from "./agentBrowserSession";
import { fetchEnvironmentBrowser } from "./environmentBrowser";

const origin = "https://t3code.vm-01.example.lazurio.io";
const session = "t3-4a1f9c2e-7b3d-4e5f-8a6b-9c0d1e2f3a4b";
const view = `https://browser.vm-01.example.lazurio.io/?port=9301&view=.html#dashboard-access-token=${"a".repeat(64)}`;
const document = { available: true, view, session };

function answer(body: unknown, init: ResponseInit & { url?: string } = {}): Response {
  const response = new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
  Object.defineProperty(response, "url", {
    value: init.url ?? `${origin}/.lazurio/browser.json?session=${session}`,
  });
  return response;
}

describe("the session name", () => {
  it("is t3- and the thread id when the id already fits agent-browser's grammar", () => {
    expect(agentBrowserSessionName("4a1f9c2e-7b3d-4e5f-8a6b-9c0d1e2f3a4b")).toBe(session);
  });

  it("marks a sanitized or cut id with a hash of the exact id, so threads never share one", () => {
    const ids = [
      "thread.with:colons/and/slashes",
      "thread:with:colons:and:slashes",
      "vlákno-č",
      "emoji-\u{1F642}",
      "x".repeat(62),
      "x".repeat(100),
      `import:codex-${"w".repeat(58)}:019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a70`,
      `import:codex-${"w".repeat(58)}:019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a71`,
    ];
    const names = ids.map(agentBrowserSessionName);
    for (const name of names) expect(name).toMatch(/^t3-[A-Za-z0-9_-]{1,61}$/);
    expect(new Set(names).size).toBe(ids.length);
    expect(names[0]).toMatch(/^t3-thread-with-colons-and-slashes-[0-9a-f]{8}$/);
  });
});

describe("the view", () => {
  it("comes only from this origin's /.lazurio/browser.json for the thread's session", async () => {
    const fetcher = vi.fn(async () => answer(document));
    await expect(fetchEnvironmentBrowser(session, origin, fetcher)).resolves.toEqual({
      view,
      session,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${origin}/.lazurio/browser.json?session=${session}`);
    expect(init).toMatchObject({
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("may show every window when it is not scoped to the session", async () => {
    for (const body of [
      { ...document, session: null },
      { available: true, view },
    ]) {
      await expect(
        fetchEnvironmentBrowser(session, origin, async () => answer(body)),
      ).resolves.toEqual({ view, session: null });
    }
  });

  it("is unavailable for anything but an available view at an https: URL", async () => {
    const cases: Array<[string, () => Promise<Response>]> = [
      ["not offered", async () => answer({ available: false, reason: "not-declared" })],
      ["older Platform", async () => answer({ error: "not-found" }, { status: 404 })],
      ["another success status", async () => answer(document, { status: 202 })],
      ["refused session", async () => answer({ error: "invalid-request" }, { status: 400 })],
      [
        "network or redirect",
        async () => {
          throw new TypeError("Failed to fetch");
        },
      ],
      [
        "T3's own page",
        async () => answer("<!doctype html>", { headers: { "content-type": "text/html" } }),
      ],
      ["not JSON", async () => answer("{", { headers: { "content-type": "application/json" } })],
      ["http view", async () => answer({ ...document, view: view.replace("https:", "http:") })],
      ["relative view", async () => answer({ ...document, view: "/?port=9301" })],
      ["script view", async () => answer({ ...document, view: "javascript:alert(1)" })],
      ["this page's origin", async () => answer({ ...document, view: `${origin}/?port=9301` })],
      ["no view", async () => answer({ available: true, session })],
      ["view type", async () => answer({ ...document, view: 42 })],
      ["available type", async () => answer({ ...document, available: "true" })],
      ["another session", async () => answer({ ...document, session: "t3-other" })],
      ["session type", async () => answer({ ...document, session: 42 })],
      [
        "other origin",
        async () => answer(document, { url: "https://evil.example/.lazurio/browser.json" }),
      ],
      ["array", async () => answer([document])],
    ];
    for (const [name, fetcher] of cases) {
      await expect([name, await fetchEnvironmentBrowser(session, origin, fetcher)]).toEqual([
        name,
        null,
      ]);
    }
  });

  it("is unavailable when the Environment does not answer in time", async () => {
    const hanging = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    await expect(fetchEnvironmentBrowser(session, origin, hanging, 0)).resolves.toBeNull();
  });
});

describe("the surface", () => {
  const ref = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
  const surface = { id: "environment-browser", kind: "environment-browser" } as const;
  const panel = () => selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref);

  beforeEach(() => {
    useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  });

  it("opens once per thread, holds no view URL, and comes back to the front", () => {
    const store = useRightPanelStore.getState();
    store.open(ref, "environment-browser");
    expect(panel()).toEqual({ isOpen: true, activeSurfaceId: surface.id, surfaces: [surface] });
    store.open(ref, "files");
    store.open(ref, "environment-browser");
    expect(panel().surfaces).toEqual([surface, { id: "files", kind: "files" }]);
    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, ref)).toEqual(
      surface,
    );
  });

  it("survives preview reconciliation, which drops browser tabs the server no longer has", () => {
    const store = useRightPanelStore.getState();
    store.openBrowser(ref, "tab-gone");
    store.open(ref, "environment-browser");
    store.reconcileBrowserSurfaces(ref, []);
    expect(panel()).toEqual({ isOpen: true, activeSurfaceId: surface.id, surfaces: [surface] });
    store.reconcileBrowserSurfaces(ref, ["tab-1"]);
    expect(panel().activeSurfaceId).toBe(surface.id);
    expect(panel().surfaces.map((entry) => entry.id)).toEqual([surface.id, "browser:tab-1"]);
  });

  it("toggles, closes, and is restored from storage as it was", () => {
    const store = useRightPanelStore.getState();
    store.toggle(ref, "environment-browser");
    expect(panel().isOpen).toBe(true);
    store.toggle(ref, "environment-browser");
    expect(panel().isOpen).toBe(false);
    store.toggle(ref, "environment-browser");
    const persisted = JSON.parse(
      JSON.stringify({ byThreadKey: useRightPanelStore.getState().byThreadKey }),
    );
    expect(migratePersistedRightPanelState(persisted).byThreadKey).toEqual(
      useRightPanelStore.getState().byThreadKey,
    );
    store.closeSurface(ref, surface.id);
    expect(panel()).toEqual({ isOpen: false, activeSurfaceId: null, surfaces: [] });
  });
});
