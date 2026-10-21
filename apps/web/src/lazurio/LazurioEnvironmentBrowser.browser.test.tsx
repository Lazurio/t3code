import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, type ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, fakeTimers, render, stubGlobal } from "../../test/render";
import { RightPanelTabs } from "../components/RightPanelTabs";
import { toastManager } from "../components/ui/toast";
import { dismissContextMenu } from "../contextMenuFallback";
import {
  type RightPanelSurface,
  selectThreadRightPanelState,
  type ThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";
import {
  ENVIRONMENT_ELEMENT,
  LazurioRightPanelSurfaces,
  useLazurioThreadTabs,
} from "./LazurioEnvironmentBrowser";
import {
  newTabSurface,
  reloadSurface,
  rememberTitle,
  resetThreadTabs,
  syncOf,
  tabSurfaceId,
  type ThreadTab,
  type ThreadTabsSnapshot,
  useThreadTabsStore,
} from "./threadTabs";

// The threads below are of the page's own environment.
vi.mock(import("../state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: (() => "env-1") as never,
}));
// The router's route: the chat's hook reads which thread it shows when a thread's view closes.
const route = vi.hoisted(() => ({
  state: { matches: [] as Array<{ readonly params: Record<string, string> }> },
}));
vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useRouter: (() => route) as never,
}));
vi.mock(import("~/hooks/useTheme"), async (original) => ({
  ...(await original()),
  useTheme: () => ({ theme: "light", resolvedTheme: "light", themeHalves: null }) as never,
}));
vi.mock(import("~/browser/browserDefaults"), async (original) => ({
  ...(await original()),
  useBrowserDefaults: () => ({ profiles: [] }) as never,
}));

// The page's own view, beside T3 on a Lazurio Environment. The page's origin is the test
// runner's; the cases that depend on it are in environmentBrowser.test.ts.
const viewOrigin = "https://browser.vm-01.example.lazurio.io";
const id = (n: number) => n.toString(16).toUpperCase().padStart(32, "0");
const tab = (n: number) => ({ id: tabSurfaceId(id(n)), kind: "environment-browser" }) as const;
const viewOf = (n: number) => `${viewOrigin}/t/${id(n)}`;
const files = { id: "files", kind: "files" } as const;
const threadA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const threadB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));
// Another Environment's people's view of one of its tabs, where an agent works over SSH.
const foreignId = "fedcba9876543210".repeat(2);
const foreignOrigin = "https://browser.vm-02.acme.lazurio.io";
const foreignView = `${foreignOrigin}/t/${foreignId}`;
const foreignTab = {
  id: `environment-browser:${foreignId}`,
  kind: "environment-browser",
  view: foreignView,
} as const;

const snapshot = (
  tabs: ReadonlyArray<Partial<ThreadTab> & { readonly tabId: string }>,
  overrides: Partial<ThreadTabsSnapshot> = {},
): ThreadTabsSnapshot => ({
  available: true,
  epoch: "epoch-1",
  revision: 1,
  threadId: "thread-A",
  strip: "t3-thread-A",
  viewOrigin,
  tabs: tabs.map((entry) => ({
    view: `${viewOrigin}/t/${entry.tabId}`,
    agent: false,
    alsoHeldBy: [],
    ...entry,
  })),
  ...overrides,
});
const panel = (threadRef: ScopedThreadRef = threadA) =>
  selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef);
const setPanel = (state: ThreadRightPanelState) =>
  useRightPanelStore.setState({ byThreadKey: { [scopedThreadKey(threadA)]: state } });
const withSnapshot = (answer: ThreadTabsSnapshot | null, threadRef: ScopedThreadRef = threadA) =>
  useThreadTabsStore.setState((state) => ({
    snapshots: { ...state.snapshots, [scopedThreadKey(threadRef)]: answer },
  }));
const showRoute = (params: Record<string, string>) => {
  route.state.matches = [{ params }];
};

/**
 * One test's page, from nothing: the stores start empty, the route shows no thread, the server's
 * streams are fakes the test emits on, and its POSTs answer with thread A's holder file.
 */
