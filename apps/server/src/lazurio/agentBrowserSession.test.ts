// @effect-diagnostics nodeBuiltinImport:off -- the fake Claude CLI uses Node streams and events
import * as NodeCrypto from "node:crypto";
import * as NodeEvents from "node:events";
import * as NodeStream from "node:stream";

import type { SpawnedProcess, SpawnOptions } from "@anthropic-ai/claude-agent-sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  CodexSettings,
  EnvironmentId,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import { AgentScope, type AgentScopeShape } from "@t3tools/shared/AgentScope";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexReplay from "effect-codex-app-server/replay";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../config.ts";
import * as ClaudeAdapterV2 from "../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import * as CodexAdapterV2 from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as AgentScopeLive from "../process/agentScope.ts";
import * as ProcessRunner from "../processRunner.ts";
import {
  AGENT_BROWSER_SESSION_ENV,
  agentBrowserSessionName,
  codexThreadConfig,
  decorateAgentScope,
  setTerminalSession,
} from "./agentBrowserSession.ts";

const threadId = ThreadId.make("4a1f9c2e-7b3d-4e5f-8a6b-9c0d1e2f3a4b");
const sessionName = "t3-4a1f9c2e-7b3d-4e5f-8a6b-9c0d1e2f3a4b";
const otherThreadId = ThreadId.make("5b2e0d3f-8c4e-4f6a-9b7c-0d1e2f3a4b5c");
const otherSessionName = "t3-5b2e0d3f-8c4e-4f6a-9b7c-0d1e2f3a4b5c";

const codexSettings = Schema.decodeSync(CodexSettings)({});
const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
  runtimeMode: "full-access",
  interactionMode: "default",
  cwd: "/workspace",
});

describe("agent-browser session name", () => {
  it("is t3- and the thread id when the id already fits agent-browser's grammar", () => {
    assert.strictEqual(agentBrowserSessionName(threadId), sessionName);
    assert.strictEqual(agentBrowserSessionName("under_score-and-dash"), "t3-under_score-and-dash");
    assert.strictEqual(agentBrowserSessionName("x".repeat(61)), `t3-${"x".repeat(61)}`);
  });

  it("keeps a readable start of a sanitized or cut id and never gives two threads one session", () => {
    // Imported threads are `import:<provider instance>:<provider session>`, and an instance id
    // may take 64 characters: cutting alone would give every such thread the same name.
    const longInstance = `codex-${"w".repeat(58)}`;
    const ids = [
      "thread.with:colons/and/slashes",
      "thread:with:colons:and:slashes",
      "thread-with-colons-and-slashes",
      "vlákno-č",
      "vlákno-ř",
      "emoji-\u{1F642}",
      "x".repeat(62),
      "x".repeat(100),
      `import:codex:${threadId}`,
      `import:${longInstance}:019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a70`,
      `import:${longInstance}:019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a71`,
      // Two imported ids whose 32-bit FNV-1a suffixes collided (review of Lazurio/t3code#41).
      `import:codex-${"w".repeat(58)}:f64cccd6-59c8-42a7-aa0e-319969aeccc9`,
      `import:codex-${"w".repeat(58)}:3c4a8834-35dc-418d-a6dd-d8d1934ab83f`,
    ];
    const names = ids.map(agentBrowserSessionName);
    for (const name of names) assert.match(name, /^t3-[A-Za-z0-9_-]{1,61}$/);
    assert.strictEqual(new Set(names).size, ids.length);
    // A readable start, then 32 hex digits of the exact id's SHA-256.
    assert.match(names[0] ?? "", /^t3-thread-with-colons-and-slash-[0-9a-f]{32}$/);
    assert.strictEqual(names[2], "t3-thread-with-colons-and-slashes");
    assert.match(names[7] ?? "", new RegExp(`^t3-${"x".repeat(28)}-[0-9a-f]{32}$`));
    assert.strictEqual(
      names[0],
      `t3-thread-with-colons-and-slash-${NodeCrypto.createHash("sha256")
        .update("thread.with:colons/and/slashes", "utf8")
        .digest("hex")
        .slice(0, 32)}`,
    );
    // The same thread always gets the same session.
    assert.deepStrictEqual(ids.map(agentBrowserSessionName), names);
  });
});

