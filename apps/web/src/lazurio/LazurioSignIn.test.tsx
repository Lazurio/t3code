// @vitest-environment jsdom

import { type EnvironmentId, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { LazurioSignInRow } from "./LazurioSignIn";

// A Lazurio Environment's config, and the logout command the row may run.
const toolsUrl = "https://launchpad.vm-01.example.lazurio.io/settings/start";
const logout = vi.fn();
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({ lazurioFolder: "/home/person/Lazurio", lazurioToolsUrl: toolsUrl }),
}));
vi.mock("../state/server", () => ({
  serverEnvironment: { configValueAtom: () => "config", logoutProviderAuth: "logout" },
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
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const render = (status: ServerProvider["auth"]["status"]) =>
  act(() =>
    root.render(
      <LazurioSignInRow
        environmentId={environmentId}
        instanceId={instanceId}
        mode="managed"
        provider={provider(status)}
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

  it("offers nothing to disconnect once signed out", () => {
    render("unauthenticated");
    expect(buttons()).toEqual([]);
    expect(container.querySelector("a")?.getAttribute("href")).toBe(toolsUrl);
  });
});
