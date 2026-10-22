// @effect-diagnostics nodeBuiltinImport:off - The CLI meets a live server over loopback HTTP and WebSocket, with its T3 home in a temporary directory.
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthOrchestrationReadScope,
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentAuthorizationError,
  EnvironmentId,
  MessageId,
  ModelSelection,
  NodeId,
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationV2DispatchCommandError,
  OrchestrationV2GetShellSnapshotError,
  OrchestrationV2RpcSchemas,
  OrchestrationV2ShellSnapshot,
  type OrchestrationV2ShellStreamItem,
  type OrchestrationV2SubscribeShellInput,
  OrchestrationV2ThreadBoundedSnapshot,
  OrchestrationV2ThreadDetailSnapshot,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  type OrchestratorMcpThreadListInput,
  type OrchestratorMcpThreadListItem,
  type OrchestratorMcpThreadReadInput,
  type OrchestratorMcpThreadSendInput,
  OrchestratorMcpFailure,
  Project,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  RpcScopeAuthorization,
  RunId,
  RuntimeRequestId,
  ServerSettings,
  ServerSettingsError,
  ThreadId,
  TurnItemId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import { assert, describe, it } from "@effect/vitest";
import { afterAll } from "vite-plus/test";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestConsole from "effect/testing/TestConsole";
import { Tool, Toolkit } from "effect/ai";
import { Command } from "effect/cli";
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Rpc, RpcGroup, RpcSerialization, RpcServer } from "effect/rpc";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as McpOAuth from "../auth/McpOAuth.ts";
import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import { cli } from "../binCli.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { callAcpMcpTool } from "../mcp/AcpMcpStdioBridge.ts";
import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import * as McpToolAccessTestkit from "../mcp/McpToolAccess.testkit.ts";
import * as OrchestratorMcpService from "../mcp/OrchestratorMcpService.ts";
import * as ThreadMetadataMcpService from "../mcp/ThreadMetadataMcpService.ts";
import * as OrchestratorHandlers from "../mcp/toolkits/orchestrator/handlers.ts";
import { OrchestratorToolkit } from "../mcp/toolkits/orchestrator/tools.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ThreadSearch from "../orchestration-v2/ThreadSearch.ts";
import * as ScheduledTasks from "../scheduledTasks/ScheduledTaskService.ts";
import {
  makePersistedServerRuntimeState,
  persistServerRuntimeState,
} from "../serverRuntimeState.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import { OrchestrationCommandReceiptRepository } from "../persistence/OrchestrationCommandReceipts.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { AGENT_CLI_EXIT_CODES, isAgentCliFailure } from "./agentCliConnection.ts";
import {
  AGENT_CLI_REQUEST_NAMESPACE,
  agentCliSendIds,
  agentCliSendKey,
  withAgentCliRequestNamespace,
} from "./agentCliRequests.ts";
import * as AgentCliSendState from "./agentCliSendState.ts";
import { addProject, buddyModel, layerBuddyServer } from "./buddySurface.testkit.ts";
import * as BuddySurfaceThreadRoute from "./buddySurfaceThreadRoute.ts";
import { BUDDY_THREAD_ID } from "./buddySurfaceThread.ts";
import { authenticateOverlayRoute } from "./routeAuth.ts";

// The agent commands are a contract for Buddy and other agents in an Environment: they act on the
// running server as its owner. These run the real `t3` CLI against a server on 127.0.0.1 over this
// T3 home's own auth: the real `/mcp` with T3's access checks, and the person's client surface for
// the thread list, permission decisions and the live stream. Only the orchestration services
// behind them are fakes.

const run = (args: ReadonlyArray<string>) =>
  Command.runWith(cli, { version: "0.0.0" })(args).pipe(
    Effect.provide(Layer.mergeAll(NodeServices.layer, NetService.layer)),
  );
const baseDirs: Array<string> = [];
const makeBaseDir = () => {
  const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-agent-cli-"));
  baseDirs.push(baseDir);
  return baseDir;
};
afterAll(() => {
  for (const baseDir of baseDirs) NodeFS.rmSync(baseDir, { recursive: true, force: true });
});
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
/** What one command printed to standard output, as JSON. */
const printedJson = <A, E, R>(command: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const before = (yield* TestConsole.logLines).length;
    const exit = yield* Effect.exit(command);
    const lines = (yield* TestConsole.logLines).slice(before);
    return { exit, output: decodeJson(lines.join("")) as Record<string, unknown> };
  });
/** The exit code `t3` ends a command with, read from its exit as `t3`'s runner reads it. */
const exitCodeOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isSuccess(exit) ? 0 : Runtime.getErrorExitCode(Cause.squash(exit.cause));

const at = (iso: string) => DateTime.makeUnsafe(iso);
const environmentId = EnvironmentId.make("environment-agent-cli-test");
const lazurio = { id: ProjectId.make("project-lazurio"), title: "Lazurio" };
const web = { id: ProjectId.make("project-web"), title: "web-app" };

