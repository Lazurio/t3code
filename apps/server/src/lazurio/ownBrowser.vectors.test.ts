// @effect-diagnostics nodeBuiltinImport:off - the vectors are a file of the Platform's, read as its runner reads them.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { environmentOfView, ownBrowserAddress } from "./ownBrowser.ts";

// LazurioPlatform's vectors of C20 (src/browser/contract/vectors/v1/own-browser.json, MIT,
// ./platform-browser-contract/LICENSE), from Lazurio/LazurioPlatform#1262, run against the copy.
interface VectorCase {
  readonly name: string;
  readonly call: string;
  readonly args: readonly [unknown, string | null];
  readonly expect: string | null;
}
const file = JSON.parse(
  NodeFS.readFileSync(
    NodePath.join(
      import.meta.dirname,
      "platform-browser-contract",
      "vectors",
      "v1",
      "own-browser.json",
    ),
    "utf8",
  ),
) as { readonly contract: string; readonly cases: readonly VectorCase[] };

describe("LazurioPlatform C20, the pages only the person's own browser opens", () => {
  it("is the Platform's file of C20", () => {
    expect(file.contract).toBe("own-browser");
    expect(new Set(file.cases.map((entry) => entry.call))).toEqual(new Set(["ownBrowserAddress"]));
  });
  it.each(file.cases)("$name", (entry) => {
    expect(ownBrowserAddress(...entry.args)).toEqual(entry.expect);
  });
  it("reads the Environment of a view's origin", () => {
    expect(environmentOfView("https://browser.vm-01.acme.lazurio.io")).toBe("vm-01.acme");
    expect(environmentOfView("https://browser.example-person.lazurio.io")).toBe("example-person");
    expect(environmentOfView("https://browser.a.vm-01.acme.lazurio.io")).toBeNull();
    expect(environmentOfView("https://t3code.vm-01.acme.lazurio.io")).toBeNull();
  });
});
