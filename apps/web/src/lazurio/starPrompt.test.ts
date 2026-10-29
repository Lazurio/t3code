import { EnvironmentId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { recordPromptSentOutsideLazurio } from "./starPrompt";

const { configs, recordPromptSent } = vi.hoisted(() => ({
  configs: new Map<string, { lazurioFolder?: string }>(),
  recordPromptSent: vi.fn(async () => {}),
}));
vi.mock("../components/GitHubStarPrompt", () => ({ recordPromptSent }));
vi.mock("../rpc/atomRegistry", () => ({ appAtomRegistry: { get: () => configs } }));
vi.mock("../state/server", () => ({ environmentServerConfigsAtom: {} }));

const managed = EnvironmentId.make("environment-managed");
const other = EnvironmentId.make("environment-other");
const loading = EnvironmentId.make("environment-loading");

describe("the GitHub star prompt", () => {
  beforeEach(() => {
    recordPromptSent.mockClear();
    configs.clear();
    configs.set(managed, { lazurioFolder: "/home/person/Lazurio" });
    configs.set(other, {});
  });

  it("never counts a prompt sent on a Lazurio Environment", () => {
    recordPromptSentOutsideLazurio(managed);
    expect(recordPromptSent).not.toHaveBeenCalled();
  });

  it("counts as upstream elsewhere, also before the config arrives", () => {
    recordPromptSentOutsideLazurio(other);
    recordPromptSentOutsideLazurio(loading);
    expect(recordPromptSent.mock.calls).toEqual([[other], [loading]]);
  });
});