const threadShell = (
  id: string,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell => ({
  ...McpToolAccessTestkit.liveThreadShell(ThreadId.make(id)),
  projectId: lazurio.id,
  title: id,
  updatedAt: at("2026-10-20T10:00:00.000Z"),
  ...overrides,
});

const listItem = (
  id: string,
  updatedAt: string,
  status: OrchestratorMcpThreadListItem["status"] = "running",
): OrchestratorMcpThreadListItem => ({
  threadId: ThreadId.make(id),
  title: id,
  createdBy: "user",
  creationSource: "web",
  status,
  latestRunId: null,
  providerInstanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5",
  runtimeMode: "full-access",
  interactionMode: "default",
  linkedPullRequest: null,
  settled: false,
  settledAt: null,
  snoozed: false,
  snoozedUntil: null,
  parentThreadId: null,
  relationshipToParent: null,
  itemCount: 3,
  createdAt: updatedAt,
  updatedAt,
});

const modelSelection = (instanceId: string, model: string): ModelSelection => ({
  instanceId: ProviderInstanceId.make(instanceId),
  model,
});
/** What a person picked as the model of new threads on this Environment. */
const environmentModel = modelSelection("claudeAgent", "claude-opus-5-5");

/** A project as `t3_project_read` returns it, with the model its own record still holds. */
const projectRecord = (
  project: { readonly id: ProjectId; readonly title: string },
  defaultModelSelection: ModelSelection | null,
): Project => ({
  ...project,
  workspaceRoot: `/${project.title}`,
  defaultModelSelection,
  scripts: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  deletedAt: null,
});

/** What the fakes behind the server hold, and what the CLI asked of them. */
const makeWorld = () => ({
  /** The Environment's settings, as the web reads them. */
  settings: {
    ...DEFAULT_SERVER_SETTINGS,
    defaultModelSelection: environmentModel,
  } as ServerSettings,
  /** The model each project's own record holds; folded settings leave it behind. */
  projectModels: new Map<string, ModelSelection>(),
  shells: new Map<string, OrchestrationV2ThreadShell>(),
  projections: new Map<string, OrchestrationV2ThreadProjection>(),
  /** Threads whose bounded snapshot leaves out their request items, as a long run's would. */
  boundedWithoutItems: new Set<string>(),
  threadsByProject: new Map<string, ReadonlyArray<OrchestratorMcpThreadListItem>>(),
  listInputs: [] as Array<OrchestratorMcpThreadListInput>,
  readInputs: [] as Array<OrchestratorMcpThreadReadInput>,
  sends: [] as Array<{
    readonly input: OrchestratorMcpThreadSendInput;
    readonly scope: McpInvocationContext.McpInvocationScope;
  }>,
  waitTimeouts: [] as Array<number | undefined>,
  launches: [] as Array<{ readonly input: unknown; readonly modes: McpToolAccess.StartedModes }>,
  /** Commands the MCP tools dispatched. */
  dispatched: [] as Array<unknown>,
  /** Commands the person's client surface dispatched. */
  ownerDispatched: [] as Array<unknown>,
  /** The projects Buddy's thread route sees, and the commands it dispatched. */
  buddyProjects: [] as Array<ProjectStore.ProjectRow>,
  buddyDispatched: [] as Array<unknown>,
  fullReads: [] as Array<string>,
  subscriptions: [] as Array<OrchestrationV2SubscribeShellInput>,
  shellStream: (
    _input: OrchestrationV2SubscribeShellInput,
    _index: number,
  ): Stream.Stream<OrchestrationV2ShellStreamItem> => Stream.empty,
});
type World = ReturnType<typeof makeWorld>;

const threadNotFound = (threadId: string) =>
  new OrchestratorMcpFailure({
    code: "thread_not_found",
    message: `Thread ${threadId} was not found.`,
  });

/** The orchestration services behind the real tools, answering from `world`. */
const orchestrationFakes = (world: World) =>
  Layer.mergeAll(
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (threadId) => Effect.succeed(world.shells.get(threadId) ?? null),
      getProjectThreadRecords: (input) => {
        const projection = world.projections.get(input.threadId);
        return projection === undefined
          ? Effect.die(`unexpected thread ${input.threadId}`)
          : Effect.succeed(projection);
      },
      dispatch: (command) =>
        Effect.sync(() => {
          world.dispatched.push(command);
          return { sequence: world.dispatched.length, storedEvents: [] };
        }),
    } satisfies Partial<ThreadManagement.ThreadManagementService["Service"]>),
    Layer.mock(OrchestratorMcpService.OrchestratorMcpService)({
      listThreads: (_scope, input) =>
        Effect.sync(() => {
          world.listInputs.push(input);
          const threads = world.threadsByProject.get(input.projectId ?? "") ?? [];
          return {
            projectId: input.projectId!,
            currentThreadId: null,
            threads: threads.slice(0, input.limit ?? 20),
            nextCursor: null,
            total: threads.length,
          };
        }),
      readThread: (_scope, input) =>
        Effect.sync(() => {
          world.readInputs.push(input);
          const shell = world.shells.get(input.threadId)!;
          return {
            thread: {
              ...listItem(input.threadId, "2026-10-20T10:00:00.000Z"),
              projectId: shell.projectId,
              activeRunId: shell.activeRunId,
              titleRegeneration: null,
              branch: null,
              worktreePath: null,
              runCount: 1,
              pendingRequestCount: 0,
              archived: false,
            },
            recentRuns: [],
            items: [],
            nextPosition: null,
            hasMore: false,
          };
        }),
      sendToThread: (scope, input) =>
        world.shells.has(input.threadId)
          ? Effect.sync(() => {
              world.sends.push({ input, scope });
              return {
                threadId: input.threadId,
                messageId: MessageId.make("message-1"),
                runId: RunId.make("run-2"),
                status: "running" as const,
                delivery: "steered" as const,
              };
            })
          : Effect.fail(threadNotFound(input.threadId)),
      waitForThread: (_scope, input) =>
        Effect.sync(() => {
          world.waitTimeouts.push(input.timeoutMs);
          return {
            threadId: input.threadId,
            runId: RunId.make("run-1"),
            status: "running" as const,
            timedOut: true,
          };
        }),
    } satisfies Partial<OrchestratorMcpService.OrchestratorMcpService["Service"]>),
    Layer.mock(ThreadMetadataMcpService.ThreadMetadataMcpService)({}),
    Layer.mock(ThreadSearch.ThreadSearch)({}),
    Layer.mock(ScheduledTasks.ScheduledTaskService)({}),
  );

// Stand-ins for the project tools, whose real services need a whole Environment. The access
// declarations are T3's own, so a launch starts with the modes T3 grants this caller.
const ProjectToolkit = Toolkit.make(
  Tool.make("t3_project_list", {
    description: "Lists projects.",
    parameters: Schema.Struct({
      cursor: Schema.optional(Schema.Number),
      limit: Schema.optional(Schema.Number),
    }),
    success: Schema.Struct({
      projects: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
      nextCursor: Schema.NullOr(Schema.Number),
    }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies: [McpInvocationContext.McpInvocationContext],
  }),
  Tool.make("t3_project_read", {
    description: "Reads a project.",
    parameters: Schema.Struct({ projectId: ProjectId }),
    success: Project,
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies: [McpInvocationContext.McpInvocationContext],
  }),
  Tool.make("t3_thread_launch", {
    description: "Launches a thread.",
    parameters: Schema.Struct({
      projectId: Schema.optional(Schema.String),
      scratch: Schema.optional(Schema.Boolean),
      title: Schema.String,
      message: Schema.optional(Schema.String),
      modelSelection: Schema.optional(ModelSelection),
      workspaceStrategy: Schema.optional(Schema.Unknown),
    }),
    success: Schema.Struct({
      threadId: Schema.String,
      projectId: Schema.String,
      modelSelection: ModelSelection,
      runId: Schema.NullOr(Schema.String),
      status: Schema.NullOr(Schema.String),
    }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies: [
      McpInvocationContext.McpInvocationContext,
      ThreadManagement.ThreadManagementService,
    ],
  }),
);
const projectHandlers = (world: World) =>
  McpToolAccess.toLayer(ProjectToolkit, {
    t3_project_list: McpToolAccess.reads(() =>
      Effect.succeed({ projects: [lazurio, web], nextCursor: null }),
    ),
    t3_project_read: McpToolAccess.reads((input) => {
      const project = [lazurio, web].find((candidate) => candidate.id === input.projectId);
      return project === undefined
        ? Effect.fail(
            new OrchestratorMcpFailure({
              code: "invalid_request",
              message: "The project was not found.",
            }),
          )
        : Effect.succeed(projectRecord(project, world.projectModels.get(project.id) ?? null));
    }),
    t3_thread_launch: McpToolAccess.startsThreads(
      () => ({}),
      (input, modes) =>
        Effect.gen(function* () {
          // T3's own choice for a caller outside a thread: the model passed, else the project
          // record's own field, else a refusal.
          const model =
            input.modelSelection ??
            (input.projectId === undefined ? undefined : world.projectModels.get(input.projectId));
          if (model === undefined)
            return yield* new OrchestratorMcpFailure({
              code: "invalid_request",
              message:
                "Pass modelSelection: the project has no default model. orchestrator_capabilities lists providers and models.",
            });
          world.launches.push({ input, modes });
          return {
            threadId: "thread-launched",
            projectId: input.projectId ?? "scratch",
            modelSelection: model,
            runId: "run-launched",
            status: "preparing",
          };
        }),
    ),
  });

// The person's client surface: the dispatch, the shell stream and the settings, under T3's own
// scope checks.
const TestWsGroup = RpcGroup.make(
  Rpc.make(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, {
    payload: OrchestrationV2RpcSchemas.dispatchCommand.input,
    success: OrchestrationV2RpcSchemas.dispatchCommand.output,
    error: Schema.Union([OrchestrationV2DispatchCommandError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(ORCHESTRATION_V2_WS_METHODS.subscribeShell, {
    payload: OrchestrationV2RpcSchemas.subscribeShell.input,
    success: OrchestrationV2RpcSchemas.subscribeShell.output,
    error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
    stream: true,
  }),
  Rpc.make(WS_METHODS.serverGetSettings, {
    payload: Schema.Struct({}),
    success: ServerSettings,
    error: Schema.Union([ServerSettingsError, EnvironmentAuthorizationError]),
  }),
).middleware(RpcScopeAuthorization);

const encodeShell = Schema.encodeSync(OrchestrationV2ShellSnapshot);
const encodeBounded = Schema.encodeSync(OrchestrationV2ThreadBoundedSnapshot);
const encodeDetail = Schema.encodeSync(OrchestrationV2ThreadDetailSnapshot);

const ownerRoutes = (world: World) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      yield* router.add(
        "GET",
        "/api/orchestration/shell",
        Effect.gen(function* () {
          yield* authenticateOverlayRoute(AuthOrchestrationReadScope);
          return HttpServerResponse.jsonUnsafe(
            encodeShell({
              schemaVersion: 1,
              snapshotSequence: 5,
              projects: [],
              threads: [...world.shells.values()],
              archivedThreads: [],
            }),
          );
        }),
      );
      yield* router.add(
        "GET",
        "/api/orchestration/threads/:threadId/bounded",
        Effect.gen(function* () {
          yield* authenticateOverlayRoute(AuthOrchestrationReadScope);
          const { threadId = "" } = yield* HttpRouter.params;
          const projection = world.projections.get(threadId)!;
          return HttpServerResponse.jsonUnsafe(
            encodeBounded({
              snapshotSequence: 5,
              projection: world.boundedWithoutItems.has(threadId)
                ? { ...projection, turnItems: [] }
                : projection,
              historyCursor: null,
              hasMoreHistory: false,
              latestLocalTurnOrdinal: null,
            }),
          );
        }),
      );
      yield* router.add(
        "GET",
        "/api/orchestration/threads/:threadId",
        Effect.gen(function* () {
          yield* authenticateOverlayRoute(AuthOrchestrationReadScope);
          const { threadId = "" } = yield* HttpRouter.params;
          world.fullReads.push(threadId);
          return HttpServerResponse.jsonUnsafe(
            encodeDetail({ snapshotSequence: 5, projection: world.projections.get(threadId)! }),
          );
        }),
      );
      yield* router.add(
        "GET",
        "/ws",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const auth = yield* EnvironmentAuth.EnvironmentAuth;
          const session = yield* auth.authenticateWebSocketUpgrade(request).pipe(Effect.option);
          if (Option.isNone(session)) return HttpServerResponse.empty({ status: 401 });
          const handlers = TestWsGroup.toLayer({
            [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: (command) =>
              Effect.sync(() => {
                world.ownerDispatched.push(command);
                return { sequence: 100 + world.ownerDispatched.length };
              }),
            [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: (input) => {
              world.subscriptions.push(input);
              return world.shellStream(input, world.subscriptions.length - 1);
            },
            [WS_METHODS.serverGetSettings]: () => Effect.succeed(world.settings),
          });
          const httpEffect = yield* RpcServer.toHttpEffectWebsocket(TestWsGroup).pipe(
            Effect.provide(
              Layer.mergeAll(
                handlers,
                RpcAuthorization.layer(session.value.scopes),
                RpcSerialization.layerJson,
              ),
            ),
          );
          return yield* httpEffect;
        }),
      );
    }),
  );

/** Buddy's thread route over the world's projects and threads. */
const buddyThreadRoute = (world: World) =>
  BuddySurfaceThreadRoute.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Orchestrator.OrchestratorV2)({
          getThreadShell: (threadId) => Effect.succeed(world.shells.get(threadId) ?? null),
          dispatch: (command) =>
            Effect.sync(() => {
              world.buddyDispatched.push(command);
              if (command.type === "thread.create")
                world.shells.set(
                  command.threadId,
                  threadShell(command.threadId, {
                    projectId: command.projectId,
                    providerInstanceId: command.modelSelection.instanceId,
                  }),
                );
              return { sequence: world.buddyDispatched.length, storedEvents: [] };
            }),
        }),
        Layer.mock(ProjectStore.ProjectStoreV2)({
          list: () => Effect.succeed(world.buddyProjects),
        }),
        NodeServices.layer,
      ),
    ),
  );

