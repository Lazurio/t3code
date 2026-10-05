import type { Options as ClaudeQueryOptions } from "@anthropic-ai/claude-agent-sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ClaudeSettings,
  CodexSettings,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderSession,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as CodexErrors from "effect-codex-app-server/errors";

import * as ServerConfig from "../config.ts";
import * as McpProviderSession from "../mcp/McpProviderSession.ts";
import * as ProviderSessionRuntime from "../persistence/ProviderSessionRuntime.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import type { ProviderAdapterError } from "../provider/Errors.ts";
import { makeClaudeAdapter } from "../provider/Layers/ClaudeAdapter.ts";
import { makeCodexAdapter } from "../provider/Layers/CodexAdapter.ts";
import type { CodexSessionRuntimeOptions } from "../provider/Layers/CodexSessionRuntime.ts";
import * as ProviderEventLoggers from "../provider/Layers/ProviderEventLoggers.ts";
import { makeProviderServiceLive } from "../provider/Layers/ProviderService.ts";
import { ProviderSessionDirectoryLive } from "../provider/Layers/ProviderSessionDirectory.ts";
import type { ProviderAdapterShape } from "../provider/Services/ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "../provider/Services/ProviderAdapterRegistry.ts";
import * as ProviderService from "../provider/Services/ProviderService.ts";
import { ProviderSessionDirectory } from "../provider/Services/ProviderSessionDirectory.ts";
import { makeAdapterRegistryMock } from "../provider/testUtils/providerAdapterRegistryMock.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AnalyticsService from "../telemetry/AnalyticsService.ts";
import {
  AGENT_BROWSER_SESSION_ENV,
  agentBrowserSessionName,
  withAgentBrowserSession,
} from "./agentBrowserSession.ts";

const codexSettings = Schema.decodeSync(CodexSettings)({});
const claudeSettings = Schema.decodeSync(ClaudeSettings)({});
const threadId = ThreadId.make("4a1f9c2e-7b3d-4e5f-8a6b-9c0d1e2f3a4b");
const sessionName = "t3-4a1f9c2e-7b3d-4e5f-8a6b-9c0d1e2f3a4b";

/** The per-thread config ProviderService records when the MCP credential is issued. */
const providerSession = (
  instanceId: ProviderInstanceId,
  extra: Partial<McpProviderSession.McpProviderSessionConfig> = {},
): McpProviderSession.McpProviderSessionConfig => ({
  environmentId: EnvironmentId.make("environment-browser-test"),
  threadId,
  providerSessionId: "provider-session-browser-test",
  providerInstanceId: instanceId,
  endpoint: "http://127.0.0.1:1/mcp",
  authorizationHeader: "Bearer fixture",
  capabilities: new Set(["pull-requests"]),
  ...extra,
});

/** Records the session for the length of `effect`, as ProviderService does around a session. */
const withRecordedSession = <A, E, R>(
  config: McpProviderSession.McpProviderSessionConfig,
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.sync(() => McpProviderSession.setMcpProviderSession(config)).pipe(
    Effect.andThen(effect),
    Effect.ensuring(Effect.sync(() => McpProviderSession.clearMcpProviderSession(config.threadId))),
  );

const testBaseDir = { prefix: "lazurio-agent-browser-" } as const;

describe("agent-browser session name", () => {
  it("is t3- and the thread id, sanitized to agent-browser's grammar, at most 64 long", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      [threadId, sessionName],
      ["thread.with:colons/and/slashes", "t3-thread-with-colons-and-slashes"],
      ["under_score and space", "t3-under_score-and-space"],
      ["vlákno-č", "t3-vl-kno--"],
      ["emoji-\u{1F642}", "t3-emoji---"],
      ["x".repeat(100), `t3-${"x".repeat(61)}`],
      ["", "t3-"],
    ];
    for (const [id, expected] of cases) {
      const name = agentBrowserSessionName(id);
      assert.deepStrictEqual([id, name], [id, expected]);
      assert.match(name, /^[A-Za-z0-9_-]{1,64}$/);
    }
  });

  it("joins the thread's provider-session environment and keeps the device variables", () => {
    const device = {
      PATH: "/t3/device/bin",
      PATH_SEPARATOR: ":",
      AGENT_DEVICE_DAEMON_BASE_URL: "http://127.0.0.1:9000",
    };
    const recorded = providerSession(ProviderInstanceId.make("codex"), {
      agentDeviceEnvironment: device,
    });
    const withSession = withAgentBrowserSession(recorded);
    assert.deepStrictEqual(withSession.agentDeviceEnvironment, {
      ...device,
      [AGENT_BROWSER_SESSION_ENV]: sessionName,
    });
    assert.deepStrictEqual(recorded.agentDeviceEnvironment, device);
    // What every adapter spreads into a provider process: the thread's name wins over an
    // inherited one, and without device access nothing else is added.
    assert.deepStrictEqual(
      McpProviderSession.withAgentDeviceEnvironment(
        { PATH: "/usr/bin", AGENT_BROWSER_SESSION: "inherited" },
        withAgentBrowserSession(providerSession(ProviderInstanceId.make("codex"))),
      ),
      { PATH: "/usr/bin", AGENT_BROWSER_SESSION: sessionName },
    );
  });
});

