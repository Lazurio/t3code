// @vitest-environment jsdom

import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, type ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { toastManager } from "../components/ui/toast";
import {
  type RightPanelSurface,
  selectThreadRightPanelState,
  type ThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";
import { LazurioRightPanelSurfaces, useLazurioThreadTabs } from "./LazurioEnvironmentBrowser";
import {
  resetThreadTabs,
  syncOf,
  tabSurfaceId,
  type ThreadTab,
  type ThreadTabsSnapshot,
  useThreadTabsStore,
} from "./threadTabs";

// The threads below are of the page's own environment.
vi.mock("../state/environments", () => ({ usePrimaryEnvironmentId: () => "env-1" }));

// The page is T3 on a Lazurio Environment, beside its people's view (vitest's jsdom instance).
const pageUrl = "https://t3code.vm-01.example.lazurio.io/";
const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } })
  .jsdom;
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

/** The server's event stream, as the page's EventSource sees it. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    act(() => {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(new MessageEvent(type, { data: JSON.stringify(data) }));
      }
    });
  }
}

let root: Root;
let container: HTMLDivElement;
const posted: Array<{ readonly action: string; readonly body: unknown }> = [];
/** What the server's holder file of thread A holds, which its POST answers carry. */
let held: ThreadTab[] = [];

beforeEach(() => {
  jsdom.reconfigure({ url: pageUrl });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
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
  FakeEventSource.instances = [];
  posted.length = 0;
  held = [];
  resetThreadTabs();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const settled = async (threadRef: ScopedThreadRef = threadA) => {
  const sync = syncOf(threadRef);
  let queue: Promise<unknown>;
  do {
    queue = sync.queue;
    await queue;
  } while (queue !== sync.queue);
};

async function showPanel(
  threadRef: ScopedThreadRef,
  surfaces: readonly RightPanelSurface[],
  activeSurfaceId: string,
) {
  await act(async () =>
    root.render(
      <LazurioRightPanelSurfaces
        threadRef={threadRef}
        surfaces={surfaces}
        activeSurfaceId={activeSurfaceId}
      >
        {activeSurfaceId === files.id ? <p>Files in view</p> : null}
      </LazurioRightPanelSurfaces>,
    ),
  );
}

function frameOf(view: string): HTMLIFrameElement {
  const frame = container.querySelector<HTMLIFrameElement>(`iframe[src="${view}"]`);
  if (frame === null) throw new Error(`No frame shows ${view}`);
  return frame;
}

const isHidden = (frame: HTMLIFrameElement) => frame.closest("[inert]") !== null;
const tell = (frame: HTMLIFrameElement, data: unknown, origin = viewOrigin) =>
  act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", { data, origin, source: frame.contentWindow }),
    );
  });
const withSnapshot = (answer: ThreadTabsSnapshot | null, threadRef: ScopedThreadRef = threadA) =>
  useThreadTabsStore.setState((state) => ({
    snapshots: { ...state.snapshots, [scopedThreadKey(threadRef)]: answer },
  }));

