import { describe, expect, it } from "vite-plus/test";

import {
  commandUsesBrowser,
  isBrowserUse,
  openedTabOf,
  trackBrowserUse,
  type BrowserUseTracker,
  type ThreadActivity,
} from "./browserUse";

const session = "t3-4a1f9c2e-7b3d-4e5f-8a6b-9c0d1e2f3a4b";

describe("a command that uses the browser", () => {
  it("runs agent-browser on a page, however the shell wraps and quotes it", () => {
    for (const command of [
      "agent-browser open https://example.com",
      // Codex runs every command through a login shell.
      `/bin/bash -lc "agent-browser --cdp 9222 --session ${session} open 'https://example.com/?q=a b'"`,
      `/bin/zsh -lc 'agent-browser --session ${session} snapshot -i'`,
      "bash -c 'cd /srv/app && agent-browser click @e2'",
      'sh -ec "sleep 1; agent-browser screenshot --full"',
      "bash -euo pipefail -c 'agent-browser get url | head -n 1'",
      `AGENT_BROWSER_SESSION=${session} agent-browser fill @e3 "a b"`,
      "env -u NO_COLOR agent-browser eval 'document.title'",
      "timeout 30 agent-browser wait --load networkidle",
      "sudo -u person agent-browser press Enter",
      "nohup agent-browser scroll down 400 > /dev/null 2>&1 &",
      "~/.local/bin/agent-browser reload",
      "/usr/local/bin/agent-browser --json find role button click --name Submit",
      "npx -y agent-browser@latest back",
      'echo "Title: $(agent-browser get title)"',
      "URL=`agent-browser get url` && echo $URL",
      "diff <(agent-browser get text @e1) expected.txt",
      "if agent-browser is visible '#done'; then echo ready; fi",
      "(cd /srv && agent-browser tab new https://example.com)",
      "{ agent-browser hover @e4; }",
      'agent-browser batch "open https://example.com" "snapshot -i"',
      "agent-browser --headed true chat 'find a photo'",
      "ls\nagent-browser open https://example.com",
      "agent-browser \\\n  --cdp 9222 \\\n  open https://example.com",
      "eval 'agent-browser forward'",
      `lazurio browser window --session ${session} --url https://example.com --json`,
      `/home/person/.local/bin/lazurio browser window --session ${session}`,
    ]) {
      expect([command, commandUsesBrowser(command)]).toEqual([command, true]);
    }
  });

  it("runs from an argument list as well", () => {
    expect(commandUsesBrowser(["bash", "-lc", "agent-browser open https://example.com"])).toBe(
      true,
    );
    expect(commandUsesBrowser(["agent-browser", "snapshot"])).toBe(true);
    expect(commandUsesBrowser(["rg", "agent-browser open", "docs"])).toBe(false);
  });

  it("is no other command, even one that names agent-browser or a browser", () => {
    for (const command of [
      'grep -rn "agent-browser open" docs/',
      "echo 'agent-browser open https://example.com'",
      "cat ~/.agent-browser/config.json",
      "ls node_modules/agent-browser",
      "which agent-browser",
      "command -v agent-browser",
      "npm install -g agent-browser",
      'git commit -m "Use agent-browser open in the docs"',
      "ps aux | grep agent-browser",
      "my-agent-browser open https://example.com",
      "agent-browser-dev open https://example.com",
      "firefox --new-window https://example.com",
      "xdg-open https://example.com",
      "open -a 'Google Chrome' https://example.com",
      "chromium --headless --dump-dom https://example.com",
      "echo browser > notes.txt",
      // A here-document is data: writing notes about agent-browser does not run it.
      "cat > notes.md <<'EOF'\nagent-browser open https://example.com\nEOF",
      "cat <<-EOF > notes.md\n\tagent-browser snapshot\n\tEOF\necho done",
      "# agent-browser open https://example.com",
      "bash script.sh agent-browser",
      "ssh host agent-browser open https://example.com",
      "",
      "   ",
    ]) {
      expect([command, commandUsesBrowser(command)]).toEqual([command, false]);
    }
  });

  it("is not an agent-browser command that works on no page", () => {
    for (const command of [
      "agent-browser",
      "agent-browser --version",
      "agent-browser -V",
      "agent-browser --help",
      "agent-browser open --help",
      "agent-browser install --with-deps",
      "agent-browser upgrade",
      "agent-browser doctor --json",
      "agent-browser skills get core",
      "agent-browser mcp",
      "agent-browser session list",
      `agent-browser --cdp 9222 --session ${session} close`,
      "agent-browser close --all",
      "agent-browser read https://example.com/article",
      "agent-browser state list",
      "agent-browser dashboard start",
      `lazurio browser link --json`,
      `lazurio browser window --help`,
      "lazurio doctor",
      "lazurio window browser",
    ]) {
      expect([command, commandUsesBrowser(command)]).toEqual([command, false]);
    }
  });

  it("survives a command line cut short or nested too deep", () => {
    // The activity's detail keeps the first 180 characters of a command.
    expect(
      commandUsesBrowser(`bash -lc "agent-browser --cdp 9222 open 'https://example.com/...`),
    ).toBe(true);
    const nested = (levels: number) => {
      let command = "agent-browser open https://example.com";
      for (let level = 0; level < levels; level += 1) {
        command = `bash -c ${JSON.stringify(command)}`;
      }
      return command;
    };
    expect(commandUsesBrowser(nested(3))).toBe(true);
    expect(commandUsesBrowser(nested(12))).toBe(false);
    expect(commandUsesBrowser("echo $(".repeat(5_000))).toBe(false);
  });
});

