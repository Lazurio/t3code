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
  personsQueuedRuns,
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