/**
 * A running server for `baseDir`: the real `/mcp` with T3's tools and access checks over the
 * fakes, the person's client surface, and the runtime state the CLI finds it by.
 */
const withLiveServer = <A, E, R>(
  baseDir: string,
  world: World,
  body: (origin: string) => Effect.Effect<A, E, R>,
) => withLiveServerOver(baseDir, world, orchestrationFakes(world), Layer.empty, body);

/**
 * The same server with `orchestration` behind the tools in place of the fakes, and `routes` served
 * beside them.
 */
const withLiveServerOver = <A, E, R, ROut, RIn, RR>(
  baseDir: string,
  world: World,
  orchestration: Layer.Layer<ROut, never, RIn>,
  routes: Layer.Layer<never, never, RR>,
  body: (origin: string) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const configLayer = Layer.effect(
      ServerConfig.ServerConfig,
      Effect.map(ServerConfig.ServerConfig, (config) => ({ ...config, host: "127.0.0.1" })),
    ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)));
    const mcpRoutes = Layer.mergeAll(
      McpHttpServer.toolkitRegistration(OrchestratorToolkit, OrchestratorHandlers.layer),
      McpHttpServer.layerThreadToolkit,
      McpHttpServer.toolkitRegistration(ProjectToolkit, projectHandlers(world)),
    ).pipe(
      Layer.provideMerge(McpHttpServer.layerMcpTransport),
      Layer.provide(
        Layer.mock(McpSessionRegistry.McpSessionRegistry)({
          resolve: () => Effect.void.pipe(Effect.as(undefined)),
        }),
      ),
      // As server.ts provides it.
      Layer.provide(
        withAgentCliRequestNamespace(
          McpOAuth.layerMcpClientAuthenticator.pipe(
            Layer.provide(
              Layer.mock(ServerEnvironment.ServerEnvironment)({
                getEnvironmentId: Effect.succeed(environmentId),
              }),
            ),
          ),
        ),
      ),
      Layer.provide(orchestration),
    );
    const serviceLayer = HttpRouter.serve(
      Layer.mergeAll(mcpRoutes, ownerRoutes(world), buddyThreadRoute(world), routes),
      {
        disableListenLog: true,
        disableLogger: true,
      },
    ).pipe(
      Layer.provideMerge(EnvironmentAuth.layerRuntime),
      Layer.provideMerge(
        NodeHttpServer.layer(NodeHttp.createServer, { host: "127.0.0.1", port: 0 }),
      ),
      Layer.provideMerge(configLayer),
      Layer.provideMerge(NodeServices.layer),
    );
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const address = (yield* HttpServer.HttpServer).address;
        if (typeof address === "string" || !("port" in address)) {
          return yield* Effect.die(`Expected a TCP address, got ${String(address)}`);
        }
        yield* persistServerRuntimeState({
          path: config.serverRuntimeStatePath,
          state: yield* makePersistedServerRuntimeState({ config, port: address.port }),
        });
        return yield* body(`http://127.0.0.1:${address.port}`);
      }).pipe(Effect.provide(serviceLayer)),
    );
  });

/** The sessions the agent commands issued that are still valid; each command revokes its own. */
const agentCliSessions = EnvironmentAuth.EnvironmentAuth.pipe(
  Effect.flatMap((auth) => auth.listSessions()),
  Effect.map((sessions) => sessions.filter((session) => session.client.label === "t3 agent cli")),
);

