import { describe, expect, it } from "vite-plus/test";

import { resolveSiblingLaunchpadUrl } from "./workspaceNavigation";

describe("resolveSiblingLaunchpadUrl", () => {
  it("maps a hosted Team T3 origin to its Launchpad sibling", () => {
    expect(
      resolveSiblingLaunchpadUrl(
        "http://t3code.management.iotorlazurio.lazurio.io:3773/thread?secret=no#fragment",
      ),
    ).toBe("http://launchpad.management.iotorlazurio.lazurio.io/");
    expect(
      resolveSiblingLaunchpadUrl(
        "https://t3code.management.iotorlazurio.lazurio.io/thread?secret=no#fragment",
      ),
    ).toBe("https://launchpad.management.iotorlazurio.lazurio.io/");
  });

  it("leaves local and unrelated T3 installations without a hosted link", () => {
    expect(resolveSiblingLaunchpadUrl("http://127.0.0.1:3773/thread")).toBeNull();
    expect(resolveSiblingLaunchpadUrl("https://app.t3.codes/thread")).toBeNull();
    expect(resolveSiblingLaunchpadUrl("not a URL")).toBeNull();
  });
});
