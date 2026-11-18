import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ProviderOptionDescriptor,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buddySpeedOf,
  buddySpeedOption,
  buddySpeedSelection,
  isBuddyWindowOrigin,
  leadsToBuddysThread,
  personsQueuedRuns,
  withoutUnusedShortcuts,
} from "./buddySurfaceControls";

const BUDDY = ProviderInstanceId.make("buddy");
const MODEL = "default";

/**
 * Hermes's speed in the tier its session runs, as T3 offers the one ACP session option Lazurio
 * Hermes v0.22.4-lazurio.3 advertises on a route with fast mode: `fast`, a select of `normal` and
 * `fast` without a category, and no model or reasoning option beside it.
 */
const speedOption = (tier: string): Extract<ProviderOptionDescriptor, { type: "select" }> => ({
  id: "fast",
  label: "Fast mode",
  type: "select",
  options: [
    { id: "normal", label: "Normal" },
    { id: "fast", label: "Fast" },
  ],
  currentValue: tier,
});

/** The speed the switch shows for Hermes's options and the composer's selection. */
function shownSpeed(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  selection: ModelSelection = { instanceId: BUDDY, model: MODEL },
) {
  const option = buddySpeedOption({
    provider: ProviderDriverKind.make("acpRegistry"),
    model: MODEL,
    models: [
      {
        slug: MODEL,
        name: "Default",
        isCustom: false,
        capabilities: { optionDescriptors: [...descriptors] },
      },
    ],
    modelOptions: selection.options,
  });
  return option === null ? "no switch" : buddySpeedOf(option, selection, null);
}

describe("Buddy's speed switch", () => {
  it("shows the speed Hermes's session runs, until the person picks one", () => {
    expect(shownSpeed([speedOption("fast")])).toBe("fast");
    expect(shownSpeed([speedOption("normal")])).toBe("normal");
    expect(
      shownSpeed([speedOption("normal")], {
        instanceId: BUDDY,
        model: MODEL,
        options: buddySpeedSelection("fast"),
      }),
    ).toBe("fast");
  });

  it("is not there unless Hermes offers both speeds as its `fast` option", () => {
    // A route without fast mode advertises no option at all.
    expect(shownSpeed([])).toBe("no switch");
    expect(shownSpeed([{ ...speedOption("fast"), options: [{ id: "fast", label: "Fast" }] }])).toBe(
      "no switch",
    );
    expect(shownSpeed([{ id: "fast", label: "Fast", type: "boolean", currentValue: true }])).toBe(
      "no switch",
    );
  });

  it("picks the speed as the selection's only option", () => {
    expect(buddySpeedSelection("normal")).toEqual([{ id: "fast", value: "normal" }]);
  });
});

describe("Buddy's queue", () => {
  const queued = [{ messageId: "person" }, { messageId: "delegace" }, { messageId: "unloaded" }];

  it("keeps the person's messages and one not loaded yet, and leaves out an agent's", () => {
    expect(
      personsQueuedRuns(queued, [
        { id: "person", createdBy: "user" },
        { id: "delegace", createdBy: "agent" },
      ]),
    ).toEqual([{ messageId: "person" }, { messageId: "unloaded" }]);
  });

  it("hands back the same queue when all of it is the person's", () => {
    expect(personsQueuedRuns(queued, [{ id: "person", createdBy: "user" }])).toBe(queued);
  });
});

describe("Buddy's window on the shared server", () => {
  it("is the page whose origin the server names for it, and nothing else", () => {
    const config = { lazurioBuddyOrigin: "https://buddy.example.test" };
    expect(isBuddyWindowOrigin(config, "https://buddy.example.test")).toBe(true);
    expect(isBuddyWindowOrigin(config, "https://t3code.example.test")).toBe(false);
    expect(isBuddyWindowOrigin({}, "https://buddy.example.test")).toBe(false);
    expect(isBuddyWindowOrigin(null, "https://buddy.example.test")).toBe(false);
  });
});

describe("a thread route in Buddy's surface", () => {
  const buddyProjectIds = new Set(["buddy-project"]);
  const route = (over: Partial<Parameters<typeof leadsToBuddysThread>[0]>) =>
    leadsToBuddysThread({
      threadId: "fork",
      buddyThreadId: null,
      hermes: false,
      projectId: "buddy-project",
      missing: false,
      buddyProjectIds,
      ...over,
    });

  it("keeps a fork or subagent of Buddy's project open on a fresh load, before Buddy's thread is known", () => {
    expect(route({})).toBe(false);
    expect(route({ buddyThreadId: "root" })).toBe(false);
  });

  it("waits for the thread and Buddy's project before it leads anywhere", () => {
    expect(route({ projectId: undefined })).toBe(false);
    expect(route({ projectId: "other", buddyProjectIds: new Set() })).toBe(false);
  });

  it("leads a thread the server confirmed missing to Buddy's, also before any thread exists", () => {
    expect(route({ projectId: undefined, missing: true })).toBe(true);
    expect(route({ projectId: undefined, missing: true, buddyProjectIds: new Set() })).toBe(true);
    // Still loading is not missing: the route waits.
    expect(route({ projectId: undefined, missing: false, buddyProjectIds: new Set() })).toBe(false);
  });

  it("leads another project's thread to Buddy's, and every other thread of Hermes's chat", () => {
    expect(route({ projectId: "other" })).toBe(true);
    expect(route({ hermes: true })).toBe(true);
    expect(route({ hermes: true, threadId: "buddy", buddyThreadId: "buddy" })).toBe(false);
  });
});

describe("the chat's shortcuts in Buddy's surface", () => {
  const binding = (command: string) => ({ command, shortcut: { key: "k" } }) as never;
  const input = {
    keybindings: [binding("modelPicker.toggle"), binding("terminal.toggle"), binding("chat.new")],
  } as unknown as Parameters<typeof withoutUnusedShortcuts>[0];
  const commands = (result: ReturnType<typeof withoutUnusedShortcuts>) =>
    result.keybindings.map((entry) => entry.command);

  it("drop the model choice only in Hermes's chat, the panels in both", () => {
    expect(commands(withoutUnusedShortcuts(input))).toEqual(["chat.new"]);
    expect(commands(withoutUnusedShortcuts(input, true))).toEqual([
      "modelPicker.toggle",
      "chat.new",
    ]);
  });
});
