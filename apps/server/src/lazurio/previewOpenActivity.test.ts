import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { projectActivityPayload } from "../orchestration/ActivityPayloadProjection.ts";

// Lazurio overlay (plan DEV-6646): clients get a thread's activities slimmed, an MCP result cut
// to one line, so the projection keeps the tab preview_open answered with for the web's right
// panel (apps/web/src/lazurio/browserUse.ts).

const tabId = "C1CCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const foreignId = "0123456789ABCDEF0123456789ABCDEF";
const foreignView = `https://browser.vm-02.acme.lazurio.io/t/${foreignId}`;
const status = {
  available: true,
  visible: true,
  tabId,
  url: "https://example.com/",
  title: "Example",
  loading: false,
};
const foreignStatus = {
  available: true,
  visible: true,
  tabId: foreignId,
  url: null,
  title: null,
  loading: false,
  view: foreignView,
  message: `Tab ${foreignId} is in the browser of another Environment (browser.vm-02.acme.lazurio.io).`,
};

function completed(payload: Record<string, unknown>): OrchestrationThreadActivity {
  return {
    id: "activity-1",
    tone: "tool",
    kind: "tool.completed",
    summary: "Open browser preview",
    payload: { itemType: "mcp_tool_call", status: "completed", toolCallId: "call-1", ...payload },
    turnId: null,
    createdAt: "2026-10-09T10:00:00.000Z",
  } as unknown as OrchestrationThreadActivity;
}

/** Codex: the MCP item with the call's arguments and the whole result. */
const codex = (result: unknown, tool = "preview_open") =>
  completed({
    title: `t3-code · ${tool}`,
    data: {
      item: {
        type: "mcpToolCall",
        id: "call-1",
        server: "t3-code",
        tool,
        status: "completed",
        arguments: { url: "https://example.com/", reuseExistingTab: false },
        result: {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        },
      },
    },
  });

/** Claude Code: the tool's name and input, and the tool_result block (ClaudeAdapter.ts). */
const claude = (result: unknown, tool = "preview_open") =>
  completed({
    title: "Open browser preview",
    data: {
      toolName: `mcp__t3-code__${tool}`,
      input: { url: foreignView },
      result: {
        type: "tool_result",
        tool_use_id: "toolu_1",
        content: [{ type: "text", text: JSON.stringify(result) }],
      },
    },
  });

const payloadOf = (activity: OrchestrationThreadActivity) =>
  activity.payload as Record<string, unknown>;

describe("a completed preview_open on its way to the clients", () => {
  it("keeps the tab it answered with and whether the person was shown it", () => {
    for (const activity of [codex(status), claude(status)]) {
      const projected = projectActivityPayload(activity);
      expect(payloadOf(projected)).toMatchObject({
        previewTab: { tabId, visible: true },
        toolIcon: { _tag: "website", pageUrl: "https://example.com/" },
      });
      expect(payloadOf(projected).previewTab).not.toHaveProperty("view");
      // The result itself is still cut to its first line.
      expect(JSON.stringify(projected.payload)).not.toContain("structuredContent");
      // Projecting again keeps it.
      expect(payloadOf(projectActivityPayload(projected)).previewTab).toEqual({
        tabId,
        visible: true,
      });
    }
    expect(payloadOf(projectActivityPayload(codex({ ...status, visible: false })))).toMatchObject({
      previewTab: { tabId, visible: false },
    });
  });

  it("keeps another Environment's view of the tab, and no page address for it", () => {
    for (const activity of [codex(foreignStatus), claude(foreignStatus)]) {
      const payload = payloadOf(projectActivityPayload(activity));
      expect(payload.previewTab).toEqual({ tabId: foreignId, visible: true, view: foreignView });
      expect(payload).not.toHaveProperty("toolIcon");
    }
  });

  it("keeps no tab of a failed call, another tool, or another server", () => {
    const failed = codex(status);
    for (const [name, activity] of [
      ["failed", { ...failed, payload: { ...payloadOf(failed), status: "failed" } }],
      ["tool error", claude({ ...status, isError: true })],
      [
        "error result",
        completed({
          data: {
            toolName: "mcp__t3-code__preview_open",
            result: { type: "tool_result", is_error: true, content: JSON.stringify(status) },
          },
        }),
      ],
      ["navigate", codex(status, "preview_navigate")],
      ["status", claude(status, "preview_status")],
      [
        "another server",
        completed({ data: { toolName: "mcp__other__preview_open", result: { content: "{}" } } }),
      ],
      ["no tab", codex({ ...status, tabId: null })],
      ["no visibility", codex({ ...status, visible: "yes" })],
      ["long tab", codex({ ...status, tabId: "x".repeat(129) })],
    ] as const) {
      expect([name, payloadOf(projectActivityPayload(activity)).previewTab]).toEqual([
        name,
        undefined,
      ]);
    }
  });
});
