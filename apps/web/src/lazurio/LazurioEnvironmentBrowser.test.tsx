// @vitest-environment jsdom

import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, type ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  type RightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";
import type { ThreadActivity } from "./browserUse";
import {
  LazurioRightPanelSurfaces,
  useLazurioEnvironmentBrowserFromChat,
} from "./LazurioEnvironmentBrowser";

// The threads below are of the page's own environment.
vi.mock("../state/environments", () => ({ usePrimaryEnvironmentId: () => "env-1" }));

// The page is T3 on a Lazurio Environment, beside its people's view (vitest's jsdom instance).
const pageUrl = "https://t3code.vm-01.example.lazurio.io/";
const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } })
  .jsdom;
const viewOrigin = "https://browser.vm-01.example.lazurio.io";
const pageTab = (target: string) =>
  ({
    id: `environment-browser:${target}`,
    kind: "environment-browser",
    view: `${viewOrigin}/t/${target}`,
  }) as const;
const first = pageTab("0123456789abcdef".repeat(2));
const second = pageTab("fedcba9876543210".repeat(2));
const opened = pageTab("00112233445566778899aabbccddeeff");
const files = { id: "files", kind: "files" } as const;
const threadA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const threadB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  jsdom.reconfigure({ url: pageUrl });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

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

function frameOf(surface: { readonly view: string }): HTMLIFrameElement {
  const frame = container.querySelector<HTMLIFrameElement>(`iframe[src="${surface.view}"]`);
  if (frame === null) throw new Error(`No frame shows ${surface.view}`);
  return frame;
}

const isHidden = (frame: HTMLIFrameElement) => frame.closest("[inert]") !== null;

describe("the panel's Environment browser frames", () => {
  it("stay mounted while the panel shows the thread, only the active one in view", async () => {
    const surfaces = [first, files, second];
    await showPanel(threadA, surfaces, first.id);
    const [firstFrame, secondFrame] = [frameOf(first), frameOf(second)];
    expect([isHidden(firstFrame), isHidden(secondFrame)]).toEqual([false, true]);

    await showPanel(threadA, surfaces, second.id);
    expect(frameOf(first)).toBe(firstFrame);
    expect(frameOf(second)).toBe(secondFrame);
    expect([isHidden(firstFrame), isHidden(secondFrame)]).toEqual([true, false]);

    // Another kind of surface in view: both frames stay, both hidden.
    await showPanel(threadA, surfaces, files.id);
    expect(container.textContent).toContain("Files in view");
    expect(frameOf(first)).toBe(firstFrame);
    expect(frameOf(second)).toBe(secondFrame);
    expect([isHidden(firstFrame), isHidden(secondFrame)]).toEqual([true, true]);

    // Closing a tab ends its frame and keeps the others.
    await showPanel(threadA, [first, files], files.id);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(frameOf(first)).toBe(firstFrame);

    // Another thread's panel has frames of its own.
    await showPanel(threadB, [first], first.id);
    expect(frameOf(first)).not.toBe(firstFrame);
  });

  it("puts a page's new tab in front only from the tab in view", async () => {
    const key = scopedThreadKey(threadA);
    useRightPanelStore.setState({
      byThreadKey: {
        [key]: { isOpen: true, activeSurfaceId: first.id, surfaces: [first, second] },
      },
    });
    await showPanel(threadA, [first, second], first.id);
    const announce = (frame: HTMLIFrameElement) =>
      act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "lazurio-browser:new-tab", view: opened.view, url: "https://a.example/" },
            origin: viewOrigin,
            source: frame.contentWindow,
          }),
        );
      });
    const panel = () =>
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadA);

    // From the hidden tab: it joins the panel behind the tab in view.
    await announce(frameOf(second));
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: first.id,
      surfaces: [first, second, opened],
    });
    expect(useRightPanelStore.getState().getUserActionRevision(threadA)).toBe(0);

    // From the tab in view: it comes to the front, as in the person's browser.
    useRightPanelStore.setState({
      byThreadKey: {
        [key]: { isOpen: true, activeSurfaceId: first.id, surfaces: [first, second] },
      },
    });
    await announce(frameOf(first));
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: opened.id,
      surfaces: [first, second, opened],
    });
  });

  it("leave the desktop app's panel as it is", async () => {
    vi.stubGlobal("desktopBridge", { preview: {} });
    await showPanel(threadA, [first, files], files.id);
    expect(container.querySelectorAll("iframe")).toHaveLength(0);
    expect(container.innerHTML).toBe("<p>Files in view</p>");
  });
});

