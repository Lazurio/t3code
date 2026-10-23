/**
 * Lazurio overlay (root decision 0210, addendum 3; plan DEV-6676): `t3 thread`, `t3 request`,
 * `t3 queue` and `t3 events`. Buddy and other agents in an Environment work with T3 Code's
 * threads through them as its owner does: read and summarize them, launch, message, steer and stop
 * them, answer their questions and decide their permission requests, and follow them live.
 *
 * Every command is a thin client of the running server (agentCliConnection.ts): an MCP tool where
 * one exists, so the CLI runs the same operations as any agent, and the person's own client surface
 * only for what no tool does. `--json` prints the result, or `{"error":{"code","message"}}`; the exit
 * code says how it ended (`AGENT_CLI_EXIT_CODES`). `docs/user/agent-cli.md` is the user's guide.
 */
import {
  CommandId,
  OrchestrationV2RunStatus,
  OrchestratorMcpThreadListResult,
  OrchestratorMcpThreadReadResult,
  type ProviderApprovalDecision,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import { Argument, Command, Flag } from "effect/cli";

import { DurationFromString, projectLocationFlags } from "../cli/config.ts";
import {
  runResultText,
  type ThreadTools,
  ThreadToolFailedError,
  waitForRun,
} from "../cli/thread.ts";
import {
  type AgentCliConnection,
  type AgentCliFailure,
  agentCliFailure,
  AGENT_CLI_SESSION_TTL,
  isAgentCliFailure,
  withAgentCliConnection,
} from "./agentCliConnection.ts";
import { agentCliSendIds, agentCliSendKey } from "./agentCliRequests.ts";
import { AGENT_CLI_SEND_STATE_ROUTE, SendState } from "./agentCliSendState.ts";
import {
  makeEventTracker,
  mergeThreadLists,
  type PendingRequest,
  pendingRequestsOf,
} from "./agentCliViews.ts";
import { readModelRecommendationRecord } from "./modelRecommendation.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const jsonFlag = Flag.Boolean("json").pipe(
  Flag.withDescription('Print JSON: the result, or {"error":{"code":…,"message":…}}.'),
  Flag.withDefault(false),
);
const common = { ...projectLocationFlags, json: jsonFlag };
/** The flags every agent command takes: the T3 home and `--json`. */
export const agentCommandFlags = common;
type CommonFlags = { readonly baseDir: Option.Option<string>; readonly json: boolean };

/**
 * Print a command's failure: with --json as `{"error":…}` on standard output, otherwise its message
 * on standard error.
 */
const printFailure = (flags: { readonly json: boolean }, error: unknown) =>
  isAgentCliFailure(error)
    ? flags.json
      ? Console.log(encodeJson({ error: { code: error.code, message: error.message } }))
      : Console.error(error.message)
    : Effect.void;

/**
 * Run a command against the running server and print its result as text or JSON. `check` reads
 * the command line first, so one that cannot work fails before anything is read, whether or not
 * T3 Code is running; `body` gets what it returns. Every failure is printed the same way and then
 * fails the command, so its exit code follows.
 */
const runChecked = <C, RC, A, E, R>(
  flags: CommonFlags,
  check: Effect.Effect<C, AgentCliFailure, RC>,
  body: (connection: AgentCliConnection, checked: C) => Effect.Effect<A, E, R>,
  text: (value: A) => string,
  options?: { readonly sessionTtl?: Duration.Duration },
) =>
  check.pipe(
    Effect.flatMap((checked) =>
      withAgentCliConnection(flags, (connection) => body(connection, checked), options),
    ),
    Effect.tap((value) => Console.log(flags.json ? encodeJson(value) : text(value))),
    Effect.tapError((error) => printFailure(flags, error)),
  );

/** `runChecked` for a command line with nothing to check beyond what `t3` parses. */
const run = <A, E, R>(
  flags: CommonFlags,
  body: (connection: AgentCliConnection) => Effect.Effect<A, E, R>,
  text: (value: A) => string,
  options?: { readonly sessionTtl?: Duration.Duration },
) => runChecked(flags, Effect.void, body, text, options);

/** How an agent command outside this file runs: as `run` runs the ones here. */
export const runAgentCommand = run;

/** Call a tool and decode the part of its answer the command reads. */
const callAs = <S extends Schema.Top>(
  connection: AgentCliConnection,
  tool: string,
  args: Readonly<Record<string, unknown>>,
  schema: S,
) =>
  connection
    .callTool(tool, args)
    .pipe(
      Effect.flatMap((value) =>
        Schema.decodeUnknownEffect(schema)(value).pipe(
          Effect.mapError(() =>
            agentCliFailure(
              "request_failed",
              `T3 Code answered ${tool} in a shape this CLI cannot read.`,
            ),
          ),
        ),
      ),
    );

/**
 * Text for a tool's result, read through `schema`; JSON output prints the tool's own result, so a
 * field this CLI does not read still reaches an agent.
 */
const textAs =
  <A>(schema: Schema.Decoder<A>, format: (value: A) => string) =>
  (value: unknown) =>
    Option.match(Schema.decodeUnknownOption(schema)(value), {
      onNone: () => encodeJson(value),
      onSome: format,
    });

/** Only the arguments that are set. */
const defined = (args: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));

const threadIdArgument = Argument.String("thread-id").pipe(
  Argument.withDescription("The thread's id, as `t3 thread list` prints it."),
);
const messageArgument = Argument.String("message").pipe(
  Argument.withDescription(
    "The message, or - to read it from standard input. Or pass --message-file.",
  ),
  Argument.optional,
);
const messageFileFlag = Flag.String("message-file").pipe(
  Flag.withDescription("Read the message from this file, or from standard input with -."),
  Flag.optional,
);

/** The message from the argument or `--message-file`, never both; `-` reads standard input. */
const readMessage = Effect.fn("LazurioAgentCli.readMessage")(
  function* (input: {
    readonly message: Option.Option<string>;
    readonly messageFile: Option.Option<string>;
    readonly required: boolean;
  }) {
    if (Option.isSome(input.message) && Option.isSome(input.messageFile)) {
      return yield* agentCliFailure(
        "invalid_request",
        "Pass the message or --message-file, not both.",
      );
    }
    if (Option.isSome(input.message) && input.message.value !== "-") {
      return Option.some(input.message.value);
    }
    const file = Option.isSome(input.message) ? input.message : input.messageFile;
    if (Option.isSome(file)) {
      const path = file.value;
      const text =
        path === "-"
          ? yield* Stdio.Stdio.pipe(
              Effect.flatMap((stdio) => stdio.stdin.pipe(Stream.decodeText(), Stream.mkString)),
            )
          : yield* FileSystem.FileSystem.pipe(Effect.flatMap((fs) => fs.readFileString(path)));
      return Option.some(text);
    }
    if (input.required) {
      return yield* agentCliFailure("invalid_request", "Pass the message, or --message-file.");
    }
    return Option.none<string>();
  },
  Effect.mapError((cause) =>
    isAgentCliFailure(cause)
      ? cause
      : agentCliFailure("invalid_request", `The message could not be read: ${String(cause)}`),
  ),
);