const activity = (
  id: string,
  payload: unknown,
  kind = "tool.started",
  createdAt = "2026-10-08T10:00:00.000Z",
): ThreadActivity => ({ id, kind, payload, turnId: "turn-1", createdAt });

describe("an activity that uses the browser", () => {
  it("is a call of T3's browser tools that works with a page", () => {
    for (const tool of [
      "preview_open",
      "preview_navigate",
      "preview_click",
      "preview_type",
      "preview_press",
      "preview_scroll",
      "preview_snapshot",
      "preview_evaluate",
      "preview_wait_for",
    ]) {
      // Codex names the server and the tool.
      expect(
        isBrowserUse(
          activity("codex", {
            itemType: "mcp_tool_call",
            title: `t3-code · ${tool}`,
            data: { item: { type: "mcpToolCall", server: "t3-code", tool, arguments: {} } },
          }),
        ),
      ).toBe(true);
      // Claude Code names the tool with its MCP prefix.
      expect(
        isBrowserUse(
          activity(
            "claude",
            { itemType: "mcp_tool_call", data: { toolName: `mcp__t3-code__${tool}`, input: {} } },
            "tool.updated",
          ),
        ),
      ).toBe(true);
      // Other providers may name it in the title only.
      expect(
        isBrowserUse(activity("title", { title: `t3-code · ${tool}` }, "tool.completed")),
      ).toBe(true);
    }
  });

  it("is a command execution that runs agent-browser or lazurio browser window", () => {
    const command = `/bin/bash -lc "agent-browser --cdp 9222 --session ${session} open 'https://example.com'"`;
    // Codex: the command on the item, and as the activity's detail.
    expect(
      isBrowserUse(
        activity("codex", {
          itemType: "command_execution",
          title: "Ran command",
          detail: command,
          data: { item: { command } },
        }),
      ),
    ).toBe(true);
    // Claude Code and the others: the projected command.
    expect(
      isBrowserUse(
        activity(
          "claude",
          {
            itemType: "command_execution",
            title: "Command run",
            data: { toolName: "Bash", command: "agent-browser snapshot -i" },
          },
          "tool.updated",
        ),
      ),
    ).toBe(true);
    // Only the detail, as the server keeps it.
    expect(
      isBrowserUse(
        activity("detail", {
          itemType: "command_execution",
          detail: `lazurio browser window --session ${session}`,
        }),
      ),
    ).toBe(true);
    // A command as an argument list.
    expect(
      isBrowserUse(
        activity("argv", {
          itemType: "command_execution",
          data: { item: { command: ["bash", "-lc", "agent-browser click @e1"] } },
        }),
      ),
    ).toBe(true);
  });

  it("is no other activity", () => {
    const browse = { itemType: "command_execution", data: { command: "agent-browser open x" } };
    for (const [name, value] of [
      ["an approval", activity("a", browse, "approval.requested")],
      ["a plan", activity("a", browse, "turn.plan.updated")],
      ["another kind of tool", activity("a", { ...browse, itemType: "file_change" })],
      ["a call still without its command", activity("a", { itemType: "command_execution" })],
      ["another command", activity("a", { itemType: "command_execution", detail: "ls -la" })],
      ...[
        "preview_status",
        "preview_resize",
        "preview_set_appearance",
        "preview_recording_start",
        "device_open",
      ].map(
        (tool) => [tool, activity("a", { data: { toolName: `mcp__t3-code__${tool}` } })] as const,
      ),
      [
        "another server's tool",
        activity("a", {
          itemType: "mcp_tool_call",
          title: "devtools · preview_open",
          data: { item: { server: "devtools", tool: "preview_open" } },
        }),
      ],
      [
        "another server's prefixed tool",
        activity("a", { data: { toolName: "mcp__x__preview_open" } }),
      ],
      ["no payload", activity("a", null)],
      ["a text payload", activity("a", "agent-browser open x")],
    ] as const) {
      expect([name, isBrowserUse(value)]).toEqual([name, false]);
    }
  });

  it("is no call of T3's browser tools at another Environment's view", () => {
    const foreign = `https://browser.vm-02.acme.lazurio.io/t/${"f".repeat(32)}`;
    const isForeignView = (url: string) => url === foreign;
    const call = (tool: string, input?: unknown) =>
      activity(tool, {
        itemType: "mcp_tool_call",
        data: {
          toolName: `mcp__t3-code__${tool}`,
          ...(input === undefined ? {} : { input }),
        },
      });
    // Codex names the call's arguments as it starts; Claude Code streams its input.
    const codex = activity("codex", {
      itemType: "mcp_tool_call",
      title: "t3-code · preview_open",
      data: { item: { server: "t3-code", tool: "preview_open", arguments: { url: foreign } } },
    });
    expect(isBrowserUse(codex, isForeignView)).toBe(false);
    expect(isBrowserUse(call("preview_navigate", { url: foreign }), isForeignView)).toBe(false);
    // Without a scheme, as the tools take it.
    expect(isBrowserUse(call("preview_open", { url: foreign.slice(8) }), isForeignView)).toBe(
      false,
    );
    // This Environment's pages, a call without a page, and an input not streamed yet.
    for (const input of [{ url: "https://example.com/" }, { url: 42 }, {}, undefined]) {
      expect([input, isBrowserUse(call("preview_open", input), isForeignView)]).toEqual([
        input,
        true,
      ]);
    }
    expect(isBrowserUse(codex)).toBe(true);
  });
});

