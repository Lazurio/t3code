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
import {
  environmentBrowserLink,
  environmentBrowserTab,
  fetchEnvironmentBrowser,
  isPlainPrimaryClick,
  readEnvironmentBrowserMessage,
} from "./environmentBrowser";

const origin = "https://t3code.vm-01.example.lazurio.io";
const session = "t3-4a1f9c2e-7b3d-4e5f-8a6b-9c0d1e2f3a4b";
const viewOrigin = "https://browser.vm-01.example.lazurio.io";
// The thread's own tab, as the Environment names it (a DevTools target id: 32 hex digits).
const view = `${viewOrigin}/t/8A3F0C2D4E5B6A7980C1D2E3F4A5B6C7`;
const document = { available: true, view, session };
// Another remote tab, one a page opened.
const targetId = "0123456789abcdef".repeat(2);
const tabView = `${viewOrigin}/t/${targetId}`;

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
      // Two imported ids whose 32-bit FNV-1a suffixes collided (review of Lazurio/t3code#41).
      `import:codex-${"w".repeat(58)}:f64cccd6-59c8-42a7-aa0e-319969aeccc9`,
      `import:codex-${"w".repeat(58)}:3c4a8834-35dc-418d-a6dd-d8d1934ab83f`,
    ];
    const names = ids.map(agentBrowserSessionName);
    for (const name of names) expect(name).toMatch(/^t3-[A-Za-z0-9_-]{1,61}$/);
    expect(new Set(names).size).toBe(ids.length);
    expect(names[0]).toMatch(/^t3-thread-with-colons-and-slash-[0-9a-f]{32}$/);
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
      ["relative view", async () => answer({ ...document, view: `/t/${targetId}` })],
      ["script view", async () => answer({ ...document, view: "javascript:alert(1)" })],
      ["this page's origin", async () => answer({ ...document, view: `${origin}/t/${targetId}` })],
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

describe("a tab of the panel", () => {
  it("is the view of exactly one remote tab, named by its target id", () => {
    expect(environmentBrowserTab(tabView)).toEqual({
      id: `environment-browser:${targetId}`,
      view: tabView,
    });
    expect(environmentBrowserTab(view, origin)).toEqual({
      id: "environment-browser:8A3F0C2D4E5B6A7980C1D2E3F4A5B6C7",
      view,
    });
  });

  it("is no tab at any other address", () => {
    for (const address of [
      tabView.replace("https:", "http:"),
      `${viewOrigin}/`,
      `${viewOrigin}/t/`,
      `${tabView}/`,
      `${tabView}/live`,
      `${viewOrigin}/t/${targetId.slice(1)}`,
      `${tabView}0`,
      `${viewOrigin}/t/${"g".repeat(32)}`,
      `${viewOrigin}/x/${targetId}`,
      `${tabView}?session=t3-other`,
      `${tabView}?`,
      `${tabView}#token`,
      `${tabView}#`,
      tabView.replace("https://", "https://person@"),
      tabView.replace("https://", "https://person:secret@"),
      `/t/${targetId}`,
      `javascript:alert(1)//t/${targetId}`,
      "not an address",
    ]) {
      expect([address, environmentBrowserTab(address)]).toEqual([address, null]);
    }
    for (const value of [42, null, undefined, { view: tabView }]) {
      expect(environmentBrowserTab(value)).toBeNull();
    }
    // Framed with allow-same-origin on this page's own origin, the view would not be confined.
    expect(environmentBrowserTab(`${origin}/t/${targetId}`, origin)).toBeNull();
  });
});

