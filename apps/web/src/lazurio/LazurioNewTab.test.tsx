// @vitest-environment jsdom

import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RightPanelTabs } from "../components/RightPanelTabs";
import {
  type RightPanelSurface,
  selectThreadRightPanelState,
  type ThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";
import { LazurioRightPanelSurfaces } from "./LazurioEnvironmentBrowser";
import { NEW_TAB_ELEMENT, newTabTools, parseNewTabChoice } from "./LazurioNewTab";
import {
  isNewTabSurface,
  newTabSurface,
  resetThreadTabs,
  syncOf,
  tabSurfaceId,
  type ThreadTabsSnapshot,
  useThreadTabsStore,
} from "./threadTabs";

// The thread below is of the page's own environment.
vi.mock("../state/environments", () => ({ usePrimaryEnvironmentId: () => "env-1" }));

const pageUrl = "https://t3code.vm-01.example.lazurio.io/";
const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } })
  .jsdom;
const viewOrigin = "https://browser.vm-01.example.lazurio.io";
const threadA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const tabId = "0123456789ABCDEF0123456789ABCDEF";
const snapshot: ThreadTabsSnapshot = {
  available: true,
  epoch: "epoch-1",
  revision: 1,
  threadId: "thread-A",
  strip: "t3-thread-A",
  viewOrigin,
  tabs: [],
};
/** The draft's line in English, jsdom's language. */
const DRAFT_LINE = "The Environment browser comes with the first message.";
const panel = () => selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadA);
const setPanel = (state: ThreadRightPanelState) =>
  useRightPanelStore.setState({ byThreadKey: { [scopedThreadKey(threadA)]: state } });

let root: Root;
let container: HTMLDivElement;
const posted: Array<{ readonly action: string; readonly body: unknown }> = [];
/** The tabs the server's holder file of thread A holds, which its POST answers carry. */
let held: string[] = [];