describe("a thread's terminal", () => {
  // The environment the terminal manager built for the thread's shell.
  const terminalEnvironment = () => ({ PATH: "/usr/bin", TERM: "xterm-256color" });

  it("carries the thread's session, the one the thread's agents carry", () => {
    const env: NodeJS.ProcessEnv = terminalEnvironment();
    setTerminalSession(env, threadId, "linux");
    assert.deepStrictEqual(env, {
      ...terminalEnvironment(),
      [AGENT_BROWSER_SESSION_ENV]: sessionName,
    });
    // Another thread's terminal has that thread's own, and an imported thread's id is named as
    // for its agents.
    const imported = `import:codex:${otherThreadId}`;
    const other: NodeJS.ProcessEnv = terminalEnvironment();
    setTerminalSession(other, imported, "darwin");
    assert.strictEqual(other[AGENT_BROWSER_SESSION_ENV], agentBrowserSessionName(imported));
    // A session the server inherited never names the thread's terminal.
    const inherited: NodeJS.ProcessEnv = { ...terminalEnvironment(), AGENT_BROWSER_SESSION: "x" };
    setTerminalSession(inherited, threadId, "linux");
    assert.strictEqual(inherited[AGENT_BROWSER_SESSION_ENV], sessionName);
  });

  it("leaves the environment of a terminal without a thread, and on Windows, as it is", () => {
    for (const thread of [undefined, ""]) {
      const env: NodeJS.ProcessEnv = terminalEnvironment();
      setTerminalSession(env, thread, "linux");
      assert.deepStrictEqual(env, terminalEnvironment());
    }
    const windows: NodeJS.ProcessEnv = terminalEnvironment();
    setTerminalSession(windows, threadId, "win32");
    assert.deepStrictEqual(windows, terminalEnvironment());
  });
});

/** A directory with an executable `name` in it, removed with the test's scope. */
const executableIn = (name: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "lazurio-agent-bin-" });
    const file = path.join(directory, name);
    yield* fileSystem.writeFileString(file, "#!/bin/sh\n");
    yield* fileSystem.chmod(file, 0o755);
    return { directory, file };
  });

/** An agent scope that returns every launch as it is and records what it was asked. */
const recordingAgentScope = () => {
  const inputs: Array<Parameters<AgentScopeShape["wrap"]>[0]> = [];
  const cleared: Array<string> = [];
  const shape: AgentScopeShape = {
    wrap: (input) =>
      Effect.sync(() => {
        inputs.push(input);
        return { command: input.command, args: input.args };
      }),
    oomKilled: (thread) => Effect.succeed(thread === "oom-killed-thread"),
    clear: (thread) =>
      Effect.sync(() => {
        cleared.push(thread);
      }),
  };
  return { inputs, cleared, layer: Layer.succeed(AgentScope, shape) };
};

/** The server's AgentScope as server.ts builds it, around `inner`, on `platform`. */
const decorated = <R>(inner: Layer.Layer<never, never, R>, platform: NodeJS.Platform = "linux") =>
  Effect.service(AgentScope).pipe(
    Effect.provide(decorateAgentScope(inner)),
    Effect.provideService(HostProcess.Platform, platform),
  );

