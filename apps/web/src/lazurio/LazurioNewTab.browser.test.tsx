import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render, stubGlobal } from "../../test/render";
import { shouldTypeToFocusComposer } from "../components/chat/composerFocusRedirect";
import { RightPanelTabs } from "../components/RightPanelTabs";
import {
  type RightPanelSurface,
  selectThreadRightPanelState,
  type ThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";
import { LazurioRightPanelSurfaces } from "./LazurioEnvironmentBrowser";
import { NEW_TAB_ELEMENT } from "./LazurioNewTab";
import {
  isNewTabSurface,
  newTabSurface,
  resetThreadTabs,
  syncOf,
  tabSurfaceId,
  type ThreadTabsSnapshot,
  useThreadTabsStore,
} from "./threadTabs";

// Nová karta where the Environment's shell defines `<lazurio-new-tab>`. A page keeps the custom
// elements it defined, so the shell without the element is LazurioNewTab.withoutElement.browser.test.tsx.

vi.mock(import("~/hooks/useTheme"), async (original) => ({
  ...(await original()),
  useTheme: () => ({ theme: "light", resolvedTheme: "light", themeHalves: null }) as never,
}));
vi.mock(import("~/browser/browserDefaults"), async (original) => ({
  ...(await original()),
  useBrowserDefaults: () => ({ profiles: [] }) as never,
}));

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
/** The draft's line in English, the test browser's language. */
const DRAFT_LINE = "The Environment browser comes with the first message.";
const files: RightPanelSurface = { id: "files", kind: "files" };
const panel = () => selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadA);
const setPanel = (state: ThreadRightPanelState) =>
  useRightPanelStore.setState({ byThreadKey: { [scopedThreadKey(threadA)]: state } });
const noop = () => undefined;

/**
 * One test's page with the shell's element, from nothing: the stores start empty, and the server's
 * POSTs answer with thread A's holder file.
 */