describe("t3 thread", () => {
  it.effect(
    "acts on a full-access thread as its owner, where a default MCP session is refused",
    () =>
      Effect.gen(function* () {
        const baseDir = makeBaseDir();
        const world = makeWorld();
        world.shells.set("thread-full", threadShell("thread-full"));
        yield* withLiveServer(baseDir, world, (origin) =>
          Effect.gen(function* () {
            // The gap: a headless agent's session from `t3 auth session issue` is capped at
            // approval-required, so a full-access thread refuses it.
            const issued = yield* printedJson(
              run([
                "auth",
                "session",
                "issue",
                "--base-dir",
                baseDir,
                "--subject",
                "mcp-client",
                "--json",
              ]),
            );
            const refused = yield* callAcpMcpTool({
              endpoint: `${origin}/mcp`,
              authorization: `Bearer ${String(issued.output.token)}`,
              tool: "t3_thread_send",
              arguments: { threadId: "thread-full", message: "Continue" },
            });
            assert.include(JSON.stringify(refused), "runtime_mode_escalation_denied");
            assert.deepStrictEqual(world.sends, []);

            const sent = yield* printedJson(
              run(["thread", "send", "thread-full", "Continue", "--base-dir", baseDir, "--json"]),
            );
            assert.strictEqual(sent.exit._tag, "Success");
            assert.deepStrictEqual(sent.output, {
              threadId: "thread-full",
              messageId: "message-1",
              runId: "run-2",
              status: "running",
              delivery: "steered",
            });
            assert.strictEqual(world.sends[0]?.input.message, "Continue");
            // As a full-access client signed in from outside a thread, with no thread of its own.
            assert.strictEqual(world.sends[0]?.scope.client?.access, "full-access");
            assert.strictEqual(world.sends[0]?.scope.thread, undefined);

            // A refusal keeps the tool's own code and exits 1.
            const missing = yield* printedJson(
              run(["thread", "send", "thread-gone", "Hello", "--base-dir", baseDir, "--json"]),
            );
            assert.deepStrictEqual(missing.output, {
              error: { code: "thread_not_found", message: "Thread thread-gone was not found." },
            });
            assert.strictEqual(missing.exit._tag, "Failure");
            assert.deepStrictEqual(yield* agentCliSessions, []);
          }),
        );
      }).pipe(Effect.provide(TestConsole.layer)),
  );

  it.effect("lists threads across projects and reads one without changing anything", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const world = makeWorld();
      world.shells.set("thread-a", threadShell("thread-a"));
      world.threadsByProject.set(lazurio.id, [
        listItem("thread-a", "2026-10-20T11:00:00.000Z", "waiting"),
      ]);
      world.threadsByProject.set(web.id, [
        listItem("thread-b", "2026-10-20T12:00:00.000Z"),
        listItem("thread-c", "2026-10-20T09:00:00.000Z", "completed"),
      ]);
      yield* withLiveServer(baseDir, world, () =>
        Effect.gen(function* () {
          const listed = yield* printedJson(
            run(["thread", "list", "--base-dir", baseDir, "--limit", "2", "--json"]),
          );
          const threads = listed.output.threads as ReadonlyArray<Record<string, unknown>>;
          assert.deepStrictEqual(
            threads.map((thread) => [thread.threadId, thread.status, thread.projectTitle]),
            [
              ["thread-b", "running", "web-app"],
              ["thread-a", "waiting", "Lazurio"],
            ],
          );
          assert.strictEqual(listed.output.total, 3);
          // Every project, top-level threads as the sidebar shows them.
          assert.deepStrictEqual(
            world.listInputs
              .map((input) => [input.projectId, input.includeSubagents, input.limit])
              .toSorted(),
            [
              [lazurio.id, false, 2],
              [web.id, false, 2],
            ],
          );

          yield* printedJson(
            run([
              "thread",
              "list",
              "--base-dir",
              baseDir,
              "--project",
              "web-app",
              "--status",
              "running",
              "--no-settled",
              "--json",
            ]),
          );
          assert.deepStrictEqual(world.listInputs[2], {
            projectId: web.id,
            includeSubagents: false,
            limit: 20,
            statuses: ["running"],
            settled: false,
          });

          const read = yield* printedJson(
            run([
              "thread",
              "read",
              "thread-a",
              "--base-dir",
              baseDir,
              "--view",
              "activity",
              "--after",
              "4",
              "--json",
            ]),
          );
          assert.strictEqual((read.output.thread as Record<string, unknown>).threadId, "thread-a");
          assert.deepStrictEqual(
            { ...world.readInputs[0] },
            {
              threadId: ThreadId.make("thread-a"),
              view: "activity",
              afterPosition: 4,
            },
          );
          assert.deepStrictEqual(world.dispatched, []);
          assert.deepStrictEqual(world.ownerDispatched, []);
        }),
      );
    }).pipe(Effect.provide(TestConsole.layer)),
  );

  it.effect("launches in the Lazurio Folder with the project's model and full access", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const world = makeWorld();
      // The managed startup records the Folder's project.
      const recordDir = NodePath.join(baseDir, "userdata", "lazurio");
      NodeFS.mkdirSync(recordDir, { recursive: true });
      const record = NodePath.join(recordDir, "model-recommendation.json");
      NodeFS.writeFileSync(record, `{"projectId":"${lazurio.id}","selection":null}`);
      yield* withLiveServer(baseDir, world, () =>
        Effect.gen(function* () {
          const launched = yield* printedJson(
            run([
              "thread",
              "launch",
              "Fix the build",
              "--title",
              "Build",
              "--base-dir",
              baseDir,
              "--json",
            ]),
          );
          assert.deepStrictEqual(launched.output, {
            threadId: "thread-launched",
            projectId: lazurio.id,
            modelSelection: environmentModel,
            runId: "run-launched",
            status: "preparing",
          });
          // No model flag (root decision 0189): the model a new thread in the project gets in the
          // app, here the Environment's.
          assert.deepStrictEqual(world.launches[0], {
            input: {
              title: "Build",
              projectId: lazurio.id,
              message: "Fix the build",
              modelSelection: environmentModel,
            },
            modes: { runtimeMode: "full-access", interactionMode: "default" },
          });

          yield* printedJson(
            run([
              "thread",
              "launch",
              "--title",
              "Fix",
              "--project",
              "web-app",
              "--base",
              "main",
              "--branch",
              "fix-login",
              "--base-dir",
              baseDir,
              "--json",
            ]),
          );
          assert.deepStrictEqual(world.launches[1]?.input, {
            title: "Fix",
            projectId: web.id,
            modelSelection: environmentModel,
            workspaceStrategy: { type: "worktree", baseRef: "main", branch: "fix-login" },
          });

          // Without the Folder, the project must be named.
          NodeFS.rmSync(record);
          const unnamed = yield* printedJson(
            run(["thread", "launch", "--title", "Fix", "--base-dir", baseDir, "--json"]),
          );
          assert.strictEqual(
            (unnamed.output.error as Record<string, unknown>).code,
            "target_required",
          );
          assert.strictEqual(world.launches.length, 2);
        }),
      );
    }).pipe(Effect.provide(TestConsole.layer)),
  );

  describe("a launch's model", () => {
    // A launch names no model (root decision 0189), so it gets the one a new thread in its
    // project gets in the app, which the web resolves with `resolveProjectSettings`: the
    // project's override in the settings, the record's own field only until the settings are
    // folded, then the Environment's (Lazurio/t3code#94).
    const projectModel = modelSelection("codex", "gpt-6.1-sol");
    /** `t3 thread launch` in the Lazurio Folder, which the managed startup records. */
    const launch = (world: World, args: ReadonlyArray<string> = []) =>
      Effect.gen(function* () {
        const baseDir = makeBaseDir();
        const recordDir = NodePath.join(baseDir, "userdata", "lazurio");
        NodeFS.mkdirSync(recordDir, { recursive: true });
        NodeFS.writeFileSync(
          NodePath.join(recordDir, "model-recommendation.json"),
          `{"projectId":"${lazurio.id}","selection":null}`,
        );
        return yield* withLiveServer(baseDir, world, () =>
          printedJson(
            run([
              "thread",
              "launch",
              "Fix the build",
              "--title",
              "Build",
              ...args,
              "--base-dir",
              baseDir,
              "--json",
            ]),
          ),
        );
      });

    it.effect("is the project's override in folded settings, not the record's own field", () =>
      Effect.gen(function* () {
        const world = makeWorld();
        world.settings = {
          ...world.settings,
          projectSettingsFolded: true,
          projectSettingsOverrides: { [lazurio.id]: { defaultModelSelection: projectModel } },
        };
        // What the record still holds, which the folded settings no longer read.
        world.projectModels.set(lazurio.id, modelSelection("codex", "gpt-5"));
        const launched = yield* launch(world);
        assert.strictEqual(exitCodeOf(launched.exit), 0);
        assert.deepStrictEqual(launched.output.modelSelection, projectModel);
        assert.deepStrictEqual(world.launches[0]?.input, {
          title: "Build",
          projectId: lazurio.id,
          message: "Fix the build",
          modelSelection: projectModel,
        });
      }).pipe(Effect.provide(TestConsole.layer)),
    );

    it.effect("is the Environment's default for a project without an override", () =>
      Effect.gen(function* () {
        const world = makeWorld();
        world.settings = {
          ...world.settings,
          projectSettingsFolded: true,
          projectSettingsOverrides: { [lazurio.id]: { defaultModelSelection: projectModel } },
        };
        const launched = yield* launch(world, ["--project", "web-app"]);
        assert.strictEqual(exitCodeOf(launched.exit), 0);
        assert.deepStrictEqual(launched.output.modelSelection, environmentModel);
        assert.deepStrictEqual(world.launches[0]?.input, {
          title: "Build",
          projectId: web.id,
          message: "Fix the build",
          modelSelection: environmentModel,
        });
      }).pipe(Effect.provide(TestConsole.layer)),
    );

    it.effect("is none where nothing sets one, so T3 refuses the launch and it exits 1", () =>
      Effect.gen(function* () {
        const world = makeWorld();
        world.settings = { ...DEFAULT_SERVER_SETTINGS, projectSettingsFolded: true };
        const refused = yield* launch(world, ["--project", "web-app"]);
        assert.deepStrictEqual(refused.output, {
          error: {
            code: "invalid_request",
            message:
              "Pass modelSelection: the project has no default model. orchestrator_capabilities lists providers and models.",
          },
        });
        assert.strictEqual(exitCodeOf(refused.exit), AGENT_CLI_EXIT_CODES.failed);
        assert.deepStrictEqual(world.launches, []);
      }).pipe(Effect.provide(TestConsole.layer)),
    );
  });

  it.effect("a wait that times out prints the thread's state and exits 4", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const world = makeWorld();
      world.shells.set("thread-full", threadShell("thread-full"));
      yield* withLiveServer(baseDir, world, () =>
        Effect.gen(function* () {
          const waited = yield* printedJson(
            run([
              "thread",
              "wait",
              "thread-full",
              "--timeout",
              "30s",
              "--base-dir",
              baseDir,
              "--json",
            ]),
          );
          assert.deepStrictEqual(waited.output, {
            threadId: "thread-full",
            runId: "run-1",
            status: "running",
            timedOut: true,
          });
          assert.deepStrictEqual(world.waitTimeouts, [30_000]);
          assert.strictEqual(waited.exit._tag, "Failure");
          const error = yield* run(["thread", "wait", "thread-full", "--base-dir", baseDir]).pipe(
            Effect.flip,
          );
          assert.isTrue(isAgentCliFailure(error));
          assert.strictEqual(Runtime.getErrorExitCode(error), AGENT_CLI_EXIT_CODES.waitTimedOut);
        }),
      );
    }).pipe(Effect.provide(TestConsole.layer)),
  );

  it.effect("says T3 Code is not running, exits 3 and signs in to nothing", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const listed = yield* printedJson(run(["thread", "list", "--base-dir", baseDir, "--json"]));
      assert.strictEqual(
        (listed.output.error as Record<string, unknown>).code,
        "server_not_running",
      );
      const error = yield* run(["request", "list", "--base-dir", baseDir]).pipe(Effect.flip);
      assert.strictEqual(Runtime.getErrorExitCode(error), AGENT_CLI_EXIT_CODES.serverNotRunning);
      const sessions = yield* agentCliSessions.pipe(
        Effect.provide(
          EnvironmentAuth.layerRuntime.pipe(
            Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
            Layer.provide(NodeServices.layer),
          ),
        ),
      );
      assert.deepStrictEqual(sessions, []);
    }).pipe(Effect.provide(TestConsole.layer)),
  );
});

