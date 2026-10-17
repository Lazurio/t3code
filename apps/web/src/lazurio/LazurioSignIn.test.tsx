// @vitest-environment jsdom

import { type EnvironmentId, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { LazurioSignInChoice, LazurioSignInRow } from "./LazurioSignIn";

// A Lazurio Environment's config (or another Environment's), the logout command the row may run,
// and whether the session may run it (upstream's sign-out needs `providers:manage`).
const toolsUrl = "https://launchpad.vm-01.example.lazurio.io/settings/start";
const logout = vi.fn();
const session = vi.hoisted(() => ({ maySignOut: true, lazurio: true }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: string) =>
    atom === "sign-out-allowed"
      ? session.maySignOut
      : session.lazurio
        ? { lazurioFolder: "/home/person/Lazurio", lazurioToolsUrl: toolsUrl }
        : {},
}));
vi.mock("../state/server", () => ({
  serverEnvironment: {
    configValueAtom: () => "config",
    logoutProviderAuth: { permissionAtom: () => "sign-out-allowed" },
  },
}));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => logout }));
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

const environmentId = "env-1" as EnvironmentId;
const instanceId = ProviderInstanceId.make("codex_personal");
const provider = (status: ServerProvider["auth"]["status"]) =>
  ({ auth: { status, email: "person@example.com" } }) as ServerProvider;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  logout.mockReset();
  session.maySignOut = true;
  session.lazurio = true;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const render = (
  status: ServerProvider["auth"]["status"],
  access: { readOnly?: boolean; enabled?: boolean } = {},
) =>
  act(() =>
    root.render(
      <LazurioSignInRow
        environmentId={environmentId}
        instanceId={instanceId}
        mode="managed"
        provider={provider(status)}
        readOnly={access.readOnly ?? false}
        enabled={access.enabled ?? true}
      />,
    ),
  );
const buttons = () => [...container.querySelectorAll("button")].map((button) => button.textContent);

describe("a managed Codex account on a Lazurio Environment", () => {
  it("can still be disconnected while signed in, but not signed in to again", async () => {
    render("authenticated");
    expect(buttons()).toEqual(["Disconnect"]);
    // T3's own sign-in stays closed: only the Getting started page, no way back into it.
    expect(container.textContent).not.toMatch(/Continue with ChatGPT|Change account|Reconnect/);
    expect(container.querySelector("a")?.getAttribute("href")).toBe(toolsUrl);
    // The row says where to sign in and what to do, not how Lazurio shares a sign-in (DEV-6665).
    expect(container.textContent).toContain(
      "Codex and Claude sign in through Lazurio on the Getting started page.",
    );
    expect(container.textContent).toContain("Disconnect it and sign Codex in through Lazurio.");
    expect(container.textContent).not.toMatch(/the terminal|instance|only T3 Code uses/);

    logout.mockResolvedValue({
      _tag: "Success",
      value: {
        phase: "idle",
        message: "Signed out locally. Remote revocation could not be confirmed.",
      },
    });
    const disconnect = container.querySelector("button");
    await act(async () => disconnect?.click());
    expect(logout).toHaveBeenCalledWith({ environmentId, input: { instanceId } });
    // What the provider said about the sign-out reaches the person, as in upstream's setup.
    expect(container.textContent).toContain("Signed out locally.");
  });

  it("keeps Disconnect unavailable where the settings page allows no writes, as upstream's", async () => {
    // A session without the scope to write, and an instance turned off, freeze it alike.
    for (const access of [{ readOnly: true }, { enabled: false }]) {
      render("authenticated", access);
      const disconnect = container.querySelector("button");
      expect(disconnect?.textContent).toBe("Disconnect");
      expect(disconnect?.disabled).toBe(true);
      await act(async () => disconnect?.click());
    }
    expect(logout).not.toHaveBeenCalled();
  });

  it("keeps Disconnect unavailable to a session that may not sign providers out", async () => {
    session.maySignOut = false;
    render("authenticated");
    const disconnect = container.querySelector("button");
    expect(disconnect?.textContent).toBe("Disconnect");
    expect(disconnect?.disabled).toBe(true);
    await act(async () => disconnect?.click());
    expect(logout).not.toHaveBeenCalled();
  });

  it("offers nothing to disconnect once signed out", () => {
    render("unauthenticated");
    expect(buttons()).toEqual([]);
    expect(container.querySelector("a")?.getAttribute("href")).toBe(toolsUrl);
  });
});

describe("Continue with ChatGPT beside other choices", () => {
  const renderChoice = () =>
    act(() =>
      root.render(
        <LazurioSignInChoice environmentId={environmentId}>
          <button type="button">Continue with ChatGPT</button>
        </LazurioSignInChoice>,
      ),
    );

  it("gives way to the Getting started page on a Lazurio Environment", () => {
    renderChoice();
    expect(buttons()).toEqual([]);
    expect(container.querySelector("a")?.getAttribute("href")).toBe(toolsUrl);
  });

  it("stays upstream's elsewhere", () => {
    session.lazurio = false;
    renderChoice();
    expect(buttons()).toEqual(["Continue with ChatGPT"]);
    expect(container.querySelector("a")).toBeNull();
  });
});
