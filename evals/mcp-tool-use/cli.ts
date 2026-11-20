#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off
// A plain async driver of child processes and wall-clock timeouts, not an Effect program.
// @effect-diagnostics globalDate:off
// @effect-diagnostics globalTimers:off
// @effect-diagnostics extendsNativeError:off
/**
 * Runs mcp-tool-use cases through the installed `claude -p` and `codex exec` instead of the API
 * replay. Each sample gets a loopback MCP server that lists this checkout's T3 tools and answers
 * them with run.ts's own answerToolCall; the case's prior turns become a session the CLI resumes;
 * run.ts's grader grades the calls. See README.md, "Real CLIs".
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeUtil from "node:util";
import * as NodeZlib from "node:zlib";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient } from "effect/http";

import { buildCodexAdditionalContext } from "../../apps/server/src/provider/CodexDeveloperInstructions.ts";
import {
  answerToolCall,
  buildBase,
  buildMessages,
  gradeSample,
  makeSample,
  McpToolUseCase,
  normalizeToolInput,
  normalizeToolName,
  pastedText,
  t3SystemAppend,
  worldFilePaths,
} from "./run.ts";

type Model = Parameters<typeof t3SystemAppend>[0];
type Base = Parameters<typeof makeSample>[1];
type Sample = ReturnType<typeof makeSample>;
type Block = { readonly type: string; readonly [key: string]: unknown };
type Message = ReturnType<typeof buildMessages>[number];

const T3_PREFIX = "mcp__t3-code__";
// CodexAdapterV2 (CODEX_DIRECT_ONLY_T3_TOOLS) registers these on a second, direct-only server.
const CODEX_DIRECT_ONLY = ["t3_thread_wait", "delegate_task"];
const PROGRAM_SHIMS = ["gh", "pnpm", "npm", "npx", "yarn", "bun", "wrangler", "vercel", "alchemy"];
const LIMIT = /rate.?limit|usage limit|overloaded|\b429\b|\b529\b|capacity|quota/i;
// Env from an enclosing agent session that would make the child CLI think it is nested.
const INHERITED =
  /^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_AGENT_SDK_VERSION|CODEX_.*)$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const valueText = (value: unknown) =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? "");
const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
const isCodex = (model: string) => model.startsWith("gpt-");
const sh = (cmd: string, args: ReadonlyArray<string>, cwd?: string) =>
  NodeChildProcess.execFileSync(cmd, args, { encoding: "utf8", cwd }).trim();

type Usage = { input: number; output: number; cacheWrite: number; cacheRead: number };
const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });

/** A graded call, as run.ts records one. */
type Call = {
  step: number;
  tool: string;
  input: unknown;
  id?: string;
  failed?: boolean;
  output?: string;
  at: number;
};

const decodeCase = Schema.decodeUnknownSync(McpToolUseCase);
const REPO = NodePath.resolve(import.meta.dirname, "../..");

export const loadCases = (files: ReadonlyArray<string>, wanted?: ReadonlyArray<string>) =>
  files
    .flatMap((file) =>
      NodeFS.readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => decodeCase(JSON.parse(line))),
    )
    .filter(({ id }) => wanted === undefined || wanted.includes(id))
    .map((testCase) => ({
      ...testCase,
      setup: {
        ...testCase.setup,
        priorTurns: (testCase.setup.priorTurns ?? []).map((turn) => ({
          ...turn,
          toolCalls: (turn.toolCalls ?? []).map((call) =>
            call.resultFile === undefined
              ? call
              : {
                  ...call,
                  result: NodeFS.readFileSync(NodePath.join(REPO, call.resultFile), "utf8"),
                },
          ),
        })),
      },
    }));

const template = () =>
  JSON.parse(
    NodeZlib.gunzipSync(
      NodeFS.readFileSync(NodePath.join(import.meta.dirname, "templates", "claude.json.gz")),
    ).toString("utf8"),
  ).request.provider_native as Parameters<typeof buildBase>[0];

/**
 * run.ts's base for the case, with the template's own reminders dropped: the CLI adds its own.
 * T3's tools, their visibility, and the case's gitStatus and context stay run.ts's.
 */
export const cliBase = (testCase: McpToolUseCase, model: Model, effort: string): Base => {
  const { setup } = testCase;
  if (setup.world?.devices !== undefined || setup.world?.backgroundTasks !== undefined)
    throw new Error(`${testCase.id}: device and background-task worlds need run.ts.`);
  if (setup.role === "native-subagent")
    throw new Error(`${testCase.id}: native-subagent cases need run.ts.`);
  const built = buildBase(template(), {
    model,
    keepUserInstructions: false,
    subagent: setup.role === "delegated-child",
    links: setup.linkedEnvironments === true,
    deviceAccess: setup.world?.deviceAgentAccess !== false,
    browserAccess: setup.world?.browserAgentAccess !== false,
  });
  const base = { ...built, reminders: [], gitStatusAt: 0 };
  // answerToolCall reads `codex` for Codex-shaped results (capabilities, caller provider).
  return (isCodex(model) ? { ...base, codex: { reasoning: { effort } } } : base) as Base;
};

/** One call the mock server answered. */
type ServerCall = Call & { readonly server: string };