const itemBase = (threadId: string, id: string) => ({
  id: TurnItemId.make(id),
  threadId: ThreadId.make(threadId),
  runId: RunId.make("run-1"),
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 1,
  status: "waiting" as const,
  title: null,
  startedAt: null,
  completedAt: null,
  updatedAt: at("2026-10-20T10:00:00.000Z"),
});

/** A thread waiting on a question, and one waiting on a permission to run a command. */
const withPendingRequests = (world: World) => {
  const questionShell = threadShell("thread-question", {
    pendingRuntimeRequest: {
      id: RuntimeRequestId.make("request-question"),
      kind: "user_input",
      createdAt: at("2026-10-20T09:00:00.000Z"),
    },
  });
  const approvalShell = threadShell("thread-approval", {
    pendingRuntimeRequest: {
      id: RuntimeRequestId.make("request-approval"),
      kind: "command",
      createdAt: at("2026-10-20T10:00:00.000Z"),
    },
  });
  const request = (id: string, kind: "user_input" | "command", createdAt: string) => ({
    id: RuntimeRequestId.make(id),
    nodeId: NodeId.make("node-1"),
    providerTurnId: null,
    nativeRequestRef: null,
    kind,
    status: "pending" as const,
    responseCapability: {
      type: "live" as const,
      providerSessionId: ProviderSessionId.make("session-1"),
    },
    createdAt: at(createdAt),
    resolvedAt: null,
  });
  world.shells.set(questionShell.id, questionShell);
  world.shells.set(approvalShell.id, approvalShell);
  world.shells.set("thread-idle", threadShell("thread-idle"));
  world.projections.set(questionShell.id, {
    ...McpToolAccessTestkit.idleThreadProjection(questionShell),
    runtimeRequests: [request("request-question", "user_input", "2026-10-20T09:00:00.000Z")],
    turnItems: [
      {
        ...itemBase(questionShell.id, "item-question"),
        type: "user_input_request",
        requestId: RuntimeRequestId.make("request-question"),
        questions: [{ id: "q1", header: "Deploy", question: "Deploy now?", options: [] }],
      },
    ],
  });
  world.projections.set(approvalShell.id, {
    ...McpToolAccessTestkit.idleThreadProjection(approvalShell),
    runtimeRequests: [request("request-approval", "command", "2026-10-20T10:00:00.000Z")],
    turnItems: [
      {
        ...itemBase(approvalShell.id, "item-approval"),
        type: "approval_request",
        requestId: RuntimeRequestId.make("request-approval"),
        requestKind: "command",
        prompt: "rm -rf build",
        options: [
          { decision: "accept", label: "Run it" },
          { decision: "decline", label: "Don't" },
        ],
      },
    ],
  });
  // A long run: the approval's card is older than the timeline window the web opens with.
  world.boundedWithoutItems.add(approvalShell.id);
};