describe("the tab a completed preview_open answered with", () => {
  const tabId = "C1CCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
  const foreignId = "fedcba9876543210".repeat(2);
  const foreignView = `https://browser.vm-02.acme.lazurio.io/t/${foreignId}`;
  // What clients get of a completed call: its result cut to one line, and the tab the server
  // keeps for them (`previewTab`).
  const codex = (previewTab: unknown, kind = "tool.completed", status = "completed") =>
    activity(
      "codex",
      {
        itemType: "mcp_tool_call",
        status,
        title: "t3-code · preview_open",
        toolCallId: "call-1",
        previewTab,
        data: {
          item: {
            type: "mcpToolCall",
            id: "call-1",
            server: "t3-code",
            tool: "preview_open",
            status,
            arguments: { url: "https://example.com/", reuseExistingTab: false },
            result: { content: '{"available":true,"visible":true,"tabId":"C1CCCCCCCCCCCC…' },
          },
        },
      },
      kind,
    );
  const claude = (previewTab: unknown, tool = "preview_open") =>
    activity(
      "claude",
      {
        itemType: "mcp_tool_call",
        status: "completed",
        title: "Open browser preview",
        toolCallId: "toolu_1",
        previewTab,
        data: {
          toolName: `mcp__t3-code__${tool}`,
          input: { url: foreignView, open: false },
          result: { content: `{"available":true,"visible":false,"tabId":"${foreignId}"…` },
        },
      },
      "tool.completed",
    );

  it("is read from Codex's and Claude Code's completed calls", () => {
    expect(openedTabOf(codex({ tabId, visible: true }))).toEqual({
      tabId,
      visible: true,
      view: null,
    });
    expect(openedTabOf(claude({ tabId: foreignId, visible: false, view: foreignView }))).toEqual({
      tabId: foreignId,
      visible: false,
      view: foreignView,
    });
  });

  it("is in no other activity", () => {
    const tab = { tabId, visible: true };
    for (const [name, value] of [
      ["started", codex(tab, "tool.started")],
      ["going on", codex(tab, "tool.updated")],
      ["failed", codex(tab, "tool.completed", "failed")],
      ["declined", codex(tab, "tool.completed", "declined")],
      ["another tool", claude(tab, "preview_navigate")],
      [
        "another server",
        activity(
          "x",
          { previewTab: tab, data: { toolName: "mcp__other__preview_open" } },
          "tool.completed",
        ),
      ],
      ["no tab", codex(undefined)],
      ["an empty tab", codex({ tabId: "", visible: true })],
      ["no visibility", codex({ tabId })],
      ["a tab that is text", codex(JSON.stringify(tab))],
    ] as const) {
      expect([name, openedTabOf(value)]).toEqual([name, null]);
    }
  });
});