function setup() {
  route.state.matches = [];
  resetThreadTabs();
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  const posted: Array<{ readonly action: string; readonly body: unknown }> = [];
  let held: ThreadTab[] = [];
  const opened: FakeEventSource[] = [];
  class FakeEventSource {
    readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
    closed = false;
    constructor(readonly url: string) {
      opened.push(this);
    }
    addEventListener(type: string, listener: (event: MessageEvent) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    close() {
      this.closed = true;
    }
    emit(type: string, data: unknown) {
      return act(() => {
        for (const listener of this.listeners.get(type) ?? []) {
          listener(new MessageEvent(type, { data: JSON.stringify(data) }));
        }
      });
    }
  }
  const stubs = new DisposableStack();
  stubs.use(stubGlobal("EventSource", FakeEventSource));
  stubs.use(
    stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const action = url.split("/").at(-1) ?? "";
      const body = JSON.parse(String(init.body)) as { readonly tabId: string };
      posted.push({ action, body });
      held =
        action === "hold"
          ? held.some((entry) => entry.tabId === body.tabId)
            ? held
            : [...held, { tabId: body.tabId, view: "", agent: false, alsoHeldBy: [] }]
          : held.filter((entry) => entry.tabId !== body.tabId);
      return new Response(JSON.stringify(snapshot(held)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return {
    /** The POSTs the page sent. */
    posted,
    /** What thread A's holder file holds from now on. */
    hold: (tabs: ReadonlyArray<ThreadTab>) => {
      held = [...tabs];
    },
    opened,
    /** The stream the page opened last. */
    stream: () => {
      const source = opened.at(-1);
      if (source === undefined) throw new Error("No event stream");
      return source;
    },
    [Symbol.dispose]: () => stubs.dispose(),
  };
}

// The hook reads the route from its mocked useRouter, and nothing else here needs a router.
const renderUi = (ui: ReactNode) => render(ui, { router: false });

const settled = async (threadRef: ScopedThreadRef = threadA) => {
  const sync = syncOf(threadRef);
  let queue: Promise<unknown>;
  do {
    queue = sync.queue;
    await queue;
  } while (queue !== sync.queue);
};

/** The panel's content, as ChatView draws it. */
const surfacesOf = (
  threadRef: ScopedThreadRef,
  surfaces: readonly RightPanelSurface[],
  activeSurfaceId: string,
) => (
  <LazurioRightPanelSurfaces
    threadRef={threadRef}
    surfaces={surfaces}
    activeSurfaceId={activeSurfaceId}
  >
    {activeSurfaceId === files.id ? <p>Files in view</p> : null}
  </LazurioRightPanelSurfaces>
);

function frameOf(container: HTMLElement, view: string): HTMLIFrameElement {
  const frame = container.querySelector<HTMLIFrameElement>(`iframe[src="${view}"]`);
  if (frame === null) throw new Error(`No frame shows ${view}`);
  return frame;
}

const isHidden = (frame: HTMLIFrameElement) => frame.closest("[inert]") !== null;
const tell = (frame: HTMLIFrameElement, data: unknown, origin = viewOrigin) =>
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", { data, origin, source: frame.contentWindow }),
    );
  });

describe("the panel's Environment browser frames", () => {
  it("stay mounted while the panel shows the thread, only the active one in view", async () => {
    using _page = setup();
    withSnapshot(snapshot([{ tabId: id(1) }, { tabId: id(2) }]));
    const surfaces = [tab(1), files, tab(2)];
    await using screen = await renderUi(surfacesOf(threadA, surfaces, tab(1).id));
    const [first, second] = [
      frameOf(screen.container, viewOf(1)),
      frameOf(screen.container, viewOf(2)),
    ];
    expect([isHidden(first), isHidden(second)]).toEqual([false, true]);
    await screen.rerender(surfacesOf(threadA, surfaces, tab(2).id));
    expect([frameOf(screen.container, viewOf(1)), frameOf(screen.container, viewOf(2))]).toEqual([
      first,
      second,
    ]);
    expect([isHidden(first), isHidden(second)]).toEqual([true, false]);
    // Another kind of surface in view: both frames stay, both hidden.
    await screen.rerender(surfacesOf(threadA, surfaces, files.id));
    expect(screen.container.textContent).toContain("Files in view");
    expect([isHidden(first), isHidden(second)]).toEqual([true, true]);
    // Closing a tab ends its frame and keeps the others.
    await screen.rerender(surfacesOf(threadA, [tab(1), files], files.id));
    expect(screen.container.querySelectorAll("iframe")).toHaveLength(1);
    // Another thread's panel has frames of its own.
    withSnapshot(snapshot([{ tabId: id(1) }]), threadB);
    await screen.rerender(surfacesOf(threadB, [tab(1)], tab(1).id));
    expect(frameOf(screen.container, viewOf(1))).not.toBe(first);
  });

  it("wait for the server's view origin, and say when the Environment offers no browser", async () => {
    using _page = setup();
    await using screen = await renderUi(surfacesOf(threadA, [tab(1)], tab(1).id));
    expect(screen.container.querySelector("iframe")).toBeNull();
    expect(screen.container.textContent).not.toContain("Browser unavailable");
    await act(() => withSnapshot(null));
    expect(screen.container.textContent).toBe(
      "Browser unavailableThis Environment does not offer its browser now. Its tabs come back when it does.",
    );
  });

  it("say it in Czech where the browser is Czech", async () => {
    using _page = setup();
    using _czech = vi.spyOn(window.navigator, "language", "get").mockReturnValue("cs-CZ");
    withSnapshot(null);
    await using screen = await renderUi(surfacesOf(threadA, [tab(1)], tab(1).id));
    expect(screen.container.textContent).toBe(
      "Prohlížeč není k dispoziciToto Prostředí teď prohlížeč nenabízí. Jeho záložky se vrátí, až ho zase nabídne.",
    );
  });

  it("leave the desktop app's panel as it is", async () => {
    using _page = setup();
    using _desktop = stubGlobal("desktopBridge", { preview: {} });
    await using screen = await renderUi(surfacesOf(threadA, [tab(1), files], files.id));
    expect(screen.container.querySelectorAll("iframe")).toHaveLength(0);
    expect(screen.container.innerHTML).toBe("<p>Files in view</p>");
  });

  it("take the title a frame tells, hold a page's new tab in front or behind, and drop a tab that ended", async () => {
    using page = setup();
    const listed = snapshot([{ tabId: id(1) }, { tabId: id(2) }]);
    page.hold(listed.tabs);
    withSnapshot(listed);
    setPanel({ isOpen: true, activeSurfaceId: tab(1).id, surfaces: [tab(1), tab(2)] });
    await using screen = await renderUi(surfacesOf(threadA, [tab(1), tab(2)], tab(1).id));
    await tell(frameOf(screen.container, viewOf(1)), {
      type: "lazurio-browser:info",
      url: "https://example.com/docs",
      title: "Docs",
      view: viewOf(1),
    });
    expect(useThreadTabsStore.getState().titles[tab(1).id]).toBe("Docs");
    // From the hidden tab: it joins the panel behind the tab in view.
    await tell(frameOf(screen.container, viewOf(2)), {
      type: "lazurio-browser:new-tab",
      view: viewOf(3),
      url: "x",
    });
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: tab(1).id,
      surfaces: [tab(1), tab(2), tab(3)],
    });
    // From the tab in view: in front, as in the person's browser.
    await tell(frameOf(screen.container, viewOf(1)), {
      type: "lazurio-browser:new-tab",
      view: viewOf(4),
      url: "x",
    });
    expect(panel().activeSurfaceId).toBe(tab(4).id);
    await settled();
    expect(
      page.posted.map((entry) => [entry.action, (entry.body as { tabId: string }).tabId]),
    ).toEqual([
      ["hold", id(3)],
      ["hold", id(4)],
    ]);
    // A tab that ended leaves at once and is let go of; an older snapshot does not bring it back.
    page.posted.length = 0;
    await tell(frameOf(screen.container, viewOf(2)), {
      type: "lazurio-browser:closed",
      view: viewOf(2),
    });
    expect(panel().surfaces.map((surface) => surface.id)).not.toContain(tab(2).id);
    await settled();
    expect(page.posted).toEqual([
      { action: "release", body: { threadId: "thread-A", tabId: id(2) } },
    ]);
  });

  it("ignore messages from another window, another origin, or another type", async () => {
    using page = setup();
    withSnapshot(snapshot([{ tabId: id(1) }]));
    setPanel({ isOpen: true, activeSurfaceId: tab(1).id, surfaces: [tab(1)] });
    await using screen = await renderUi(surfacesOf(threadA, [tab(1)], tab(1).id));
    const newTab = { type: "lazurio-browser:new-tab", view: viewOf(3), url: "x" };
    await act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { data: newTab, origin: viewOrigin, source: window }),
      );
    });
    await tell(frameOf(screen.container, viewOf(1)), newTab, "https://evil.example");
    await tell(frameOf(screen.container, viewOf(1)), { ...newTab, type: "lazurio-browser:open" });
    expect(panel().surfaces).toEqual([tab(1)]);
    expect(page.posted).toEqual([]);
  });

  it("show only the view: no head row above it, and no line about a shared tab", async () => {
    using _page = setup();
    withSnapshot(
      snapshot([
        {
          tabId: id(1),
          agent: true,
          alsoHeldBy: [
            { strip: "launchpad", label: "Launchpad" },
            { strip: "t3-thread-B", label: "Web shop" },
          ],
        },
      ]),
    );
    await using screen = await renderUi(surfacesOf(threadA, [tab(1)], tab(1).id));
    // The view's own bar is the panel's only toolbar; the strip's dot and tooltip say the rest.
    expect(frameOf(screen.container, viewOf(1)).title).toBe("Environment browser");
    expect(screen.container.querySelectorAll("button, a, [role='note']")).toHaveLength(0);
    expect(screen.container.textContent).toBe("");
  });

  it("name their frames in Czech for assistive technology where the browser is Czech", async () => {
    using _page = setup();
    using _czech = vi.spyOn(window.navigator, "language", "get").mockReturnValue("cs-CZ");
    withSnapshot(snapshot([{ tabId: id(1) }]));
    await using screen = await renderUi(surfacesOf(threadA, [tab(1), foreignTab], tab(1).id));
    expect(frameOf(screen.container, viewOf(1)).title).toBe("Prohlížeč Prostředí");
    expect(frameOf(screen.container, foreignView).title).toBe("Prohlížeč jiného Prostředí");
  });

  it("make a fresh frame of a tab reloaded through the store, also of one behind the tab in view", async () => {
    using _page = setup();
    withSnapshot(snapshot([{ tabId: id(1) }, { tabId: id(2) }]));
    await using screen = await renderUi(surfacesOf(threadA, [tab(1), tab(2)], tab(1).id));
    const [first, second] = [
      frameOf(screen.container, viewOf(1)),
      frameOf(screen.container, viewOf(2)),
    ];
    await act(() => reloadSurface(tab(2).id));
    expect(frameOf(screen.container, viewOf(1))).toBe(first);
    expect(frameOf(screen.container, viewOf(2))).not.toBe(second);
    expect(isHidden(frameOf(screen.container, viewOf(2)))).toBe(true);
  });
});

