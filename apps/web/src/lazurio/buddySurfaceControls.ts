/**
 * Lazurio overlay (root decision 0210, addenda of 2026-10-22 and of HumanAndMachines/Lazurio#648; plan DEV-6676): the
 * controls of Buddy's chat. The composer is a message box. It offers no model, reasoning effort,
 * access or mode: the Lazurio Platform sets Buddy's model and effort in Hermes's own config, and
 * Buddy always works with full access. Its one choice is Hermes's speed, Normal or Fast, where
 * Hermes offers it. Its queue holds the person's own messages. The surface has no terminal and no
 * right panel (Lazurio/t3code#109) and none of those choices, so T3's keys for them stay the
 * browser's.
 */
import { getDescriptorStringValue } from "@t3tools/client-runtime/model-traits";
import type {
  KeybindingCommand,
  ModelSelection,
  ProviderDriverKind,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
  ResolvedKeybindingsConfig,
  ServerProviderModel,
} from "@t3tools/contracts";
import { getProviderOptionDescriptors } from "@t3tools/shared/model";

import type { ChatShortcutsInput } from "~/components/chat/useChatShortcuts";
import { getProviderModelCapabilities } from "~/providerModels";

/** Hermes's ACP session option for its speed (Lazurio/hermes-agent), a select of these values. */
const BUDDY_SPEED_OPTION_ID = "fast";
const BUDDY_SPEEDS = ["normal", "fast"] as const;
export type BuddySpeed = (typeof BUDDY_SPEEDS)[number];

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;

export const isBuddySpeed = (value: unknown): value is BuddySpeed =>
  BUDDY_SPEEDS.some((speed) => speed === value);

/** What the composer has chosen for its provider: the model and the options it holds for it. */
export interface BuddyComposerSelection {
  readonly provider: ProviderDriverKind;
  readonly model: string;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly modelOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
}

/**
 * Hermes's speed option for the composer's model, carrying the composer's choice, when Hermes offers
 * it with both speeds; null otherwise.
 */
export function buddySpeedOption(selection: BuddyComposerSelection): SelectDescriptor | null {
  const option = getProviderOptionDescriptors({
    caps: getProviderModelCapabilities(selection.models, selection.model, selection.provider),
    selections: selection.modelOptions,
  }).find(
    (descriptor): descriptor is SelectDescriptor =>
      descriptor.id === BUDDY_SPEED_OPTION_ID && descriptor.type === "select",
  );
  return option !== undefined &&
    BUDDY_SPEEDS.every((speed) => option.options.some((choice) => choice.id === speed))
    ? option
    : null;
}

/**
 * The speed the switch shows: the person's choice, else the speed of Hermes's session; null for a
 * value it cannot name.
 */
export function buddySpeedOf(
  option: SelectDescriptor,
  selection: ModelSelection | null,
  reported: ModelSelection | null | undefined,
): BuddySpeed | null {
  const value = getDescriptorStringValue(option, selection, reported);
  return isBuddySpeed(value) ? value : null;
}

/** The options of the composer's selection once the person picks a speed: the speed alone. */
export const buddySpeedSelection = (speed: BuddySpeed): ReadonlyArray<ProviderOptionSelection> => [
  { id: BUDDY_SPEED_OPTION_ID, value: speed },
];

/** T3's shortcuts for the terminal and the right panel, which Buddy's surface does not have. */
const PANEL_SHORTCUTS: ReadonlyArray<KeybindingCommand> = [
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
];

/** T3's shortcuts for the composer's choices Buddy's chat does not offer. */
const CHOICE_SHORTCUTS: ReadonlyArray<KeybindingCommand> = [
  "modelPicker.toggle",
  "composer.effort",
  "composer.increaseEffort",
  "composer.decreaseEffort",
  "composer.mode",
];

const UNUSED_SHORTCUTS: ReadonlySet<KeybindingCommand> = new Set([
  ...PANEL_SHORTCUTS,
  ...CHOICE_SHORTCUTS,
]);

const NO_KEYBINDINGS: ResolvedKeybindingsConfig = [];

/**
 * The chat's shortcuts without the bindings of the terminal, the right panel and the composer's
 * choices, and without project scripts, which run in a terminal. Without a binding no key matches
 * them, not even the chat's guards that hold Mod+W for a closing terminal before any command runs,
 * so their keys reach the browser, as on any page that has no use for them.
 */
export function withoutUnusedShortcuts(input: ChatShortcutsInput): ChatShortcutsInput {
  return {
    ...input,
    keybindings: input.keybindings.filter((binding) => !UNUSED_SHORTCUTS.has(binding.command)),
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