describe("t3 request", () => {
  it.effect("lists, answers and decides the requests threads wait on, as their user", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const world = makeWorld();
      withPendingRequests(world);
      yield* withLiveServer(baseDir, world, () =>
        Effect.gen(function* () {
          const listed = yield* printedJson(
            run(["request", "list", "--base-dir", baseDir, "--json"]),
          );
          assert.deepStrictEqual(listed.output, {
            requests: [
              {
                requestId: "request-question",
                threadId: "thread-question",
                projectId: lazurio.id,
                threadTitle: "thread-question",
                type: "question",
                kind: "user_input",
                createdAt: "2026-10-20T09:00:00.000Z",
                answerable: true,
                questions: [{ id: "q1", header: "Deploy", question: "Deploy now?", options: [] }],
              },
              {
                requestId: "request-approval",
                threadId: "thread-approval",
                projectId: lazurio.id,
                threadTitle: "thread-approval",
                type: "approval",
                kind: "command",
                createdAt: "2026-10-20T10:00:00.000Z",
                answerable: true,
                prompt: "rm -rf build",
                decisions: ["accept", "decline"],
                options: [
                  { decision: "accept", label: "Run it" },
                  { decision: "decline", label: "Don't" },
                ],
              },
            ],
          });
          // Only the thread whose card lay outside its recent timeline was read whole.
          assert.deepStrictEqual(world.fullReads, ["thread-approval"]);

          const approved = yield* printedJson(
            run(["request", "approve", "request-approval", "--base-dir", baseDir, "--json"]),
          );
          assert.deepStrictEqual(approved.output, {
            threadId: "thread-approval",
            requestId: "request-approval",
            decision: "accept",
            sequence: 101,
          });
          assert.deepStrictEqual(
            world.ownerDispatched.map((command) => {
              const { commandId: _commandId, ...rest } = command as Record<string, unknown>;
              return rest;
            }),
            [
              {
                type: "runtime-request.respond",
                threadId: "thread-approval",
                requestId: "request-approval",
                decision: "accept",
              },
            ],
          );

          const notOffered = yield* printedJson(
            run([
              "request",
              "approve",
              "request-approval",
              "--for-session",
              "--thread",
              "thread-approval",
              "--base-dir",
              baseDir,
              "--json",
            ]),
          );
          assert.deepStrictEqual(notOffered.output, {
            error: {
              code: "invalid_request",
              message: "This request offers accept, decline, not acceptForSession.",
            },
          });

          // Both at once cannot work: refused like any failure, and nothing is decided.
          const both = yield* printedJson(
            run([
              "request",
              "approve",
              "request-approval",
              "--for-session",
              "--always",
              "--base-dir",
              baseDir,
              "--json",
            ]),
          );
          assert.deepStrictEqual(both.output, {
            error: {
              code: "invalid_request",
              message: "Pass --for-session or --always, not both.",
            },
          });
          assert.strictEqual(exitCodeOf(both.exit), AGENT_CLI_EXIT_CODES.failed);
          assert.strictEqual(world.ownerDispatched.length, 1);

          yield* printedJson(
            run(["request", "deny", "request-approval", "--base-dir", baseDir, "--json"]),
          );
          assert.strictEqual(
            (world.ownerDispatched[1] as Record<string, unknown>).decision,
            "decline",
          );

          const notAnApproval = yield* printedJson(
            run(["request", "approve", "request-question", "--base-dir", baseDir, "--json"]),
          );
          assert.strictEqual(
            (notAnApproval.output.error as Record<string, unknown>).code,
            "not_an_approval",
          );

          // An answer goes through T3's own tool for answering questions.
          const answered = yield* printedJson(
            run([
              "request",
              "respond",
              "request-question",
              "--answer",
              "Yes",
              "--base-dir",
              baseDir,
              "--json",
            ]),
          );
          assert.deepStrictEqual(answered.output, {
            threadId: "thread-question",
            requestId: "request-question",
            answered: true,
          });
          const { commandId: _commandId, ...respond } = world.dispatched[0] as Record<
            string,
            unknown
          >;
          assert.deepStrictEqual(respond, {
            type: "runtime-request.respond",
            threadId: "thread-question",
            requestId: "request-question",
            answers: { q1: "Yes" },
          });
          assert.strictEqual(world.ownerDispatched.length, 2);
          assert.deepStrictEqual(yield* agentCliSessions, []);
        }),
      );
    }).pipe(Effect.provide(TestConsole.layer)),
  );
});

const shellSnapshotItem = (
  sequence: number,
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
): OrchestrationV2ShellStreamItem => ({
  kind: "snapshot",
  snapshot: {
    schemaVersion: 1,
    snapshotSequence: sequence,
    projects: [
      {
        id: lazurio.id,
        title: lazurio.title,
        workspaceRoot: "/lazurio",
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    ],
    threads,
    archivedThreads: [],
  },
});

describe("t3 events", () => {
  it.effect("prints each thread's state as a JSON line, then a synced line", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const world = makeWorld();
      world.shellStream = () =>
        Stream.make(
          shellSnapshotItem(10, [
            threadShell("thread-1"),
            threadShell("thread-2", { status: "idle", activeRunId: null }),
          ]),
          { kind: "synchronized" },
          // Never reached without --follow.
          {
            kind: "thread.removed",
            sequence: 11,
            location: "active",
            threadId: ThreadId.make("thread-1"),
          },
        );
      yield* withLiveServer(baseDir, world, () =>
        Effect.gen(function* () {
          const printedLines = (args: ReadonlyArray<string>) =>
            Effect.gen(function* () {
              const before = (yield* TestConsole.logLines).length;
              yield* run(args);
              return (yield* TestConsole.logLines)
                .slice(before)
                .map((line) => decodeJson(line) as Record<string, unknown>);
            });
          const lines = yield* printedLines(["events", "--base-dir", baseDir]);
          assert.deepStrictEqual(
            lines.map((line) => [
              line.kind,
              line.threadId ?? null,
              line.status ?? null,
              line.sequence,
            ]),
            [
              ["thread", "thread-1", "running", 10],
              ["thread", "thread-2", "idle", 10],
              ["synced", null, null, 10],
            ],
          );
          // Every agent command takes --json; for this one the output is JSON lines either way.
          assert.deepStrictEqual(
            yield* printedLines(["events", "--base-dir", baseDir, "--json"]),
            lines,
          );
          assert.deepStrictEqual(world.subscriptions, [
            { requestCompletionMarker: true },
            { requestCompletionMarker: true },
          ]);
        }),
      );
    }).pipe(Effect.provide(TestConsole.layer)),
  );

  it.effect("prints a failure as JSON with --json, as every agent command does", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      for (const args of [["events"], ["events", "--follow"]]) {
        const printed = yield* printedJson(run([...args, "--base-dir", baseDir, "--json"]));
        assert.deepStrictEqual(printed.output, {
          error: {
            code: "server_not_running",
            message: "T3 Code is not running for this T3 home, so nothing was read or changed.",
          },
        });
        assert.strictEqual(exitCodeOf(printed.exit), AGENT_CLI_EXIT_CODES.serverNotRunning);
      }
      // Without --json the message goes to standard error, and standard output stays empty.
      const logsBefore = (yield* TestConsole.logLines).length;
      const errorsBefore = (yield* TestConsole.errorLines).length;
      const exit = yield* Effect.exit(run(["events", "--base-dir", baseDir]));
      assert.strictEqual((yield* TestConsole.logLines).length, logsBefore);
      assert.deepStrictEqual((yield* TestConsole.errorLines).slice(errorsBefore), [
        "T3 Code is not running for this T3 home, so nothing was read or changed.",
      ]);
      assert.strictEqual(exitCodeOf(exit), AGENT_CLI_EXIT_CODES.serverNotRunning);
    }).pipe(Effect.provide(TestConsole.layer)),
  );

  it.effect("follows changes and resumes after the last sequence when the stream drops", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const world = makeWorld();
      const resumed = yield* Deferred.make<void>();
      const running = threadShell("thread-1");
      world.shellStream = (_input, index) =>
        index === 0
          ? // The first connection ends, as when T3 restarts or the session expires.
            Stream.make(
              shellSnapshotItem(10, [running]),
              { kind: "synchronized" },
              {
                kind: "thread.updated",
                sequence: 11,
                location: "active",
                thread: { ...running, itemCount: 7 },
              },
              {
                kind: "thread.updated",
                sequence: 12,
                location: "active",
                thread: {
                  ...running,
                  activityRunStatus: "waiting",
                  pendingRuntimeRequest: {
                    id: RuntimeRequestId.make("request-approval"),
                    kind: "command",
                    createdAt: at("2026-10-20T11:00:00.000Z"),
                  },
                },
              },
            )
          : Stream.fromEffect(Deferred.succeed(resumed, undefined)).pipe(
              Stream.flatMap(() => Stream.never),
            );
      yield* withLiveServer(baseDir, world, () =>
        Effect.gen(function* () {
          const before = (yield* TestConsole.logLines).length;
          const following = yield* Effect.forkChild(
            run(["events", "--follow", "--base-dir", baseDir]),
          );
          // The second subscription starts only after the first one's lines were printed.
          yield* Deferred.await(resumed);
          yield* Fiber.interrupt(following);
          const lines = (yield* TestConsole.logLines)
            .slice(before)
            .map((line) => decodeJson(line) as Record<string, unknown>);
          assert.deepStrictEqual(
            lines.map((line) => [line.kind, line.status ?? null, line.sequence]),
            [
              ["thread", "running", 10],
              ["synced", null, 10],
              ["thread", "waiting", 12],
            ],
          );
          assert.deepStrictEqual((lines[2]?.pendingRequest as Record<string, unknown>) ?? null, {
            requestId: "request-approval",
            kind: "command",
            type: "approval",
          });
          assert.deepStrictEqual(world.subscriptions, [
            { requestCompletionMarker: true },
            { requestCompletionMarker: true, afterSequence: 12 },
          ]);
        }),
      );
    }).pipe(Effect.provide(TestConsole.layer)),
  );
});