describe("a link in the chat", () => {
  it("opens in the panel when it is one remote tab of the view the Environment named", () => {
    expect(environmentBrowserLink(tabView, origin, viewOrigin)).toEqual({
      id: `environment-browser:${targetId}`,
      view: tabView,
    });
  });

  it("is left to the browser at any other address, and before the Environment named its view", () => {
    for (const href of [
      `${tabView}?q=1`,
      `${tabView}#top`,
      tabView.replace("https:", "http:"),
      tabView.replace("https://", "https://person@"),
      `${viewOrigin}/`,
      `${tabView}/live`,
      `https://elsewhere.example.test/t/${targetId}`,
      `${origin}/t/${targetId}`,
      "not an address",
    ]) {
      expect([href, environmentBrowserLink(href, origin, viewOrigin)]).toEqual([href, null]);
    }
    expect(environmentBrowserLink(tabView, origin, null)).toBeNull();
  });

  it("opens there on a plain primary click only, never on a new-tab gesture", () => {
    const click = {
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
    };
    expect(isPlainPrimaryClick(click)).toBe(true);
    for (const gesture of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
      { button: 2 },
      { defaultPrevented: true },
    ]) {
      expect([gesture, isPlainPrimaryClick({ ...click, ...gesture })]).toEqual([gesture, false]);
    }
  });
});

describe("a message of the framed view", () => {
  const frame = {};
  const newTab = { type: "lazurio-browser:new-tab", view: tabView, url: "https://example.com/" };
  const info = {
    type: "lazurio-browser:info",
    url: "https://example.com/docs",
    title: "Docs",
    view,
  };
  const message = (data: unknown, from: { source?: unknown; origin?: string } = {}) => ({
    data,
    source: frame,
    origin: viewOrigin,
    ...from,
  });

  it("tells its tab's title, or else the page's host", () => {
    expect(readEnvironmentBrowserMessage(message(info), frame, view)).toEqual({
      type: "info",
      title: "Docs",
    });
    expect(readEnvironmentBrowserMessage(message({ ...info, title: " " }), frame, view)).toEqual({
      type: "info",
      title: "example.com",
    });
    expect(
      readEnvironmentBrowserMessage(
        message({ ...info, url: "about:blank", title: "" }),
        frame,
        view,
      ),
    ).toEqual({ type: "info", title: null });
  });

  it("opens a page's new tab on the view's own origin", () => {
    expect(readEnvironmentBrowserMessage(message(newTab), frame, view)).toEqual({
      type: "new-tab",
      tab: { id: `environment-browser:${targetId}`, view: tabView },
    });
    // A tab that a page opened tells of its own new tabs as well.
    expect(readEnvironmentBrowserMessage(message(newTab), frame, tabView)).toMatchObject({
      type: "new-tab",
    });
  });

  it("is ignored from another window or origin, of another type, or malformed", () => {
    const cases: Array<[string, ReturnType<typeof message>, object | null]> = [
      ["another window", message(newTab, { source: {} }), frame],
      ["no window", message(newTab, { source: null }), frame],
      ["no frame yet", message(newTab, { source: null }), null],
      ["another origin", message(newTab, { origin: "https://evil.example" }), frame],
      ["this page's origin", message(newTab, { origin }), frame],
      [
        "another Environment",
        message(newTab, { origin: viewOrigin.replace("vm-01", "vm-02") }),
        frame,
      ],
      ["another type", message({ ...newTab, type: "lazurio-browser:close" }), frame],
      ["no type", message({ view: tabView }), frame],
      ["text", message(JSON.stringify(newTab)), frame],
      ["nothing", message(null), frame],
      ["view type", message({ ...newTab, view: 42 }), frame],
      ["http view", message({ ...newTab, view: tabView.replace("https:", "http:") }), frame],
      ["view with a query", message({ ...newTab, view: `${tabView}?token=x` }), frame],
      ["view with a fragment", message({ ...newTab, view: `${tabView}#x` }), frame],
      [
        "view with credentials",
        message({ ...newTab, view: tabView.replace("https://", "https://a:b@") }),
        frame,
      ],
      ["view of a new tab", message({ ...newTab, view: `${viewOrigin}/` }), frame],
      [
        "view on another origin",
        message({ ...newTab, view: tabView.replace("vm-01", "vm-02") }),
        frame,
      ],
      [
        "info without a title",
        message({ type: "lazurio-browser:info", url: "https://a.example/" }),
        frame,
      ],
      ["info without an address", message({ ...info, url: null }), frame],
    ];
    for (const [name, event, window] of cases) {
      expect([name, readEnvironmentBrowserMessage(event, window, view)]).toEqual([name, null]);
    }
    expect(readEnvironmentBrowserMessage(message(newTab), frame, "not an address")).toBeNull();
  });
});

