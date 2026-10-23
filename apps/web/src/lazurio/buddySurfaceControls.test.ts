import {
  ProviderDriverKind,
  type ProviderOptionDescriptor,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { shouldRenderTraitsControls } from "~/components/chat/TraitsPicker";
import { ACP_SESSION_MODE_OPTION_ID, withoutSessionMode } from "./buddySurfaceControls";

const ACP = ProviderDriverKind.make("acpRegistry");
const MODEL = "custom:buddy-fake-1";

/** Hermes's session modes as the ACP adapter offers them (Default, Accept Edits, Don't Ask). */
const SESSION_MODE: ProviderOptionDescriptor = {
  id: ACP_SESSION_MODE_OPTION_ID,
  label: "Mode",
  type: "select",
  options: [
    { id: "default", label: "Default" },
    { id: "accept_edits", label: "Accept Edits" },
    { id: "dont_ask", label: "Don't Ask" },
  ],
  currentValue: "default",
};
const THOUGHT_LEVEL: ProviderOptionDescriptor = {
  id: "thought_level",
  label: "Thinking",
  type: "select",
  options: [
    { id: "low", label: "Low" },
    { id: "high", label: "High" },
  ],
  currentValue: "low",
};

const hermes = (
  optionDescriptors: ReadonlyArray<ProviderOptionDescriptor>,
): ReadonlyArray<ServerProviderModel> => [
  {
    slug: MODEL,
    name: "Custom endpoint · buddy-fake-1",
    isCustom: false,
    capabilities: { optionDescriptors: [...optionDescriptors] },
  },
];

/** Whether the composer shows an options chip for these models. */
const optionsChip = (models: ReadonlyArray<ServerProviderModel>) =>
  shouldRenderTraitsControls({
    provider: ACP,
    models,
    model: MODEL,
    prompt: "",
    modelOptions: undefined,
    planModeEnabled: false,
  });

describe("Buddy's options chip", () => {
  it("leaves out Hermes's session mode, so Hermes with no other option shows no chip", () => {
    expect(optionsChip(hermes([SESSION_MODE]))).toBe(true);
    expect(optionsChip(withoutSessionMode(hermes([SESSION_MODE])))).toBe(false);
  });

  it("keeps an option Hermes receives besides its mode", () => {
    const [model] = withoutSessionMode(hermes([SESSION_MODE, THOUGHT_LEVEL]));
    expect(model?.capabilities?.optionDescriptors).toEqual([THOUGHT_LEVEL]);
    expect(optionsChip(withoutSessionMode(hermes([SESSION_MODE, THOUGHT_LEVEL])))).toBe(true);
  });

  it("hands back the same models when no agent offers a session mode", () => {
    const models = hermes([THOUGHT_LEVEL]);
    expect(withoutSessionMode(models)).toBe(models);
  });
});