/** Loopback MCP server (streamable HTTP, JSON responses) answering T3 tools from one sample. */
const serveMcp = async (sample: Sample, codex: boolean) => {
  const calls: Array<ServerCall> = [];
  const alwaysLoaded = new Set(
    sample.base.nativeTools.map((tool) => tool.name).filter((name) => name.startsWith(T3_PREFIX)),
  );
  const tools = sample.base.t3.map((tool) => ({
    name: tool.name.slice(T3_PREFIX.length),
    description: tool.description,
    inputSchema: tool.input_schema,
    ...(alwaysLoaded.has(tool.name) ? { _meta: { "anthropic/alwaysLoad": true } } : {}),
  }));
  // The CLI loads tools itself, so every T3 tool counts as loaded for answerToolCall.
  for (const tool of sample.base.deferred) sample.tools.push(tool);
  const config = {
    apiKey: "",
    model: sample.base.model,
    effort: "high",
    maxSteps: 0,
    shellModel: "claude-haiku-5-5",
  } as unknown as Parameters<typeof answerToolCall>[1];
  let nextId = 0;
  const handle = async (server: string, message: Record<string, unknown>) => {
    const params = isRecord(message.params) ? message.params : {};
    switch (message.method) {
      case "initialize":
        return {
          protocolVersion: params.protocolVersion ?? "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: server, version: "eval" },
        };
      case "ping":
        return {};
      case "tools/list":
        return { tools };
      case "tools/call": {
        const name = valueText(params.name);
        const input = isRecord(params.arguments) ? params.arguments : {};
        const call: ServerCall = {
          server,
          step: 0,
          at: Date.now(),
          tool: normalizeToolName(`${T3_PREFIX}${name}`),
          input: normalizeToolInput(`${T3_PREFIX}${name}`, input),
        };
        calls.push(call);
        const result = await Effect.runPromise(
          answerToolCall(sample, config, {
            type: "tool_use",
            id: `toolu_cli_${nextId++}`,
            name: `${T3_PREFIX}${name}`,
            input,
          }).pipe(Effect.provide(FetchHttpClient.layer)),
        );
        const output = valueText(result.content);
        call.failed = result.is_error === true;
        call.output = output;
        const structured = (() => {
          try {
            const parsed: unknown = JSON.parse(output);
            return isRecord(parsed) ? parsed : undefined;
          } catch {
            return undefined;
          }
        })();
        return {
          content: [{ type: "text", text: output }],
          ...(call.failed ? { isError: true } : {}),
          ...(codex && !call.failed && structured ? { structuredContent: structured } : {}),
        };
      }
      default:
        throw Object.assign(new Error(`Unknown method ${valueText(message.method)}`), {
          code: -32601,
        });
    }
  };
  const server = NodeHttp.createServer((request, response) => {
    const name = request.url?.startsWith("/direct") ? "t3-code-direct" : "t3-code";
    if (request.method !== "POST") {
      response.writeHead(request.method === "DELETE" ? 200 : 405).end();
      return;
    }
    const chunks: Array<Buffer> = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      void (async () => {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const messages = (Array.isArray(body) ? body : [body]).filter(isRecord);
        const replies = await Promise.all(
          messages
            .filter((message) => message.id !== undefined)
            .map(async (message) => {
              try {
                return { jsonrpc: "2.0", id: message.id, result: await handle(name, message) };
              } catch (error) {
                const code =
                  isRecord(error) && typeof error.code === "number" ? error.code : -32603;
                return { jsonrpc: "2.0", id: message.id, error: { code, message: String(error) } };
              }
            }),
        );
        if (replies.length === 0) {
          response.writeHead(202).end();
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(Array.isArray(body) ? replies : replies[0]));
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    calls,
    url: `http://127.0.0.1:${port}/mcp`,
    directUrl: `http://127.0.0.1:${port}/direct/mcp`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

/** The prompt is the last user message's text; everything before it is resumed history. */
const splitPrompt = (testCase: McpToolUseCase, messages: ReadonlyArray<Message>) => {
  const last = messages.at(-1);
  if (
    testCase.prompt === "" ||
    last?.role !== "user" ||
    last.content.some((b) => b.type !== "text")
  )
    throw new Error(`${testCase.id}: the CLI adapter needs a case that ends with a user prompt.`);
  return {
    history: messages.slice(0, -1),
    prompt: last.content.map((block) => valueText(block.text)).join("\n\n"),
  };
};

/** A Claude Code session file holding the case's history, for `claude --resume`. */
const writeClaudeSession = (cwd: string, history: ReadonlyArray<Message>, version: string) => {
  const sessionId = NodeCrypto.randomUUID();
  const dir = NodePath.join(
    NodeOS.homedir(),
    ".claude",
    "projects",
    cwd.replace(/[^a-zA-Z0-9]/g, "-"),
  );
  NodeFS.mkdirSync(dir, { recursive: true });
  let parentUuid: string | null = null;
  const start = Date.now() - history.length * 1000;
  // The template masks native tool names; the CLI knows them by their own (ToolSearch, Bash).
  const named = history.map((message) => ({
    ...message,
    content: message.content.map((block) =>
      block.type === "tool_use" && !valueText(block.name).startsWith(T3_PREFIX)
        ? { ...block, name: normalizeToolName(valueText(block.name)) }
        : block,
    ),
  }));
  const lines = named.map((message, i) => {
    const uuid = NodeCrypto.randomUUID();
    const toolUse = message.content.some((block) => block.type === "tool_use");
    const line = {
      parentUuid,
      isSidechain: false,
      userType: "external",
      cwd,
      sessionId,
      version,
      entrypoint: "sdk-cli",
      type: message.role,
      message:
        message.role === "user"
          ? { role: "user", content: message.content }
          : {
              id: `msg_eval_${i}`,
              type: "message",
              role: "assistant",
              model: "claude-eval-history",
              content: message.content,
              stop_reason: toolUse ? "tool_use" : "end_turn",
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 },
            },
      uuid,
      timestamp: new Date(start + i * 1000).toISOString(),
    };
    parentUuid = uuid;
    return JSON.stringify(line);
  });
  const file = NodePath.join(dir, `${sessionId}.jsonl`);
  NodeFS.writeFileSync(file, `${lines.join("\n")}\n`);
  return { sessionId, file, dir };
};

/** run.ts's Codex rendering of a prior call: a code-mode cell, files as shell commands. */
const codexCell = (name: string, input: unknown) => {
  const args = isRecord(input) ? input : {};
  if (name === "Bash")
    return `text(await tools.exec_command(${JSON.stringify({ ...args, cmd: args.command })}));`;
  if (["Read", "Write", "Edit"].includes(name)) {
    const file = valueText(args.file_path);
    const command =
      name === "Read"
        ? `cat ${JSON.stringify(file)}`
        : name === "Write"
          ? `cat > ${JSON.stringify(file)} <<'EVAL_EOF'\n${valueText(args.content)}\nEVAL_EOF`
          : `python3 -c ${JSON.stringify(`from pathlib import Path; p=Path(${JSON.stringify(file)}); p.write_text(p.read_text().replace(${JSON.stringify(args.old_string)}, ${JSON.stringify(args.new_string)}))`)}`;
    return `text(await tools.exec_command(${JSON.stringify({ cmd: command })}));`;
  }
  return `text(await tools.${name.replace(T3_PREFIX, "mcp__t3_code__")}(${JSON.stringify(input)}));`;
};

const codexItems = (messages: ReadonlyArray<Message>): Array<Block> =>
  messages.flatMap((message) =>
    message.content.flatMap((block): Array<Block> => {
      if (block.type === "tool_use") {
        const name = valueText(block.name);
        const bare = name.startsWith(T3_PREFIX)
          ? name.slice(T3_PREFIX.length)
          : normalizeToolName(name);
        // Prior ToolSearch round trips are Claude's; Codex loads tools on its own.
        if (bare === "ToolSearch") return [];
        // As run.ts renders it: direct-only tools too become a cell, a valid but approximate shape.
        return [
          {
            type: "custom_tool_call",
            call_id: block.id,
            name: "exec",
            input: codexCell(name.startsWith(T3_PREFIX) ? name : bare, block.input),
          },
        ];
      }
      if (block.type === "tool_result") {
        if (Array.isArray(block.content)) return [];
        return [
          {
            type: "custom_tool_call_output",
            call_id: block.tool_use_id,
            output: valueText(block.content),
          },
        ];
      }
      if (block.type !== "text" || block.text === "Tool loaded.") return [];
      return [
        {
          type: "message",
          role: message.role,
          content: [
            {
              type: message.role === "user" ? "input_text" : "output_text",
              text: valueText(block.text),
            },
          ],
        },
      ];
    }),
  );

const codexProvider = () => {
  for (const file of [
    NodePath.join(NodeOS.homedir(), ".codex", "config.toml"),
    "/etc/codex/config.toml",
  ]) {
    const match = NodeFS.existsSync(file)
      ? /^model_provider\s*=\s*"([^"]+)"/m.exec(NodeFS.readFileSync(file, "utf8"))
      : null;
    if (match) return match[1]!;
  }
  return "openai";
};

/** A Codex rollout with T3's developer context and the case's history, for `codex exec resume`. */
const writeCodexRollout = (
  cwd: string,
  testCase: McpToolUseCase,
  model: Model,
  effort: string,
  history: ReadonlyArray<Message>,
  version: string,
) => {
  const id = NodeCrypto.randomUUID();
  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/\.\d+Z$/, "")
    .replaceAll(":", "-");
  const dir = NodePath.join(
    NodeOS.homedir(),
    ".codex",
    "sessions",
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  );
  NodeFS.mkdirSync(dir, { recursive: true });
  const context = buildCodexAdditionalContext(
    { model, reasoningEffort: effort } as Parameters<typeof buildCodexAdditionalContext>[0],
    {
      browser: testCase.setup.world?.browserAgentAccess !== false,
      device: testCase.setup.world?.deviceAgentAccess !== false,
    },
  );
  const developer = Object.entries(context).map(([key, entry]) => ({
    type: "message",
    role: "developer",
    content: [{ type: "input_text", text: `<${key}>${entry.value}</${key}>` }],
  }));
  const timestamp = now.toISOString();
  const lines = [
    {
      timestamp,
      type: "session_meta",
      payload: {
        id,
        timestamp,
        cwd,
        originator: "codex_exec",
        cli_version: version,
        source: "exec",
        model_provider: codexProvider(),
      },
    },
    ...[...developer, ...codexItems(history)].map((payload) => ({
      timestamp,
      type: "response_item",
      payload,
    })),
  ];
  const file = NodePath.join(dir, `rollout-${stamp}-${id}.jsonl`);
  NodeFS.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return { sessionId: id, file, dir };
};

/**
 * Claude Code PreToolUse hook: each Bash and Monitor command runs in bubblewrap, with no network,
 * the home directories hidden, writes only to the sample's work directory and the shims first on
 * PATH. Without its settings it denies. The transcript keeps the model's own command.
 */
const SHELL_HOOK = String.raw`
const fs = require("node:fs");
const { EVAL_WORK: work, EVAL_SHIMS: shims, EVAL_CWD: cwd } = process.env;
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const command = input.tool_input && input.tool_input.command;
const decide = (decision, extra) => process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, ...extra },
}));
if (!work || !shims || !cwd || typeof command !== "string") {
  decide("deny", { permissionDecisionReason: "The eval shell is not configured." });
} else {
  const wrapped = [
    "bwrap --die-with-parent --unshare-all --ro-bind / /",
    "--tmpfs /home --tmpfs /root --tmpfs /tmp --tmpfs /run",
    "--bind " + quote(work) + " " + quote(work) + " --dev /dev --proc /proc",
    "--setenv PATH " + quote(shims + ":/usr/local/bin:/usr/bin:/bin") + " --setenv HOME " + quote(cwd),
    "--chdir " + quote(cwd) + " -- /bin/bash -c " + quote(command),
  ].join(" ");
  const { dangerouslyDisableSandbox, ...rest } = input.tool_input;
  decide("allow", {
    permissionDecisionReason: "Runs in the eval sandbox.",
    updatedInput: { ...rest, command: wrapped },
  });
}
`;

/** The case's world files in a throwaway checkout, and PATH shims that print its shell mocks. */
const makeWorkspace = (testCase: McpToolUseCase) => {
  const work = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3cli"));
  const app = NodePath.join(work, "app");
  const shims = NodePath.join(work, "shims");
  NodeFS.mkdirSync(app);
  NodeFS.mkdirSync(shims);
  // Outside `work`, which sandboxed commands may write: the hook itself runs unsandboxed.
  const hookDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3clihook"));
  const hook = NodePath.join(hookDir, "shell-hook.cjs");
  NodeFS.writeFileSync(hook, SHELL_HOOK, { mode: 0o444 });
  const files = testCase.setup.world?.files;
  for (const [path, content] of Object.entries(isRecord(files) ? files : {})) {
    if (NodePath.isAbsolute(path)) continue;
    const target = NodePath.join(app, path);
    // A key ending in a slash is a directory; its value only describes it to the shell model.
    if (path.endsWith("/")) {
      NodeFS.mkdirSync(target, { recursive: true });
      continue;
    }
    NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
    NodeFS.writeFileSync(target, valueText(content));
  }
  const mocks = testCase.setup.shellMocks ?? [];
  const programs = new Set([
    ...PROGRAM_SHIMS,
    ...mocks.flatMap(({ match }) => /^[a-z][\w-]*/.exec(match)?.[0] ?? []),
  ]);
  mocks.forEach(({ output }, i) =>
    NodeFS.writeFileSync(NodePath.join(shims, `.mock-${i}`), output),
  );
  for (const program of programs) {
    // A shimmed program answers its own invocation: the first matching mock, else nothing.
    const checks = mocks.map(
      ({ match }, i) =>
        `if printf '%s\\n' "$cmd" | grep -Eq -- ${quote(match)}; then cat ${quote(NodePath.join(shims, `.mock-${i}`))}; exit 0; fi`,
    );
    const script = ["#!/bin/sh", `cmd=${quote(program)}" $*"`, ...checks, "exit 0", ""].join("\n");
    NodeFS.writeFileSync(NodePath.join(shims, program), script, { mode: 0o755 });
  }
  return { work, app, shims, hook, hookDir };
};

type Flags = {
  readonly model: Model;
  readonly effort: string;
  readonly label: string;
  readonly maxSteps?: number;
  readonly timeoutMs: number;
  readonly dryRun: boolean;
};

type Stream = {
  readonly events: Array<{ readonly at: number; readonly event: Record<string, unknown> }>;
  readonly stderr: Array<string>;
  exitCode: number | null;
  killedFor?: string;
};

const runCli = (
  command: string,
  args: ReadonlyArray<string>,
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly timeoutMs: number;
    readonly stopWhen: (stream: Stream) => string | undefined;
  },
) =>
  new Promise<Stream>((resolve) => {
    const child = NodeChildProcess.spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stream: Stream = { events: [], stderr: [], exitCode: null };
    const kill = (reason: string) => {
      if (stream.killedFor !== undefined) return;
      stream.killedFor = reason;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    };
    const timer = setTimeout(() => kill("timeout"), options.timeoutMs);
    NodeReadline.createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const event: unknown = JSON.parse(line);
        if (isRecord(event)) stream.events.push({ at: Date.now(), event });
      } catch {
        stream.stderr.push(line);
      }
      const reason = options.stopWhen(stream);
      if (reason !== undefined) kill(reason);
    });
    child.stderr.on("data", (chunk: Buffer) => stream.stderr.push(chunk.toString("utf8")));
    child.on("close", (code) => {
      clearTimeout(timer);
      stream.exitCode = code;
      resolve(stream);
    });
  });

