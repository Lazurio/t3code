import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";

// The strip reads its look and the browser's profiles from mocked hooks, as Nová karta's test does.
vi.mock(import("~/hooks/useTheme"), async (original) => ({
  ...(await original()),
  useTheme: () => ({ theme: "light", resolvedTheme: "light", themeHalves: null }) as never,
}));
vi.mock(import("~/browser/browserDefaults"), async (original) => ({
  ...(await original()),
  useBrowserDefaults: () => ({ profiles: [] }) as never,
}));

import { RightPanelTabs } from "~/components/RightPanelTabs";
import {
  type RightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "~/rightPanelStore";
import { render } from "../../test/render";
import { buddyRightPanelState } from "./BuddySurface";

const THREAD = scopeThreadRef(EnvironmentId.make("environment-buddy"), ThreadId.make("buddy"));
const FILES: RightPanelSurface = { id: "files", kind: "files" };
const noop = () => undefined;

/**
 * The thread's right panel open, as T3 keeps it after the panel was opened on the thread: in T3
 * before Buddy's surface, by a link the chat took into it, or for a page an agent showed.
 */
function openPanel(): Disposable {
  useRightPanelStore.setState({
    byThreadKey: {
      [scopedThreadKey(THREAD)]: { isOpen: true, activeSurfaceId: FILES.id, surfaces: [FILES] },
    },
  });
  return { [Symbol.dispose]: () => useRightPanelStore.setState({ byThreadKey: {} }) };
}

/**
 * The right panel beside the chat, given the thread's panel as ChatView reads it: ChatView draws
 * the panel only while that reading is open, which the release contract keeps.
 */
function ChatPanel(props: { readonly buddy: boolean }) {
  const panel = buddyRightPanelState(
    props.buddy,
    useRightPanelStore((state) => selectThreadRightPanelState(state.byThreadKey, THREAD)),
  );
  if (!panel.isOpen) return null;
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
      surfaces={panel.surfaces}
      environmentId={null}
      activeSurfaceId={panel.activeSurfaceId}
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
      deviceAvailable={false}
    >
      {null}
    </RightPanelTabs>
  );
}

describe("T3's right panel beside Buddy's conversation", () => {
  it("is not there while the thread's panel is open", async () => {
    using _panel = openPanel();
    await using screen = await render(<ChatPanel buddy />);
    expect(screen.container.childElementCount).toBe(0);
    // The thread keeps its panel open: Buddy's surface never shows it, and closes nothing.
    const { byThreadKey } = useRightPanelStore.getState();
    expect(selectThreadRightPanelState(byThreadKey, THREAD).isOpen).toBe(true);
  });

  it("opens with the same state outside Buddy's T3 Code", async () => {
    using _panel = openPanel();
    await using screen = await render(<ChatPanel buddy={false} />);
    await expect.element(screen.getByText("Files", { exact: true })).toBeVisible();
  });
});