describe("the server's agent scope", () => {
  it.effect("starts a thread's agent under env with the thread's session", () =>
    Effect.gen(function* () {
      const { directory } = yield* executableIn("pi");
      const inner = recordingAgentScope();
      const scope = yield* decorated(inner.layer);

      const launch = yield* scope.wrap({
        command: "pi",
        args: ["--mode", "rpc"],
        name: "pi",
        threadId,
        env: { PATH: directory },
      });

      assert.deepStrictEqual(launch, {
        command: "/usr/bin/env",
        args: [`${AGENT_BROWSER_SESSION_ENV}=${sessionName}`, "pi", "--mode", "rpc"],
      });
      // The rest of the scope is upstream's.
      assert.strictEqual(inner.inputs.length, 1);
      assert.isTrue(yield* scope.oomKilled("oom-killed-thread"));
      yield* scope.clear(threadId);
      assert.deepStrictEqual(inner.cleared, [threadId]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("leaves processes without a thread, Codex's shared app-server and Windows alone", () =>
    Effect.gen(function* () {
      const { directory } = yield* executableIn("agent");
      const inner = recordingAgentScope();
      const launch = { command: "agent", args: ["--serve"] };
      const linux = yield* decorated(inner.layer);
      const windows = yield* decorated(inner.layer, "win32");

      // A terminal or a server of no thread (OpenCode) passes no thread.
      assert.deepStrictEqual(
        yield* linux.wrap({ ...launch, name: "terminal", env: { PATH: directory } }),
        launch,
      );
      // One Codex app-server serves every thread of its instance.
      assert.deepStrictEqual(
        yield* linux.wrap({ ...launch, name: "codex", threadId, env: { PATH: directory } }),
        launch,
      );
      assert.deepStrictEqual(
        yield* windows.wrap({ ...launch, name: "claude", threadId, env: { PATH: directory } }),
        launch,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("leaves a command that does not resolve to fail at spawn as upstream's", () =>
    Effect.gen(function* () {
      const { directory } = yield* executableIn("agent");
      const scope = yield* decorated(recordingAgentScope().layer);
      const missing = { command: "missing-agent", args: [], name: "muse", threadId };

      assert.deepStrictEqual(yield* scope.wrap({ ...missing, env: { PATH: directory } }), {
        command: "missing-agent",
        args: [],
      });
      assert.deepStrictEqual(
        yield* scope.wrap({ ...missing, command: `${directory}/missing-agent` }),
        { command: `${directory}/missing-agent`, args: [] },
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("wraps upstream's Linux agent scope, which runs the agent in a systemd scope", () =>
    Effect.gen(function* () {
      const { directory } = yield* executableIn("agent");
      const fileSystem = yield* FileSystem.FileSystem;
      for (const tool of ["systemd-run", "systemctl"]) {
        yield* fileSystem.writeFileString(`${directory}/${tool}`, "");
        yield* fileSystem.chmod(`${directory}/${tool}`, 0o755);
      }
      // A user manager that accepts every scope and knows no unit.
      const runner = ProcessRunner.ProcessRunner.of({
        run: ({ args }) =>
          Effect.succeed({
            stdout: args[1] === "show" ? "LoadState=not-found\nActiveState=inactive\n" : "",
            stderr: "",
            code: ChildProcessSpawner.ExitCode(0),
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            stdoutInvalidUtf8: false,
            stderrInvalidUtf8: false,
          }),
      });
      const upstream = Layer.effect(AgentScope, AgentScopeLive.make);
      const scope = yield* decorated(upstream).pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, runner),
        Effect.provideService(HostProcess.Environment, {
          PATH: directory,
          XDG_RUNTIME_DIR: "/run/user/1",
        }),
      );

      const launch = yield* scope.wrap({ command: "agent", args: [], name: "acp", threadId });

      assert.strictEqual(launch.command, "/usr/bin/env");
      assert.deepStrictEqual(launch.args.slice(0, 3), [
        `${AGENT_BROWSER_SESSION_ENV}=${sessionName}`,
        "/bin/sh",
        "-c",
      ]);
      assert.isTrue(launch.args.some((arg) => arg.startsWith("--unit=t3code-acp-")));
      assert.strictEqual(launch.args.at(-1), `${directory}/agent`);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "lazurio-agent-scope-" }).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  );
});

const mcpSessionOf = (thread: ThreadId) => ({
  environmentId: EnvironmentId.make("environment-agent-browser"),
  threadId: thread,
  providerSessionId: `mcp-${thread}`,
  providerInstanceId: CodexAdapterV2.CODEX_DEFAULT_INSTANCE_ID,
  endpoint: "http://127.0.0.1:1/mcp",
  authorizationHeader: "Bearer fixture",
  browserToolsAvailable: true,
});

/** Codex's answer to `thread/start`. */
const startedThread = (id: number, nativeThreadId: string) => ({
  type: "emit_inbound" as const,
  label: `thread/start ${nativeThreadId}`,
  frame: {
    id,
    result: {
      thread: {
        id: nativeThreadId,
        sessionId: nativeThreadId,
        forkedFromId: null,
        preview: "",
        ephemeral: false,
        modelProvider: "openai",
        createdAt: 1782622440,
        updatedAt: 1782622440,
        status: { type: "idle" },
        path: `/tmp/${nativeThreadId}.jsonl`,
        cwd: "/workspace",
        cliVersion: "0.144.0",
        source: "vscode",
        threadSource: null,
        agentNickname: null,
        agentRole: null,
        gitInfo: null,
        name: null,
        turns: [],
      },
      model: "gpt-5.4",
      modelProvider: "openai",
      serviceTier: null,
      cwd: "/workspace",
      instructionSources: [],
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: { type: "workspaceWrite", writableRoots: [], networkAccess: false },
      reasoningEffort: "medium",
    },
  },
});

/** The `thread/start` Codex must receive for a thread: its config names the thread's session. */
const threadStart = (id: number, session: string) => ({
  type: "expect_outbound" as const,
  label: `thread/start ${session}`,
  frame: {
    id,
    method: "thread/start",
    params: {
      config: {
        ...CodexAdapterV2.CODEX_THREAD_CONFIG,
        "shell_environment_policy.set.AGENT_BROWSER_SESSION": session,
      },
    },
  },
});

describe("Codex threads", () => {
  it("name their own session in their thread config, and only with a thread's session", () => {
    assert.deepStrictEqual(codexThreadConfig(undefined), {});
    assert.deepStrictEqual(
      CodexAdapterV2.codexThreadRuntimeParams({ mcpSession: mcpSessionOf(threadId) }).config[
        "shell_environment_policy.set.AGENT_BROWSER_SESSION"
      ],
      sessionName,
    );
    assert.notProperty(
      CodexAdapterV2.codexThreadRuntimeParams({ mcpSession: undefined }).config,
      "shell_environment_policy.set.AGENT_BROWSER_SESSION",
    );
  });

  it.effect("start their one app-server without any thread's session", () =>
    Effect.gen(function* () {
      const { directory, file } = yield* executableIn("codex");
      const spawned: Array<{ readonly command: string; readonly args: ReadonlyArray<string> }> = [];
      // The spawn boundary: what the app-server would start with. Refusing keeps it unstarted.
      const spawner = ChildProcessSpawner.make((command) => {
        if (ChildProcess.isStandardCommand(command)) {
          spawned.push({ command: command.command, args: command.args });
        }
        return Effect.fail(
          PlatformError.systemError({ _tag: "NotFound", module: "ChildProcess", method: "spawn" }),
        );
      });
      const factory = yield* CodexAdapterV2.CodexAppServerClientFactory.pipe(
        Effect.provide(
          CodexAdapterV2.layerAppServerClientFactory.pipe(
            Layer.provide(decorateAgentScope(recordingAgentScope().layer)),
          ),
        ),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(
          ProviderEventLoggers.ProviderEventLoggers,
          ProviderEventLoggers.NoOpProviderEventLoggers,
        ),
      );

      yield* factory
        .open({
          instanceId: CodexAdapterV2.CODEX_DEFAULT_INSTANCE_ID,
          threadId,
          providerSessionId: ProviderSessionId.make("provider-session-agent-browser"),
          runtimePolicy,
          settings: { ...codexSettings, binaryPath: file },
          environment: { PATH: directory },
        })
        .pipe(Effect.scoped, Effect.exit);

      assert.deepStrictEqual(
        spawned.map((launch) => launch.command),
        [file],
      );
      assert.notInclude(spawned[0]?.args.join(" "), AGENT_BROWSER_SESSION_ENV);
    }).pipe(
      Effect.scoped,
      Effect.provide(NodeServices.layer),
      Effect.provideService(HostProcess.Platform, "linux"),
    ),
  );

  it.effect("on one app-server each start a thread that names its own session", () =>
    Effect.gen(function* () {
      const mcpSessions = yield* McpProviderSessions.McpProviderSessions;
      yield* mcpSessions.set(mcpSessionOf(threadId));
      yield* mcpSessions.set(mcpSessionOf(otherThreadId));
      // The replay fails the request when a frame differs from the one it expects.
      const transcript: CodexReplay.CodexAppServerReplayTranscript = {
        provider: "codex",
        protocol: "codex.app-server",
        version: "0.144.0",
        scenario: "lazurio-agent-browser-session",
        entries: [
          {
            type: "expect_outbound",
            label: "initialize",
            frame: {
              id: 1,
              method: "initialize",
              params: {
                clientInfo: { name: "T3 Code", title: "T3 Code", version: "ignored" },
                capabilities: {
                  experimentalApi: true,
                  optOutNotificationMethods: ["turn/diff/updated"],
                  extensions: {
                    "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
                  },
                },
              },
            },
          },
          {
            type: "emit_inbound",
            label: "initialize",
            frame: {
              id: 1,
              result: {
                userAgent: "T3 Code/0.156.1",
                codexHome: "/tmp/codex-home",
                platformFamily: "unix",
                platformOs: "linux",
              },
            },
          },
          { type: "expect_outbound", label: "initialized", frame: { method: "initialized" } },
          threadStart(2, sessionName),
          startedThread(2, "native-thread-one"),
          threadStart(3, otherSessionName),
          startedThread(3, "native-thread-two"),
        ],
      };
      const clientFactory: CodexAdapterV2.CodexAppServerClientFactoryShape = {
        open: (input) =>
          Layer.build(CodexReplay.layerReplay(transcript)).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapter.ProviderAdapterOpenSessionError({
                  driver: CodexAdapterV2.CODEX_DRIVER_KIND,
                  providerSessionId: input.providerSessionId,
                  cause,
                }),
            ),
            Effect.flatMap((context) =>
              Effect.service(CodexClient.CodexAppServerClient).pipe(Effect.provide(context)),
            ),
          ),
      };
      const adapter = yield* CodexAdapterV2.makeCodexAdapterV2({
        instanceId: CodexAdapterV2.CODEX_DEFAULT_INSTANCE_ID,
        settings: codexSettings,
        environment: {},
        clientFactory,
        crypto: yield* Crypto.Crypto,
        fileSystem: yield* FileSystem.FileSystem,
        idAllocator: yield* IdAllocator.IdAllocatorV2,
        serverConfig: yield* ServerConfig.ServerConfig,
      });
      const modelSelection = {
        instanceId: CodexAdapterV2.CODEX_DEFAULT_INSTANCE_ID,
        model: "gpt-5.4",
      };
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("provider-session-shared"),
        modelSelection,
        runtimePolicy,
      });

      const first = yield* runtime.ensureThread({ threadId, modelSelection, runtimePolicy });
      const second = yield* runtime.ensureThread({
        threadId: otherThreadId,
        modelSelection,
        runtimePolicy,
      });

      assert.strictEqual(first.nativeThreadRef?.nativeId, "native-thread-one");
      assert.strictEqual(second.nativeThreadRef?.nativeId, "native-thread-two");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          IdAllocator.layer,
          McpProviderSessions.layer,
          ServerConfig.layerTest(process.cwd(), { prefix: "lazurio-codex-session-" }),
        ).pipe(Layer.provideMerge(NodeServices.layer)),
      ),
    ),
  );
});

// Stands in for the Claude CLI behind the SDK's spawn hook: records how it was started and
// answers its control requests.
function makeFakeClaudeCli() {
  const spawns: Array<SpawnOptions> = [];
  const spawn = (options: SpawnOptions): SpawnedProcess => {
    spawns.push(options);
    const stdin = new NodeStream.PassThrough();
    const stdout = new NodeStream.PassThrough();
    const child = Object.assign(new NodeEvents.EventEmitter(), {
      stdin,
      stdout,
      killed: false,
      exitCode: null as number | null,
      kill: () => {
        stdout.end();
        child.emit("exit", null, "SIGTERM");
        return true;
      },
    });
    let pending = "";
    stdin.on("data", (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
        const frame = JSON.parse(pending.slice(0, end));
        pending = pending.slice(end + 1);
        if (frame.type !== "control_request") continue;
        const response = { subtype: "success", request_id: frame.request_id, response: {} };
        stdout.write(`${JSON.stringify({ type: "control_response", response })}\n`);
      }
    });
    stdin.on("end", () => {
      stdout.end();
      child.emit("exit", 0, null);
    });
    return child;
  };
  return { spawn, spawns };
}

/** Opens and closes a Claude Code session of the thread through the server's agent scope. */
const startClaude = (pathToClaudeCodeExecutable: string, environment: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const cli = makeFakeClaudeCli();
    const runner = yield* ClaudeAdapterV2.ClaudeAgentSdkQueryRunner;
    const session = yield* runner.open({
      threadId,
      providerSessionId: ProviderSessionId.make("provider-session-claude-agent-browser"),
      options: {
        ...ClaudeAdapterV2.makeClaudeQueryOptions({
          modelSelection: {
            instanceId: ProviderInstanceId.make(ClaudeAdapterV2.CLAUDE_PROVIDER),
            model: "claude-sonnet-4-6",
          },
          nativeThreadId: "native-thread-claude-agent-browser",
          resume: false,
          cwd: null,
          environment,
        }),
        pathToClaudeCodeExecutable,
        spawnClaudeCodeProcess: cli.spawn,
      },
    });
    yield* session.close;
    return cli.spawns;
  }).pipe(
    Effect.provide(
      ClaudeAdapterV2.layerQueryRunner.pipe(
        Layer.provide(decorateAgentScope(recordingAgentScope().layer)),
      ),
    ),
    Effect.provideService(
      ProviderEventLoggers.ProviderEventLoggers,
      ProviderEventLoggers.NoOpProviderEventLoggers,
    ),
  );

describe("Claude Code", () => {
  it.effect("as a native binary starts with the thread's session", () =>
    Effect.gen(function* () {
      const { directory, file } = yield* executableIn("claude");

      const spawns = yield* startClaude(file, { PATH: directory });

      assert.strictEqual(spawns.length, 1);
      assert.strictEqual(spawns[0]?.command, "/usr/bin/env");
      assert.deepStrictEqual(spawns[0]?.args.slice(0, 2), [
        `${AGENT_BROWSER_SESSION_ENV}=${sessionName}`,
        file,
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("through a script entry starts without one: the SDK runs it through node", () =>
    Effect.gen(function* () {
      const spawns = yield* startClaude("/opt/claude/cli.js", { PATH: "/usr/bin" });

      assert.strictEqual(spawns.length, 1);
      assert.notStrictEqual(spawns[0]?.command, "/usr/bin/env");
      assert.isTrue(spawns[0]?.args.includes("/opt/claude/cli.js"));
      assert.notInclude(spawns[0]?.args.join(" "), AGENT_BROWSER_SESSION_ENV);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