const childEnv = (extra: Record<string, string>) => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !INHERITED.test(key))),
  ...extra,
});

/** Unwraps Codex's `bash -lc '<command>'` so shell checks read the agent's command. */
const unwrapShell = (command: string) => {
  const single = /^(?:\S*\/)?(?:ba|z)?sh -l?c '([\s\S]*)'$/.exec(command.trim());
  if (single) return single[1]!.replaceAll(`'\\''`, "'");
  const double = /^(?:\S*\/)?(?:ba|z)?sh -l?c "([\s\S]*)"$/.exec(command.trim());
  return double ? double[1]!.replace(/\\(["\\$`])/g, "$1") : command;
};

const limitText = (stream: Stream) =>
  stream.events
    .map(({ event }) => event)
    .filter(
      (event) =>
        (event.type === "system" && /retry/i.test(valueText(event.subtype))) ||
        event.type === "error" ||
        event.type === "turn.failed" ||
        (event.type === "result" && event.is_error === true),
    )
    .map(valueText)
    .find((text) => LIMIT.test(text));

const runClaude = async (
  testCase: McpToolUseCase,
  flags: Flags,
  sample: Sample,
  ws: ReturnType<typeof makeWorkspace>,
  server: Awaited<ReturnType<typeof serveMcp>>,
  history: ReadonlyArray<Message>,
  prompt: string,
) => {
  const version = sh("claude", ["--version"]).split(" ")[0]!;
  const session = history.length > 0 ? writeClaudeSession(ws.app, history, version) : undefined;
  const sessionId = session?.sessionId ?? NodeCrypto.randomUUID();
  const { world } = testCase.setup;
  const hook = `${quote(process.execPath)} ${quote(ws.hook)}`;
  const maxSteps = flags.maxSteps ?? testCase.maxSteps ?? 6;
  const args = [
    "-p",
    prompt,
    ...(session ? ["--resume", sessionId] : ["--session-id", sessionId]),
    "--model",
    flags.model,
    "--effort",
    flags.effort,
    "--output-format",
    "stream-json",
    "--verbose",
    "--append-system-prompt",
    t3SystemAppend(
      flags.model,
      world?.deviceAgentAccess !== false,
      world?.browserAgentAccess !== false,
    ),
    "--mcp-config",
    JSON.stringify({ mcpServers: { "t3-code": { type: "http", url: server.url } } }),
    "--strict-mcp-config",
    "--setting-sources",
    "project,local",
    "--settings",
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: "Bash|Monitor", hooks: [{ type: "command", command: hook }] }],
      },
    }),
    "--permission-mode",
    "acceptEdits",
    "--permission-prompts",
    "none",
    "--allowedTools",
    "mcp__t3-code",
    "--disable-slash-commands",
    "--max-turns",
    String(maxSteps),
  ];
  const env = childEnv({ EVAL_WORK: ws.work, EVAL_SHIMS: ws.shims, EVAL_CWD: ws.app });
  if (flags.dryRun) return { args, sessionFile: session?.file, stream: undefined };
  const stream = await runCli("claude", args, {
    cwd: ws.app,
    env,
    timeoutMs: flags.timeoutMs,
    stopWhen: (s) => (limitText(s) ? "limit" : undefined),
  });
  const sessionFile = NodePath.join(
    NodeOS.homedir(),
    ".claude",
    "projects",
    ws.app.replace(/[^a-zA-Z0-9]/g, "-"),
    `${sessionId}.jsonl`,
  );
  // Native calls come from the stream; T3 calls from the server, as they ran.
  const native: Array<Call> = [];
  const results = new Map<string, { failed: boolean; output: string }>();
  const said: Array<string> = [];
  const steps: Array<number> = [];
  const seen = new Set<string>();
  let result: Record<string, unknown> | undefined;
  for (const { at, event } of stream.events) {
    const message = isRecord(event.message) ? event.message : {};
    const content = Array.isArray(message.content) ? message.content.filter(isRecord) : [];
    if (event.type === "assistant") {
      const id = valueText(message.id);
      if (!seen.has(id)) {
        seen.add(id);
        steps.push(at);
      }
      for (const block of content) {
        if (block.type === "text") said.push(valueText(block.text));
        if (block.type !== "tool_use") continue;
        const name = valueText(block.name);
        if (name.startsWith(T3_PREFIX)) continue;
        native.push({
          step: seen.size - 1,
          at,
          id: valueText(block.id),
          tool: normalizeToolName(name),
          input: normalizeToolInput(name, block.input),
        });
      }
    }
    if (event.type === "user")
      for (const block of content)
        if (block.type === "tool_result")
          results.set(valueText(block.tool_use_id), {
            failed: block.is_error === true,
            output: valueText(block.content),
          });
    if (event.type === "result") result = event;
  }
  for (const call of native) Object.assign(call, results.get(call.id ?? "") ?? {});
  const stepAt = (at: number) => Math.max(0, steps.filter((t) => t <= at).length - 1);
  const calls = [
    ...native,
    ...server.calls.map(({ server: _server, ...call }) => ({ ...call, step: stepAt(call.at) })),
  ].toSorted((a, b) => a.at - b.at);
  const subtype = valueText(result?.subtype);
  const usage = isRecord(result?.usage) ? result.usage : {};
  return {
    args,
    sessionFile,
    stream,
    run: {
      calls,
      text: said.join("\n\n"),
      stopReason:
        subtype === "success"
          ? "end_turn"
          : subtype === "error_max_turns"
            ? "max_steps"
            : subtype || "no_result",
      finalText: subtype === "success" ? valueText(result?.result) : "",
    },
    usage: {
      input: Number(usage.input_tokens ?? 0),
      output: Number(usage.output_tokens ?? 0),
      cacheWrite: Number(usage.cache_creation_input_tokens ?? 0),
      cacheRead: Number(usage.cache_read_input_tokens ?? 0),
    },
    cli: {
      costUsd: result?.total_cost_usd,
      durationMs: result?.duration_ms,
      durationApiMs: result?.duration_api_ms,
      numTurns: result?.num_turns,
      modelUsage: result?.modelUsage,
    },
  };
};