describe("the browser use of the thread in view", () => {
  const thread = "env-1:thread-A";
  const at = (second: number) => `2026-10-08T10:00:${String(second).padStart(2, "0")}.000Z`;
  const browse = (id: string, second: number, call = id, kind = "tool.started") => ({
    ...activity(id, {
      itemType: "command_execution",
      toolCallId: call,
      data: { command: "agent-browser snapshot -i" },
    }),
    kind,
    createdAt: at(second),
  });
  const other = (id: string, second: number) => ({
    ...activity(id, { itemType: "command_execution", toolCallId: id, detail: "ls" }),
    kind: "tool.completed",
    createdAt: at(second),
  });
  const look = (
    tracker: BrowserUseTracker | null,
    activities: ReadonlyArray<ThreadActivity>,
    live = true,
    threadKey = thread,
  ) => trackBrowserUse(tracker, threadKey, activities, live);

  it("takes in what the thread shows at first and counts each later call once", () => {
    const history = [browse("old", 1), other("ls", 2)];
    const first = look(null, history);
    expect(first.used).toBe(false);
    expect(look(first.tracker, history).used).toBe(false);

    const started = look(first.tracker, [...history, browse("new", 3)]);
    expect(started.used).toBe(true);
    // The same call going on and ending does not count again.
    const ended = look(started.tracker, [
      ...history,
      browse("new", 3),
      browse("new-done", 4, "new", "tool.completed"),
    ]);
    expect(ended.used).toBe(false);
    // Nor does work that is not the browser.
    const listed = look(ended.tracker, [
      ...history,
      browse("new", 3),
      browse("new-done", 4, "new", "tool.completed"),
      other("ls-2", 5),
    ]);
    expect(listed.used).toBe(false);
    // A later call does.
    expect(
      look(listed.tracker, [
        ...history,
        browse("new", 3),
        browse("new-done", 4, "new", "tool.completed"),
        other("ls-2", 5),
        browse("next", 6),
      ]).used,
    ).toBe(true);
  });

  it("counts none of the backlog that loads with a thread", () => {
    // Opening a thread: nothing loaded yet, then its snapshot, then the events it missed.
    const empty = look(null, [], false);
    const snapshot = look(empty.tracker, [browse("a", 1), other("b", 2)], false);
    expect(snapshot.used).toBe(false);
    const caughtUp = look(snapshot.tracker, [browse("a", 1), other("b", 2), browse("c", 3)], false);
    expect(caughtUp.used).toBe(false);
    // Live now: the same activities still count for nothing, and the next call counts.
    const live = look(caughtUp.tracker, [browse("a", 1), other("b", 2), browse("c", 3)]);
    expect(live.used).toBe(false);
    expect(
      look(live.tracker, [browse("a", 1), other("b", 2), browse("c", 3), browse("d", 4)]).used,
    ).toBe(true);
  });

  it("counts no older history that loads later, such as an earlier page", () => {
    const shown = look(null, [other("recent", 30)]);
    expect(look(shown.tracker, [browse("older", 10), other("recent", 30)]).used).toBe(false);
  });

  it("starts over for another thread", () => {
    const a = look(null, [other("a", 1)]);
    const b = look(a.tracker, [browse("b", 2)], true, "env-1:thread-B");
    expect(b.used).toBe(false);
    expect(look(b.tracker, [browse("b", 2), browse("c", 3)], true, "env-1:thread-B").used).toBe(
      true,
    );
  });

  it("counts a new call that shares the newest activity's millisecond", () => {
    const shown = look(null, [other("a", 7)]);
    expect(look(shown.tracker, [other("a", 7), browse("b", 7)]).used).toBe(true);
  });

  it("takes in the tab of each new completed preview_open once, never one of the backlog", () => {
    const opened = (id: string, second: number, call: string, tabId: string) => ({
      ...activity(
        id,
        {
          itemType: "mcp_tool_call",
          status: "completed",
          toolCallId: call,
          previewTab: { tabId, visible: true },
          data: { toolName: "mcp__t3-code__preview_open", input: {} },
        },
        "tool.completed",
      ),
      createdAt: at(second),
    });
    const [a, b] = ["A".repeat(32), "B".repeat(32)];
    // A thread that loads shows calls that completed before: none opens its tab.
    const loading = look(null, [], false);
    const backlog = look(loading.tracker, [opened("a", 1, "call-a", a)], false);
    expect(backlog.opened).toEqual([]);
    const live = look(backlog.tracker, [opened("a", 1, "call-a", a)]);
    expect(live.opened).toEqual([]);
    expect(look(null, [opened("a", 1, "call-a", a)]).opened).toEqual([]);

    // A call that completes now opens its tab, once.
    const history = [opened("a", 1, "call-a", a)];
    const next = look(live.tracker, [...history, opened("b", 2, "call-b", b)]);
    expect(next.opened).toEqual([{ tabId: b, visible: true, view: null }]);
    expect(next.used).toBe(true);
    expect(look(next.tracker, [...history, opened("b", 2, "call-b", b)]).opened).toEqual([]);
    // Another row of the same call does not open it again.
    expect(
      look(next.tracker, [...history, opened("b", 2, "call-b", b), opened("b2", 3, "call-b", b)])
        .opened,
    ).toEqual([]);
  });

  it("counts a call that started in the backlog and goes on live", () => {
    const loading = look(null, [], false);
    const backlog = look(loading.tracker, [browse("start", 1, "call")], false);
    expect(
      look(backlog.tracker, [
        browse("start", 1, "call"),
        browse("update", 2, "call", "tool.updated"),
      ]).used,
    ).toBe(true);
  });
});
