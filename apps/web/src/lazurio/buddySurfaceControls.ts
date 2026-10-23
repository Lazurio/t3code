/**
 * Lazurio overlay (root decision 0210, addendum of 2026-10-22, point 1; plan DEV-6676): the controls
 * of Buddy's chat. The composer is a message box: it keeps the model chip and the options Hermes
 * receives, and leaves out the controls for how a turn may act, T3's runtime access ("Full access")
 * and interaction mode and Hermes's session mode ("Default"), which is its permission mode. Its
 * queue holds the person's own messages. The surface has no terminal and no right panel, so T3's
 * keys for them stay the browser's (Lazurio/t3code#109).
 */
import type {
  KeybindingCommand,
  ResolvedKeybindingsConfig,
  ServerProviderModel,
} from "@t3tools/contracts";

import type { ChatShortcutsInput } from "~/components/chat/useChatShortcuts";

/** The option an ACP agent's session modes become (packages/provider-acp sessionConfig.ts). */
export const ACP_SESSION_MODE_OPTION_ID = "_t3/session-mode";

/** The composer's block of T3's runtime access and interaction mode. */
const MODE_BLOCK_ID = "mode";

const isSessionMode = (descriptor: { readonly id: string }) =>
  descriptor.id === ACP_SESSION_MODE_OPTION_ID;

/** The models as the options chip reads them: without an ACP agent's session mode. */
export function withoutSessionMode(
  models: ReadonlyArray<ServerProviderModel>,
): ReadonlyArray<ServerProviderModel> {
  if (!models.some((model) => model.capabilities?.optionDescriptors?.some(isSessionMode))) {
    return models;
  }
  return models.map((model) => {
    const descriptors = model.capabilities?.optionDescriptors;
    if (!descriptors?.some(isSessionMode)) return model;
    return {
      ...model,
      capabilities: {
        ...model.capabilities,
        optionDescriptors: descriptors.filter((descriptor) => !isSessionMode(descriptor)),
      },
    };
  });
}

export const withoutModeBlock = <Block extends { readonly id: string }>(blocks: Block[]) =>
  blocks.filter((block) => block.id !== MODE_BLOCK_ID);

/** T3's shortcuts for the terminal and the right panel. */
export const PANEL_SHORTCUTS: ReadonlySet<KeybindingCommand> = new Set([
  "terminal.toggle",
  "terminal.split",
  "terminal.splitVertical",
  "terminal.new",
  "terminal.close",
  "rightPanel.toggle",
  "rightPanel.toggleMaximized",
  "rightPanel.close",
  "threadPanel.toggle",
  "diff.toggle",
]);

const NO_KEYBINDINGS: ResolvedKeybindingsConfig = [];

/**
 * The chat's shortcuts without the bindings of the terminal's and the right panel's, and without
 * project scripts, which run in a terminal. Without a binding no key matches them, not even the
 * chat's guards that hold Mod+W for a closing terminal before any command runs, so their keys reach
 * the browser, as on any page that has no use for them.
 */
export function withoutPanelShortcuts(input: ChatShortcutsInput): ChatShortcutsInput {
  return {
    ...input,
    keybindings: input.keybindings.filter((binding) => !PANEL_SHORTCUTS.has(binding.command)),
    scriptKeybindings: NO_KEYBINDINGS,
  };
}

/** A message as the thread's projection holds it, as far as who wrote it goes. */
export interface QueueMessage {
  readonly id: string;
  readonly createdBy: string;
}

/**
 * The queued runs whose message the person wrote. A run whose message an agent or T3 wrote is left
 * out; one whose message the page has not loaded yet stays, as T3 shows it.
 */
export function personsQueuedRuns<Queued extends { readonly messageId: string }>(
  queued: ReadonlyArray<Queued>,
  messages: ReadonlyArray<QueueMessage> | undefined,
): ReadonlyArray<Queued> {
  const notThePersons = new Set(
    (messages ?? []).filter((message) => message.createdBy !== "user").map((message) => message.id),
  );
  if (!queued.some((run) => notThePersons.has(run.messageId))) return queued;
  return queued.filter((run) => !notThePersons.has(run.messageId));
}