const runCodex = async (
  testCase: McpToolUseCase,
  flags: Flags,
  sample: Sample,
  ws: ReturnType<typeof makeWorkspace>,
  server: Awaited<ReturnType<typeof serveMcp>>,
  history: ReadonlyArray<Message>,
  prompt: string,
) => {
  const version = sh("codex", ["--version"]).split(" ").at(-1)!;
  const rollout = writeCodexRollout(ws.app, testCase, flags.model, flags.effort, history, version);
  const timeoutSec = 65 * 60;
  const config = [
    `model_reasoning_effort="${flags.effort}"`,
    `sandbox_mode="read-only"`,
    `approval_policy="never"`,
    // CODEX_THREAD_CONFIG in CodexAdapterV2.
    "tools.update_plan.enabled=true",
    "mcp_optional_startup_grace_ms=10000",
    "features.concurrent_reasoning_summaries=true",
    // The station's own MCP servers stay out of the sample.
    "mcp_servers.executor.enabled=false",
    "mcp_servers.computer.enabled=false",
    `mcp_servers.t3-code={url=${JSON.stringify(server.url)},tool_timeout_sec=${timeoutSec},disabled_tools=${JSON.stringify(CODEX_DIRECT_ONLY)},default_tools_approval_mode="approve"}`,
    `mcp_servers.t3-code-direct={url=${JSON.stringify(server.directUrl)},tool_timeout_sec=${timeoutSec},enabled_tools=${JSON.stringify(CODEX_DIRECT_ONLY)},omit_tools_from=["code_mode","deferred"],default_tools_approval_mode="approve"}`,
    // T3 runs Codex with full access, where MCP calls need no approval; under read-only they
    // would, and `never` refuses them. The sandbox still holds the shell to read-only.
    "suppress_unstable_features_warning=true",
    `shell_environment_policy.set.PATH=${JSON.stringify(`${ws.shims}:/usr/local/bin:/usr/bin:/bin`)}`,
  ];
  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "-m",
    flags.model,
    ...config.flatMap((value) => ["-c", value]),
    "resume",
    rollout.sessionId,
    prompt,
  ];
  if (flags.dryRun) return { args, sessionFile: rollout.file, stream: undefined };
  const cap = (flags.maxSteps ?? testCase.maxSteps ?? 10) + 4;
  const toolItems = (s: Stream) =>
    s.events.filter(
      ({ event }) =>
        event.type === "item.started" &&
        isRecord(event.item) &&
        ["command_execution", "mcp_tool_call", "file_change", "web_search"].includes(
          valueText(event.item.type),
        ),
    ).length;
  const stream = await runCli("codex", args, {
    cwd: ws.app,
    env: childEnv({}),
    timeoutMs: flags.timeoutMs,
    stopWhen: (s) =>
      limitText(s)
        ? "limit"
        : Math.max(toolItems(s), server.calls.length) > cap
          ? "max_steps"
          : undefined,
  });
  const native: Array<Call> = [];
  const said: Array<string> = [];
  const usage = emptyUsage();
  const raw: Array<unknown> = [];
  let completed = false;
  for (const { at, event } of stream.events) {
    const item = isRecord(event.item) ? event.item : {};
    if (event.type === "item.completed" && item.type === "agent_message")
      said.push(valueText(item.text));
    if (event.type === "item.completed" && item.type === "command_execution")
      native.push({
        step: native.length,
        at,
        tool: "Bash",
        input: { command: unwrapShell(valueText(item.command)) },
        failed: item.exit_code !== 0,
        output: valueText(item.aggregated_output),
      });
    if (event.type === "turn.completed") completed = true;
  }
  // Codex records each response's usage in the rollout, also when the runner stops it mid-turn.
  for (const line of NodeFS.readFileSync(rollout.file, "utf8").split("\n")) {
    if (!line.includes('"token_usage_record"')) continue;
    const record: unknown = JSON.parse(line);
    const u =
      isRecord(record) && isRecord(record.payload) && isRecord(record.payload.usage)
        ? record.payload.usage
        : {};
    raw.push(u);
    const cached = Number(u.cached_input_tokens ?? 0);
    usage.input += Number(u.input_tokens ?? 0) - cached;
    usage.cacheRead += cached;
    usage.cacheWrite += Number(u.cache_write_input_tokens ?? 0);
    usage.output += Number(u.output_tokens ?? 0);
  }
  const calls = [...native, ...server.calls.map(({ server: _server, ...call }) => call)]
    .toSorted((a, b) => a.at - b.at)
    .map((call, step) => ({ ...call, step }));
  return {
    args,
    sessionFile: rollout.file,
    stream,
    run: {
      calls,
      text: said.join("\n\n"),
      stopReason: completed ? "end_turn" : (stream.killedFor ?? "no_result"),
      finalText: completed ? (said.at(-1) ?? "") : "",
    },
    usage,
    cli: { responses: raw.length, usage: raw },
  };
};

