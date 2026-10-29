import { describe, expect, it } from "vite-plus/test";

import { lazurioSignInOf, t3AccountToDisconnect } from "./providerSignIn";

const folder = "/home/person/Lazurio";
const toolsUrl = "https://launchpad.vm.org.lazurio.io/settings/start";

describe("where Codex signs in", () => {
  it("stays T3's own sign-in without T3CODE_LAZURIO_FOLDER, or before the config arrives", () => {
    expect(lazurioSignInOf(null)).toBeNull();
    expect(lazurioSignInOf(undefined)).toBeNull();
    expect(lazurioSignInOf({})).toBeNull();
    // The page alone does not make an Environment a Lazurio one.
    expect(lazurioSignInOf({ lazurioToolsUrl: toolsUrl })).toBeNull();
  });

  it("is the Getting started page on a Lazurio Environment, when the Environment names it", () => {
    expect(lazurioSignInOf({ lazurioFolder: folder, lazurioToolsUrl: toolsUrl })).toEqual({
      toolsUrl,
    });
    // Without the page T3 still never offers its own sign-in; it only has nowhere to link.
    expect(lazurioSignInOf({ lazurioFolder: folder })).toEqual({ toolsUrl: undefined });
  });
});

describe("a ChatGPT account only T3 uses, on a Lazurio Environment", () => {
  const signedIn = { auth: { status: "authenticated" as const } };
  it("can still be disconnected while a managed Codex instance is signed in to it", () => {
    expect(t3AccountToDisconnect("managed", signedIn)).toBe(true);
  });

  it("is nothing to disconnect once signed out, or when Codex uses its own CLI's sign-in", () => {
    expect(t3AccountToDisconnect("managed", { auth: { status: "unauthenticated" } })).toBe(false);
    expect(t3AccountToDisconnect("managed", { auth: { status: "unknown" } })).toBe(false);
    expect(t3AccountToDisconnect("managed", undefined)).toBe(false);
    // The CLI's sign-in belongs to the CLI and Lazurio, not to T3.
    expect(t3AccountToDisconnect("existing", signedIn)).toBe(false);
    expect(t3AccountToDisconnect(undefined, signedIn)).toBe(false);
  });
});