async function setup() {
  resetThreadTabs();
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  if (customElements.get(NEW_TAB_ELEMENT) === undefined) {
    customElements.define(NEW_TAB_ELEMENT, class extends HTMLElement {});
  }
  await customElements.whenDefined(NEW_TAB_ELEMENT);
  const posted: Array<{ readonly action: string; readonly body: unknown }> = [];
  let held: string[] = [];
  const fetch = stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const action = url.split("/").at(-1) ?? "";
    const body = JSON.parse(String(init.body)) as { readonly tabId: string };
    posted.push({ action, body });
    held =
      action === "hold"
        ? [...new Set([...held, body.tabId])]
        : held.filter((entry) => entry !== body.tabId);
    const tabs = held.map((tab) => ({ tabId: tab, agent: false, alsoHeldBy: [] }));
    return new Response(JSON.stringify({ ...snapshot, tabs }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { posted, [Symbol.dispose]: () => fetch[Symbol.dispose]() };
}

/** The thread in view, as ChatView's hook sets it, with the server's answer. */
function inView(answer: ThreadTabsSnapshot | null = snapshot) {
  useThreadTabsStore.setState({
    inView: threadA,
    snapshots: { [scopedThreadKey(threadA)]: answer },
  });
}

/** Upstream's strip of an open panel as the store has it now, with upstream's "+" actions;
 * Terminal opens a terminal. */
function strip(onAddDevice: () => void = noop) {
  const state = panel();
  return (
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
      onActivate={noop}
      onCloseSurface={noop}
      onCloseOtherSurfaces={noop}
      onCloseSurfacesToRight={noop}
      onCloseAllSurfaces={noop}
      onCopyFilePath={noop}
      onAddBrowser={noop}
      onAddBrowserInProfile={noop}
      onAddTerminal={() => useRightPanelStore.getState().openTerminal(threadA, "term-1")}
      onAddPullRequest={noop}
      onAddPullRequests={noop}
      onAddDiff={noop}
      onAddFiles={noop}
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
    </RightPanelTabs>
  );
}

const choose = (container: HTMLElement, detail: unknown) =>
  act(() => {
    const element = container.querySelector(NEW_TAB_ELEMENT);
    if (element === null) throw new Error("Nová karta is not shown");
    element.dispatchEvent(
      new CustomEvent(NEW_TAB_ELEMENT, { detail, bubbles: true, composed: true }),
    );
  });

/** Presses Mod+T where the focus is, on a Mac. */
async function pressNewTab(options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "t",
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  await act(() => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
}

/** A letter typed while the focus is in T3 Code's document, outside any field. */
const pressLetter = (key: string) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });

const upstreamMenu = () => document.querySelector('[role="menu"]:not([data-closed])');

describe("with the shell's element", () => {
  it("keeps upstream's panel while the server keeps no tabs", async () => {
    using _page = await setup();
    inView(null);
    setPanel({ isOpen: true, activeSurfaceId: null, surfaces: [] });
    await using screen = await render(strip());
    using _mac = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    expect(screen.container.textContent).toContain("Open a surface");
    // Mod+T too opens upstream's menu.
    await pressNewTab();
    await vi.waitFor(() => expect(upstreamMenu()?.textContent).toContain("Linked pull requests"));
    expect(panel().surfaces).toEqual([]);
  });

  it("says on a draft's empty panel that the Environment browser comes with its first message", async () => {
    using _page = await setup();
    useThreadTabsStore.setState({ draftInView: threadA });
    setPanel({ isOpen: true, activeSurfaceId: null, surfaces: [] });
    await using screen = await render(strip());
    expect(screen.container.textContent).toContain("Open a surface");
    expect(screen.container.textContent).toContain(DRAFT_LINE);
    expect(screen.container.querySelector(NEW_TAB_ELEMENT)).toBeNull();
    // Where the server said of another thread that this Environment has no browser, upstream's
    // line stays.
    await act(() =>
      useThreadTabsStore.setState({
        snapshots: {
          [scopedThreadKey(scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B")))]:
            null,
        },
      }),
    );
    expect(screen.container.textContent).not.toContain(DRAFT_LINE);
  });

  it("shows Nová karta as the empty panel, with the thread's strip and upstream's tools", async () => {
    using page = await setup();
    inView();
    setPanel({ isOpen: true, activeSurfaceId: null, surfaces: [] });
    await using screen = await render(strip());
    const element = screen.container.querySelector(NEW_TAB_ELEMENT);
    expect(element?.getAttribute("strip")).toBe("t3-thread-A");
    expect(JSON.parse(element?.getAttribute("tools") ?? "[]")).toEqual([
      { id: "terminal", label: "Terminal", key: "T", icon: "terminal" },
      { id: "device", label: "Device", key: "M", icon: "device" },
    ]);
    expect(element?.hasAttribute("focus-address")).toBe(false);
    expect(element?.hasAttribute("lang")).toBe(false);
    // A page chosen there becomes the thread's tab, held.
    await choose(screen.container, { kind: "page", tab: tabId, view: `${viewOrigin}/t/${tabId}` });
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: tabSurfaceId(tabId),
      surfaces: [{ id: tabSurfaceId(tabId), kind: "environment-browser" }],
    });
    await syncOf(threadA).queue;
    expect(page.posted).toEqual([{ action: "hold", body: { threadId: "thread-A", tabId } }]);
  });

  it('turns "+" into a Nová karta tab, which a choice replaces in place', async () => {
    using _page = await setup();
    inView();
    setPanel({ isOpen: true, activeSurfaceId: files.id, surfaces: [files] });
    await using screen = await render(strip());
    expect(screen.container.querySelector('[aria-label="Add panel surface"]')).toBeNull();
    await act(() =>
      screen.container.querySelector<HTMLButtonElement>('[aria-label="New tab"]')?.click(),
    );
    const [, added] = panel().surfaces;
    expect(added !== undefined && isNewTabSurface(added)).toBe(true);
    expect(panel().activeSurfaceId).toBe(added?.id);
    await screen.rerender(strip());
    // A view on another origin than the thread's is no choice.
    await choose(screen.container, {
      kind: "tab",
      tab: tabId,
      view: `https://browser.evil.example/t/${tabId}`,
    });
    expect(panel().surfaces).toHaveLength(2);
    await choose(screen.container, { kind: "tab", tab: tabId, view: `${viewOrigin}/t/${tabId}` });
    expect(panel().surfaces).toEqual([
      files,
      { id: tabSurfaceId(tabId), kind: "environment-browser" },
    ]);
  });

  it('shows "+" on an open empty panel too, beside Nová karta, and it adds a Nová karta tab', async () => {
    using _page = await setup();
    inView();
    setPanel({ isOpen: true, activeSurfaceId: null, surfaces: [] });
    await using screen = await render(strip());
    expect(screen.container.querySelector(NEW_TAB_ELEMENT)).not.toBeNull();
    expect(screen.container.querySelector('[aria-label="Add panel surface"]')).toBeNull();
    await act(() =>
      screen.container.querySelector<HTMLButtonElement>('[aria-label="New tab"]')?.click(),
    );
    const [added] = panel().surfaces;
    expect(panel().surfaces).toHaveLength(1);
    expect(added !== undefined && isNewTabSurface(added)).toBe(true);
    expect(panel().activeSurfaceId).toBe(added?.id);
  });

  it("opens a Nová karta tab on Mod+T instead of upstream's menu, one per press", async () => {
    using _page = await setup();
    inView();
    setPanel({ isOpen: true, activeSurfaceId: files.id, surfaces: [files] });
    await using _screen = await render(strip());
    using _mac = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
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
    using _page = await setup();
    inView();
    const newTab = newTabSurface();
    setPanel({ isOpen: true, activeSurfaceId: newTab.id, surfaces: [newTab, files] });
    await using screen = await render(strip());
    await choose(screen.container, { kind: "tool", id: "browser" });
    await choose(screen.container, { kind: "tool", id: "nope" });
    expect(panel().surfaces.map((surface) => surface.id)).toEqual([newTab.id, files.id]);
    await choose(screen.container, { kind: "tool", id: "terminal" });
    expect(panel().surfaces.map((surface) => surface.id)).toEqual(["terminal:term-1", files.id]);
    expect(panel().activeSurfaceId).toBe("terminal:term-1");
  });

  it("keeps Nová karta when a tool opens no surface, and runs tools by letter unless one types", async () => {
    using _page = await setup();
    inView();
    const newTab = newTabSurface();
    const onAddDevice = vi.fn();
    setPanel({ isOpen: true, activeSurfaceId: newTab.id, surfaces: [newTab] });
    await using _screen = await render(strip(onAddDevice));
    await pressLetter("m");
    expect(onAddDevice).toHaveBeenCalledTimes(1);
    expect(panel().surfaces.map((surface) => surface.id)).toEqual([newTab.id]);
    const input = document.createElement("input");
    document.body.append(input);
    using _input = { [Symbol.dispose]: () => input.remove() };
    await act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    });
    expect(panel().surfaces.map((surface) => surface.id)).toEqual([newTab.id]);
    await pressLetter("t");
    expect(panel().surfaces.map((surface) => surface.id)).toEqual(["terminal:term-1"]);
  });

  it("leaves the tools' letters to Nová karta, not to the composer's type-to-focus", async () => {
    using _page = await setup();
    inView();
    const newTab = newTabSurface();
    setPanel({ isOpen: true, activeSurfaceId: newTab.id, surfaces: [newTab] });
    await using _screen = await render(strip());
    const toComposer = (key: string) =>
      shouldTypeToFocusComposer(new KeyboardEvent("keydown", { key, cancelable: true }));
    expect(toComposer("t")).toBe(false);
    expect(toComposer("M")).toBe(false);
    expect(toComposer("x")).toBe(true);
  });

  it("runs tools by letter while a closed popup stays mounted, never over an open or closing one", async () => {
    // Upstream's launcher letters ignore closed keepMounted popups (#18132); Nová karta's too.
    using _page = await setup();
    inView();
    const newTab = newTabSurface();
    const onAddDevice = vi.fn();
    setPanel({ isOpen: true, activeSurfaceId: newTab.id, surfaces: [newTab] });
    await using screen = await render(strip(onAddDevice));
    const popup = document.createElement("div");
    popup.dataset.slot = "menu-popup";
    popup.dataset.closed = "";
    screen.container.append(popup);
    await pressLetter("m");
    expect(onAddDevice).toHaveBeenCalledTimes(1);
    for (const state of ["data-open", "data-ending-style"]) {
      popup.setAttribute(state, "");
      await pressLetter("m");
      expect(onAddDevice, state).toHaveBeenCalledTimes(1);
      popup.removeAttribute(state);
    }
  });
});