class LimitReached extends Error {}

const runSample = async (testCase: McpToolUseCase, n: number, flags: Flags, out: string) => {
  const started = Date.now();
  const base = cliBase(testCase, flags.model, flags.effort);
  const sample = makeSample(testCase, base);
  const { history, prompt } = splitPrompt(testCase, buildMessages(sample));
  const ws = makeWorkspace(testCase);
  const server = await serveMcp(sample, isCodex(flags.model));
  const dir = NodePath.join(out, "samples", `${testCase.id}-${n}`);
  NodeFS.mkdirSync(dir, { recursive: true });
  try {
    const runner = isCodex(flags.model) ? runCodex : runClaude;
    const outcome = await runner(testCase, flags, sample, ws, server, history, prompt);
    NodeFS.writeFileSync(
      NodePath.join(dir, "command.json"),
      JSON.stringify({ cwd: ws.app, args: outcome.args }, null, 2),
    );
    // The session the CLI resumed and continued: moved out of the CLI's home with the sample.
    if (outcome.sessionFile && NodeFS.existsSync(outcome.sessionFile)) {
      NodeFS.copyFileSync(outcome.sessionFile, NodePath.join(dir, "session.jsonl"));
      NodeFS.rmSync(outcome.sessionFile);
      // Claude Code keeps the sample's subagent transcripts and auto-memory beside it, in a
      // project folder named after the sample's checkout; the rest of it moves out too.
      const parent = NodePath.dirname(outcome.sessionFile);
      if (parent.includes("t3cli")) {
        if (NodeFS.readdirSync(parent).length > 0)
          NodeFS.cpSync(parent, NodePath.join(dir, "claude-project"), { recursive: true });
        NodeFS.rmSync(parent, { recursive: true, force: true });
      }
    }
    if (outcome.stream === undefined || !("run" in outcome)) return undefined;
    const { stream } = outcome;
    NodeFS.writeFileSync(
      NodePath.join(dir, "stream.jsonl"),
      stream.events.map(({ at, event }) => JSON.stringify({ at, ...event })).join("\n"),
    );
    NodeFS.writeFileSync(NodePath.join(dir, "stderr.txt"), stream.stderr.join(""));
    const run = { ...outcome.run, cwd: ws.app, linked: [...sample.linked] };
    const limit = stream.killedFor === "limit" ? limitText(stream) : undefined;
    const error =
      limit ??
      (stream.killedFor === "timeout"
        ? "timeout"
        : run.stopReason === "no_result"
          ? `no result (exit ${stream.exitCode}): ${stream.stderr.join("").slice(-500)}`
          : undefined);
    const checks = gradeSample(
      testCase.expect,
      run as Parameters<typeof gradeSample>[1],
      pastedText(testCase),
      worldFilePaths(testCase),
    );
    const row = {
      id: testCase.id,
      kind: testCase.kind,
      pattern: testCase.pattern,
      role: testCase.setup.role,
      label: flags.label,
      model: flags.model,
      harness: isCodex(flags.model) ? "codex exec" : "claude -p",
      pass: error === undefined && checks.every((check) => check.pass),
      ...(error === undefined ? {} : { error }),
      checks,
      durationMs: Date.now() - started,
      usage: outcome.usage,
      cli: outcome.cli,
      ...run,
      mcpCalls: server.calls.length,
    };
    NodeFS.writeFileSync(NodePath.join(dir, "row.json"), JSON.stringify(row, null, 2));
    if (limit !== undefined) throw Object.assign(new LimitReached(limit), { row });
    return row;
  } finally {
    await server.close();
    NodeFS.rmSync(ws.work, { recursive: true, force: true });
    NodeFS.rmSync(ws.hookDir, { recursive: true, force: true });
  }
};