describe("ProviderService", () => {
  it.effect("records the thread's session before the adapter starts it", () =>
    Effect.gen(function* () {
      const codexInstanceId = ProviderInstanceId.make("codex");
      const environments: Array<NodeJS.ProcessEnv> = [];
      // Starts the provider the way every adapter does: the recorded provider session's
      // environment over the instance's own.
      const adapter: ProviderAdapterShape<ProviderAdapterError> = {
        provider: ProviderDriverKind.make("codex"),
        capabilities: { sessionModelSwitch: "in-session" },
        startSession: (input) =>
          Effect.sync(() => {
            environments.push(
              McpProviderSession.withAgentDeviceEnvironment(
                { PATH: "/usr/bin" },
                McpProviderSession.readMcpProviderSession(input.threadId),
              ),
            );
            const now = "2026-01-01T00:00:00.000Z";
            return {
              provider: ProviderDriverKind.make("codex"),
              providerInstanceId: codexInstanceId,
              status: "ready",
              runtimeMode: input.runtimeMode,
              threadId: input.threadId,
              resumeCursor: { opaque: "resume" },
              createdAt: now,
              updatedAt: now,
            } satisfies ProviderSession;
          }),
        sendTurn: () => Effect.die("unused"),
        interruptTurn: () => Effect.void,
        respondToRequest: () => Effect.void,
        respondToUserInput: () => Effect.void,
        stopSession: () => Effect.void,
        listSessions: () => Effect.succeed([]),
        hasSession: () => Effect.succeed(false),
        readThread: () => Effect.die("unused"),
        rollbackThread: () => Effect.die("unused"),
        stopAll: () => Effect.void,
        streamEvents: Stream.empty,
      };
      const providerLayer = makeProviderServiceLive({
        issueMcpCredential: (request) =>
          Effect.succeed({
            config: providerSession(request.providerInstanceId, {
              threadId: request.threadId,
              capabilities: request.capabilities,
            }),
          }),
      }).pipe(
        Layer.provide(
          Layer.succeed(
            ProviderAdapterRegistry.ProviderAdapterRegistry,
            makeAdapterRegistryMock({ [ProviderDriverKind.make("codex")]: adapter }),
          ),
        ),
        Layer.provide(
          ProviderSessionDirectoryLive.pipe(
            Layer.provide(
              ProviderSessionRuntime.layer.pipe(Layer.provide(SqlitePersistenceMemory)),
            ),
          ),
        ),
        Layer.provide(ServerSettings.layerTest()),
        Layer.provide(ServerConfig.layerTest(process.cwd(), testBaseDir)),
        Layer.provide(AnalyticsService.layerTest),
        Layer.provide(
          Layer.succeed(
            ProviderEventLoggers.ProviderEventLoggers,
            ProviderEventLoggers.NoOpProviderEventLoggers,
          ),
        ),
      );

      yield* Effect.gen(function* () {
        const provider = yield* ProviderService.ProviderService;
        yield* provider.startSession(threadId, {
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          threadId,
          runtimeMode: "full-access",
        });
      }).pipe(Effect.provide(providerLayer));

      assert.deepStrictEqual(environments, [
        { PATH: "/usr/bin", AGENT_BROWSER_SESSION: sessionName },
      ]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("provider processes", () => {
  it.effect("the Codex app-server of the thread starts with its session", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("codex");
      const started: Array<CodexSessionRuntimeOptions> = [];
      const adapter = yield* makeCodexAdapter(codexSettings, {
        // The spawn boundary: what the app-server would be started with. Refusing to start keeps
        // the test free of a running app-server.
        makeRuntime: (options) => {
          started.push(options);
          return Effect.fail(
            new CodexErrors.CodexAppServerSpawnError({
              command: `${options.binaryPath} app-server`,
              cause: new Error("not started in this test"),
            }),
          );
        },
      });

      yield* withRecordedSession(
        withAgentBrowserSession(providerSession(instanceId)),
        adapter
          .startSession({
            provider: ProviderDriverKind.make("codex"),
            threadId,
            runtimeMode: "full-access",
          })
          .pipe(Effect.exit),
      );

      assert.strictEqual(started.length, 1);
      assert.strictEqual(started[0]?.environment?.[AGENT_BROWSER_SESSION_ENV], sessionName);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          ServerConfig.layerTest(process.cwd(), testBaseDir),
          ServerSettings.layerTest(),
          Layer.succeed(ProviderSessionDirectory, {
            upsert: () => Effect.void,
            recordImportedTranscript: () => Effect.die("unused"),
            getProvider: () => Effect.die("unused"),
            getBinding: () => Effect.succeedNone,
            listThreadIds: () => Effect.succeed([]),
            listBindings: () => Effect.succeed([]),
          }),
        ).pipe(Layer.provideMerge(NodeServices.layer)),
      ),
    ),
  );

  it.effect("the Claude Code process of the thread starts with its session", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("claudeAgent");
      const started: Array<ClaudeQueryOptions> = [];
      const adapter = yield* makeClaudeAdapter(claudeSettings, {
        // The spawn boundary: the options the Claude Agent SDK would start Claude Code with.
        createQuery: (input) => {
          started.push(input.options);
          throw new Error("not started in this test");
        },
      });

      yield* withRecordedSession(
        withAgentBrowserSession(providerSession(instanceId)),
        adapter
          .startSession({
            provider: ProviderDriverKind.make("claudeAgent"),
            threadId,
            runtimeMode: "full-access",
          })
          .pipe(Effect.exit),
      );

      assert.strictEqual(started.length, 1);
      assert.strictEqual(started[0]?.env?.[AGENT_BROWSER_SESSION_ENV], sessionName);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          ServerConfig.layerTest(process.cwd(), testBaseDir),
          ServerSettings.layerTest(),
        ).pipe(Layer.provideMerge(NodeServices.layer)),
      ),
    ),
  );
});