// Projects

const ProjectPage = Schema.Struct({
  projects: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
  nextCursor: Schema.NullOr(Schema.Number),
});
type ProjectRef = (typeof ProjectPage.Type)["projects"][number];

const listProjects = Effect.fn("LazurioAgentCli.listProjects")(function* (
  connection: AgentCliConnection,
) {
  const projects: Array<ProjectRef> = [];
  let cursor: number | null = 0;
  while (cursor !== null) {
    const page: typeof ProjectPage.Type = yield* callAs(
      connection,
      "t3_project_list",
      { cursor, limit: 100 },
      ProjectPage,
    );
    projects.push(...page.projects);
    cursor = page.nextCursor;
  }
  return projects;
});

/** A project named by its id or, failing that, its title. */
const resolveProject = (connection: AgentCliConnection, idOrTitle: string) =>
  listProjects(connection).pipe(
    Effect.flatMap((projects) => {
      const match =
        projects.find((project) => project.id === idOrTitle) ??
        projects.find((project) => project.title.toLowerCase() === idOrTitle.toLowerCase());
      return match === undefined
        ? Effect.fail(agentCliFailure("project_not_found", `No project ${idOrTitle}.`))
        : Effect.succeed(match);
    }),
  );

const projectFlag = Flag.String("project").pipe(
  Flag.withDescription("Only this project's threads: its id or title."),
  Flag.optional,
);

// t3 thread

const THREAD_STATUSES = ["idle", ...OrchestrationV2RunStatus.literals] as const;

const formatThreadList = (result: ReturnType<typeof mergeThreadLists>) =>
  [
    ...result.threads.map(
      (thread) =>
        `${thread.status.padEnd(11)} ${thread.threadId}  ${thread.title}  (${thread.projectTitle})`,
    ),
    result.threads.length < result.total
      ? `${result.threads.length} of ${result.total} threads; --limit shows more.`
      : `${result.total} threads.`,
  ].join("\n");

const threadListCommand = Command.make("list", {
  ...common,
  project: projectFlag,
  status: Flag.Literals("status", THREAD_STATUSES).pipe(
    Flag.withDescription(
      "Only threads in this state, for example waiting or running; repeat for several.",
    ),
    Flag.atLeast(0),
  ),
  settled: Flag.Boolean("settled").pipe(
    Flag.withDescription("Only settled threads; --no-settled lists the active ones."),
    Flag.optional,
  ),
  title: Flag.String("title").pipe(
    Flag.withDescription("Only threads whose title contains this text."),
    Flag.optional,
  ),
  subagents: Flag.Boolean("subagents").pipe(
    Flag.withDescription("Include threads of delegated subagents."),
    Flag.withDefault(false),
  ),
  limit: Flag.Int("limit").pipe(
    Flag.withDescription("At most this many threads, newest change first (1-100)."),
    Flag.withDefault(20),
  ),
}).pipe(
  Command.withDescription("List threads across all projects, newest change first."),
  Command.withHandler((flags) =>
    run(
      flags,
      (connection) =>
        Effect.gen(function* () {
          const projects = Option.isSome(flags.project)
            ? [yield* resolveProject(connection, flags.project.value)]
            : yield* listProjects(connection);
          const pages = yield* Effect.forEach(
            projects,
            (project) =>
              callAs(
                connection,
                "t3_thread_list",
                defined({
                  projectId: project.id,
                  includeSubagents: flags.subagents,
                  limit: flags.limit,
                  statuses: flags.status.length > 0 ? flags.status : undefined,
                  settled: Option.getOrUndefined(flags.settled),
                  titleContains: Option.getOrUndefined(flags.title),
                }),
                OrchestratorMcpThreadListResult,
              ).pipe(Effect.map((page) => ({ project, page }))),
            { concurrency: 4 },
          );
          return mergeThreadLists(pages, flags.limit);
        }),
      formatThreadList,
    ),
  ),
);

const formatThreadRead = (result: OrchestratorMcpThreadReadResult) =>
  [
    `${result.thread.title} (${result.thread.status}, ${result.thread.model}) ${result.thread.threadId}`,
    ...result.items.map((item) => {
      const label =
        item.type === "user_message"
          ? "user"
          : item.type === "assistant_message"
            ? "assistant"
            : item.type;
      const head = `[${item.position}] ${label}${item.title === null ? "" : `: ${item.title}`}`;
      return item.text === null || item.text.length === 0 ? head : `${head}\n${item.text}`;
    }),
    ...(result.hasMore && result.nextPosition !== null
      ? [`More: --after ${result.nextPosition}`]
      : []),
  ].join("\n\n");

