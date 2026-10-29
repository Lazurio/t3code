/**
 * Lazurio overlay (root decision 0210, addendum 3): how the agent commands reach this Environment's
 * T3 server as its owner. Each command issues its own in-memory sessions from the T3 home (the
 * Environment is the boundary, 0172) and revokes them at exit; thread work goes through `/mcp` with
 * the full-access ceiling, and only what no MCP tool does uses the person's client surface.
 */
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
  type EnvironmentId,
  mcpClientScopes,
  ORCHESTRATION_PROTOCOL_HEADER,
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_VERSION,
  ORCHESTRATION_PROTOCOL_VERSION_TEXT,
  ORCHESTRATION_V2_WS_METHODS,
  type OrchestrationV2Command,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ShellStreamItem,
  type OrchestrationV2SubscribeShellInput,
  type OrchestrationV2ThreadProjection,
  type ThreadId,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Runtime from "effect/Runtime";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { GlobalFlag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import { resolveCliAuthConfig } from "../cli/config.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { mcpToolSession } from "../mcp/AcpMcpStdioBridge.ts";
import { isProcessAlive, readPersistedServerRuntimeState } from "../serverRuntimeState.ts";

/** Exit codes of the agent commands; `docs/user/agent-cli.md` documents them. */
export const AGENT_CLI_EXIT_CODES = {
  failed: 1,
  needsInput: 2,
  serverNotRunning: 3,
  waitTimedOut: 4,
} as const;

/**
 * Why an agent command did not do what it was asked. `code` is an MCP failure code when a tool
 * refused, otherwise one of the CLI's own; the exit code follows from it.
 */
export class AgentCliFailure extends Schema.TaggedError<AgentCliFailure>()("AgentCliFailure", {
  code: Schema.String,
  message: Schema.String,
}) {
  override get [Runtime.errorExitCode](): number {
    return this.code === "server_not_running"
      ? AGENT_CLI_EXIT_CODES.serverNotRunning
      : this.code === "wait_timed_out"
        ? AGENT_CLI_EXIT_CODES.waitTimedOut
        : this.code === "needs_input"
          ? AGENT_CLI_EXIT_CODES.needsInput
          : AGENT_CLI_EXIT_CODES.failed;
  }
  // The command prints the failure itself, as JSON with --json.
  override readonly [Runtime.errorReported] = false;
}

export const agentCliFailure = (code: string, message: string) =>
  new AgentCliFailure({ code, message });
export const isAgentCliFailure = Schema.is(AgentCliFailure);

const serverNotRunning = () =>
  agentCliFailure(
    "server_not_running",
    "T3 Code is not running for this T3 home, so nothing was read or changed.",
  );

/** Whether `cause`, or something it wraps, is a refused connection: no server answered. */
const isConnectionRefused = (cause: unknown, depth = 0): boolean =>
  depth < 6 &&
  typeof cause === "object" &&
  cause !== null &&
  (("code" in cause && cause.code === "ECONNREFUSED") ||
    ("cause" in cause && isConnectionRefused(cause.cause, depth + 1)));

const messageOf = (cause: unknown): string =>
  cause instanceof Error && cause.message.length > 0
    ? cause.message
    : typeof cause === "object" && cause !== null && "message" in cause
      ? String(cause.message)
      : String(cause);

/** Any other failure of a command, so `--json` still prints an error document. */
const commandFailed = (cause: unknown) =>
  isAgentCliFailure(cause) ? cause : agentCliFailure("failed", messageOf(cause));

const requestFailed = (cause: unknown) =>
  isConnectionRefused(cause)
    ? serverNotRunning()
    : agentCliFailure(
        "request_failed",
        `T3 Code did not complete the request: ${messageOf(cause)}`,
      );

/** One command's sessions live this long unless it revokes them first, as it does on exit. */
export const AGENT_CLI_SESSION_TTL = Duration.minutes(10);
const SESSION_LABEL = "t3 agent cli";
const SOCKET_OPEN_TIMEOUT = "15 seconds";
/** The scopes of the person's client surface this needs: reading threads and deciding requests. */
const OWNER_SCOPES = [AuthOrchestrationReadScope, AuthOrchestrationOperateScope];

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/**
 * The value of an MCP `tools/call` result: the tool's structured result, or its failure. T3's
 * tools return their failure as `{ code, message }` text, so the CLI keeps the tool's own code.
 */
const toolCallOutcome = (value: unknown) => {
  const result = asRecord(value) ?? {};
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((part) => asRecord(part))
    .flatMap((part) => (part?.type === "text" && typeof part.text === "string" ? [part.text] : []))
    .join("");
  if (result.isError === true) {
    const failure = asRecord(Option.getOrUndefined(decodeJson(text)));
    return Effect.fail(
      typeof failure?.code === "string" && typeof failure.message === "string"
        ? agentCliFailure(failure.code, failure.message)
        : agentCliFailure("tool_failed", text || "The tool failed."),
    );
  }
  return Effect.succeed(
    result.structuredContent !== undefined
      ? result.structuredContent
      : Option.getOrElse(decodeJson(text), () => ({})),
  );
};

/** This Environment's running T3 server, as its owner, for one agent command. */
export interface AgentCliConnection {
  /** The server's state directory, where the managed startup records the Lazurio Folder's project. */
  readonly stateDir: string;
  /** This Environment's id, for the `t3-thread://` links the commands print. */
  readonly environmentId: EnvironmentId;
  /** Call one T3 MCP tool as a full-access client; a refusal fails with the tool's own code. */
  readonly callTool: (
    tool: string,
    args: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<unknown, AgentCliFailure>;
  /** Every active thread with its pending request, as the web reads the thread list. */
  readonly shellSnapshot: Effect.Effect<OrchestrationV2ShellSnapshot, AgentCliFailure>;
  /**
   * A thread's control state, as the web opens a thread: every runtime request and the recent
   * timeline. `full` reads the whole timeline.
   */
  readonly threadSnapshot: (
    threadId: ThreadId,
    options?: { readonly full?: boolean },
  ) => Effect.Effect<
    { readonly projection: OrchestrationV2ThreadProjection; readonly snapshotSequence: number },
    AgentCliFailure
  >;
  /** Dispatch one orchestration command as the person's client does. */
  readonly dispatch: (
    command: OrchestrationV2Command,
  ) => Effect.Effect<{ readonly sequence: number }, AgentCliFailure>;
  /** The live thread list, as the sidebar follows it. */
  readonly subscribeShell: (
    input: OrchestrationV2SubscribeShellInput,
  ) => Stream.Stream<OrchestrationV2ShellStreamItem, AgentCliFailure>;
}

const makeOwnerHttpClient = (origin: string) =>
  HttpApiClient.make(EnvironmentHttpApi, { baseUrl: origin });
const makeWsClient = RpcClient.make(WsRpcGroup);

/**
 * Run `use` against this Environment's running T3 server. Without one it fails with
 * `server_not_running` before issuing anything. Sessions are issued on first use and revoked when
 * `use` ends.
 */
export const withAgentCliConnection = Effect.fn("LazurioAgentCli.withConnection")(function* <
  A,
  E,
  R,
>(
  flags: { readonly baseDir: Option.Option<string> },
  use: (connection: AgentCliConnection) => Effect.Effect<A, E, R>,
  options?: { readonly sessionTtl?: Duration.Duration },
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  const state = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath).pipe(
    Effect.mapError(requestFailed),
  );
  if (Option.isNone(state) || !isProcessAlive(state.value.pid)) {
    return yield* serverNotRunning();
  }
  const origin = state.value.origin;
  const ttl = options?.sessionTtl ?? AGENT_CLI_SESSION_TTL;

  return yield* Effect.gen(function* () {
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const environmentId = yield* ServerEnvironment.ServerEnvironmentIdentity.pipe(
      Effect.flatMap((identity) => identity.getEnvironmentId),
    );
    const scope = yield* Effect.scope;
    /** Issued once, on first use, and revoked with this connection. */
    const lazily = <B>(acquire: Effect.Effect<B, AgentCliFailure, Scope.Scope>) =>
      Effect.cached(Effect.provideService(acquire, Scope.Scope, scope));
    const issue = (input: Parameters<typeof auth.issueSession>[0]) =>
      Effect.acquireRelease(
        auth
          .issueSession({ ...input, ttl, label: SESSION_LABEL })
          .pipe(
            Effect.mapError((cause) =>
              agentCliFailure(
                "auth_unavailable",
                `This command could not sign in to T3 Code: ${messageOf(cause)}`,
              ),
            ),
          ),
        (issued) => auth.revokeSession(issued.sessionId).pipe(Effect.ignore),
      ).pipe(Effect.map((issued) => issued.token));

    const mcp = yield* lazily(
      issue({
        subject: EnvironmentAuth.MCP_CLIENT_SUBJECT,
        scopes: mcpClientScopes("full-access"),
        runtimeModeCeiling: "full-access",
      }).pipe(
        Effect.flatMap((token) =>
          mcpToolSession({
            endpoint: new URL("/mcp", origin).href,
            authorization: `Bearer ${token}`,
            clientName: "t3-agent-cli",
          }).pipe(Effect.mapError(requestFailed)),
        ),
      ),
    );
    const ownerToken = yield* lazily(issue({ scopes: OWNER_SCOPES }));
    const http = yield* makeOwnerHttpClient(origin);
    const ownerHeaders = ownerToken.pipe(
      Effect.map(
        (token) =>
          ({
            authorization: `Bearer ${token}`,
            [ORCHESTRATION_PROTOCOL_HEADER]: ORCHESTRATION_PROTOCOL_VERSION_TEXT,
          }) as const,
      ),
    );
    const threadNotFound = (cause: unknown) =>
      typeof cause === "object" &&
      cause !== null &&
      "_tag" in cause &&
      cause._tag === "EnvironmentResourceNotFoundError"
        ? agentCliFailure("thread_not_found", "The thread was not found.")
        : requestFailed(cause);
    const ws = yield* lazily(
      Effect.gen(function* () {
        const token = yield* ownerToken;
        const url = new URL("/ws", origin);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set(
          ORCHESTRATION_PROTOCOL_QUERY_PARAM,
          String(ORCHESTRATION_PROTOCOL_VERSION),
        );
        const protocol = yield* Layer.build(
          Layer.effect(
            RpcClient.Protocol,
            RpcClient.makeProtocolSocket({
              retryTransientErrors: false,
              retryPolicy: Schedule.recurs(0),
            }),
          ).pipe(
            Layer.provide(
              Layer.mergeAll(
                // A header, not a ticket: the token never appears in a URL.
                NodeSocket.layerWebSocket(url.toString(), {
                  openTimeout: SOCKET_OPEN_TIMEOUT,
                  headers: { authorization: `Bearer ${token}` },
                }),
                RpcSerialization.layerJson,
              ),
            ),
          ),
        );
        return yield* makeWsClient.pipe(Effect.provide(protocol));
      }),
    );

    const connection: AgentCliConnection = {
      stateDir: config.stateDir,
      environmentId,
      callTool: (tool, args) =>
        mcp.pipe(
          Effect.flatMap((session) =>
            session.call(tool, args).pipe(Effect.mapError(requestFailed)),
          ),
          Effect.flatMap(toolCallOutcome),
        ),
      shellSnapshot: ownerHeaders.pipe(
        Effect.flatMap((headers) => http.orchestration.shellSnapshot({ query: {}, headers })),
        Effect.mapError((cause) => (isAgentCliFailure(cause) ? cause : requestFailed(cause))),
      ),
      threadSnapshot: (threadId, readOptions) =>
        ownerHeaders.pipe(
          Effect.flatMap((headers) =>
            readOptions?.full === true
              ? http.orchestration.threadSnapshot({ params: { threadId }, headers })
              : http.orchestration.threadBoundedSnapshot({
                  params: { threadId },
                  query: {},
                  headers,
                }),
          ),
          Effect.map((snapshot) => ({
            projection: snapshot.projection,
            snapshotSequence: snapshot.snapshotSequence,
          })),
          Effect.mapError((cause) => (isAgentCliFailure(cause) ? cause : threadNotFound(cause))),
        ),
      dispatch: (command) =>
        ws.pipe(
          Effect.flatMap((client) => client[ORCHESTRATION_V2_WS_METHODS.dispatchCommand](command)),
          Effect.mapError((cause) =>
            isAgentCliFailure(cause)
              ? cause
              : typeof cause === "object" &&
                  cause !== null &&
                  "_tag" in cause &&
                  cause._tag === "OrchestrationV2DispatchCommandError"
                ? agentCliFailure("orchestration_error", messageOf(cause))
                : requestFailed(cause),
          ),
        ),
      subscribeShell: (input) =>
        Stream.unwrap(
          ws.pipe(
            Effect.map((client) => client[ORCHESTRATION_V2_WS_METHODS.subscribeShell](input)),
          ),
        ).pipe(
          Stream.mapError((cause) => (isAgentCliFailure(cause) ? cause : requestFailed(cause))),
        ),
    };
    return yield* use(connection);
  }).pipe(
    Effect.scoped,
    Effect.provide(
      Layer.mergeAll(
        EnvironmentAuth.layerRuntime.pipe(
          Layer.provide(ServerConfig.layer(config)),
          Layer.provide(Layer.succeed(References.MinimumLogLevel, "Error")),
        ),
        FetchHttpClient.layer,
      ),
    ),
  );
}, Effect.mapError(commandFailed));