describe("another Environment's browser in the panel", () => {
  const signInNotice = "Sign in to this Environment's browser";

  it("frames it inside a coloured border, leaves naming it to its view's bar, and tells it only this page's origin", async () => {
    using _page = setup();
    withSnapshot(snapshot([{ tabId: id(1) }]));
    await using screen = await renderUi(surfacesOf(threadA, [tab(1), foreignTab], foreignTab.id));
    const foreign = frameOf(screen.container, foreignView);
    expect(foreign.getAttribute("referrerpolicy")).toBe("origin");
    expect(foreign.title).toBe("Another Environment's browser");
    // Marked as that Environment's by its border; this Environment's tab has none.
    expect(foreign.closest(".border-warning")).not.toBeNull();
    expect(frameOf(screen.container, viewOf(1)).closest(".border-warning")).toBeNull();
    // No head: the view's own bar names that Environment, as its switcher does.
    expect(screen.container.querySelector(ENVIRONMENT_ELEMENT)).toBeNull();
    expect(screen.container.querySelectorAll("button, a")).toHaveLength(0);
    expect(screen.container.textContent).toBe("");
    expect(frameOf(screen.container, viewOf(1)).title).toBe("Environment browser");
  });

  it("asks the person to sign in there where its view does not come up, naming that Environment", async () => {
    using _page = setup();
    // The frame's first wait starts as it mounts.
    using _timers = fakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await using screen = await renderUi(surfacesOf(threadA, [foreignTab], foreignTab.id));
    const notice = () => screen.container.textContent?.includes(signInNotice) ?? false;
    await act(() => {
      frameOf(screen.container, foreignView).dispatchEvent(new Event("load"));
    });
    await act(() => vi.advanceTimersByTime(3_999));
    expect(notice()).toBe(false);
    await act(() => vi.advanceTimersByTime(1));
    expect(notice()).toBe(true);
    // The shell's element names that Environment above the notice's title, as that Environment's
    // switcher does; until the shell knows it (or without the element), it says only that the
    // browser is another Environment's. The fork has no naming rule of its own.
    const name = screen.container.querySelector(ENVIRONMENT_ELEMENT);
    expect(name?.getAttribute("environment")).toBe("vm-02.acme");
    expect(name?.getAttribute("lang")).toBe("en");
    expect(name?.textContent).toBe("Another Environment's browser");
    expect(screen.container.textContent).toContain(`Another Environment's browser${signInNotice}`);
    expect(screen.container.textContent).not.toContain("Acme · vm-02");
    expect(screen.container.querySelector("img")).toBeNull();
    const before = frameOf(screen.container, foreignView);
    const reload = [...screen.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Reload",
    );
    await act(() => reload?.click());
    expect(frameOf(screen.container, foreignView)).not.toBe(before);
    expect(notice()).toBe(false);
    // Its view comes up after all and tells its tab: no notice.
    await tell(
      frameOf(screen.container, foreignView),
      {
        type: "lazurio-browser:info",
        url: "https://example.com/",
        title: "Example",
        view: foreignView,
      },
      foreignOrigin,
    );
    await act(() => vi.advanceTimersByTime(60_000));
    expect(notice()).toBe(false);
    expect(screen.container.querySelector(ENVIRONMENT_ELEMENT)).toBeNull();
  });
});

