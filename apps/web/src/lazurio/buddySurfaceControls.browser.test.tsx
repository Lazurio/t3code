import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  ThreadId,
} from "@t3tools/contracts";
import {
  compileResolvedKeybindingsConfig,
  DEFAULT_RESOLVED_KEYBINDINGS,
  isMacPlatform,
} from "@t3tools/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { useComposerDraftStore } from "~/composerDraftStore";
import type { ChatShortcutsInput } from "~/components/chat/useChatShortcuts";
import { confirmTerminalClose } from "~/lib/terminalCloseConfirm";
import { render } from "../../test/render";
import { BuddyComposerControls, useBuddyChatShortcuts } from "./BuddySurface";

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

/**
 * The chat's shortcuts as ChatView gives them, with a project script bound to Mod+Shift+R and the
 * reasoning effort's steps, which have no default keys, bound to Mod+Alt+Up and Mod+Alt+Down.
 */
function chatShortcuts() {
  const handlers = {
    "terminal.toggle": vi.fn(),
    "terminal.close": vi.fn(),
    "rightPanel.close": vi.fn(),
    "diff.toggle": vi.fn(),
    "threadPanel.toggle": vi.fn(),
    "modelPicker.toggle": vi.fn(),
    "composer.effort": vi.fn(),
    "composer.increaseEffort": vi.fn(),
    "composer.decreaseEffort": vi.fn(),
    "composer.mode": vi.fn(),
    "chat.find": vi.fn(),
  };
  const script = vi.fn();
  const input: ChatShortcutsInput = {
    enabled: true,
    keybindings: [
      ...DEFAULT_RESOLVED_KEYBINDINGS,
      ...compileResolvedKeybindingsConfig([
        { key: "mod+alt+arrowup", command: "composer.increaseEffort" },
        { key: "mod+alt+arrowdown", command: "composer.decreaseEffort" },
      ]),
    ],
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
    composerRef: { current: null },
    branchToolbarRef: { current: null },
    closeThreadFind: () => {},
    commands: handlers,
    fallback: (command) => (command === "script.setup.run" ? script : undefined),
  };
  return { input, handlers, script };
}

/** Presses Mod plus `key`, as the platform spells Mod, and says whether the chat took the key. */
function press(
  key: string,
  options: {
    readonly shiftKey?: boolean;
    readonly altKey?: boolean;
    readonly repeat?: boolean;
  } = {},
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

describe("T3's terminal, right-panel and choice keys in Buddy's surface", () => {
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
    // No model, reasoning effort, access or mode to choose (root decision 0210, 2026-10-25).
    expect(press("M", { shiftKey: true })).toBe(false);
    expect(press("E", { shiftKey: true })).toBe(false);
    expect(press("A", { shiftKey: true })).toBe(false);
    expect(press("ArrowUp", { altKey: true })).toBe(false);
    expect(press("ArrowDown", { altKey: true })).toBe(false);
    const { "chat.find": find, ...unusedHandlers } = handlers;
    for (const handler of Object.values(unusedHandlers)) expect(handler).not.toHaveBeenCalled();
    expect(script).not.toHaveBeenCalled();
    expect(press("f")).toBe(true);
    expect(find).toHaveBeenCalledOnce();
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
    expect(press("M", { shiftKey: true })).toBe(true);
    expect(press("ArrowUp", { altKey: true })).toBe(true);
    expect(handlers["terminal.toggle"]).toHaveBeenCalledOnce();
    expect(handlers["diff.toggle"]).toHaveBeenCalledOnce();
    expect(handlers["modelPicker.toggle"]).toHaveBeenCalledOnce();
    expect(handlers["composer.increaseEffort"]).toHaveBeenCalledOnce();
    expect(script).toHaveBeenCalledOnce();
    {
      await using _closing = await pendingTerminalClose();
      expect(press("w")).toBe(true);
    }
  });
});

const ENVIRONMENT = EnvironmentId.make("environment-buddy");
const BUDDY = ProviderInstanceId.make("buddy");
const THREAD = scopeThreadRef(ENVIRONMENT, ThreadId.make("buddy"));
const MODEL = "default";

/**
 * Hermes's speed as T3 offers the one ACP session option Lazurio Hermes v0.22.4-lazurio.3
 * advertises on a route with fast mode, in the tier its session runs.
 */
const SPEED: ProviderOptionDescriptor = {
  id: "fast",
  label: "Fast mode",
  type: "select",
  options: [
    { id: "normal", label: "Normal" },
    { id: "fast", label: "Fast" },
  ],
  currentValue: "normal",
};

/** Buddy's composer controls as the composer gives them for Hermes's options and its selection. */
function Controls(props: {
  readonly descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly options?: ReadonlyArray<ProviderOptionSelection>;
}) {
  return (
    <BuddyComposerControls
      routeKind="server"
      routeThreadRef={THREAD}
      draftId={null}
      selectedProvider={ProviderDriverKind.make("acpRegistry")}
      selectedInstanceId={BUDDY}
      selectedModel={MODEL}
      selectedProviderModels={[
        {
          slug: MODEL,
          name: "Default",
          isCustom: false,
          capabilities: { optionDescriptors: [...props.descriptors] },
        },
      ]}
      composerModelOptions={props.options === undefined ? null : { [BUDDY]: [...props.options] }}
      reportedModelSelection={null}
    />
  );
}

const draftedOptions = () =>
  useComposerDraftStore.getState().getComposerDraft(THREAD)?.modelSelectionByProvider[BUDDY]
    ?.options;

describe("Buddy's composer controls", () => {
  it("are Hermes's Normal / Fast switch, and a pick is the next message's only option", async () => {
    setup();
    useComposerDraftStore.setState({ draftsByThreadKey: {}, draftThreadsByThreadKey: {} });
    // The controls read no route.
    await using screen = await render(<Controls descriptors={[SPEED]} />, { router: false });
    const speed = page.getByRole("group", { name: "Speed" });
    await expect.element(speed).toBeVisible();
    await expect
      .element(speed.getByRole("button", { name: "Normal" }))
      .toHaveAttribute("aria-pressed", "true");
    await speed.getByRole("button", { name: "Fast" }).click();
    expect(draftedOptions()).toEqual([{ id: "fast", value: "fast" }]);
    await screen.rerender(<Controls descriptors={[SPEED]} options={draftedOptions() ?? []} />);
    await expect
      .element(speed.getByRole("button", { name: "Fast" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.container.querySelectorAll("button")).toHaveLength(2);
  });

  it("say Normální and Rychlý in Czech", async () => {
    setup();
    using _czech = vi.spyOn(navigator, "language", "get").mockReturnValue("cs-CZ");
    // The controls read no route.
    await using _screen = await render(<Controls descriptors={[SPEED]} />, { router: false });
    const speed = page.getByRole("group", { name: "Rychlost" });
    await expect.element(speed.getByRole("button", { name: "Normální" })).toBeVisible();
    await expect.element(speed.getByRole("button", { name: "Rychlý" })).toBeVisible();
  });

  it("are nothing on a route where Hermes offers no speed", async () => {
    setup();
    // The controls read no route.
    await using screen = await render(<Controls descriptors={[]} />, { router: false });
    expect(screen.container.childElementCount).toBe(0);
  });
});
