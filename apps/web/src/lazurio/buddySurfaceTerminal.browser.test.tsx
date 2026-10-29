import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

// The thread, its project and the session's terminal grant come from mocked state, as the queue's
// test reads its thread; the server knows no session of the thread's terminal yet.
vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  useThreadRefs: (() => [{ environmentId: "environment-buddy", threadId: "buddy" }]) as never,
  useQuietThreadShell: (() => ({
    environmentId: "environment-buddy",
    projectId: "project-buddy",
    worktreePath: null,
  })) as never,
  useProject: (() => ({ workspaceRoot: "/workspace/buddy" })) as never,
}));
vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: (() => true) as never,
}));
vi.mock(import("~/state/terminalSessions"), async (original) => ({
  ...(await original()),
  useKnownTerminalSessions: (() => []) as never,
}));
vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => async () => undefined) as never,
}));
// The emulator stands in for the drawer's terminal: whether the chat shows a terminal is decided
// before it renders, and it would attach to a shell on the server.
vi.mock(import("~/components/ThreadTerminalDrawer"), async () => {
  const { createElement } = await import("react");
  return {
    default: ((props: { readonly visible: boolean }) =>
      props.visible ? createElement("section", { "aria-label": "Terminal" }) : null) as never,
  };
});

import { ChatTerminalDrawers } from "~/components/chat/ChatTerminalDrawers";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "~/terminalUiStateStore";
import { DEFAULT_THREAD_TERMINAL_ID } from "~/types";
import { render } from "../../test/render";
import { buddyTerminalUiState } from "./BuddySurface";

const THREAD = scopeThreadRef(EnvironmentId.make("environment-buddy"), ThreadId.make("buddy"));

/**
 * The thread's terminal open, as T3 keeps it after a drawer was opened on the thread: in T3 before
 * Buddy's surface, or by an action such as a code block's Run in terminal.
 */
function openTerminal(): Disposable {
  useTerminalUiStateStore
    .getState()
    .ensureTerminal(THREAD, DEFAULT_THREAD_TERMINAL_ID, { open: true, active: true });
  return {
    [Symbol.dispose]: () => useTerminalUiStateStore.getState().removeTerminalUiState(THREAD),
  };
}

/**
 * The drawers under the chat, given the thread's drawer as ChatView reads it. ChatView also leaves
 * the drawers out of Buddy's surface altogether, which the release contract keeps; this shows that
 * the thread's state alone opens none there either.
 */
function ChatDrawers(props: { readonly buddy: boolean }) {
  const terminal = buddyTerminalUiState(
    props.buddy,
    useTerminalUiStateStore((state) =>
      selectThreadTerminalUiState(state.terminalUiStateByThreadKey, THREAD),
    ),
  );
  return (
    <ChatTerminalDrawers
      activeThreadKey={scopedThreadKey(THREAD)}
      activeTerminalOpen={Boolean(terminal.terminalOpen)}
      composerHeight={0}
      launchContext={null}
      splitShortcutLabel={undefined}
      splitVerticalShortcutLabel={undefined}
      newShortcutLabel={undefined}
      closeShortcutLabel={undefined}
      keybindings={[]}
      onAddTerminalContext={() => {}}
    />
  );
}

describe("T3's terminal drawer under Buddy's conversation", () => {
  it("is not there while the thread's terminal is open", async () => {
    using _terminal = openTerminal();
    await using screen = await render(<ChatDrawers buddy />);
    expect(screen.container.childElementCount).toBe(0);
    // The thread keeps its terminal open: Buddy's surface never shows it, and closes nothing.
    const { terminalUiStateByThreadKey } = useTerminalUiStateStore.getState();
    expect(selectThreadTerminalUiState(terminalUiStateByThreadKey, THREAD).terminalOpen).toBe(true);
  });

  it("opens with the same state outside Buddy's T3 Code", async () => {
    using _terminal = openTerminal();
    await using screen = await render(<ChatDrawers buddy={false} />);
    await expect.element(screen.getByRole("region", { name: "Terminal" })).toBeInTheDocument();
  });
});