describe("a command line that cannot work", () => {
  it.effect("fails as JSON with exit 1 before anything is read, whether or not T3 Code runs", () =>
    Effect.gen(function* () {
      // No server runs for this T3 home: each command fails on its command line alone.
      const baseDir = makeBaseDir();
      const cases: ReadonlyArray<readonly [ReadonlyArray<string>, string]> = [
        [
          ["request", "approve", "request-1", "--for-session", "--always"],
          "Pass --for-session or --always, not both.",
        ],
        [
          ["thread", "launch", "--title", "Fix", "--base", "main", "--existing-worktree", "/w"],
          "Pass --base or --existing-worktree, not both.",
        ],
        [["thread", "launch", "--title", "Fix", "--from-origin"], "--from-origin needs --base."],
        [
          ["thread", "launch", "--title", "Fix", "--branch", "fix"],
          "--branch needs --base or --existing-worktree.",
        ],
        [
          ["thread", "launch", "--title", "Fix", "--scratch", "--project", "web-app"],
          "Pass --project or --scratch, not both.",
        ],
        [
          ["thread", "launch", "Go", "--title", "Fix", "--message-file", "/message"],
          "Pass the message or --message-file, not both.",
        ],
        [["thread", "send", "thread-1"], "Pass the message, or --message-file."],
        [["thread", "organize", "thread-1", "snooze"], "snooze needs --until."],
        [
          ["thread", "organize", "thread-1", "snooze", "--until", "soon"],
          "--until takes a time or a duration such as 2h, not soon.",
        ],
        [
          ["thread", "fork", "thread-1", "--run", "run-1", "--checkpoint", "checkpoint-1"],
          "Pass --run or --checkpoint, not both.",
        ],
        [["request", "respond", "request-1"], "Pass --answer or --answers."],
        [
          ["request", "respond", "request-1", "--answers", '["Yes"]'],
          "--answers must be a JSON object.",
        ],
        [["queue", "edit", "thread-1", "queued-1"], "Pass the message, or --message-file."],
        [
          ["queue", "reorder", "thread-1", "queued-1", "--before", "queued-2", "--last"],
          "Pass --before or --last.",
        ],
      ];
      for (const [args, message] of cases) {
        const printed = yield* printedJson(run([...args, "--base-dir", baseDir, "--json"]));
        assert.deepStrictEqual(
          printed.output,
          { error: { code: "invalid_request", message } },
          args.join(" "),
        );
        assert.strictEqual(exitCodeOf(printed.exit), AGENT_CLI_EXIT_CODES.failed, args.join(" "));
      }
      const unreadable = yield* printedJson(
        run([
          "thread",
          "send",
          "thread-1",
          "--message-file",
          NodePath.join(baseDir, "missing.txt"),
          "--base-dir",
          baseDir,
          "--json",
        ]),
      );
      assert.strictEqual(
        (unreadable.output.error as Record<string, unknown>).code,
        "invalid_request",
      );
      assert.strictEqual(exitCodeOf(unreadable.exit), AGENT_CLI_EXIT_CODES.failed);

      // Without --json the message goes to standard error, and standard output stays empty.
      const logsBefore = (yield* TestConsole.logLines).length;
      const errorsBefore = (yield* TestConsole.errorLines).length;
      const exit = yield* Effect.exit(
        run([
          "request",
          "approve",
          "request-1",
          "--for-session",
          "--always",
          "--base-dir",
          baseDir,
        ]),
      );
      assert.strictEqual((yield* TestConsole.logLines).length, logsBefore);
      assert.deepStrictEqual((yield* TestConsole.errorLines).slice(errorsBefore), [
        "Pass --for-session or --always, not both.",
      ]);
      assert.strictEqual(exitCodeOf(exit), AGENT_CLI_EXIT_CODES.failed);

      // Nothing was read or written: even resolving the T3 home's paths would create its folders.
      assert.deepStrictEqual(NodeFS.readdirSync(baseDir), []);
    }).pipe(Effect.provide(TestConsole.layer)),
  );
});

/**
 * T3's MCP tool for sending, over the production runtime of `layerBuddyServer`, with stand-ins only
 * for what sending never reaches.
 */
const realSending = Layer.mergeAll(
  OrchestratorMcpService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
        Layer.mock(GitVcsDriver.GitVcsDriver)({}),
        Layer.mock(ProviderRegistry.ProviderRegistry)({}),
        Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({}),
        Layer.mock(ScheduledTasks.ScheduledTaskService)({}),
        Layer.mock(ProjectService.ProjectService)({}),
        Layer.mock(SecretRequests.SecretRequests)({}),
        ServerSettingsService.layerTest(),
      ),
    ),
  ),
  Layer.mock(ThreadMetadataMcpService.ThreadMetadataMcpService)({}),
  Layer.mock(ThreadSearch.ThreadSearch)({}),
  Layer.mock(ScheduledTasks.ScheduledTaskService)({}),
).pipe(Layer.orDie);

const sendArgs = (baseDir: string, threadId: string, message: string, key: string) => [
  "thread",
  "send",
  threadId,
  message,
  "--mode",
  "queue",
  "--idempotency-key",
  key,
  "--base-dir",
  baseDir,
  "--json",
];

