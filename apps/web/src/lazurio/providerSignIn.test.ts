import { describe, expect, it } from "vite-plus/test";

import { lazurioSignInOf } from "./providerSignIn";

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
