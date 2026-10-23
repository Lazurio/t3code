/**
 * Lazurio overlay (root decision 0210, addendum of 2026-10-22, point 1; plan DEV-6676): the controls
 * of Buddy's chat. The composer is a message box: it keeps the model chip and the options Hermes
 * receives, and leaves out the controls for how a turn may act, T3's runtime access ("Full access")
 * and interaction mode and Hermes's session mode ("Default"), which is its permission mode. The
 * surface has no terminal and no right panel, so T3's keys for them stay the browser's
 * (Lazurio/t3code#109).
 */
import type { KeybindingCommand, ServerProviderModel } from "@t3tools/contracts";

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

/**
 * The chat's shortcuts without the terminal's and the right panel's, and without project scripts,
 * which run in a terminal. Their keys reach the browser, as on any page that has no use for them.
 */
export function withoutPanelShortcuts(input: ChatShortcutsInput): ChatShortcutsInput {
  const commands = { ...input.commands };
  for (const command of PANEL_SHORTCUTS) delete commands[command];
  return { ...input, commands, fallback: () => undefined };
}