describe("t3 thread send --idempotency-key", () => {
  it.effect("names one request per thread, sender and key in every command", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const world = makeWorld();
      world.shells.set("thread-buddy", threadShell("thread-buddy"));
      world.shells.set("thread-other", threadShell("thread-other"));
      yield* withLiveServer(baseDir, world, (origin) =>
        Effect.gen(function* () {
          const send = (threadId: string, environment: Record<string, string> = {}) =>
            printedJson(
              run(sendArgs(baseDir, threadId, "budíček wake-1: HOTOVO", "wake-1")).pipe(
                Effect.provideService(HostProcess.Environment, environment),
              ),
            ).pipe(
              Effect.tap((sent) =>
                Effect.sync(() => assert.strictEqual(sent.exit._tag, "Success")),
              ),
            );
          // budíček's retry after a crash: a second command with the same key and the same sender.
          yield* send("thread-buddy", { T3CODE_ACTING_SENDER: "budicek" });
          yield* send("thread-buddy", { T3CODE_ACTING_SENDER: "budicek" });
          // The same key for another thread, and from another sender.
          yield* send("thread-other", { T3CODE_ACTING_SENDER: "budicek" });
          yield* send("thread-buddy");
          const keys = world.sends.map((sent) => sent.input.clientRequestId ?? "");
          for (const key of keys) assert.match(key, /^lazurio-send:[0-9a-f]{64}$/);
          assert.strictEqual(keys[0], keys[1]);
          assert.strictEqual(new Set(keys).size, 3);
          // One namespace for every agent command, though each signed in with a session of its
          // own and revoked it.
          assert.deepStrictEqual(
            world.sends.map((sent) => sent.scope.requestNamespace),
            Array(4).fill(AGENT_CLI_REQUEST_NAMESPACE),
          );
          assert.notStrictEqual(
            world.sends[0]?.scope.client?.sessionId,
            world.sends[1]?.scope.client?.sessionId,
          );
          assert.deepStrictEqual(yield* agentCliSessions, []);

          // Any other MCP client keeps its own session's namespace.
          const issued = yield* printedJson(
            run([
              "auth",
              "session",
              "issue",
              "--base-dir",
              baseDir,
              "--subject",
              "mcp-client",
              "--runtime-mode-ceiling",
              "full-access",
              "--json",
            ]),
          );
          yield* callAcpMcpTool({
            endpoint: `${origin}/mcp`,
            authorization: `Bearer ${String(issued.output.token)}`,
            tool: "t3_thread_send",
            arguments: { threadId: "thread-buddy", message: "Ahoj", clientRequestId: "wake-1" },
          });
          assert.match(world.sends[4]?.scope.requestNamespace ?? "", /^client:/);
        }),
      );
    }).pipe(Effect.provide(TestConsole.layer)),
  );

  it.live(
    "sends once from separate commands with one key, as an agent, and reports a final refusal",
    () => {
      const baseDir = makeBaseDir();
      const folder = makeBaseDir();
      return Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const projectId = ProjectId.make("project-buddy");
        yield* addProject(projectId, folder);
        for (const threadId of ["thread-buddy", "thread-other", "thread-refused"])
          yield* orchestrator.dispatch({
            type: "thread.create",
            createdBy: "user",
            creationSource: "web",
            commandId: CommandId.make(`command:create:${threadId}`),
            threadId: ThreadId.make(threadId),
            projectId,
            title: threadId,
            modelSelection: buddyModel,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
          });
        // T3 refused the send of one key before: its receipt says so, and T3 keeps it.
        const refusedKey = yield* agentCliSendKey({
          threadId: "thread-refused",
          key: "wake-9",
        }).pipe(
          Effect.provideService(HostProcess.Environment, { T3CODE_ACTING_SENDER: "budicek" }),
        );
        yield* (yield* OrchestrationCommandReceiptRepository)
          .upsert({
            commandId: CommandId.make(agentCliSendIds(refusedKey).commandId),
            aggregateKind: "thread",
            aggregateId: ThreadId.make("thread-refused"),
            commandType: "message.dispatch",
            acceptedAt: "2026-10-22T10:00:00.000Z",
            resultSequence: 0,
            status: "rejected",
            error: "The thread refused this message.",
          })
          .pipe(Effect.orDie);
        const sends: ReadonlyArray<readonly [thread: string, text: string, key: string]> = [
          ["thread-buddy", "budíček: úkol doběhl", "wake-7"],
          ["thread-buddy", "budíček: úkol doběhl", "wake-7"],
          ["thread-other", "budíček: úkol doběhl", "wake-7"],
          ["thread-buddy", "budíček: jiný text", "wake-7"],
          ["thread-refused", "budíček: úkol doběhl", "wake-9"],
          ["thread-missing", "budíček: úkol doběhl", "wake-10"],
        ];
        const sent = yield* withLiveServerOver(
          baseDir,
          makeWorld(),
          realSending,
          AgentCliSendState.layer,
          () =>
            Effect.forEach(
              sends,
              ([threadId, text, key]) =>
                printedJson(
                  run(sendArgs(baseDir, threadId, text, key)).pipe(
                    Effect.provideService(HostProcess.Environment, {
                      T3CODE_ACTING_SENDER: "budicek",
                    }),
                  ),
                ),
              { concurrency: 1 },
            ),
        ).pipe(
          // The runtime above memoized its database's setup. The server and the commands open the
          // T3 home's database as in production, so they build from a memo map of their own.
          Effect.provideServiceEffect(Layer.CurrentMemoMap, Layer.makeMemoMap),
        );
        const [first, repeat, other, conflict, refused, missing] = sent;
        for (const result of [first, repeat, other])
          assert.strictEqual(result?.exit._tag, "Success", JSON.stringify(result?.output));
        // The repeat printed the first send's result, with the command that delivered it.
        assert.deepStrictEqual(repeat?.output, first?.output);
        assert.match(
          String(first?.output.commandId),
          /^command:mcp:lazurio%3Aagent-cli:thread-send:lazurio-send%3A[0-9a-f]{64}$/,
        );
        const finalCode = (result: (typeof sent)[number] | undefined) => [
          result === undefined ? -1 : exitCodeOf(result.exit),
          (result?.output.error as { code?: unknown } | undefined)?.code,
        ];
        assert.deepStrictEqual(finalCode(conflict), [1, "idempotency_conflict"]);
        assert.deepStrictEqual(finalCode(refused), [1, "command_rejected"]);
        assert.deepStrictEqual(finalCode(missing), [1, "thread_not_found"]);
        const messagesOf = (threadId: string) =>
          orchestrator
            .getThreadRecords(ThreadId.make(threadId), ["messages"], { messageRoles: ["user"] })
            .pipe(Effect.map((records) => records.messages));
        // One message from the two commands and none from the conflict, sent by an agent over MCP.
        assert.deepStrictEqual(
          (yield* messagesOf("thread-buddy")).map((message) => [
            message.text,
            message.createdBy,
            message.creationSource,
          ]),
          [["budíček: úkol doběhl", "agent", "mcp"]],
        );
        assert.strictEqual((yield* messagesOf("thread-other")).length, 1);
        assert.strictEqual((yield* messagesOf("thread-refused")).length, 0);
      }).pipe(Effect.provide(layerBuddyServer), Effect.scoped, Effect.provide(TestConsole.layer));
    },
  );
});

describe("t3 lazurio buddy thread", () => {
  const buddyProject = (home: string): ProjectStore.ProjectRow => ({
    projectId: ProjectId.make("project-buddy"),
    title: "buddy",
    workspaceRoot: NodePath.join(home, "Lazurio", ".agents", "buddy"),
    defaultModelSelection: null,
    defaultThreadEnvMode: null,
    autoPull: false,
    faviconPath: null,
    projectIcon: null,
    scripts: [],
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    deletedAt: null,
  });

  it.effect("prints Buddy's thread, made once in Buddy's project", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const home = makeBaseDir();
      const world = makeWorld();
      world.buddyProjects.push(buddyProject(home));
      yield* withLiveServer(baseDir, world, () =>
        Effect.gen(function* () {
          for (const _ask of [1, 2]) {
            const asked = yield* printedJson(
              run(["lazurio", "buddy", "thread", "--base-dir", baseDir, "--json"]),
            );
            assert.strictEqual(exitCodeOf(asked.exit), 0);
            assert.deepStrictEqual(asked.output, {
              threadId: BUDDY_THREAD_ID,
              projectId: "project-buddy",
            });
          }
          assert.deepStrictEqual(
            world.buddyDispatched.map((command) => (command as { type: string }).type),
            ["thread.create"],
          );
          assert.deepStrictEqual(yield* agentCliSessions, []);
        }),
      ).pipe(
        Effect.provideService(HostProcess.Environment, { HOME: home, T3CODE_LAZURIO_BUDDY: "1" }),
      );
    }).pipe(Effect.provide(TestConsole.layer)),
  );

  it.effect(
    "refuses with exit 1 without Buddy's project and on a T3 Code that is not Buddy's",
    () =>
      Effect.gen(function* () {
        const baseDir = makeBaseDir();
        const home = makeBaseDir();
        const world = makeWorld();
        const ask = run(["lazurio", "buddy", "thread", "--base-dir", baseDir, "--json"]);
        yield* withLiveServer(baseDir, world, () =>
          Effect.gen(function* () {
            const missing = yield* printedJson(ask);
            assert.strictEqual(exitCodeOf(missing.exit), AGENT_CLI_EXIT_CODES.failed);
            assert.strictEqual(
              (missing.output.error as { code?: unknown } | undefined)?.code,
              "no_project",
            );
          }),
        ).pipe(
          Effect.provideService(HostProcess.Environment, { HOME: home, T3CODE_LAZURIO_BUDDY: "1" }),
        );
        yield* withLiveServer(baseDir, world, () =>
          Effect.gen(function* () {
            const notBuddy = yield* printedJson(ask);
            assert.strictEqual(exitCodeOf(notBuddy.exit), AGENT_CLI_EXIT_CODES.failed);
            assert.deepStrictEqual(notBuddy.output, {
              error: { code: "not_buddy", message: "This T3 Code is not Buddy's." },
            });
          }),
        ).pipe(Effect.provideService(HostProcess.Environment, { HOME: home }));
        assert.deepStrictEqual(world.buddyDispatched, []);
      }).pipe(Effect.provide(TestConsole.layer)),
  );
});