const closes = ["Close", "Close others", "Close to the right", "Close all"];
const noop = () => undefined;

/** One test's strip of the thread the chat shows (as ChatView's hook sets it), with titles its
 * frames told. */
function setupStrip() {
  const page = setup();
  useThreadTabsStore.setState({ inView: threadA });
  rememberTitle(tab(1).id, "Docs");
  rememberTitle(tab(2).id, "Shop");
  rememberTitle(foreignTab.id, "Report");
  return {
    page,
    [Symbol.dispose]: () => {
      dismissContextMenu();
      page[Symbol.dispose]();
    },
  };
}

/** Upstream's strip over the panel's frames, as ChatView draws them. */
const strip = (surfaces: readonly RightPanelSurface[], activeSurfaceId: string) => (
  <RightPanelTabs
    mode="inline"
    open
    keybindings={DEFAULT_RESOLVED_KEYBINDINGS}
    getShortcutContext={() => ({
      terminalFocus: false,
      terminalOpen: false,
      previewFocus: false,
      previewOpen: false,
      isWeb: true,
      isDesktop: false,
    })}
    surfaces={surfaces}
    environmentId={null}
    activeSurfaceId={activeSurfaceId}
    pendingSurfaceIds={new Set()}
    previewSessions={{}}
    desktopByTabId={{}}
    terminalLabelsById={new Map()}
    onActivate={noop}
    onCloseSurface={noop}
    onCloseOtherSurfaces={noop}
    onCloseSurfacesToRight={noop}
    onCloseAllSurfaces={noop}
    onCopyFilePath={noop}
    onAddBrowser={noop}
    onAddBrowserInProfile={noop}
    onAddTerminal={noop}
    onAddPullRequest={noop}
    onAddPullRequests={noop}
    onAddDiff={noop}
    onAddFiles={noop}
    onAddDevice={noop}
    browserAvailable={false}
    terminalAvailable
    diffAvailable={false}
    filesAvailable
    pullRequestAvailable={false}
    pullRequestsAvailable={false}
    deviceAvailable
  >
    <LazurioRightPanelSurfaces
      threadRef={threadA}
      surfaces={surfaces}
      activeSurfaceId={activeSurfaceId}
    >
      {null}
    </LazurioRightPanelSurfaces>
  </RightPanelTabs>
);