type Row = NonNullable<Awaited<ReturnType<typeof runSample>>>;

const summarize = (rows: ReadonlyArray<Row>, header: string) => {
  const byCase = Map.groupBy(rows, (row) => row.id);
  const sum = (key: keyof Usage) => rows.reduce((total, row) => total + row.usage[key], 0);
  const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;
  const cost = rows.reduce((total, row) => {
    const cli: unknown = row.cli;
    return total + (isRecord(cli) && typeof cli.costUsd === "number" ? cli.costUsd : 0);
  }, 0);
  return [
    "# MCP tool-use eval through the CLI\n",
    `- ${header}`,
    `- Pass: ${rows.filter((row) => row.pass).length} of ${rows.filter((row) => row.error === undefined).length} finished samples; ${rows.filter((row) => row.error !== undefined).length} errored.`,
    `- Wall time per sample: ${rows.map((row) => seconds(row.durationMs)).join(", ")}.`,
    `- Tokens: input ${sum("input")}, output ${sum("output")}, cache write ${sum("cacheWrite")}, cache read ${sum("cacheRead")}.`,
    ...(cost > 0 ? [`- Claude Code's own cost estimate (API prices): $${cost.toFixed(2)}.`] : []),
    "",
    "| Case | Pass | Failed checks |",
    "| --- | --- | --- |",
    ...[...byCase].map(
      ([id, members]) =>
        `| ${id} | ${members.filter((row) => row.pass).length}/${members.length} | ${[
          ...new Set(
            members.flatMap((row) => [
              ...(row.error ? [`error: ${row.error.slice(0, 80)}`] : []),
              ...row.checks.filter((check) => !check.pass).map((check) => check.check),
            ]),
          ),
        ]
          .join("; ")
          .replaceAll("|", "\\|")} |`,
    ),
    "",
  ].join("\n");
};