describe("the panel's Environment browser frames", () => {
  it("stay mounted while the panel shows the thread, only the active one in view", async () => {
    withSnapshot(snapshot([{ tabId: id(1) }, { tabId: id(2) }]));
    const surfaces = [tab(1), files, tab(2)];
    await showPanel(threadA, surfaces, tab(1).id);
    const [first, second] = [frameOf(viewOf(1)), frameOf(viewOf(2))];
    expect([isHidden(first), isHidden(second)]).toEqual([false, true]);
    await showPanel(threadA, surfaces, tab(2).id);
    expect([frameOf(viewOf(1)), frameOf(viewOf(2))]).toEqual([first, second]);
    expect([isHidden(first), isHidden(second)]).toEqual([true, false]);
    // Another kind of surface in view: both frames stay, both hidden.
    await showPanel(threadA, surfaces, files.id);
    expect(container.textContent).toContain("Files in view");
    expect([isHidden(first), isHidden(second)]).toEqual([true, true]);
    // Closing a tab ends its frame and keeps the others.
    await showPanel(threadA, [tab(1), files], files.id);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    // Another thread's panel has frames of its own.
    withSnapshot(snapshot([{ tabId: id(1) }]), threadB);
    await showPanel(threadB, [tab(1)], tab(1).id);
    expect(frameOf(viewOf(1))).not.toBe(first);
  });

  it("wait for the server's view origin, and say when the Environment offers no browser", async () => {
    await showPanel(threadA, [tab(1)], tab(1).id);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).not.toContain("Browser unavailable");
    act(() => withSnapshot(null));
    expect(container.textContent).toContain("Browser unavailable");
  });

  it("leave the desktop app's panel as it is", async () => {
    vi.stubGlobal("desktopBridge", { preview: {} });
    await showPanel(threadA, [tab(1), files], files.id);
    expect(container.querySelectorAll("iframe")).toHaveLength(0);
    expect(container.innerHTML).toBe("<p>Files in view</p>");
  });

  it("take the title a frame tells, hold a page's new tab in front or behind, and drop a tab that ended", async () => {
    const listed = snapshot([{ tabId: id(1) }, { tabId: id(2) }]);
    held = [...listed.tabs];
    withSnapshot(listed);
    setPanel({ isOpen: true, activeSurfaceId: tab(1).id, surfaces: [tab(1), tab(2)] });
    await showPanel(threadA, [tab(1), tab(2)], tab(1).id);
    await tell(frameOf(viewOf(1)), {
      type: "lazurio-browser:info",
      url: "https://example.com/docs",
      title: "Docs",
      view: viewOf(1),
    });
    expect(useThreadTabsStore.getState().titles[tab(1).id]).toBe("Docs");
    // From the hidden tab: it joins the panel behind the tab in view.
    await tell(frameOf(viewOf(2)), { type: "lazurio-browser:new-tab", view: viewOf(3), url: "x" });
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: tab(1).id,
      surfaces: [tab(1), tab(2), tab(3)],
    });
    // From the tab in view: in front, as in the person's browser.
    await tell(frameOf(viewOf(1)), { type: "lazurio-browser:new-tab", view: viewOf(4), url: "x" });
    expect(panel().activeSurfaceId).toBe(tab(4).id);
    await settled();
    expect(posted.map((entry) => [entry.action, (entry.body as { tabId: string }).tabId])).toEqual([
      ["hold", id(3)],
      ["hold", id(4)],
    ]);
    // A tab that ended leaves at once and is let go of; an older snapshot does not bring it back.
    posted.length = 0;
    await tell(frameOf(viewOf(2)), { type: "lazurio-browser:closed", view: viewOf(2) });
    expect(panel().surfaces.map((surface) => surface.id)).not.toContain(tab(2).id);
    await settled();
    expect(posted).toEqual([{ action: "release", body: { threadId: "thread-A", tabId: id(2) } }]);
  });

  it("ignore messages from another window, another origin, or another type", async () => {
    withSnapshot(snapshot([{ tabId: id(1) }]));
    setPanel({ isOpen: true, activeSurfaceId: tab(1).id, surfaces: [tab(1)] });
    await showPanel(threadA, [tab(1)], tab(1).id);
    const newTab = { type: "lazurio-browser:new-tab", view: viewOf(3), url: "x" };
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", { data: newTab, origin: viewOrigin, source: window }),
      );
    });
    await tell(frameOf(viewOf(1)), newTab, "https://evil.example");
    await tell(frameOf(viewOf(1)), { ...newTab, type: "lazurio-browser:open" });
    expect(panel().surfaces).toEqual([tab(1)]);
    expect(posted).toEqual([]);
  });

  it("say discreetly under the view's bar where else the tab is", async () => {
    withSnapshot(
      snapshot([
        {
          tabId: id(1),
          alsoHeldBy: [
            { strip: "launchpad", label: "Launchpad" },
            { strip: "t3-thread-B", label: "Web shop" },
          ],
        },
      ]),
    );
    await showPanel(threadA, [tab(1)], tab(1).id);
    expect(container.querySelector('[role="note"]')?.textContent).toBe(
      "Shared tab · also in Apps and in the thread “Web shop”",
    );
  });
});