const threadReadCommand = Command.make("read", {
  ...common,
  threadId: threadIdArgument,
  view: Flag.Literals("view", ["messages", "activity"]).pipe(
    Flag.withDescription("messages: what people and agents said (default); activity: every step."),
    Flag.optional,
  ),
  after: Flag.Int("after").pipe(
    Flag.withDescription("Continue after this position, as the last page's nextPosition says."),
    Flag.optional,
  ),
  limit: Flag.Int("limit").pipe(
    Flag.withDescription("At most this many items (1-100)."),
    Flag.optional,
  ),
  item: Flag.String("item").pipe(
    Flag.withDescription("Read one item's long text, with --text-offset."),
    Flag.optional,
  ),
  textOffset: Flag.Int("text-offset").pipe(
    Flag.withDescription("Where to continue the item's text, as nextTextOffset says."),
    Flag.optional,
  ),
  maxChars: Flag.Int("max-chars").pipe(
    Flag.withDescription("Cut each item's text at this many characters."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Read a thread: its state and a page of its timeline."),
  Command.withHandler((flags) =>
    run(
      flags,
      (connection) =>
        connection.callTool(
          "t3_thread_read",
          defined({
            threadId: flags.threadId,
            view: Option.getOrUndefined(flags.view),
            afterPosition: Option.getOrUndefined(flags.after),
            limit: Option.getOrUndefined(flags.limit),
            itemId: Option.getOrUndefined(flags.item),
            textOffset: Option.getOrUndefined(flags.textOffset),
            maxCharsPerItem: Option.getOrUndefined(flags.maxChars),
          }),
        ),
      textAs(OrchestratorMcpThreadReadResult, formatThreadRead),
    ),
  ),
);

const SearchResult = Schema.Struct({
  matches: Schema.Array(Schema.Struct({ threadId: Schema.String, snippet: Schema.String })),
});

const threadSearchCommand = Command.make("search", {
  ...common,
  query: Argument.String("query").pipe(
    Argument.withDescription("Words in a thread's title or messages."),
  ),
  project: projectFlag,
  limit: Flag.Int("limit").pipe(
    Flag.withDescription("At most this many matches (1-50)."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Search threads' titles and messages in every project."),
  Command.withHandler((flags) =>
    run(
      flags,
      (connection) =>
        Effect.gen(function* () {
          const project = Option.isSome(flags.project)
            ? yield* resolveProject(connection, flags.project.value)
            : undefined;
          return yield* connection.callTool(
            "t3_thread_search",
            defined({
              query: flags.query,
              limit: Option.getOrUndefined(flags.limit),
              projectId: project?.id,
            }),
          );
        }),
      textAs(SearchResult, ({ matches }) =>
        matches.length === 0
          ? "No matches."
          : matches.map((match) => `${match.threadId}  ${match.snippet}`).join("\n"),
      ),
    ),
  ),
);

/**
 * The project a new thread starts in without --project: the Environment's Lazurio Folder, which
 * the managed startup records, or none.
 */
const folderProject = (connection: AgentCliConnection) =>
  readModelRecommendationRecord(connection.stateDir).pipe(
    Effect.map(Option.map((record) => record.projectId)),
  );

const LaunchResult = Schema.Struct({
  threadId: Schema.String,
  projectId: Schema.String,
  runId: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.String),
});

const threadLaunchCommand = Command.make("launch", {
  ...common,
  message: messageArgument,
  messageFile: messageFileFlag,
  title: Flag.String("title").pipe(Flag.withDescription("The thread's title.")),
  project: Flag.String("project").pipe(
    Flag.withDescription(
      "The project: its id or title. Without it the Environment's Lazurio Folder project.",
    ),
    Flag.optional,
  ),
  scratch: Flag.Boolean("scratch").pipe(
    Flag.withDescription("Start outside any project, in a fresh folder of its own."),
    Flag.withDefault(false),
  ),
  base: Flag.String("base").pipe(
    Flag.withDescription("Start in a new worktree from this ref, for example main."),
    Flag.optional,
  ),
  fromOrigin: Flag.Boolean("from-origin").pipe(
    Flag.withDescription("With --base: start from the remote's version of the ref."),
    Flag.withDefault(false),
  ),
  existingWorktree: Flag.String("existing-worktree").pipe(
    Flag.withDescription("Start in this existing worktree of the project (absolute path)."),
    Flag.optional,
  ),
  branch: Flag.String("branch").pipe(
    Flag.withDescription("The new worktree's branch, or the existing worktree's."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription(
    "Start a new thread with its project's model and runtime mode, as a new thread in the app gets them; the message is its first task.",
  ),
  Command.withHandler((flags) =>
    runChecked(
      flags,
      Effect.gen(function* () {
        if (Option.isSome(flags.base) && Option.isSome(flags.existingWorktree)) {
          return yield* agentCliFailure(
            "invalid_request",
            "Pass --base or --existing-worktree, not both.",
          );
        }
        if (flags.fromOrigin && Option.isNone(flags.base)) {
          return yield* agentCliFailure("invalid_request", "--from-origin needs --base.");
        }
        if (
          Option.isSome(flags.branch) &&
          Option.isNone(flags.base) &&
          Option.isNone(flags.existingWorktree)
        ) {
          return yield* agentCliFailure(
            "invalid_request",
            "--branch needs --base or --existing-worktree.",
          );
        }
        if (flags.scratch && Option.isSome(flags.project)) {
          return yield* agentCliFailure(
            "invalid_request",
            "Pass --project or --scratch, not both.",
          );
        }
        return yield* readMessage({ ...flags, required: false });
      }),
      (connection, message) =>
        Effect.gen(function* () {
          const projectId = flags.scratch
            ? undefined
            : Option.isSome(flags.project)
              ? (yield* resolveProject(connection, flags.project.value)).id
              : Option.getOrUndefined(yield* folderProject(connection));
          if (!flags.scratch && projectId === undefined) {
            return yield* agentCliFailure(
              "target_required",
              "Pass --project: this Environment has no Lazurio Folder project.",
            );
          }
          const branch = Option.getOrUndefined(flags.branch);
          const workspaceStrategy = Option.isSome(flags.existingWorktree)
            ? defined({
                type: "existing_worktree",
                worktreePath: flags.existingWorktree.value,
                branch,
              })
            : Option.isSome(flags.base)
              ? defined({
                  type: "worktree",
                  baseRef: flags.base.value,
                  branch,
                  startFromOrigin: flags.fromOrigin ? true : undefined,
                })
              : undefined;
          // No model or runtime mode, like a hand-off from the Launchpad (root decision 0189): T3
          // starts a thread launched from outside a thread with its project's defaults, as the
          // app's composer does, or refuses where no model is set.
          return yield* connection.callTool(
            "t3_thread_launch",
            defined({
              title: flags.title,
              projectId,
              scratch: flags.scratch ? true : undefined,
              message: Option.getOrUndefined(message),
              workspaceStrategy,
            }),
          );
        }),
      textAs(
        LaunchResult,
        (result) =>
          `Launched ${result.threadId} in project ${result.projectId}${result.status === null ? "." : ` (${result.status}).`}`,
      ),
    ),
  ),
);

const SendResult = Schema.Struct({
  threadId: Schema.String,
  runId: Schema.NullOr(Schema.String),
  status: Schema.optional(Schema.String),
  delivery: Schema.String,
});
const decodeSendResult = Schema.decodeUnknownEffect(SendResult);

/** What `send --wait` prints: the send's result with the run it waited for and how it ended. */
const SentRun = Schema.Struct({
  threadId: Schema.String,
  runId: Schema.String,
  status: Schema.String,
  reply: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
const decodeSentRun = Schema.decodeUnknownOption(SentRun);

/** T3 checks the session on every call of a wait, which lasts as long as the run. */
const SEND_WAIT_SESSION_TTL = Duration.days(1);

/** This connection as upstream's `t3 thread` tools, whose wait `send --wait` reuses. */
const threadToolsOf = (connection: AgentCliConnection): ThreadTools => ({
  call: (tool, args, schema) =>
    connection.callTool(tool, args).pipe(
      Effect.flatMap((value) => Schema.decodeUnknownEffect(schema)(value)),
      Effect.mapError(
        (cause) =>
          new ThreadToolFailedError({
            tool,
            detail: isAgentCliFailure(cause)
              ? cause.message
              : `T3 Code answered ${tool} in a shape this CLI cannot read.`,
          }),
      ),
    ),
});

/**
 * Wait for exactly the run a send started, following a restart to its continuation, as upstream's
 * `t3 thread send --wait` does: its reply when it completed, its error when it did not, or the
 * status `waiting` while it waits for an answer.
 */
const waitForSentRun = Effect.fn("LazurioAgentCli.waitForSentRun")(
  function* (connection: AgentCliConnection, sent: unknown) {
    const result = yield* decodeSendResult(sent).pipe(
      Effect.mapError(() =>
        agentCliFailure(
          "request_failed",
          "T3 Code answered t3_thread_send in a shape this CLI cannot read.",
        ),
      ),
    );
    if (result.runId === null) {
      return yield* agentCliFailure(
        "request_failed",
        "T3 Code named no run for this send, so there is nothing to wait for.",
      );
    }
    const tools = threadToolsOf(connection);
    const threadId = ThreadId.make(result.threadId);
    const sentRunId = RunId.make(result.runId);
    const outcome = yield* waitForRun(tools, threadId, sentRunId);
    const runId = (outcome.type === "ended" ? outcome.runId : null) ?? sentRunId;
    const status = outcome.type === "ended" ? outcome.status : "waiting";
    const reply =
      status === "completed"
        ? yield* runResultText(tools, threadId, runId, "assistant_message")
        : null;
    const error =
      status === "completed" || status === "waiting"
        ? null
        : yield* runResultText(tools, threadId, runId, "error");
    return {
      ...(typeof sent === "object" && sent !== null ? sent : {}),
      runId,
      status,
      reply,
      error,
    };
  },
  Effect.mapError((cause) =>
    isAgentCliFailure(cause) ? cause : agentCliFailure("request_failed", cause.message),
  ),
);

const formatSentRun = (run: typeof SentRun.Type) =>
  run.status === "completed"
    ? (run.reply ?? `${run.threadId}: completed.`)
    : run.status === "waiting"
      ? `${run.threadId} is waiting for an answer; t3 request list --thread ${run.threadId} shows it.`
      : `${run.threadId}: ${run.status}${run.error === null ? "." : `: ${run.error}`}`;

/**
 * How `send --wait` ends once it printed the run: exit 1 when the run did not complete, and 2 while
 * it waits for an answer, so a script tells "needs a person" from a failed run.
 */
const sentRunExit = (value: unknown) =>
  Option.match(decodeSentRun(value), {
    onNone: () => Effect.void,
    onSome: (run) =>
      run.status === "completed"
        ? Effect.void
        : Effect.fail(
            run.status === "waiting"
              ? agentCliFailure("needs_input", `Thread ${run.threadId} is waiting for an answer.`)
              : agentCliFailure(
                  "run_failed",
                  `Thread ${run.threadId} stopped with status ${run.status}.`,
                ),
          ),
  });

const decodeSendState = Schema.decodeUnknownOption(SendState);

/** What T3 recorded of a keyed send; nothing from a T3 without the route, or when unreachable. */
const sendStateOf = (
  connection: AgentCliConnection,
  request: { readonly threadId: string; readonly commandId: string; readonly messageId: string },
) =>
  connection.postRoute(AGENT_CLI_SEND_STATE_ROUTE, request).pipe(
    Effect.map(({ status, body }) =>
      status === 200 ? Option.getOrUndefined(decodeSendState(body)) : undefined,
    ),
    Effect.orElseSucceed(() => undefined),
  );

const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Send once per key: T3 runs the key's command once and replays its receipt for a repeat. A repeat
 * with another message is refused, and so is a key T3 refused. A repeat whose message T3 delivered
 * but cannot replay, such as on a thread archived since, answers "delivered" without a run to wait
 * for.
 */
const sendOnce = Effect.fn("LazurioAgentCli.sendOnce")(function* (
  connection: AgentCliConnection,
  input: {
    readonly threadId: string;
    readonly text: string;
    readonly send: (clientRequestId: string) => Effect.Effect<unknown, AgentCliFailure>;
  },
  key: string,
) {
  const sendKey = yield* agentCliSendKey({ threadId: input.threadId, key });
  const ids = agentCliSendIds(sendKey);
  const sent = yield* Effect.result(input.send(sendKey));
  const state = yield* sendStateOf(connection, { threadId: input.threadId, ...ids });
  const stored = state?.message ?? null;
  // T3's tool trims the message as it decodes it (OrchestratorMcpPrompt), so the same trim tells
  // whether this is the stored message.
  if (stored !== null && stored.text !== input.text.trim())
    return yield* agentCliFailure(
      "idempotency_conflict",
      "This key already sent another message to this thread, so nothing was sent. Send this message with a new key.",
    );
  if (Result.isSuccess(sent))
    return { result: { ...asObject(sent.success), commandId: ids.commandId }, waitable: true };
  // T3 checks the thread before it replays a receipt, so a repeat can fail although the key's
  // message was delivered.
  if (state?.receipt?.status === "accepted" && stored !== null)
    return {
      result: {
        threadId: input.threadId,
        messageId: ids.messageId,
        runId: stored.runId,
        delivery: "delivered",
        commandId: ids.commandId,
      },
      waitable: false,
    };
  if (state?.receipt?.status === "rejected")
    return yield* agentCliFailure(
      "command_rejected",
      `T3 Code refused the message for this key${state.receipt.error === null ? "." : `: ${state.receipt.error}`} A key T3 Code refused stays refused.`,
    );
  return yield* sent.failure;
});

const formatSendResult = (result: typeof SendResult.Type) =>
  result.status === undefined
    ? `${result.threadId}: ${result.delivery} earlier (run ${result.runId ?? "none"}).`
    : `${result.threadId}: ${result.delivery} (run ${result.runId}, ${result.status}).`;

/** A send's text: the awaited run when `--wait` waited, otherwise the delivery. */
const formatSend = (value: unknown) =>
  Option.match(decodeSentRun(value), {
    onSome: formatSentRun,
    onNone: () => textAs(SendResult, formatSendResult)(value),
  });

const threadSendCommand = Command.make("send", {
  ...common,
  threadId: threadIdArgument,
  message: messageArgument,
  messageFile: messageFileFlag,
  mode: Flag.Literals("mode", ["auto", "queue", "steer", "restart"]).pipe(
    Flag.withDescription(
      "queue (default): a turn of its own after the running one, which goes on; auto: start an idle thread, steer a running turn or queue behind it; steer: into the running turn; restart: stop the running turn and start again with this.",
    ),
    Flag.withDefault("queue"),
  ),
  wait: Flag.Boolean("wait").pipe(
    Flag.withDescription(
      "Wait for the run the message starts and print its reply. Exits 1 if the run fails and 2 if it waits for an answer.",
    ),
    Flag.withDefault(false),
  ),
  idempotencyKey: Flag.String("idempotency-key").pipe(
    Flag.withDescription(
      "Send once per key, also across commands and restarts: a repeat with the same key sends nothing and prints the first send's result.",
    ),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Send a message to a thread, as its user would."),
  Command.withHandler((flags) =>
    runChecked(
      flags,
      readMessage({ ...flags, required: true }),
      (connection, message) =>
        Effect.gen(function* () {
          const text = Option.getOrElse(message, () => "");
          const send = (clientRequestId?: string) =>
            connection.callTool(
              "t3_thread_send",
              defined({
                threadId: flags.threadId,
                message: text,
                mode: flags.mode,
                clientRequestId,
              }),
            );
          const { result, waitable } = Option.isNone(flags.idempotencyKey)
            ? { result: yield* send(), waitable: true }
            : yield* sendOnce(
                connection,
                { threadId: flags.threadId, text, send },
                flags.idempotencyKey.value,
              );
          // A key's repeat waits on the run of the first send, whose receipt T3 replays.
          return flags.wait && waitable ? yield* waitForSentRun(connection, result) : result;
        }),
      formatSend,
      flags.wait ? { sessionTtl: SEND_WAIT_SESSION_TTL } : undefined,
    ).pipe(Effect.flatMap((value) => (flags.wait ? sentRunExit(value) : Effect.void))),
  ),
);

const InterruptResult = Schema.Struct({
  threadId: Schema.String,
  runId: Schema.NullOr(Schema.String),
  status: Schema.String,
});

const threadInterruptCommand = Command.make("interrupt", {
  ...common,
  threadId: threadIdArgument,
  run: Flag.String("run").pipe(
    Flag.withDescription("This run; without it the newest one that is running."),
    Flag.optional,
  ),
  reason: Flag.String("reason").pipe(
    Flag.withDescription("Why, for the thread's record."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Stop a thread's running turn."),
  Command.withHandler((flags) =>
    run(
      flags,
      (connection) =>
        connection.callTool(
          "t3_thread_interrupt",
          defined({
            threadId: flags.threadId,
            runId: Option.getOrUndefined(flags.run),
            reason: Option.getOrUndefined(flags.reason),
          }),
        ),
      textAs(InterruptResult, (result) => `${result.threadId}: ${result.status}.`),
    ),
  ),
);

const WaitResult = Schema.Struct({
  threadId: Schema.String,
  runId: Schema.NullOr(Schema.String),
  status: Schema.String,
  timedOut: Schema.Boolean,
});
const decodeWaitResult = Schema.decodeUnknownOption(WaitResult);
const DEFAULT_WAIT = Duration.minutes(10);

const threadWaitCommand = Command.make("wait", {
  ...common,
  threadId: threadIdArgument,
  run: Flag.String("run").pipe(
    Flag.withDescription("This run; without it the thread's latest one."),
    Flag.optional,
  ),
  timeout: Flag.String("timeout").pipe(
    Flag.withSchema(DurationFromString),
    Flag.withDescription("How long to wait, for example 30s, 10m (default) or 1h (the most)."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription(
    "Wait until a thread's run finishes. On timeout it exits 4 and the run goes on.",
  ),
  Command.withHandler((flags) => {
    const timeout = Option.getOrElse(flags.timeout, () => DEFAULT_WAIT);
    return run(
      flags,
      (connection) =>
        connection.callTool(
          "t3_thread_wait",
          defined({
            threadId: flags.threadId,
            runId: Option.getOrUndefined(flags.run),
            timeoutMs: Duration.toMillis(timeout),
          }),
        ),
      textAs(WaitResult, (result) =>
        result.timedOut
          ? `${result.threadId}: still ${result.status} after the timeout.`
          : `${result.threadId}: ${result.status}.`,
      ),
      // T3 checks the session when the wait starts; this keeps it valid for the whole wait.
      { sessionTtl: Duration.sum(timeout, AGENT_CLI_SESSION_TTL) },
    ).pipe(
      Effect.flatMap((result) =>
        decodeWaitResult(result).pipe(Option.exists((waited) => waited.timedOut))
          ? Effect.fail(
              agentCliFailure(
                "wait_timed_out",
                "The run had not finished when the wait timed out.",
              ),
            )
          : Effect.void,
      ),
    );
  }),
);

const decodeDuration = Schema.decodeEffect(DurationFromString);

/** An ISO time, or a duration from now such as 2h. */
const untilTime = (value: string) =>
  decodeDuration(value).pipe(
    Effect.flatMap((duration) =>
      Clock.currentTimeMillis.pipe(
        Effect.map((now) =>
          DateTime.formatIso(DateTime.makeUnsafe(now + Duration.toMillis(duration))),
        ),
      ),
    ),
    Effect.catch(() =>
      Option.match(DateTime.make(value), {
        onNone: () =>
          Effect.fail(
            agentCliFailure(
              "invalid_request",
              `--until takes a time or a duration such as 2h, not ${value}.`,
            ),
          ),
        onSome: (time) => Effect.succeed(DateTime.formatIso(DateTime.toUtc(time))),
      }),
    ),
  );

const ORGANIZE_ACTIONS = [
  "pin",
  "unpin",
  "settle",
  "unsettle",
  "archive",
  "unarchive",
  "snooze",
  "unsnooze",
  "mark-unread",
] as const;

const threadOrganizeCommand = Command.make("organize", {
  ...common,
  threadId: threadIdArgument,
  action: Argument.Literals("action", ORGANIZE_ACTIONS).pipe(
    Argument.withDescription("What to do with the thread."),
  ),
  until: Flag.String("until").pipe(
    Flag.withDescription("With snooze: until this time, or for a duration such as 2h."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Pin, settle, archive or snooze a thread, or undo it."),
  Command.withHandler((flags) =>
    runChecked(
      flags,
      Effect.gen(function* () {
        if (flags.action === "snooze" && Option.isNone(flags.until)) {
          return yield* agentCliFailure("invalid_request", "snooze needs --until.");
        }
        return Option.isSome(flags.until) ? yield* untilTime(flags.until.value) : undefined;
      }),
      (connection, snoozedUntil) =>
        connection.callTool(
          "t3_thread_organize",
          defined({
            threadId: flags.threadId,
            action: flags.action === "mark-unread" ? "mark_unread" : flags.action,
            snoozedUntil,
          }),
        ),
      () => `${flags.action}: ${flags.threadId}.`,
    ),
  ),
);

const ForkResult = Schema.Struct({ targetThreadId: Schema.String });

const threadForkCommand = Command.make("fork", {
  ...common,
  threadId: threadIdArgument,
  run: Flag.String("run").pipe(
    Flag.withDescription("Fork after this finished run."),
    Flag.optional,
  ),
  checkpoint: Flag.String("checkpoint").pipe(
    Flag.withDescription("Fork at this checkpoint."),
    Flag.optional,
  ),
  title: Flag.String("title").pipe(Flag.withDescription("The new thread's title."), Flag.optional),
}).pipe(
  Command.withDescription(
    "Fork a thread into a new one with its history, from its latest stable point unless --run or --checkpoint.",
  ),
  Command.withHandler((flags) =>
    runChecked(
      flags,
      Effect.gen(function* () {
        if (Option.isSome(flags.run) && Option.isSome(flags.checkpoint)) {
          return yield* agentCliFailure("invalid_request", "Pass --run or --checkpoint, not both.");
        }
        return Option.isSome(flags.run)
          ? { type: "run", runId: flags.run.value }
          : Option.isSome(flags.checkpoint)
            ? { type: "checkpoint", checkpointId: flags.checkpoint.value }
            : { type: "latest_stable" };
      }),
      (connection, sourcePoint) =>
        connection.callTool(
          "t3_thread_fork",
          defined({
            threadId: flags.threadId,
            sourcePoint,
            title: Option.getOrUndefined(flags.title),
          }),
        ),
      textAs(ForkResult, (result) => `Forked ${flags.threadId} into ${result.targetThreadId}.`),
    ),
  ),
);

const threadSubcommands = [
  threadListCommand,
  threadReadCommand,
  threadSearchCommand,
  threadLaunchCommand,
  threadSendCommand,
  threadInterruptCommand,
  threadWaitCommand,
  threadOrganizeCommand,
  threadForkCommand,
] as const;

/**
 * `t3 thread`: these commands and upstream's own `t3 thread` in one group, because `t3` refuses to
 * start with two groups of one name. Where both have a command of a name, this one serves it, so
 * `list` and `send` keep this contract; upstream's others (`start` and `show`) stay its own.
 */
export const lazurioThreadCommand = <Name extends string, Input, ContextInput, E, R>(
  upstream: Command.Command<Name, Input, ContextInput, E, R>,
) => {
  const names = new Set<string>(threadSubcommands.map((command) => command.name));
  // Upstream's subcommands, whose errors and services the type of `upstream` carries.
  const upstreamOnly = upstream.subcommands
    .flatMap((group) => group.commands)
    .filter((command) => !names.has(command.name)) as ReadonlyArray<
    Command.Command<string, unknown, unknown, E, R>
  >;
  return Command.make("thread").pipe(
    Command.withDescription("Work with this Environment's T3 Code threads as their owner."),
    Command.withSubcommands([...threadSubcommands, ...upstreamOnly]),
  );
};

// t3 request

/**
 * The pending questions and approvals of one thread, or of every thread that waits on someone.
 * A thread's control state carries every request; a request whose details are older than its
 * recent timeline reads the whole thread.
 */
const pendingRequests = Effect.fn("LazurioAgentCli.pendingRequests")(function* (
  connection: AgentCliConnection,
  threadId: Option.Option<string>,
) {
  const threadIds = Option.isSome(threadId)
    ? [ThreadId.make(threadId.value)]
    : (yield* connection.shellSnapshot).threads
        .filter((thread) => thread.pendingRuntimeRequest !== null)
        .map((thread) => thread.id);
  const perThread = yield* Effect.forEach(
    threadIds,
    (id) =>
      connection.threadSnapshot(id).pipe(
        Effect.flatMap((snapshot) => {
          const found = pendingRequestsOf(snapshot.projection);
          return found.complete
            ? Effect.succeed(found.requests)
            : connection
                .threadSnapshot(id, { full: true })
                .pipe(Effect.map((full) => pendingRequestsOf(full.projection).requests));
        }),
      ),
    { concurrency: 4 },
  );
  return perThread.flat().toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
});

const findRequest = (
  connection: AgentCliConnection,
  requestId: string,
  threadId: Option.Option<string>,
) =>
  pendingRequests(connection, threadId).pipe(
    Effect.flatMap((requests) => {
      const request = requests.find((candidate) => candidate.requestId === requestId);
      return request === undefined
        ? Effect.fail(agentCliFailure("request_not_found", `No pending request ${requestId}.`))
        : Effect.succeed(request);
    }),
  );

const describeRequest = (request: PendingRequest) =>
  request.type === "question"
    ? `question ${request.requestId} in ${request.threadId} (${request.threadTitle})`
    : `approval ${request.requestId} in ${request.threadId} (${request.threadTitle}): ${request.kind}${request.prompt === undefined ? "" : ` ${request.prompt}`}`;

const requestIdArgument = Argument.String("request-id").pipe(
  Argument.withDescription("The request's id, as `t3 request list` prints it."),
);
const requestThreadFlag = Flag.String("thread").pipe(
  Flag.withDescription("Only this thread's requests; faster when you know it."),
  Flag.optional,
);

const requestListCommand = Command.make("list", { ...common, thread: requestThreadFlag }).pipe(
  Command.withDescription(
    "List the questions and permission requests threads wait on, oldest first.",
  ),
  Command.withHandler((flags) =>
    run(
      flags,
      (connection) =>
        pendingRequests(connection, flags.thread).pipe(Effect.map((requests) => ({ requests }))),
      ({ requests }) =>
        requests.length === 0
          ? "No thread waits on an answer."
          : requests.map(describeRequest).join("\n"),
    ),
  ),
);

const requestReadCommand = Command.make("read", {
  ...common,
  requestId: requestIdArgument,
  thread: requestThreadFlag,
}).pipe(
  Command.withDescription("Read a pending question or permission request in full."),
  Command.withHandler((flags) =>
    run(
      flags,
      (connection) => findRequest(connection, flags.requestId, flags.thread),
      (request) =>
        [
          describeRequest(request),
          ...(request.questions ?? []).map((question) => encodeJson(question)),
          ...(request.decisions === undefined
            ? []
            : [`Decisions: ${request.decisions.join(", ")}`]),
        ].join("\n"),
    ),
  ),
);

const decodeQuestionIds = Schema.decodeUnknownOption(
  Schema.Array(Schema.Struct({ id: Schema.String })),
);

const requestRespondCommand = Command.make("respond", {
  ...common,
  requestId: requestIdArgument,
  thread: requestThreadFlag,
  answer: Flag.String("answer").pipe(
    Flag.withDescription("The answer to a request with one question."),
    Flag.optional,
  ),
  answers: Flag.String("answers").pipe(
    Flag.withDescription('Answers by question id as JSON, for example {"q1":"Yes"}.'),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Answer a thread's question in its user's name."),
  Command.withHandler((flags) =>
    runChecked(
      flags,
      // The answers by question id that --answers gives, or none for --answer.
      Effect.gen(function* () {
        if (Option.isSome(flags.answer) === Option.isSome(flags.answers)) {
          return yield* agentCliFailure("invalid_request", "Pass --answer or --answers.");
        }
        if (Option.isNone(flags.answers)) return Option.none<object>();
        const parsed = Option.getOrUndefined(decodeJson(flags.answers.value));
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return yield* agentCliFailure("invalid_request", "--answers must be a JSON object.");
        }
        return Option.some(parsed);
      }),
      (connection, answersById) =>
        Effect.gen(function* () {
          const request = yield* findRequest(connection, flags.requestId, flags.thread);
          if (request.type !== "question") {
            return yield* agentCliFailure(
              "not_a_question",
              `${request.requestId} is a permission request: decide it with t3 request approve or deny.`,
            );
          }
          const questions = Option.getOrElse(decodeQuestionIds(request.questions ?? []), () => []);
          let answers: unknown;
          if (Option.isSome(answersById)) {
            answers = answersById.value;
          } else {
            const [only, ...more] = questions;
            if (only === undefined || more.length > 0) {
              return yield* agentCliFailure(
                "invalid_request",
                `This request asks ${questions.length} questions: answer each by id with --answers.`,
              );
            }
            answers = { [only.id]: Option.getOrElse(flags.answer, () => "") };
          }
          yield* connection.callTool("t3_pending_request_respond", {
            threadId: request.threadId,
            requestId: request.requestId,
            answers,
          });
          return { threadId: request.threadId, requestId: request.requestId, answered: true };
        }),
      (result) => `Answered ${result.requestId} in ${result.threadId}.`,
    ),
  ),
);

/**
 * Decide a permission request as the person does with its card's buttons: the same command the
 * web sends, through the person's client surface. No MCP tool decides one, by design.
 */
const decide = (
  flags: CommonFlags & { readonly requestId: string; readonly thread: Option.Option<string> },
  decision: ProviderApprovalDecision,
  check: Effect.Effect<void, AgentCliFailure> = Effect.void,
) =>
  runChecked(
    flags,
    check,
    (connection) =>
      Effect.gen(function* () {
        const request = yield* findRequest(connection, flags.requestId, flags.thread);
        if (request.type !== "approval") {
          return yield* agentCliFailure(
            "not_an_approval",
            `${request.requestId} is a question: answer it with t3 request respond.`,
          );
        }
        if (!request.answerable) {
          return yield* agentCliFailure(
            "request_not_answerable",
            "The agent can no longer take a decision on this request.",
          );
        }
        if (request.decisions !== undefined && !request.decisions.includes(decision)) {
          return yield* agentCliFailure(
            "invalid_request",
            `This request offers ${request.decisions.join(", ")}, not ${decision}.`,
          );
        }
        const id = yield* Crypto.Crypto.pipe(
          Effect.flatMap((crypto) => crypto.randomUUIDv4()),
          Effect.orDie,
        );
        const { sequence } = yield* connection.dispatch({
          type: "runtime-request.respond",
          commandId: CommandId.make(`agent-cli:${id}`),
          threadId: ThreadId.make(request.threadId),
          requestId: RuntimeRequestId.make(request.requestId),
          decision,
        });
        return { threadId: request.threadId, requestId: request.requestId, decision, sequence };
      }),
    (result) => `${result.decision}: ${result.requestId} in ${result.threadId}.`,
  );

const requestApproveCommand = Command.make("approve", {
  ...common,
  requestId: requestIdArgument,
  thread: requestThreadFlag,
  forSession: Flag.Boolean("for-session").pipe(
    Flag.withDescription("Allow it for the rest of the agent's session, where offered."),
    Flag.withDefault(false),
  ),
  always: Flag.Boolean("always").pipe(
    Flag.withDescription("Always allow it, where the provider offers that."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription("Approve a thread's permission request, as its user would."),
  Command.withHandler((flags) =>
    decide(
      flags,
      flags.always ? "acceptAlways" : flags.forSession ? "acceptForSession" : "accept",
      flags.forSession && flags.always
        ? Effect.fail(
            agentCliFailure("invalid_request", "Pass --for-session or --always, not both."),
          )
        : Effect.void,
    ),
  ),
);

const requestDenyCommand = Command.make("deny", {
  ...common,
  requestId: requestIdArgument,
  thread: requestThreadFlag,
  cancel: Flag.Boolean("cancel").pipe(
    Flag.withDescription("Cancel the agent's turn instead of only declining."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription("Decline a thread's permission request, as its user would."),
  Command.withHandler((flags) => decide(flags, flags.cancel ? "cancel" : "decline")),
);

export const requestCommand = Command.make("request").pipe(
  Command.withDescription("Answer the questions and permission requests threads wait on."),
  Command.withSubcommands([
    requestListCommand,
    requestReadCommand,
    requestRespondCommand,
    requestApproveCommand,
    requestDenyCommand,
  ]),
);

// t3 queue

const queuedRunArgument = Argument.String("queued-run-id").pipe(
  Argument.withDescription("The queued message's id, as `t3 queue list` prints it."),
);
const QueueList = Schema.Struct({
  items: Schema.Array(Schema.Struct({ queuedRunId: Schema.String, text: Schema.String })),
});
const QueueEntry = Schema.Struct({ text: Schema.String });

const queueListCommand = Command.make("list", {
  ...common,
  threadId: threadIdArgument,
  cursor: Flag.Int("cursor").pipe(
    Flag.withDescription("Continue at this nextCursor."),
    Flag.optional,
  ),
  limit: Flag.Int("limit").pipe(Flag.withDescription("At most this many (1-100)."), Flag.optional),
}).pipe(
  Command.withDescription("List a thread's queued messages in the order they will be sent."),
  Command.withHandler((flags) =>
    run(
      flags,
      (connection) =>
        connection.callTool(
          "t3_queue_list",
          defined({
            threadId: flags.threadId,
            cursor: Option.getOrUndefined(flags.cursor),
            limit: Option.getOrUndefined(flags.limit),
          }),
        ),
      textAs(QueueList, ({ items }) =>
        items.length === 0
          ? "Nothing is queued."
          : items.map((item) => `${item.queuedRunId}  ${item.text.split("\n")[0]}`).join("\n"),
      ),
    ),
  ),
);

const queueReadCommand = Command.make("read", {
  ...common,
  threadId: threadIdArgument,
  queuedRunId: queuedRunArgument,
}).pipe(
  Command.withDescription("Read a queued message."),
  Command.withHandler((flags) =>
    run(
      flags,
      (connection) =>
        connection.callTool("t3_queue_read", {
          threadId: flags.threadId,
          queuedRunId: flags.queuedRunId,
        }),
      textAs(QueueEntry, (entry) => entry.text),
    ),
  ),
);

const queueEditCommand = Command.make("edit", {
  ...common,
  threadId: threadIdArgument,
  queuedRunId: queuedRunArgument,
  message: messageArgument,
  messageFile: messageFileFlag,
}).pipe(
  Command.withDescription("Replace a queued message's text; its attachments stay."),
  Command.withHandler((flags) =>
    runChecked(
      flags,
      readMessage({ ...flags, required: true }),
      (connection, text) =>
        connection.callTool("t3_queue_edit", {
          threadId: flags.threadId,
          queuedRunId: flags.queuedRunId,
          text: Option.getOrElse(text, () => ""),
        }),
      () => `Edited ${flags.queuedRunId}.`,
    ),
  ),
);

const queueCancelCommand = Command.make("cancel", {
  ...common,
  threadId: threadIdArgument,
  queuedRunId: queuedRunArgument,
}).pipe(
  Command.withDescription("Remove a message from the queue."),
  Command.withHandler((flags) =>
    run(
      flags,
      (connection) =>
        connection.callTool("t3_queue_cancel", {
          threadId: flags.threadId,
          queuedRunId: flags.queuedRunId,
        }),
      () => `Cancelled ${flags.queuedRunId}.`,
    ),
  ),
);

const queueReorderCommand = Command.make("reorder", {
  ...common,
  threadId: threadIdArgument,
  queuedRunId: queuedRunArgument,
  before: Flag.String("before").pipe(
    Flag.withDescription("Move it before this queued message."),
    Flag.optional,
  ),
  last: Flag.Boolean("last").pipe(
    Flag.withDescription("Move it to the end."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription("Move a queued message before another one, or to the end."),
  Command.withHandler((flags) =>
    runChecked(
      flags,
      Option.isSome(flags.before) === flags.last
        ? Effect.fail(agentCliFailure("invalid_request", "Pass --before or --last."))
        : Effect.void,
      (connection) =>
        connection.callTool("t3_queue_reorder", {
          threadId: flags.threadId,
          queuedRunId: flags.queuedRunId,
          beforeRunId: Option.getOrNull(flags.before),
        }),
      () => `Moved ${flags.queuedRunId}.`,
    ),
  ),
);

const ActiveRun = Schema.Struct({
  thread: Schema.Struct({ activeRunId: Schema.NullOr(Schema.String) }),
});

const queuePromoteCommand = Command.make("promote", {
  ...common,
  threadId: threadIdArgument,
  queuedRunId: queuedRunArgument,
  run: Flag.String("run").pipe(
    Flag.withDescription("Steer into this run; without it the one that is running."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Send a queued message now, as steering into the running turn."),
  Command.withHandler((flags) =>
    run(
      flags,
      (connection) =>
        Effect.gen(function* () {
          const targetRunId = Option.isSome(flags.run)
            ? flags.run.value
            : (yield* callAs(
                connection,
                "t3_thread_read",
                { threadId: flags.threadId, limit: 1 },
                ActiveRun,
              )).thread.activeRunId;
          if (targetRunId === null) {
            return yield* agentCliFailure(
              "thread_not_running",
              "Nothing is running in this thread to steer into.",
            );
          }
          return yield* connection.callTool("t3_queue_promote_to_steer", {
            threadId: flags.threadId,
            queuedRunId: flags.queuedRunId,
            targetRunId,
          });
        }),
      () => `Sent ${flags.queuedRunId} as steering.`,
    ),
  ),
);

export const queueCommand = Command.make("queue").pipe(
  Command.withDescription("Work with the messages queued behind a thread's running turn."),
  Command.withSubcommands([
    queueListCommand,
    queueReadCommand,
    queueEditCommand,
    queueCancelCommand,
    queueReorderCommand,
    queuePromoteCommand,
  ]),
);

// t3 events

/** A followed stream reconnects with a fresh session; T3 ends a socket when its session expires. */
const EVENTS_SESSION_TTL = Duration.hours(1);
/** Right away after a stream that ran, as when its session expired; slower while T3 is down. */
const RECONNECT_DELAYS = [0, 1, 2, 5, 10, 30].map((seconds) => Duration.seconds(seconds));

export const eventsCommand = Command.make("events", {
  ...common,
  follow: Flag.Boolean("follow").pipe(
    Flag.withDescription("Keep printing changes until stopped; reconnects when T3 Code restarts."),
    Flag.withDefault(false),
  ),
  project: Flag.String("project").pipe(
    Flag.withDescription("Only this project's threads (its id)."),
    Flag.optional,
  ),
  thread: Flag.String("thread").pipe(Flag.withDescription("Only this thread."), Flag.optional),
  subagents: Flag.Boolean("subagents").pipe(
    Flag.withDescription("Include threads of delegated subagents."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription(
    "Print each thread's state as a JSON line, then a synced line; with --follow, a line whenever one changes. The output is JSON lines with or without --json.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const tracker = makeEventTracker({
        projectId: Option.getOrUndefined(flags.project),
        threadId: Option.getOrUndefined(flags.thread),
        subagents: flags.subagents,
      });
      const received = yield* Ref.make(false);
      const connect = withAgentCliConnection(
        flags,
        (connection) =>
          connection
            .subscribeShell({
              requestCompletionMarker: true,
              ...(tracker.sequence === null ? {} : { afterSequence: tracker.sequence }),
            })
            .pipe(
              (stream) =>
                flags.follow
                  ? stream
                  : Stream.takeUntil(stream, (item) => item.kind === "synchronized"),
              Stream.runForEach((item) =>
                Effect.gen(function* () {
                  yield* Ref.set(received, true);
                  const now = yield* Clock.currentTimeMillis;
                  for (const line of tracker.apply(item, now)) {
                    yield* Console.log(encodeJson(line));
                  }
                }),
              ),
            ),
        { sessionTtl: EVENTS_SESSION_TTL },
      );
      if (!flags.follow) return yield* connect;
      // Once the stream has started, a dropped connection means T3 restarted or the session
      // expired: say why on standard error, then reconnect and resume after the last sequence, so
      // no change is missed and standard output stays JSON lines.
      let started = false;
      let attempt = 0;
      while (true) {
        const exit = yield* Effect.exit(connect);
        if (yield* Ref.getAndSet(received, false)) {
          started = true;
          attempt = 0;
        }
        if (exit._tag === "Failure") {
          // Before the stream ever ran, the failure is the command's, such as T3 not running.
          if (!started) return yield* Effect.failCause(exit.cause);
          const dropped = Cause.findErrorOption(exit.cause);
          if (Option.isSome(dropped)) yield* Console.error(dropped.value.message);
        }
        const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)]!;
        if (Duration.isGreaterThan(delay, Duration.zero)) yield* Effect.sleep(delay);
        attempt += 1;
      }
    }).pipe(Effect.tapError((error) => printFailure(flags, error))),
  ),
);

/** The agent commands beside `t3 thread` (`lazurioThreadCommand`), for `t3`'s command list. */
export const agentCliCommands = [requestCommand, queueCommand, eventsCommand] as const;