const main = async () => {
  const { values } = NodeUtil.parseArgs({
    options: {
      model: { type: "string", default: "claude-sonnet-5-5" },
      cases: { type: "string", multiple: true },
      case: { type: "string", multiple: true },
      samples: { type: "string", default: "1" },
      concurrency: { type: "string", default: "1" },
      out: { type: "string" },
      effort: { type: "string" },
      label: { type: "string", default: "" },
      "max-steps": { type: "string" },
      "timeout-min": { type: "string", default: "10" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  if (values.out === undefined) throw new Error("Pass --out <directory>.");
  const model = values.model as Model;
  const concurrency = Math.min(2, Math.max(1, Number(values.concurrency)));
  const casesDir = NodePath.join(import.meta.dirname, "cases");
  const files =
    values.cases ??
    NodeFS.readdirSync(casesDir)
      .filter((name) => name.endsWith(".ndjson"))
      .toSorted()
      .map((name) => NodePath.join(casesDir, name));
  const wanted = values.case?.flatMap((ids) => ids.split(","));
  const harness = isCodex(model) ? "codex" : "claude";
  const cases = loadCases(files, wanted).filter(
    ({ setup }) => setup.harness === undefined || setup.harness === harness,
  );
  if (cases.length === 0) throw new Error("No case matches.");
  // run.ts's defaults: high for Claude, the Codex template's own effort for Codex.
  const effort = values.effort ?? (isCodex(model) ? "xhigh" : "high");
  const flags: Flags = {
    model,
    effort,
    label: values.label,
    ...(values["max-steps"] === undefined ? {} : { maxSteps: Number(values["max-steps"]) }),
    timeoutMs: Number(values["timeout-min"]) * 60_000,
    dryRun: values["dry-run"],
  };
  const out = NodePath.resolve(values.out);
  NodeFS.mkdirSync(out, { recursive: true });
  const queue = cases.flatMap((testCase) =>
    Array.from({ length: Number(values.samples) }, (_, n) => ({ testCase, n })),
  );
  const rows: Array<Row> = [];
  let stopped: string | undefined;
  const worker = async () => {
    while (queue.length > 0 && stopped === undefined) {
      const { testCase, n } = queue.shift()!;
      try {
        const row = await runSample(testCase, n, flags, out);
        if (row === undefined) {
          process.stdout.write(`${testCase.id}-${n}: dry run, see ${out}/samples\n`);
          continue;
        }
        rows.push(row);
        process.stdout.write(
          `${testCase.id}-${n}: ${row.error ? `ERROR ${row.error.slice(0, 120)}` : row.pass ? "pass" : "FAIL"} (${Math.round(row.durationMs / 1000)} s)\n`,
        );
      } catch (error) {
        if (error instanceof LimitReached) {
          stopped = error.message;
          rows.push((error as LimitReached & { row: Row }).row);
          process.stdout.write(
            `${testCase.id}-${n}: LIMIT, stopping: ${error.message.slice(0, 200)}\n`,
          );
        } else {
          // One sample's failure is that sample's error, not the run's end.
          const row = {
            id: testCase.id,
            kind: testCase.kind,
            pattern: testCase.pattern,
            role: testCase.setup.role,
            label: flags.label,
            model: flags.model,
            pass: false,
            error: `runner: ${String(error)}`.slice(0, 1000),
            checks: [],
            durationMs: 0,
            usage: emptyUsage(),
          } as unknown as Row;
          rows.push(row);
          const dir = NodePath.join(out, "samples", `${testCase.id}-${n}`);
          NodeFS.mkdirSync(dir, { recursive: true });
          NodeFS.writeFileSync(NodePath.join(dir, "row.json"), JSON.stringify(row, null, 2));
          process.stdout.write(`${testCase.id}-${n}: ERROR ${String(error).slice(0, 160)}\n`);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (flags.dryRun) return;
  const commit = sh("git", ["describe", "--always", "--dirty"], REPO);
  const cliVersion = isCodex(model) ? sh("codex", ["--version"]) : sh("claude", ["--version"]);
  const header = `Checkout \`${commit}\`${flags.label ? ` (${flags.label})` : ""}, ${model} at ${effort} effort through ${cliVersion}, ${values.samples} sample(s) per case, concurrency ${concurrency}.${stopped ? ` Stopped at a provider limit: ${stopped.slice(0, 200)}` : ""}`;
  NodeFS.appendFileSync(
    NodePath.join(out, "results.jsonl"),
    rows.map((row) => `${JSON.stringify(row)}\n`).join(""),
  );
  NodeFS.writeFileSync(NodePath.join(out, "summary.md"), summarize(rows, header));
  process.stdout.write(`\n${summarize(rows, header)}`);
  if (stopped) process.exitCode = 2;
};

if (import.meta.main) await main();
