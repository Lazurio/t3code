import {
  compileResolvedKeybindingsConfig,
  DEFAULT_RESOLVED_KEYBINDINGS,
  isMacPlatform,
} from "@t3tools/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";

import type { ChatShortcutsInput } from "~/components/chat/useChatShortcuts";
import { render } from "../../test/render";
import { useBuddyChatShortcuts } from "./BuddySurface";

function Chat(props: { readonly buddy: boolean; readonly input: ChatShortcutsInput }) {
  useBuddyChatShortcuts(props.buddy, props.input);
  return null;
}

/** The chat's shortcuts as ChatView gives them, with a project script bound to Mod+Shift+R. */
function chatShortcuts() {
  const handlers = {
    "terminal.toggle": vi.fn(),
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
function press(key: string, shiftKey = false) {
  const mod = isMacPlatform(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
  const event = new KeyboardEvent("keydown", {
    key,
    shiftKey,
    ...mod,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("T3's terminal and right-panel keys in Buddy's surface", () => {
  it("do nothing and stay the browser's, while the chat's other keys still work", async () => {
    const { input, handlers, script } = chatShortcuts();
    // The hook reads no route.
    await using _screen = await render(<Chat buddy input={input} />, { router: false });
    expect(press("j")).toBe(false);
    expect(press("d")).toBe(false);
    expect(press("B", true)).toBe(false);
    expect(press("R", true)).toBe(false);
    expect(handlers["terminal.toggle"]).not.toHaveBeenCalled();
    expect(handlers["diff.toggle"]).not.toHaveBeenCalled();
    expect(handlers["threadPanel.toggle"]).not.toHaveBeenCalled();
    expect(script).not.toHaveBeenCalled();
    expect(press("M", true)).toBe(true);
    expect(handlers["modelPicker.toggle"]).toHaveBeenCalledOnce();
  });

  it("stay T3's outside Buddy's T3 Code", async () => {
    const { input, handlers, script } = chatShortcuts();
    // The hook reads no route.
    await using _screen = await render(<Chat buddy={false} input={input} />, { router: false });
    expect(press("j")).toBe(true);
    expect(press("d")).toBe(true);
    expect(press("R", true)).toBe(true);
    expect(handlers["terminal.toggle"]).toHaveBeenCalledOnce();
    expect(handlers["diff.toggle"]).toHaveBeenCalledOnce();
    expect(script).toHaveBeenCalledOnce();
  });
});