const stripTab = (container: HTMLElement, title: string) => {
  const element = [...container.querySelectorAll<HTMLElement>("[data-active-tab]")].find(
    (entry) => entry.textContent === title,
  );
  if (element === undefined) throw new Error(`The strip has no tab ${title}`);
  return element;
};

/** Right-clicks the strip's tab titled `title`: its menu's items, which take a choice from the
 * next frame on, as after a person's right-click. */
async function openMenu(container: HTMLElement, title: string) {
  const element = stripTab(container, title);
  await act(() => {
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  return [...document.body.querySelectorAll<HTMLButtonElement>('[data-level="0"] button')];
}
const said = (items: readonly HTMLButtonElement[]) =>
  items.map((item) => `${item.textContent}${item.disabled ? " (unavailable)" : ""}`);
const choose = (items: readonly HTMLButtonElement[], label: string) =>
  act(() => items.find((item) => item.textContent === label)?.click());

describe("the strip tab's title and tooltip", () => {
  it("titles a tab with what its frame tells, and its tooltip adds an agent at work and the places that hold it", async () => {
    using _strip = setupStrip();
    rememberTitle(tab(1).id, null);
    withSnapshot(
      snapshot([
        { tabId: id(1), agent: true, alsoHeldBy: [{ strip: "launchpad", label: "Launchpad" }] },
      ]),
    );
    await using screen = await renderUi(strip([tab(1), files], tab(1).id));
    // The compiled strip memoizes its tabs by their inputs: the frame's title must reach it.
    expect(stripTab(screen.container, "Browser")).toBeDefined();
    await tell(frameOf(screen.container, viewOf(1)), {
      type: "lazurio-browser:info",
      url: "https://example.com/docs",
      title: "Docs",
      view: viewOf(1),
    });
    const docs = stripTab(screen.container, "Docs");
    expect(docs.querySelector('[aria-label="Close Docs"]')).not.toBeNull();
    await userEvent.hover(docs.querySelector("span.truncate")!);
    await expect
      .poll(() => document.querySelector('[data-slot="tooltip-popup"][data-open]')?.textContent, {
        timeout: 3_000,
      })
      .toBe("Docs · an agent works here · shared, also in Apps");
  });
});

describe("the strip tab's menu", () => {
  it("offers Open in new tab and Reload for an Environment browser tab, before upstream's closes", async () => {
    using _strip = setupStrip();
    withSnapshot(snapshot([{ tabId: id(1) }]));
    await using screen = await renderUi(
      strip([tab(1), foreignTab, newTabSurface(), files], tab(1).id),
    );
    expect(said(await openMenu(screen.container, "Docs"))).toEqual([
      "Open in new tab",
      "Reload",
      ...closes,
    ]);
    dismissContextMenu();
    expect(said(await openMenu(screen.container, "Report"))).toEqual([
      "Open in new tab",
      "Reload",
      ...closes,
    ]);
  });

  it("offers only upstream's items for Nová karta and upstream's own surfaces", async () => {
    using _strip = setupStrip();
    withSnapshot(snapshot([{ tabId: id(1) }]));
    await using screen = await renderUi(strip([newTabSurface(), files, tab(1)], tab(1).id));
    expect(said(await openMenu(screen.container, "New tab"))).toEqual(closes);
    dismissContextMenu();
    expect(said(await openMenu(screen.container, "Files"))).toEqual(closes);
  });

  it("offers neither while the tab has no view address", async () => {
    using _strip = setupStrip();
    // Before the server's first answer, and where this Environment offers no browser.
    await using screen = await renderUi(strip([tab(1), files], files.id));
    const unavailable = ["Open in new tab (unavailable)", "Reload (unavailable)", ...closes];
    expect(said(await openMenu(screen.container, "Docs"))).toEqual(unavailable);
    dismissContextMenu();
    await act(() => withSnapshot(null));
    expect(said(await openMenu(screen.container, "Docs"))).toEqual(unavailable);
  });

  it("opens the tab's view in a new tab of the person's browser", async () => {
    using _strip = setupStrip();
    withSnapshot(snapshot([{ tabId: id(1) }]));
    await using screen = await renderUi(strip([tab(1), foreignTab], tab(1).id));
    using open = vi.spyOn(window, "open").mockReturnValue(null);
    await choose(await openMenu(screen.container, "Docs"), "Open in new tab");
    await choose(await openMenu(screen.container, "Report"), "Open in new tab");
    expect(open.mock.calls).toEqual([
      [viewOf(1), "_blank", "noopener"],
      [foreignView, "_blank", "noopener"],
    ]);
  });

  it("reloads the tab's frame, also of a tab behind the one in view", async () => {
    using _strip = setupStrip();
    withSnapshot(snapshot([{ tabId: id(1) }, { tabId: id(2) }]));
    await using screen = await renderUi(strip([tab(1), tab(2)], tab(1).id));
    const [first, second] = [
      frameOf(screen.container, viewOf(1)),
      frameOf(screen.container, viewOf(2)),
    ];
    await choose(await openMenu(screen.container, "Shop"), "Reload");
    expect(frameOf(screen.container, viewOf(2))).not.toBe(second);
    expect(isHidden(frameOf(screen.container, viewOf(2)))).toBe(true);
    expect(frameOf(screen.container, viewOf(1))).toBe(first);
    await choose(await openMenu(screen.container, "Docs"), "Reload");
    expect(frameOf(screen.container, viewOf(1))).not.toBe(first);
  });
});

describe("the chat's hook", () => {
  function Chat(props: {
    readonly threadRef: ScopedThreadRef;
    readonly inlinePanel?: boolean;
    readonly draft?: boolean;
  }) {
    useLazurioThreadTabs(props.threadRef, {
      inlinePanel: props.inlinePanel ?? true,
      draft: props.draft ?? false,
    });
    return (
      <div data-timeline-root="true">
        <a href={viewOf(7)}>The agent's tab</a>
        <a href={foreignView}>The agent's tab on another Environment</a>
        <a href="https://example.com/">Elsewhere</a>
      </div>
    );
  }
  /** The chat of a thread, on the route that shows it. */
  const chatOn = (threadRef: ScopedThreadRef, inlinePanel = true) => {
    showRoute({ environmentId: threadRef.environmentId, threadId: threadRef.threadId });
    return <Chat threadRef={threadRef} inlinePanel={inlinePanel} />;
  };

  it("follows the thread's list from the server's stream, and closes it with the view", async () => {
    using page = setup();
    await using screen = await renderUi(chatOn(threadA));
    expect(page.stream().url).toBe("/api/lazurio/thread-tabs/events?threadId=thread-A");
    expect(useThreadTabsStore.getState().inView).toEqual(threadA);
    await page.stream().emit("snapshot", snapshot([{ tabId: id(1) }, { tabId: id(2) }]));
    expect(panel()).toMatchObject({ surfaces: [tab(1), tab(2)], isOpen: false });
    await page.stream().emit("snapshot", snapshot([{ tabId: id(2) }]));
    expect(panel().surfaces).toEqual([tab(2)]);
    // Unavailable leaves the strip as it is.
    await page.stream().emit("snapshot", { available: false });
    expect(panel().surfaces).toEqual([tab(2)]);
    const source = page.stream();
    await screen.rerender(<p>Elsewhere</p>);
    expect(source.closed).toBe(true);
    expect(useThreadTabsStore.getState().inView).toBeNull();
  });

  it("opens no stream for a draft, and follows the thread once its first message makes it one", async () => {
    using page = setup();
    // The draft keeps its ref when it becomes a thread (ChatView's promotion is data-driven).
    await using screen = await renderUi(<Chat threadRef={threadA} draft />);
    expect(page.opened).toHaveLength(0);
    expect(useThreadTabsStore.getState().draftInView).toEqual(threadA);
    expect(useThreadTabsStore.getState().inView).toBeNull();
    await screen.rerender(<Chat threadRef={threadA} draft={false} />);
    expect(page.stream().url).toBe("/api/lazurio/thread-tabs/events?threadId=thread-A");
    expect(useThreadTabsStore.getState().draftInView).toBeNull();
    expect(useThreadTabsStore.getState().inView).toEqual(threadA);
    await page.stream().emit("snapshot", snapshot([{ tabId: id(1) }]));
    expect(panel().surfaces).toEqual([tab(1)]);
    // Another draft in view takes the line; leaving it clears it.
    await screen.rerender(<Chat threadRef={threadB} draft />);
    expect(useThreadTabsStore.getState().draftInView).toEqual(threadB);
    await screen.rerender(<p>Elsewhere</p>);
    expect(useThreadTabsStore.getState().draftInView).toBeNull();
  });

  it("asks nothing for a thread of another environment, or in the desktop app", async () => {
    using page = setup();
    await using screen = await renderUi(
      chatOn(scopeThreadRef("env-2" as EnvironmentId, ThreadId.make("thread-C"))),
    );
    expect(page.opened).toHaveLength(0);
    using _desktop = stubGlobal("desktopBridge", { preview: {} });
    await screen.rerender(chatOn(threadA));
    expect(page.opened).toHaveLength(0);
  });

  it("opens the inline panel on a tab an agent revealed after the baseline, never a sheet", async () => {
    using page = setup();
    await using screen = await renderUi(chatOn(threadA));
    await page
      .stream()
      .emit("snapshot", snapshot([{ tabId: id(1), revealRequest: { id: "epoch-1:1" } }]));
    expect(panel().isOpen).toBe(false);
    await page.stream().emit(
      "snapshot",
      snapshot([
        { tabId: id(1), revealRequest: { id: "epoch-1:1" } },
        { tabId: id(2), revealRequest: { id: "epoch-1:2" } },
      ]),
    );
    expect(panel()).toMatchObject({ isOpen: true, activeSurfaceId: tab(2).id });
    await act(() => useRightPanelStore.getState().close(threadA));
    await screen.rerender(chatOn(threadA, false));
    await page
      .stream()
      .emit("snapshot", snapshot([{ tabId: id(2), revealRequest: { id: "epoch-1:3" } }]));
    expect(panel().isOpen).toBe(false);
  });

  it("opens the panel on a page revealed while the thread's view was closed, unless the person left the thread", async () => {
    using page = setup();
    await using screen = await renderUi(chatOn(threadA));
    await page.stream().emit("snapshot", snapshot([]));
    // The view closes and opens again while the route still shows the thread (ChatView mounting
    // anew), and the agent reveals a page in between: the new stream's first snapshot opens it.
    const first = page.stream();
    await screen.rerender(<p>Loading</p>);
    expect(first.closed).toBe(true);
    await screen.rerender(chatOn(threadA));
    await page
      .stream()
      .emit("snapshot", snapshot([{ tabId: id(1), revealRequest: { id: "epoch-1:1" } }]));
    expect(panel()).toMatchObject({ isOpen: true, activeSurfaceId: tab(1).id });
    // The person closes the panel and goes to Settings, and the agent reveals a page meanwhile.
    // Back on the thread, its first snapshot is a baseline: the panel stays closed.
    await act(() => useRightPanelStore.getState().close(threadA));
    showRoute({});
    await screen.rerender(<p>Settings</p>);
    await screen.rerender(chatOn(threadA));
    await page
      .stream()
      .emit("snapshot", snapshot([{ tabId: id(1), revealRequest: { id: "epoch-1:2" } }]));
    expect(panel().isOpen).toBe(false);
  });

  it("adds another Environment's tab the server announces, in front when revealed", async () => {
    using page = setup();
    await using _screen = await renderUi(chatOn(threadA));
    await page.stream().emit("snapshot", snapshot([]));
    await page.stream().emit("foreign", { tabId: foreignId.toUpperCase(), view: foreignView });
    expect(panel()).toMatchObject({ isOpen: false, surfaces: [foreignTab] });
    await page
      .stream()
      .emit("foreign", { tabId: foreignId, view: foreignView, revealRequest: { id: "e:1" } });
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: foreignTab.id,
      surfaces: [foreignTab],
    });
    await act(() => useRightPanelStore.getState().closeSurface(threadA, foreignTab.id));
    await page
      .stream()
      .emit("foreign", { tabId: foreignId, view: foreignView, revealRequest: { id: "e:2" } });
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: foreignTab.id,
      surfaces: [foreignTab],
    });
    expect(page.posted).toEqual([]);
  });

  it("lets go of tabs the person closes in the strip, one toast for Close all, nothing for the list's own changes", async () => {
    using page = setup();
    await using _screen = await renderUi(chatOn(threadA));
    using toasts = vi.spyOn(toastManager, "add");
    const listed = snapshot([
      { tabId: id(1), agent: true },
      { tabId: id(2), alsoHeldBy: [{ strip: "launchpad", label: "Launchpad" }] },
      { tabId: id(3) },
    ]);
    page.hold(listed.tabs);
    await page.stream().emit("snapshot", listed);
    await act(() => useRightPanelStore.getState().activateSurface(threadA, tab(1).id));
    await act(() => useRightPanelStore.getState().closeSurface(threadA, tab(1).id));
    await settled();
    expect(page.posted).toEqual([
      { action: "release", body: { threadId: "thread-A", tabId: id(1) } },
    ]);
    expect(toasts.mock.calls.at(-1)?.[0]).toMatchObject({
      title: "The tab left this thread.",
      description: "An agent works in it, so it stays open.",
    });
    // Close all closes one surface at a time: one toast that restores all.
    page.posted.length = 0;
    toasts.mockClear();
    await act(() => {
      for (const surface of panel().surfaces) {
        useRightPanelStore.getState().closeSurface(threadA, surface.id);
      }
    });
    await settled();
    expect(toasts).toHaveBeenCalledTimes(1);
    expect(page.posted.map((entry) => (entry.body as { tabId: string }).tabId).sort()).toEqual([
      id(2),
      id(3),
    ]);
    const undo = toasts.mock.calls[0]?.[0].actionProps as { onClick: () => void } | undefined;
    await act(() => undo?.onClick());
    expect(panel().surfaces).toEqual([tab(2), tab(3)]);
    // A tab the list lost leaves without a word.
    await settled();
    page.posted.length = 0;
    toasts.mockClear();
    await page.stream().emit("snapshot", snapshot([{ tabId: id(2) }]));
    await act(() => undefined);
    expect(toasts).not.toHaveBeenCalled();
    expect(page.posted).toEqual([]);
  });

  it("opens a link to one remote tab in the panel on a plain click, held, and leaves other clicks alone", async () => {
    using page = setup();
    await using screen = await renderUi(chatOn(threadA));
    await page.stream().emit("snapshot", snapshot([]));
    const [agentTab, foreignLink, outside] = [...screen.container.querySelectorAll("a")];
    // What the browser would follow: every click the panel leaves alone, never followed here.
    let followed: string | null = null;
    const follow = (event: MouseEvent) => {
      followed = (event.target as HTMLAnchorElement).href;
      event.preventDefault();
    };
    document.addEventListener("click", follow);
    using _follow = { [Symbol.dispose]: () => document.removeEventListener("click", follow) };
    const click = async (link: HTMLAnchorElement | undefined, init: MouseEventInit = {}) => {
      followed = null;
      await act(() => {
        link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
      });
      return followed;
    };
    for (const gesture of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
    ]) {
      expect(await click(agentTab, gesture)).toBe(viewOf(7));
    }
    expect(await click(outside)).toBe("https://example.com/");
    expect(await click(agentTab)).toBeNull();
    expect(panel()).toEqual({ isOpen: true, activeSurfaceId: tab(7).id, surfaces: [tab(7)] });
    await settled();
    expect(page.posted).toEqual([{ action: "hold", body: { threadId: "thread-A", tabId: id(7) } }]);
    expect(await click(foreignLink)).toBeNull();
    expect(panel().activeSurfaceId).toBe(foreignTab.id);
  });
});