beforeEach(() => {
  jsdom.reconfigure({ url: pageUrl });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // Base UI's scroll area asks for animations, which jsdom does not have.
  if (!("getAnimations" in Element.prototype)) {
    Object.defineProperty(Element.prototype, "getAnimations", {
      configurable: true,
      value: () => [],
    });
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const action = url.split("/").at(-1) ?? "";
      const body = JSON.parse(String(init.body)) as { readonly tabId: string };
      posted.push({ action, body });
      held =
        action === "hold"
          ? [...new Set([...held, body.tabId])]
          : held.filter((entry) => entry !== body.tabId);
      const tabs = held.map((tabId) => ({ tabId, agent: false, alsoHeldBy: [] }));
      return new Response(JSON.stringify({ ...snapshot, tabs }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  held = [];
  posted.length = 0;
  resetThreadTabs();
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The thread in view, as ChatView's hook sets it, with the server's answer. */
function inView(answer: ThreadTabsSnapshot | null = snapshot) {
  useThreadTabsStore.setState({
    inView: threadA,
    snapshots: { [scopedThreadKey(threadA)]: answer },
  });
}

/** Upstream's strip of an open panel with upstream's "+" actions; Terminal opens a terminal. */
async function renderStrip(onAddDevice = () => undefined) {
  const state = panel();
  await act(async () =>
    root.render(
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
        surfaces={state.surfaces}
        environmentId={null}
        activeSurfaceId={state.activeSurfaceId}
        pendingSurfaceIds={new Set()}
        previewSessions={{}}
        desktopByTabId={{}}
        terminalLabelsById={new Map()}
        onActivate={() => undefined}
        onCloseSurface={() => undefined}
        onCloseOtherSurfaces={() => undefined}
        onCloseSurfacesToRight={() => undefined}
        onCloseAllSurfaces={() => undefined}
        onCopyFilePath={() => undefined}
        onAddBrowser={() => undefined}
        onAddBrowserInProfile={() => undefined}
        onAddTerminal={() => useRightPanelStore.getState().openTerminal(threadA, "term-1")}
        onAddPullRequest={() => undefined}
        onAddPullRequests={() => undefined}
        onAddDiff={() => undefined}
        onAddFiles={() => undefined}
        onAddDevice={onAddDevice}
        browserAvailable={false}
        terminalAvailable
        diffAvailable={false}
        filesAvailable={false}
        pullRequestAvailable={false}
        pullRequestsAvailable={false}
        deviceAvailable
      >
        <LazurioRightPanelSurfaces
          threadRef={threadA}
          surfaces={state.surfaces}
          activeSurfaceId={state.activeSurfaceId}
        >
          {null}
        </LazurioRightPanelSurfaces>
      </RightPanelTabs>,
    ),
  );
}

const choose = (detail: unknown) =>
  act(async () => {
    const element = container.querySelector(NEW_TAB_ELEMENT);
    if (element === null) throw new Error("Nová karta is not shown");
    element.dispatchEvent(
      new CustomEvent(NEW_TAB_ELEMENT, { detail, bubbles: true, composed: true }),
    );
  });

/** Presses Mod+T where the focus is, on a Mac, and lets the strip answer by the next frame. */
async function pressNewTab(options: KeyboardEventInit = {}) {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const event = new KeyboardEvent("keydown", {
    key: "t",
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  return event;
}
const upstreamMenu = () => document.querySelector('[role="menu"]:not([data-closed])');

describe("Nová karta's tools", () => {
  it("are upstream's available actions without Browser, within the element's patterns", () => {
    const action = (label: string, shortcut: string, available = true) => ({
      label,
      shortcut,
      available,
      onClick: () => undefined,
    });
    const tools = newTabTools([
      action("Browser", "B"),
      action("Terminal", "T"),
      action("Files", "F", false),
      action("Diff", "D"),
      action("Pull request", "P"),
      action("Linked pull requests", "L"),
      action("Device", "M"),
    ]);
    expect(tools).toEqual([
      { id: "terminal", label: "Terminal", key: "T", icon: "terminal" },
      { id: "diff", label: "Diff", key: "D", icon: "diff" },
      { id: "pull-request", label: "Pull request", key: "P", icon: "pull-request" },
      {
        id: "linked-pull-requests",
        label: "Linked pull requests",
        key: "L",
        icon: "linked-pull-requests",
      },
      { id: "device", label: "Device", key: "M", icon: "device" },
    ]);
    // LazurioPlatform `parseNewTabTools`: at most 12, ids and icons of [a-z0-9-], labels of at
    // most 48 characters, one letter each and no letter twice.
    expect(tools.length).toBeLessThanOrEqual(12);
    for (const tool of tools) {
      expect(tool.id).toMatch(/^[a-z0-9][a-z0-9-]{0,31}$/);
      expect(tool.label.length).toBeLessThanOrEqual(48);
      expect(tool.key).toMatch(/^[A-Za-z0-9]$/);
    }
    expect(new Set(tools.map((tool) => tool.key.toLowerCase())).size).toBe(tools.length);
  });

  it("take only the element's choices", () => {
    expect(parseNewTabChoice({ kind: "tool", id: "terminal" })).toEqual({
      kind: "tool",
      id: "terminal",
    });
    expect(parseNewTabChoice({ kind: "tab", tab: tabId.toLowerCase(), view: "x" })).toEqual({
      kind: "tab",
      tab: tabId,
      view: "x",
    });
    for (const bad of [null, {}, { kind: "page", tab: "nope", view: "x" }, { kind: "open" }]) {
      expect(parseNewTabChoice(bad)).toBeNull();
    }
  });
});

describe("without the shell's element", () => {
  it("keeps upstream's \"+\" menu and empty panel, even with the server's list", async () => {
    inView();
    setPanel({ isOpen: true, activeSurfaceId: null, surfaces: [] });
    await renderStrip();
    expect(container.textContent).toContain("Open a surface");
    expect(container.querySelector(NEW_TAB_ELEMENT)).toBeNull();
    setPanel({
      isOpen: true,
      activeSurfaceId: "files",
      surfaces: [{ id: "files", kind: "files" }],
    });
    await renderStrip();
    expect(container.querySelector('[aria-label="Add panel surface"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="New tab"]')).toBeNull();
  });

  it("keeps Mod+T on upstream's menu", async () => {
    inView();
    const files: RightPanelSurface = { id: "files", kind: "files" };
    setPanel({ isOpen: true, activeSurfaceId: files.id, surfaces: [files] });
    await renderStrip();
    expect((await pressNewTab()).defaultPrevented).toBe(true);
    expect(upstreamMenu()?.textContent).toContain("Linked pull requests");
    expect(panel().surfaces).toEqual([files]);
  });

  it("keeps upstream's empty panel on a draft, without the Environment browser's line", async () => {
    useThreadTabsStore.setState({ draftInView: threadA });
    setPanel({ isOpen: true, activeSurfaceId: null, surfaces: [] });
    await renderStrip();
    expect(container.textContent).toContain("Open a surface");
    expect(container.textContent).not.toContain(DRAFT_LINE);
  });
});

describe("with the shell's element", () => {
  beforeEach(async () => {
    if (customElements.get(NEW_TAB_ELEMENT) === undefined) {
      customElements.define(NEW_TAB_ELEMENT, class extends HTMLElement {});
    }
    await act(async () => customElements.whenDefined(NEW_TAB_ELEMENT));
  });

  it("keeps upstream's panel while the server keeps no tabs", async () => {
    inView(null);
    setPanel({ isOpen: true, activeSurfaceId: null, surfaces: [] });
    await renderStrip();
    expect(container.textContent).toContain("Open a surface");
    // Mod+T too opens upstream's menu.
    await pressNewTab();
    expect(upstreamMenu()?.textContent).toContain("Linked pull requests");
    expect(panel().surfaces).toEqual([]);
  });

  it("says on a draft's empty panel that the Environment browser comes with its first message", async () => {
    useThreadTabsStore.setState({ draftInView: threadA });
    setPanel({ isOpen: true, activeSurfaceId: null, surfaces: [] });
    await renderStrip();
    expect(container.textContent).toContain("Open a surface");
    expect(container.textContent).toContain(DRAFT_LINE);
    expect(container.querySelector(NEW_TAB_ELEMENT)).toBeNull();
    // Where the server said of another thread that this Environment has no browser, upstream's
    // line stays.
    useThreadTabsStore.setState({
      snapshots: {
        [scopedThreadKey(scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B")))]:
          null,
      },
    });
    await renderStrip();
    expect(container.textContent).not.toContain(DRAFT_LINE);
  });

  it("shows Nová karta as the empty panel, with the thread's strip and upstream's tools", async () => {
    inView();
    setPanel({ isOpen: true, activeSurfaceId: null, surfaces: [] });
    await renderStrip();
    const element = container.querySelector(NEW_TAB_ELEMENT);
    expect(element?.getAttribute("strip")).toBe("t3-thread-A");
    expect(JSON.parse(element?.getAttribute("tools") ?? "[]")).toEqual([
      { id: "terminal", label: "Terminal", key: "T", icon: "terminal" },
      { id: "device", label: "Device", key: "M", icon: "device" },
    ]);
    expect(element?.hasAttribute("focus-address")).toBe(false);
    expect(element?.hasAttribute("lang")).toBe(false);
    // A page chosen there becomes the thread's tab, held.
    await choose({ kind: "page", tab: tabId, view: `${viewOrigin}/t/${tabId}` });
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: tabSurfaceId(tabId),
      surfaces: [{ id: tabSurfaceId(tabId), kind: "environment-browser" }],
    });
    await syncOf(threadA).queue;
    expect(posted).toEqual([{ action: "hold", body: { threadId: "thread-A", tabId } }]);
  });

  it('turns "+" into a Nová karta tab, which a choice replaces in place', async () => {
    inView();
    const files: RightPanelSurface = { id: "files", kind: "files" };
    setPanel({ isOpen: true, activeSurfaceId: files.id, surfaces: [files] });
    await renderStrip();
    expect(container.querySelector('[aria-label="Add panel surface"]')).toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="New tab"]')?.click(),
    );
    const [, added] = panel().surfaces;
    expect(added !== undefined && isNewTabSurface(added)).toBe(true);
    expect(panel().activeSurfaceId).toBe(added?.id);
    await renderStrip();
    // A view on another origin than the thread's is no choice.
    await choose({ kind: "tab", tab: tabId, view: `https://browser.evil.example/t/${tabId}` });
    expect(panel().surfaces).toHaveLength(2);
    await choose({ kind: "tab", tab: tabId, view: `${viewOrigin}/t/${tabId}` });
    expect(panel().surfaces).toEqual([
      files,
      { id: tabSurfaceId(tabId), kind: "environment-browser" },
    ]);
  });

  it('shows "+" on an open empty panel too, beside Nová karta, and it adds a Nová karta tab', async () => {
    inView();
    setPanel({ isOpen: true, activeSurfaceId: null, surfaces: [] });
    await renderStrip();
    expect(container.querySelector(NEW_TAB_ELEMENT)).not.toBeNull();
    expect(container.querySelector('[aria-label="Add panel surface"]')).toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="New tab"]')?.click(),
    );
    const [added] = panel().surfaces;
    expect(panel().surfaces).toHaveLength(1);
    expect(added !== undefined && isNewTabSurface(added)).toBe(true);
    expect(panel().activeSurfaceId).toBe(added?.id);
  });

  it("opens a Nová karta tab on Mod+T instead of upstream's menu, one per press", async () => {
    inView();
    const files: RightPanelSurface = { id: "files", kind: "files" };
    setPanel({ isOpen: true, activeSurfaceId: files.id, surfaces: [files] });
    await renderStrip();
    expect((await pressNewTab()).defaultPrevented).toBe(true);
    const [, added] = panel().surfaces;
    expect(added !== undefined && isNewTabSurface(added)).toBe(true);
    expect(panel().activeSurfaceId).toBe(added?.id);
    expect(upstreamMenu()).toBeNull();
    // A held key repeats the press without a second tab.
    expect((await pressNewTab({ repeat: true })).defaultPrevented).toBe(true);
    expect(panel().surfaces).toHaveLength(2);
  });

  it("runs upstream's action for a tool in Nová karta's place, and ignores an unknown one", async () => {
    inView();
    const newTab = newTabSurface();
    const files: RightPanelSurface = { id: "files", kind: "files" };
    setPanel({ isOpen: true, activeSurfaceId: newTab.id, surfaces: [newTab, files] });
    await renderStrip();
    await choose({ kind: "tool", id: "browser" });
    await choose({ kind: "tool", id: "nope" });
    expect(panel().surfaces.map((surface) => surface.id)).toEqual([newTab.id, files.id]);
    await choose({ kind: "tool", id: "terminal" });
    expect(panel().surfaces.map((surface) => surface.id)).toEqual(["terminal:term-1", files.id]);
    expect(panel().activeSurfaceId).toBe("terminal:term-1");
  });

  it("keeps Nová karta when a tool opens no surface, and runs tools by letter unless one types", async () => {
    inView();
    const newTab = newTabSurface();
    const onAddDevice = vi.fn();
    setPanel({ isOpen: true, activeSurfaceId: newTab.id, surfaces: [newTab] });
    await renderStrip(onAddDevice);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
    });
    expect(onAddDevice).toHaveBeenCalledTimes(1);
    expect(panel().surfaces.map((surface) => surface.id)).toEqual([newTab.id]);
    const input = document.createElement("input");
    document.body.append(input);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    });
    input.remove();
    expect(panel().surfaces.map((surface) => surface.id)).toEqual([newTab.id]);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    });
    expect(panel().surfaces.map((surface) => surface.id)).toEqual(["terminal:term-1"]);
  });
});
