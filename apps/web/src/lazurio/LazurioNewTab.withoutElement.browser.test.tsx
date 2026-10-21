import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";
import { RightPanelTabs } from "../components/RightPanelTabs";
import {
  type RightPanelSurface,
  selectThreadRightPanelState,
  type ThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";
import { LazurioRightPanelSurfaces } from "./LazurioEnvironmentBrowser";
import { NEW_TAB_ELEMENT } from "./LazurioNewTab";
import { resetThreadTabs, type ThreadTabsSnapshot, useThreadTabsStore } from "./threadTabs";

// A shell without `<lazurio-new-tab>` (an older Platform): upstream's "+" menu, Mod+T and empty
// panel stay. This page never defines the element, which LazurioNewTab.browser.test.tsx does.

vi.mock(import("~/hooks/useTheme"), async (original) => ({
  ...(await original()),
  useTheme: () => ({ theme: "light", resolvedTheme: "light", themeHalves: null }) as never,
}));
vi.mock(import("~/browser/browserDefaults"), async (original) => ({
  ...(await original()),
  useBrowserDefaults: () => ({ profiles: [] }) as never,
}));

const threadA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const snapshot: ThreadTabsSnapshot = {
  available: true,
  epoch: "epoch-1",
  revision: 1,
  threadId: "thread-A",
  strip: "t3-thread-A",
  viewOrigin: "https://browser.vm-01.example.lazurio.io",
  tabs: [],
};
/** The draft's line in English, the test browser's language. */
const DRAFT_LINE = "The Environment browser comes with the first message.";
const files: RightPanelSurface = { id: "files", kind: "files" };
const panel = () => selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadA);
const setPanel = (state: ThreadRightPanelState) =>
  useRightPanelStore.setState({ byThreadKey: { [scopedThreadKey(threadA)]: state } });
const noop = () => undefined;

/** One test's page, from nothing. */
function setup() {
  expect(customElements.get(NEW_TAB_ELEMENT)).toBeUndefined();
  resetThreadTabs();
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
}

/** The thread in view, as ChatView's hook sets it, with the server's list of its tabs. */
function inView() {
  useThreadTabsStore.setState({
    inView: threadA,
    snapshots: { [scopedThreadKey(threadA)]: snapshot },
  });
}

/** Upstream's strip of an open panel as the store has it now. */
function strip() {
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
      onAddTerminal={noop}
      onAddPullRequest={noop}
      onAddPullRequests={noop}
      onAddDiff={noop}
      onAddFiles={noop}
      onAddDevice={noop}
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

describe("without the shell's element", () => {
  it("keeps upstream's \"+\" menu and empty panel, even with the server's list", async () => {
    setup();
    inView();
    setPanel({ isOpen: true, activeSurfaceId: null, surfaces: [] });
    await using screen = await render(strip());
    expect(screen.container.textContent).toContain("Open a surface");
    expect(screen.container.querySelector(NEW_TAB_ELEMENT)).toBeNull();
    setPanel({ isOpen: true, activeSurfaceId: files.id, surfaces: [files] });
    await screen.rerender(strip());
    expect(screen.container.querySelector('[aria-label="Add panel surface"]')).not.toBeNull();
    expect(screen.container.querySelector('[aria-label="New tab"]')).toBeNull();
  });

  it("keeps Mod+T on upstream's menu", async () => {
    setup();
    inView();
    setPanel({ isOpen: true, activeSurfaceId: files.id, surfaces: [files] });
    await using _screen = await render(strip());
    using _mac = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const event = new KeyboardEvent("keydown", {
      key: "t",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(() => {
      (document.activeElement ?? document.body).dispatchEvent(event);
    });
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelector('[role="menu"]:not([data-closed])')?.textContent).toContain(
      "Linked pull requests",
    );
    expect(panel().surfaces).toEqual([files]);
  });

  it("keeps upstream's empty panel on a draft, without the Environment browser's line", async () => {
    setup();
    useThreadTabsStore.setState({ draftInView: threadA });
    setPanel({ isOpen: true, activeSurfaceId: null, surfaces: [] });
    await using screen = await render(strip());
    expect(screen.container.textContent).toContain("Open a surface");
    expect(screen.container.textContent).not.toContain(DRAFT_LINE);
  });
});
