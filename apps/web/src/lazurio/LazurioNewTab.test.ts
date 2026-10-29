import { describe, expect, it } from "vite-plus/test";

import { newTabTools, parseNewTabChoice } from "./LazurioNewTab";

const tabId = "0123456789ABCDEF0123456789ABCDEF";

describe("Nová karta's tools", () => {
  it("are upstream's available actions without Browser, within the element's patterns", () => {
    const action = (label: string, shortcut: string, available = true) => ({
      label,
      shortcut,
      available,
      onClick: () => undefined,
    });
    const tools = newTabTools([
      action("Browser", "B"),
      action("Terminal", "T"),
      action("Files", "F", false),
      action("Diff", "D"),
      action("Pull request", "P"),
      action("Linked pull requests", "L"),
      action("Device", "M"),
    ]);
    expect(tools).toEqual([
      { id: "terminal", label: "Terminal", key: "T", icon: "terminal" },
      { id: "diff", label: "Diff", key: "D", icon: "diff" },
      { id: "pull-request", label: "Pull request", key: "P", icon: "pull-request" },
      {
        id: "linked-pull-requests",
        label: "Linked pull requests",
        key: "L",
        icon: "linked-pull-requests",
      },
      { id: "device", label: "Device", key: "M", icon: "device" },
    ]);
    // LazurioPlatform `parseNewTabTools`: at most 12, ids and icons of [a-z0-9-], labels of at
    // most 48 characters, one letter each and no letter twice.
    expect(tools.length).toBeLessThanOrEqual(12);
    for (const tool of tools) {
      expect(tool.id).toMatch(/^[a-z0-9][a-z0-9-]{0,31}$/);
      expect(tool.label.length).toBeLessThanOrEqual(48);
      expect(tool.key).toMatch(/^[A-Za-z0-9]$/);
    }
    expect(new Set(tools.map((tool) => tool.key.toLowerCase())).size).toBe(tools.length);
  });

  it("take only the element's choices", () => {
    expect(parseNewTabChoice({ kind: "tool", id: "terminal" })).toEqual({
      kind: "tool",
      id: "terminal",
    });
    expect(parseNewTabChoice({ kind: "tab", tab: tabId.toLowerCase(), view: "x" })).toEqual({
      kind: "tab",
      tab: tabId,
      view: "x",
    });
    for (const bad of [null, {}, { kind: "page", tab: "nope", view: "x" }, { kind: "open" }]) {
      expect(parseNewTabChoice(bad)).toBeNull();
    }
  });
});