describe("the surface", () => {
  const ref = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
  const surface = { id: "environment-browser", kind: "environment-browser" } as const;
  const tab = { id: `environment-browser:${targetId}`, kind: "environment-browser", view: tabView };
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

  it("opens a page's new tab as a tab of its own, once, in front, with the panel open", () => {
    const store = useRightPanelStore.getState();
    store.open(ref, "environment-browser");
    store.close(ref);
    store.openEnvironmentBrowserTab(ref, tabView);
    expect(panel()).toEqual({ isOpen: true, activeSurfaceId: tab.id, surfaces: [surface, tab] });
    store.activateSurface(ref, surface.id);
    store.openEnvironmentBrowserTab(ref, tabView);
    expect(panel()).toEqual({ isOpen: true, activeSurfaceId: tab.id, surfaces: [surface, tab] });
    store.closeSurface(ref, tab.id);
    expect(panel()).toEqual({ isOpen: true, activeSurfaceId: surface.id, surfaces: [surface] });
  });

  it("adds a hidden page's new tab behind the surface in view, as an automatic update", () => {
    const store = useRightPanelStore.getState();
    store.open(ref, "environment-browser");
    const revision = store.getUserActionRevision(ref);
    store.openEnvironmentBrowserTab(ref, tabView, true);
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: surface.id,
      surfaces: [surface, tab],
    });
    store.openEnvironmentBrowserTab(ref, tabView, true);
    expect(panel().surfaces).toEqual([surface, tab]);
    expect(store.getUserActionRevision(ref)).toBe(revision);
    // While the panel closes, the tab joins it without opening it again.
    store.closeSurface(ref, tab.id);
    store.close(ref);
    store.openEnvironmentBrowserTab(ref, tabView, true);
    expect(panel()).toEqual({
      isOpen: false,
      activeSurfaceId: surface.id,
      surfaces: [surface, tab],
    });
  });

  it("ignores an address that is not the view of one remote tab", () => {
    const store = useRightPanelStore.getState();
    for (const address of [
      `${tabView}?x=1`,
      tabView.replace("https:", "http:"),
      `${viewOrigin}/`,
    ]) {
      store.openEnvironmentBrowserTab(ref, address);
    }
    expect(useRightPanelStore.getState().byThreadKey).toEqual({});
    expect(store.getUserActionRevision(ref)).toBe(0);
  });

  it("survives preview reconciliation, which drops browser tabs the server no longer has", () => {
    const store = useRightPanelStore.getState();
    store.openBrowser(ref, "tab-gone");
    store.openEnvironmentBrowserTab(ref, tabView);
    store.open(ref, "environment-browser");
    store.reconcileBrowserSurfaces(ref, []);
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: surface.id,
      surfaces: [tab, surface],
    });
    store.reconcileBrowserSurfaces(ref, ["tab-1"]);
    expect(panel().activeSurfaceId).toBe(surface.id);
    expect(panel().surfaces.map((entry) => entry.id)).toEqual([
      tab.id,
      surface.id,
      "browser:tab-1",
    ]);
  });

  it("toggles, closes, and is restored from storage as it was", () => {
    const store = useRightPanelStore.getState();
    store.toggle(ref, "environment-browser");
    expect(panel().isOpen).toBe(true);
    store.toggle(ref, "environment-browser");
    expect(panel().isOpen).toBe(false);
    store.toggle(ref, "environment-browser");
    store.openEnvironmentBrowserTab(ref, tabView);
    const persisted = JSON.parse(
      JSON.stringify({ byThreadKey: useRightPanelStore.getState().byThreadKey }),
    );
    expect(migratePersistedRightPanelState(persisted).byThreadKey).toEqual(
      useRightPanelStore.getState().byThreadKey,
    );
    store.closeSurface(ref, surface.id);
    store.closeSurface(ref, tab.id);
    expect(panel()).toEqual({ isOpen: false, activeSurfaceId: null, surfaces: [] });
  });
});