describe("another Environment's browser in the panel", () => {
  const signInNotice = "Sign in to the Environment browser of Acme · vm-02";

  it("frames it marked as that Environment's, telling it only this page's origin", async () => {
    withSnapshot(snapshot([{ tabId: id(1) }]));
    await showPanel(threadA, [tab(1), foreignTab], foreignTab.id);
    expect(frameOf(foreignView).getAttribute("referrerpolicy")).toBe("origin");
    expect(frameOf(foreignView).title).toBe("Acme · vm-02");
    expect(container.textContent).toContain("Acme · vm-02");
    const picture = container.querySelector<HTMLImageElement>(
      'img[src="https://github.com/acme.png?size=32"]',
    );
    expect(picture?.getAttribute("referrerpolicy")).toBe("no-referrer");
    act(() => {
      picture?.dispatchEvent(new Event("error"));
    });
    expect(container.textContent).toContain("AAcme · vm-02");
    expect(frameOf(viewOf(1)).title).toBe("Environment browser");
  });

  it("asks the person to sign in there where its view does not come up", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await showPanel(threadA, [foreignTab], foreignTab.id);
    const notice = () => container.textContent?.includes(signInNotice) ?? false;
    act(() => {
      frameOf(foreignView).dispatchEvent(new Event("load"));
    });
    act(() => vi.advanceTimersByTime(3_999));
    expect(notice()).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(notice()).toBe(true);
    const before = frameOf(foreignView);
    const reload = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Reload",
    );
    act(() => reload?.click());
    expect(frameOf(foreignView)).not.toBe(before);
    expect(notice()).toBe(false);
    // Its view comes up after all and tells its tab: no notice.
    await tell(
      frameOf(foreignView),
      {
        type: "lazurio-browser:info",
        url: "https://example.com/",
        title: "Example",
        view: foreignView,
      },
      foreignOrigin,
    );
    act(() => vi.advanceTimersByTime(60_000));
    expect(notice()).toBe(false);
  });
});

