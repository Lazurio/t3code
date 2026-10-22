import {
  compileResolvedKeybindingsConfig,
  DEFAULT_RESOLVED_KEYBINDINGS,
  isMacPlatform,
} from "@t3tools/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";

import type { ChatShortcutsInput } from "~/components/chat/useChatShortcuts";
import { confirmTerminalClose } from "~/lib/terminalCloseConfirm";
import { render } from "../../test/render";
import { useBuddyChatShortcuts } from "./BuddySurface";

// A terminal's close confirmation waits on the desktop dialog; the test holds it open.
const dialog = vi.hoisted(() => ({ answer: null as ((confirmed: boolean) => void) | null }));
vi.mock(import("~/localApi"), async (original) => ({
  ...(await original()),
  readLocalApi: (() => ({
    dialogs: {
      confirm: () =>
        new Promise<boolean>((resolve) => {
          dialog.answer = resolve;
        }),
    },
  })) as never,
}));

const setup = () => {
  dialog.answer = null;
};

function Chat(props: { readonly buddy: boolean; readonly input: ChatShortcutsInput }) {
  useBuddyChatShortcuts(props.buddy, props.input);
  return null;
}

/** The chat's shortcuts as ChatView gives them, with a project script bound to Mod+Shift+R. */
function chatShortcuts() {
  const handlers = {
    "terminal.toggle": vi.fn(),
    "terminal.close": vi.fn(),
    "rightPanel.close": vi.fn(),
    "diff.toggle": vi.fn(),
    "threadPanel.toggle": vi.fn(),
    "modelPicker.toggle": vi.fn(),
  };
  const script = vi.fn();
  const input: ChatShortcutsInput = {
    enabled: true,
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    scriptKeybindings: compileResolvedKeybindingsConfig([
      { key: "mod+shift+r", command: "script.setup.run" },
    ]),
    getShortcutContext: () => ({
      terminalFocus: false,
      terminalOpen: false,
      previewFocus: false,
      previewOpen: false,
      isWeb: true,
      isDesktop: false,
      modelPickerOpen: false,
    }),
    threadFindActive: false,
    typeIntoComposer: () => false,
    closeThreadFind: () => {},
    commands: handlers,
    fallback: (command) => (command === "script.setup.run" ? script : undefined),
  };
  return { input, handlers, script };
}

/** Presses Mod plus `key`, as the platform spells Mod, and says whether the chat took the key. */
function press(
  key: string,
  options: { readonly shiftKey?: boolean; readonly repeat?: boolean } = {},
) {
  const mod = isMacPlatform(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
  const event = new KeyboardEvent("keydown", {
    key,
    ...options,
    ...mod,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/** Opens a terminal's close confirmation and leaves it waiting until the test answers it. */
async function pendingTerminalClose() {
  const closing = confirmTerminalClose(["shell"]);
  await vi.waitFor(() => expect(dialog.answer).not.toBeNull());
  return {
    [Symbol.asyncDispose]: async () => {
      dialog.answer?.(false);
      await closing;
    },
  };
}

describe("T3's terminal and right-panel keys in Buddy's surface", () => {
  it("do nothing and stay the browser's, while the chat's other keys still work", async () => {
    setup();
    const { input, handlers, script } = chatShortcuts();
    // The hook reads no route.
    await using _screen = await render(<Chat buddy input={input} />, { router: false });
    expect(press("j")).toBe(false);
    expect(press("d")).toBe(false);
    expect(press("B", { shiftKey: true })).toBe(false);
    expect(press("R", { shiftKey: true })).toBe(false);
    // Mod+W closes the browser's tab, held down too, where T3 would hold it for a terminal.
    expect(press("w")).toBe(false);
    expect(press("w", { repeat: true })).toBe(false);
    const { "modelPicker.toggle": modelPicker, ...panelHandlers } = handlers;
    for (const handler of Object.values(panelHandlers)) expect(handler).not.toHaveBeenCalled();
    expect(script).not.toHaveBeenCalled();
    expect(press("M", { shiftKey: true })).toBe(true);
    expect(modelPicker).toHaveBeenCalledOnce();
  });

  it("leave Mod+W to the browser while a terminal's close confirmation is still open", async () => {
    setup();
    const { input } = chatShortcuts();
    // The hook reads no route.
    await using _screen = await render(<Chat buddy input={input} />, { router: false });
    await using _closing = await pendingTerminalClose();
    expect(press("w")).toBe(false);
  });

  it("stay T3's outside Buddy's T3 Code", async () => {
    setup();
    const { input, handlers, script } = chatShortcuts();
    // The hook reads no route.
    await using _screen = await render(<Chat buddy={false} input={input} />, { router: false });
    expect(press("j")).toBe(true);
    expect(press("d")).toBe(true);
    expect(press("R", { shiftKey: true })).toBe(true);
    expect(press("w", { repeat: true })).toBe(true);
    expect(handlers["terminal.toggle"]).toHaveBeenCalledOnce();
    expect(handlers["diff.toggle"]).toHaveBeenCalledOnce();
    expect(script).toHaveBeenCalledOnce();
    {
      await using _closing = await pendingTerminalClose();
      expect(press("w")).toBe(true);
    }
  });
});
