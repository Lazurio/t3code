import { EnvironmentId, ProviderDriverKind, type ManagedPolicySummary } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";

// Whether the managed policy pins Codex's setup mode. The overlay's sign-in choice stands in as a
// link beside what the dialog hands it, so the lock on upstream's button stays visible.
const state = vi.hoisted(() => ({ policy: undefined as ManagedPolicySummary | undefined }));
vi.mock(import("../state/managedPolicy"), async (original) => ({
  ...(await original()),
  useManagedPolicy: (() => state.policy) as never,
}));
vi.mock(import("../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useEnvironmentSettings: (() => ({ providerInstances: {} })) as never,
  usePersistEnvironmentProviderInstanceMutation: vi.fn() as never,
}));
vi.mock(import("../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: (() => true) as never,
  readEnvironmentScope: (() => true) as never,
}));
vi.mock(import("./LazurioSignIn"), async (original) => ({
  ...(await original()),
  LazurioSignInChoice: (({ children }: { children: ReactNode }) => (
    <>
      <a href="#getting-started">Open Getting started</a>
      {children}
    </>
  )) as never,
}));

import { AddProviderInstanceDialog } from "../components/settings/AddProviderInstanceDialog";

const codexLocked: ManagedPolicySummary = {
  organization: "Example Organization",
  lockedSettings: [],
  limits: {
    providers: {
      lockedInstanceFields: { [ProviderDriverKind.make("codex")]: ["config.setupMode"] },
    },
  },
};

function setup(policy: ManagedPolicySummary | undefined) {
  state.policy = policy;
}

const renderDialog = () =>
  render(
    <AddProviderInstanceDialog
      open
      environmentId={EnvironmentId.make("env-1")}
      environmentLabel="This Environment"
      onOpenChange={() => undefined}
    />,
  );
const gettingStarted = () => document.querySelector('a[href="#getting-started"]');

describe("Lazurio's Codex sign-in choice in Add provider", () => {
  it("takes the place of Continue with ChatGPT", async () => {
    setup(undefined);
    await using _screen = await renderDialog();
    await expect.poll(gettingStarted).not.toBeNull();
  });

  it("is handed upstream's ChatGPT button while no policy locks Codex's setup mode", async () => {
    setup(undefined);
    await using _screen = await renderDialog();
    await expect.poll(() => document.body.textContent).toContain("Continue with ChatGPT");
  });

  it("stays where the managed policy locks Codex's setup mode, which rules out only T3's runtime", async () => {
    setup(codexLocked);
    await using _screen = await renderDialog();
    await expect.poll(() => document.body.textContent).toContain("Configure manually");
    expect(gettingStarted()).not.toBeNull();
    expect(document.body.textContent).not.toContain("Continue with ChatGPT");
  });
});
