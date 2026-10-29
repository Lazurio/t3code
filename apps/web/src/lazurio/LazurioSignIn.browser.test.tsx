import { type EnvironmentId, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render, type Screen } from "../../test/render";

// A Lazurio Environment's config (or another Environment's), the logout command the row may run,
// and whether the session may run it (upstream's sign-out needs `providers:manage`).
const toolsUrl = "https://launchpad.vm-01.example.lazurio.io/settings/start";
const state = vi.hoisted(() => ({ logout: vi.fn(), maySignOut: true, lazurio: true }));
vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: ((atom: string) =>
    atom === "sign-out-allowed"
      ? state.maySignOut
      : state.lazurio
        ? { lazurioFolder: "/home/person/Lazurio", lazurioToolsUrl: toolsUrl }
        : {}) as never,
}));
vi.mock(import("../state/server"), async (original) => ({
  ...(await original()),
  serverEnvironment: {
    configValueAtom: () => "config",
    logoutProviderAuth: { permissionAtom: () => "sign-out-allowed" },
  } as never,
}));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => state.logout }));
// The settings row's layout needs the settings page around it; its words and control are enough.
vi.mock("../components/settings/settingsLayout", () => ({
  SettingsRow: (props: { title: ReactNode; description?: ReactNode; control?: ReactNode }) => (
    <div>
      <div>{props.title}</div>
      <div>{props.description}</div>
      <div>{props.control}</div>
    </div>
  ),
}));

import { LazurioSignInChoice, LazurioSignInRow } from "./LazurioSignIn";

const environmentId = "env-1" as EnvironmentId;
const instanceId = ProviderInstanceId.make("codex_personal");
const provider = (status: ServerProvider["auth"]["status"]) =>
  ({ auth: { status, email: "person@example.com" } }) as ServerProvider;

function setup({ maySignOut = true, lazurio = true } = {}) {
  state.logout.mockReset();
  state.maySignOut = maySignOut;
  state.lazurio = lazurio;
  // The overlay answers a Czech browser in Czech (root decision 0199); these tests read English.
  return vi.spyOn(navigator, "language", "get").mockReturnValue("en-US");
}

const renderRow = (
  status: ServerProvider["auth"]["status"],
  access: { readOnly?: boolean; enabled?: boolean } = {},
) =>
  render(
    <LazurioSignInRow
      environmentId={environmentId}
      instanceId={instanceId}
      mode="managed"
      provider={provider(status)}
      readOnly={access.readOnly ?? false}
      enabled={access.enabled ?? true}
    />,
  );
const buttons = (screen: Screen) =>
  [...screen.container.querySelectorAll("button")].map((button) => button.textContent);

describe("a managed Codex account on a Lazurio Environment", () => {
  it("can still be disconnected while signed in, but not signed in to again", async () => {
    using _state = setup();
    await using screen = await renderRow("authenticated");
    expect(buttons(screen)).toEqual(["Disconnect"]);
    // T3's own sign-in stays closed: only the Getting started page, no way back into it.
    expect(screen.container.textContent).not.toMatch(
      /Continue with ChatGPT|Change account|Reconnect/,
    );
    expect(screen.container.querySelector("a")?.getAttribute("href")).toBe(toolsUrl);
    // The row says where to sign in and what to do, not how Lazurio shares a sign-in (DEV-6665).
    expect(screen.container.textContent).toContain(
      "Codex and Claude sign in through Lazurio on the Getting started page.",
    );
    expect(screen.container.textContent).toContain(
      "Disconnect it and sign Codex in through Lazurio.",
    );
    expect(screen.container.textContent).not.toMatch(/the terminal|instance|only T3 Code uses/);

    state.logout.mockResolvedValue({
      _tag: "Success",
      value: {
        phase: "idle",
        message: "Signed out locally. Remote revocation could not be confirmed.",
      },
    });
    const disconnect = screen.container.querySelector("button");
    await act(async () => disconnect?.click());
    expect(state.logout).toHaveBeenCalledWith({ environmentId, input: { instanceId } });
    // What the provider said about the sign-out reaches the person, as in upstream's setup.
    expect(screen.container.textContent).toContain("Signed out locally.");
  });

  it("keeps Disconnect unavailable where the settings page allows no writes, as upstream's", async () => {
    using _state = setup();
    // A session without the scope to write, and an instance turned off, freeze it alike.
    for (const access of [{ readOnly: true }, { enabled: false }]) {
      await using screen = await renderRow("authenticated", access);
      const disconnect = screen.container.querySelector("button");
      expect(disconnect?.textContent).toBe("Disconnect");
      expect(disconnect?.disabled).toBe(true);
      await act(async () => disconnect?.click());
    }
    expect(state.logout).not.toHaveBeenCalled();
  });

  it("keeps Disconnect unavailable to a session that may not sign providers out", async () => {
    using _state = setup({ maySignOut: false });
    await using screen = await renderRow("authenticated");
    const disconnect = screen.container.querySelector("button");
    expect(disconnect?.textContent).toBe("Disconnect");
    expect(disconnect?.disabled).toBe(true);
    await act(async () => disconnect?.click());
    expect(state.logout).not.toHaveBeenCalled();
  });

  it("offers nothing to disconnect once signed out", async () => {
    using _state = setup();
    await using screen = await renderRow("unauthenticated");
    expect(buttons(screen)).toEqual([]);
    expect(screen.container.querySelector("a")?.getAttribute("href")).toBe(toolsUrl);
  });
});

describe("Continue with ChatGPT beside other choices", () => {
  const renderChoice = () =>
    render(
      <LazurioSignInChoice environmentId={environmentId}>
        <button type="button">Continue with ChatGPT</button>
      </LazurioSignInChoice>,
    );

  it("gives way to the Getting started page on a Lazurio Environment", async () => {
    using _state = setup();
    await using screen = await renderChoice();
    expect(buttons(screen)).toEqual([]);
    expect(screen.container.querySelector("a")?.getAttribute("href")).toBe(toolsUrl);
  });

  it("stays upstream's elsewhere", async () => {
    using _state = setup({ lazurio: false });
    await using screen = await renderChoice();
    expect(buttons(screen)).toEqual(["Continue with ChatGPT"]);
    expect(screen.container.querySelector("a")).toBeNull();
  });
});