// Another Environment's people's view of one of its tabs, where an agent works over SSH.
const foreignId = "fedcba9876543210".repeat(2);
const foreignOrigin = "https://browser.vm-02.acme.lazurio.io";
const foreignView = `${foreignOrigin}/t/${foreignId}`;
const foreignTab = {
  id: `environment-browser:${foreignId}`,
  kind: "environment-browser",
  view: foreignView,
} as const;

describe("another Environment's browser in the panel", () => {
  const signInNotice = "Sign in to the Environment browser of Acme · vm-02";

  it("frames it marked as that Environment's, telling it only this page's origin", async () => {
    await showPanel(threadA, [first, foreignTab], foreignTab.id);
    // That Environment's view lets T3 frame it by the origin its request names (jsdom has the
    // attribute only).
    expect(frameOf(foreignTab).getAttribute("referrerpolicy")).toBe("origin");
    expect(frameOf(first).getAttribute("referrerpolicy")).toBe("origin");
    // Named by its Organization and Environment, with the Organization's picture.
    expect(frameOf(foreignTab).title).toBe("Acme · vm-02");
    expect(container.textContent).toContain("Acme · vm-02");
    const picture = container.querySelector<HTMLImageElement>(
      'img[src="https://github.com/acme.png?size=32"]',
    );
    expect(picture?.getAttribute("referrerpolicy")).toBe("no-referrer");
    // A picture that does not load leaves the Organization's initial.
    act(() => {
      picture?.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("AAcme · vm-02");
    // This Environment's own tab stays as it was.
    expect(frameOf(first).title).toBe("Environment browser");
  });

  it("asks the person to sign in there where its view does not come up", async () => {
    vi.useFakeTimers();
    try {
      await showPanel(threadA, [foreignTab], foreignTab.id);
      const notice = () => container.textContent?.includes(signInNotice) ?? false;
      // The gateway sends the frame to its sign-in, which does not render in a frame.
      act(() => {
        frameOf(foreignTab).dispatchEvent(new Event("load"));
      });
      act(() => vi.advanceTimersByTime(3_999));
      expect(notice()).toBe(false);
      act(() => vi.advanceTimersByTime(1));
      expect(notice()).toBe(true);
      // The way out: the view in a tab of its own, where the sign-in renders, then Reload.
      expect(
        [...container.querySelectorAll<HTMLAnchorElement>(`a[href="${foreignView}"]`)].map(
          (link) => [link.target, link.rel],
        ),
      ).toEqual([
        ["_blank", "noopener"],
        ["_blank", "noopener"],
      ]);
      const before = frameOf(foreignTab);
      const reload = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Reload",
      );
      act(() => reload?.click());
      expect(frameOf(foreignTab)).not.toBe(before);
      expect(notice()).toBe(false);
      // A frame that never even loads gets the notice too, later.
      act(() => vi.advanceTimersByTime(14_999));
      expect(notice()).toBe(false);
      act(() => vi.advanceTimersByTime(1));
      expect(notice()).toBe(true);
      // Its view comes up after all and tells its tab: the notice goes.
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "lazurio-browser:info",
              url: "https://example.com/",
              title: "Example",
              view: foreignView,
            },
            origin: foreignOrigin,
            source: frameOf(foreignTab).contentWindow,
          }),
        );
      });
      expect(notice()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not ask while its view comes up, nor for this Environment's own tab", async () => {
    vi.useFakeTimers();
    try {
      await showPanel(threadA, [first, foreignTab], foreignTab.id);
      act(() => {
        frameOf(foreignTab).dispatchEvent(new Event("load"));
        frameOf(first).dispatchEvent(new Event("load"));
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "lazurio-browser:info", url: "https://a.example/", title: "A" },
            origin: foreignOrigin,
            source: frameOf(foreignTab).contentWindow,
          }),
        );
      });
      act(() => vi.advanceTimersByTime(60_000));
      expect(container.textContent).not.toContain(signInNotice);
      expect(container.textContent).not.toContain("Sign in");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the chat and the Environment browser", () => {
  const ownTab = `${viewOrigin}/t/${"8A3F0C2D4E5B6A79".repeat(2)}`;
  const browse = (id: string, second: number, call = id, kind = "tool.started") => ({
    id,
    kind,
    turnId: "turn-1",
    createdAt: `2026-10-08T10:00:${String(second).padStart(2, "0")}.000Z`,
    payload: {
      itemType: "command_execution",
      toolCallId: call,
      data: { command: "agent-browser --cdp 9222 snapshot -i" },
    },
  });
  // What the Environment answers at /.lazurio/browser.json on this page's origin.
  const answer = () => {
    const body = JSON.stringify({ available: true, view: ownTab, session: null });
    const response = new Response(body, { headers: { "content-type": "application/json" } });
    Object.defineProperty(response, "url", {
      value: `${window.location.origin}/.lazurio/browser.json`,
    });
    return response;
  };
  const panel = () =>
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadA);

  function Chat(props: {
    readonly activities: ReadonlyArray<ThreadActivity>;
    readonly live?: boolean;
    readonly inlinePanel?: boolean;
  }) {
    useLazurioEnvironmentBrowserFromChat({
      threadRef: threadA,
      activities: props.activities,
      live: props.live ?? true,
      inlinePanel: props.inlinePanel ?? true,
    });
    return (
      <>
        <div data-timeline-root="true">
          <a href={opened.view}>The agent's tab</a>
          <a href={`https://elsewhere.example.test/t/${"0".repeat(32)}`}>Another view</a>
        </div>
        <a href={second.view}>Not in the chat</a>
      </>
    );
  }
  const showChat = (props: Parameters<typeof Chat>[0]) =>
    act(async () => root.render(<Chat {...props} />));
  // The Environment's answer and the opening it leads to.
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

  it("opens the panel on the thread's own tab when its agent starts to use the browser", async () => {
    const fetch = vi.fn(async () => answer());
    vi.stubGlobal("fetch", fetch);
    const history = [browse("before", 1)];
    await showChat({ activities: history });
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    expect(panel().isOpen).toBe(false);

    const started = [...history, browse("call", 2)];
    await showChat({ activities: started });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: "environment-browser",
      surfaces: [{ id: "environment-browser", kind: "environment-browser" }],
    });
    // The app opened it, not the person.
    expect(useRightPanelStore.getState().getUserActionRevision(threadA)).toBe(0);

    // The person closes it: the call going on leaves it closed, the agent's next call opens it.
    act(() => useRightPanelStore.getState().close(threadA));
    const ended = [...started, browse("call-done", 3, "call", "tool.completed")];
    await showChat({ activities: ended });
    await settle();
    expect(panel().isOpen).toBe(false);
    await showChat({ activities: [...ended, browse("next", 4)] });
    await settle();
    expect(panel().isOpen).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("leaves the panel for the backlog, on a narrow screen, without the browser, and while it shows", async () => {
    const fetch = vi.fn(async () => answer());
    vi.stubGlobal("fetch", fetch);
    // A thread that loads: its backlog arrives before it is live.
    await showChat({ activities: [], live: false });
    await showChat({ activities: [browse("a", 1)], live: false });
    await showChat({ activities: [browse("a", 1)] });
    // On a narrow screen the panel is a sheet over the chat and its composer.
    await showChat({ activities: [browse("a", 1), browse("b", 2)], inlinePanel: false });
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    expect(panel().isOpen).toBe(false);

    // An Environment without the browser: T3 answers its own page.
    fetch.mockImplementation(
      async () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } }),
    );
    await showChat({ activities: [browse("a", 1), browse("b", 2), browse("c", 3)] });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(panel().isOpen).toBe(false);

    // The person picked the Environment browser already: nothing to ask.
    act(() => useRightPanelStore.getState().open(threadA, "environment-browser"));
    await showChat({
      activities: [browse("a", 1), browse("b", 2), browse("c", 3), browse("d", 4)],
    });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not open over a choice the person made while the Environment was asked", async () => {
    let respond = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (respond = () => resolve(answer())))),
    );
    await showChat({ activities: [] });
    await showChat({ activities: [browse("a", 1)] });
    act(() => useRightPanelStore.getState().open(threadA, "files"));
    respond();
    await settle();
    expect(panel()).toMatchObject({ isOpen: true, activeSurfaceId: "files" });
  });

  it("opens a link to one remote tab of the Environment's view in the panel on a plain click", async () => {
    const fetch = vi.fn(async () => answer());
    vi.stubGlobal("fetch", fetch);
    // The agent's browser use: the Environment names its view.
    await showChat({ activities: [] });
    await showChat({ activities: [browse("a", 1)] });
    await settle();
    act(() => useRightPanelStore.getState().close(threadA));
    const [agentTab, anotherView, outside] = [...container.querySelectorAll("a")];
    // What the browser would do with a click the panel leaves alone.
    let followed: string | null = null;
    const follow = (event: MouseEvent) => {
      followed = (event.target as HTMLAnchorElement).href;
      event.preventDefault();
    };
    document.addEventListener("click", follow);
    const click = (
      link: HTMLAnchorElement | undefined,
      init: MouseEventInit = {},
    ): string | null => {
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
        expect(click(agentTab, gesture)).toBe(opened.view);
      }
      expect(click(anotherView)).toBe(anotherView?.href);
      expect(click(outside)).toBe(second.view);
      expect(panel().isOpen).toBe(false);

      expect(click(agentTab)).toBeNull();
      expect(panel()).toEqual({
        isOpen: true,
        activeSurfaceId: opened.id,
        surfaces: [{ id: "environment-browser", kind: "environment-browser" }, opened],
      });
    } finally {
      document.removeEventListener("click", follow);
    }
  });

  // A call of preview_open as Codex reports it: the call's arguments, and once it completes the
  // tab the server keeps for clients (`previewTab`; its result is cut to one line).
  const at = (second: number) => `2026-10-08T10:00:${String(second).padStart(2, "0")}.000Z`;
  const previewOpen = (
    id: string,
    second: number,
    options: {
      readonly call?: string;
      readonly args?: Record<string, unknown>;
      readonly tab?: { readonly tabId: string; readonly visible: boolean; readonly view?: string };
    } = {},
  ): ThreadActivity => ({
    id,
    kind: options.tab === undefined ? "tool.started" : "tool.completed",
    turnId: "turn-1",
    createdAt: at(second),
    payload: {
      itemType: "mcp_tool_call",
      status: options.tab === undefined ? "inProgress" : "completed",
      toolCallId: options.call ?? id,
      title: "t3-code · preview_open",
      ...(options.tab === undefined ? {} : { previewTab: options.tab }),
      data: {
        item: {
          type: "mcpToolCall",
          server: "t3-code",
          tool: "preview_open",
          arguments: options.args ?? {},
        },
      },
    },
  });
  const tabAt = (target: string) =>
    ({
      id: `environment-browser:${target}`,
      kind: "environment-browser",
      view: `${viewOrigin}/t/${target}`,
    }) as const;
  const own = { id: "environment-browser", kind: "environment-browser" } as const;

  it("brings the tab a completed preview_open answered with to the front (#48)", async () => {
    const fetch = vi.fn(async () => answer());
    vi.stubGlobal("fetch", fetch);
    const [window1, window2] = ["C1".padEnd(32, "C"), "C2".padEnd(32, "C")];
    const newWindow = { reuseExistingTab: false, url: "https://example.com/" };
    // A call that completed before the thread was in view opens nothing.
    const history = [previewOpen("old", 1, { tab: { tabId: window2, visible: true } })];
    await showChat({ activities: history });
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    expect(panel().isOpen).toBe(false);

    // The agent opens another window: as it starts, the thread's own tab; once it answers, its
    // own window comes to the front.
    const started = [...history, previewOpen("start", 2, { call: "new", args: newWindow })];
    await showChat({ activities: started });
    await settle();
    expect(panel()).toEqual({ isOpen: true, activeSurfaceId: own.id, surfaces: [own] });
    const answered = [
      ...started,
      previewOpen("done", 3, {
        call: "new",
        args: newWindow,
        tab: { tabId: window1, visible: true },
      }),
    ];
    await showChat({ activities: answered });
    await settle();
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: tabAt(window1).id,
      surfaces: [own, tabAt(window1)],
    });
    expect(useRightPanelStore.getState().getUserActionRevision(threadA)).toBe(0);

    // Background work joins the panel behind the tab in view.
    const background = [
      ...answered,
      previewOpen("bg", 4, { args: { open: false }, tab: { tabId: window2, visible: false } }),
    ];
    await showChat({ activities: background });
    await settle();
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: tabAt(window1).id,
      surfaces: [own, tabAt(window1), tabAt(window2)],
    });

    // The thread's own window is the thread's own tab.
    const ownWindow = ownTab.slice(ownTab.lastIndexOf("/") + 1);
    await showChat({
      activities: [
        ...background,
        previewOpen("again", 5, { tab: { tabId: ownWindow, visible: true } }),
      ],
    });
    await settle();
    expect(panel()).toMatchObject({ isOpen: true, activeSurfaceId: own.id });
    expect(panel().surfaces).toHaveLength(3);
  });

  it("brings no tab to the front over the person's choice or over the chat", async () => {
    const asked: Array<() => void> = [];
    const fetch = vi.fn(
      () => new Promise<Response>((resolve) => asked.push(() => resolve(answer()))),
    );
    vi.stubGlobal("fetch", fetch);
    const window1 = "C1".padEnd(32, "C");
    await showChat({ activities: [] });
    await showChat({
      activities: [previewOpen("done", 1, { tab: { tabId: window1, visible: true } })],
    });
    // The person picks the files while the Environment is asked.
    act(() => useRightPanelStore.getState().open(threadA, "files"));
    expect(fetch).toHaveBeenCalled();
    for (const respond of asked) respond();
    await settle();
    expect(panel()).toMatchObject({ isOpen: true, activeSurfaceId: "files" });
    expect(panel().surfaces.map((surface) => surface.id)).not.toContain(tabAt(window1).id);

    // Where the panel is a sheet over the chat, another Environment's tab joins it closed.
    act(() => useRightPanelStore.getState().close(threadA));
    await showChat({
      activities: [
        previewOpen("done", 1, { tab: { tabId: window1, visible: true } }),
        previewOpen("foreign", 2, {
          args: { url: foreignView },
          tab: { tabId: foreignId, visible: true, view: foreignView },
        }),
      ],
      inlinePanel: false,
    });
    await settle();
    expect(panel()).toMatchObject({ isOpen: false, activeSurfaceId: "files" });
    expect(panel().surfaces).toContainEqual(foreignTab);
  });

  it("opens another Environment's tab from preview_open without this Environment's browser", async () => {
    const fetch = vi.fn(async () => answer());
    vi.stubGlobal("fetch", fetch);
    const call = { call: "foreign", args: { url: foreignView } };
    await showChat({ activities: [] });
    // Starting a call at another Environment's view does not use this Environment's browser.
    const started = [previewOpen("start", 1, call)];
    await showChat({ activities: started });
    await settle();
    expect(panel().isOpen).toBe(false);
    await showChat({
      activities: [
        ...started,
        previewOpen("done", 2, {
          ...call,
          tab: { tabId: foreignId, visible: true, view: foreignView },
        }),
      ],
    });
    await settle();
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: foreignTab.id,
      surfaces: [foreignTab],
    });
    // A view that names another tab than the answer is not taken.
    act(() => useRightPanelStore.getState().close(threadA));
    await showChat({
      activities: [
        ...started,
        previewOpen("done", 2, {
          ...call,
          tab: { tabId: foreignId, visible: true, view: foreignView },
        }),
        previewOpen("odd", 3, {
          args: { url: foreignView },
          tab: { tabId: "0".repeat(32), visible: true, view: foreignView },
        }),
      ],
    });
    await settle();
    expect(panel().isOpen).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("opens a link to another Environment's tab in the panel on a plain click only", async () => {
    function ForeignChat() {
      useLazurioEnvironmentBrowserFromChat({
        threadRef: threadA,
        activities: [],
        live: true,
        inlinePanel: true,
      });
      return (
        <div data-timeline-root="true">
          <a href={foreignView}>The agent's tab on another Environment</a>
        </div>
      );
    }
    await act(async () => root.render(<ForeignChat />));
    const link = container.querySelector("a");
    let followed: string | null = null;
    const follow = (event: MouseEvent) => {
      followed = (event.target as HTMLAnchorElement).href;
      event.preventDefault();
    };
    document.addEventListener("click", follow);
    const click = (init: MouseEventInit = {}): string | null => {
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
        { button: 1 },
      ]) {
        expect([gesture, click(gesture)]).toEqual([gesture, foreignView]);
      }
      expect(panel().isOpen).toBe(false);
      expect(click()).toBeNull();
      expect(panel()).toEqual({
        isOpen: true,
        activeSurfaceId: foreignTab.id,
        surfaces: [foreignTab],
      });
    } finally {
      document.removeEventListener("click", follow);
    }
  });
});