describe("the chat's hook", () => {
  function Chat(props: { readonly threadRef: ScopedThreadRef; readonly inlinePanel?: boolean }) {
    useLazurioThreadTabs(props.threadRef, { inlinePanel: props.inlinePanel ?? true });
    return (
      <div data-timeline-root="true">
        <a href={viewOf(7)}>The agent's tab</a>
        <a href={foreignView}>The agent's tab on another Environment</a>
        <a href="https://example.com/">Elsewhere</a>
      </div>
    );
  }
  const showChat = (threadRef: ScopedThreadRef = threadA, inlinePanel = true) =>
    act(async () => root.render(<Chat threadRef={threadRef} inlinePanel={inlinePanel} />));
  const stream = () => {
    const source = FakeEventSource.instances.at(-1);
    if (source === undefined) throw new Error("No event stream");
    return source;
  };

  it("follows the thread's list from the server's stream, and closes it with the view", async () => {
    await showChat();
    expect(stream().url).toBe("/api/lazurio/thread-tabs/events?threadId=thread-A");
    expect(useThreadTabsStore.getState().inView).toEqual(threadA);
    stream().emit("snapshot", snapshot([{ tabId: id(1) }, { tabId: id(2) }]));
    expect(panel()).toMatchObject({ surfaces: [tab(1), tab(2)], isOpen: false });
    stream().emit("snapshot", snapshot([{ tabId: id(2) }]));
    expect(panel().surfaces).toEqual([tab(2)]);
    // Unavailable leaves the strip as it is.
    stream().emit("snapshot", { available: false });
    expect(panel().surfaces).toEqual([tab(2)]);
    const source = stream();
    await act(async () => root.render(<p>Elsewhere</p>));
    expect(source.closed).toBe(true);
    expect(useThreadTabsStore.getState().inView).toBeNull();
  });

  it("asks nothing for a thread of another environment, or in the desktop app", async () => {
    await showChat(scopeThreadRef("env-2" as EnvironmentId, ThreadId.make("thread-C")));
    expect(FakeEventSource.instances).toHaveLength(0);
    vi.stubGlobal("desktopBridge", { preview: {} });
    await showChat();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("opens the inline panel on a tab an agent revealed after the baseline, never a sheet", async () => {
    await showChat();
    stream().emit("snapshot", snapshot([{ tabId: id(1), revealRequest: { id: "epoch-1:1" } }]));
    expect(panel().isOpen).toBe(false);
    stream().emit(
      "snapshot",
      snapshot([
        { tabId: id(1), revealRequest: { id: "epoch-1:1" } },
        { tabId: id(2), revealRequest: { id: "epoch-1:2" } },
      ]),
    );
    expect(panel()).toMatchObject({ isOpen: true, activeSurfaceId: tab(2).id });
    act(() => useRightPanelStore.getState().close(threadA));
    await showChat(threadA, false);
    stream().emit("snapshot", snapshot([{ tabId: id(2), revealRequest: { id: "epoch-1:3" } }]));
    expect(panel().isOpen).toBe(false);
  });

  it("adds another Environment's tab the server announces, in front when revealed", async () => {
    await showChat();
    stream().emit("snapshot", snapshot([]));
    stream().emit("foreign", { tabId: foreignId.toUpperCase(), view: foreignView });
    expect(panel()).toMatchObject({ isOpen: false, surfaces: [foreignTab] });
    act(() => useRightPanelStore.getState().closeSurface(threadA, foreignTab.id));
    stream().emit("foreign", { tabId: foreignId, view: foreignView, revealRequest: { id: "e:1" } });
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: foreignTab.id,
      surfaces: [foreignTab],
    });
    expect(posted).toEqual([]);
  });

  it("lets go of tabs the person closes in the strip, one toast for Close all, nothing for the list's own changes", async () => {
    const toasts = vi.spyOn(toastManager, "add");
    await showChat();
    const listed = snapshot([
      { tabId: id(1), agent: true },
      { tabId: id(2), alsoHeldBy: [{ strip: "launchpad", label: "Launchpad" }] },
      { tabId: id(3) },
    ]);
    held = [...listed.tabs];
    stream().emit("snapshot", listed);
    act(() => useRightPanelStore.getState().activateSurface(threadA, tab(1).id));
    act(() => useRightPanelStore.getState().closeSurface(threadA, tab(1).id));
    await act(async () => undefined);
    await settled();
    expect(posted).toEqual([{ action: "release", body: { threadId: "thread-A", tabId: id(1) } }]);
    expect(toasts.mock.calls.at(-1)?.[0]).toMatchObject({
      title: "The tab left this thread.",
      description: "An agent works in it, so it stays open.",
    });
    // Close all closes one surface at a time: one toast that restores all.
    posted.length = 0;
    toasts.mockClear();
    act(() => {
      for (const surface of panel().surfaces) {
        useRightPanelStore.getState().closeSurface(threadA, surface.id);
      }
    });
    await act(async () => undefined);
    await settled();
    expect(toasts).toHaveBeenCalledTimes(1);
    expect(posted.map((entry) => (entry.body as { tabId: string }).tabId).sort()).toEqual([
      id(2),
      id(3),
    ]);
    const undo = toasts.mock.calls[0]?.[0].actionProps as { onClick: () => void } | undefined;
    act(() => undo?.onClick());
    expect(panel().surfaces).toEqual([tab(2), tab(3)]);
    // A tab the list lost leaves without a word.
    posted.length = 0;
    toasts.mockClear();
    await settled();
    posted.length = 0;
    stream().emit("snapshot", snapshot([{ tabId: id(2) }]));
    await act(async () => undefined);
    expect(toasts).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });

  it("opens a link to one remote tab in the panel on a plain click, held, and leaves other clicks alone", async () => {
    await showChat();
    stream().emit("snapshot", snapshot([]));
    const [agentTab, foreignLink, outside] = [...container.querySelectorAll("a")];
    let followed: string | null = null;
    const follow = (event: MouseEvent) => {
      followed = (event.target as HTMLAnchorElement).href;
      event.preventDefault();
    };
    document.addEventListener("click", follow);
    const click = (link: HTMLAnchorElement | undefined, init: MouseEventInit = {}) => {
      followed = null;
      act(() => {
        link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
      });
      return followed;
    };
    try {
      for (const gesture of [
        { ctrlKey: true },
        { metaKey: true },
        { shiftKey: true },
        { altKey: true },
      ]) {
        expect(click(agentTab, gesture)).toBe(viewOf(7));
      }
      expect(click(outside)).toBe("https://example.com/");
      expect(click(agentTab)).toBeNull();
      expect(panel()).toEqual({ isOpen: true, activeSurfaceId: tab(7).id, surfaces: [tab(7)] });
      await settled();
      expect(posted).toEqual([{ action: "hold", body: { threadId: "thread-A", tabId: id(7) } }]);
      expect(click(foreignLink)).toBeNull();
      expect(panel().activeSurfaceId).toBe(foreignTab.id);
    } finally {
      document.removeEventListener("click", follow);
    }
  });
});
