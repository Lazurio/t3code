/**
 * Lazurio overlay (plan LZD-0033): `GET /api/lazurio/buddy/signal`, the one source of the sign by
 * Buddy's avatar, versioned for every reader. Absent Buddy or thread is a 404, never `quiet`.
 */
import {
  AuthOrchestrationReadScope,
  type MessageId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
  type OrchestrationV2RuntimeRequest,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerResponse } from "effect/http";

import * as ServerConfig from "../config.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import type { ProjectionRecords } from "../orchestration-v2/ProjectionStore.ts";
import { isBuddySurfaceEnvironment } from "./buddySurface.ts";
import { BuddyTaskFailures } from "./buddyTaskFailures.ts";
import { BUDDY_THREAD_ID, findSharedBuddyThread, sharedBuddyFolder } from "./buddySurfaceThread.ts";
import { authenticateOverlayRoute } from "./routeAuth.ts";

export const BUDDY_SIGNAL_ROUTE = "/api/lazurio/buddy/signal";

export const BuddySignalState = Schema.Literals(["waiting", "failed", "answered", "quiet"]);
export type BuddySignalState = typeof BuddySignalState.Type;
export const BuddySignalStarter = Schema.Literals(["person", "other"]);
export type BuddySignalStarter = typeof BuddySignalStarter.Type;

export const BuddySignal = Schema.Struct({
  version: Schema.Literal(1),
  state: BuddySignalState,
  threadId: Schema.String,
  since: Schema.NullOr(Schema.String),
  request: Schema.NullOr(Schema.Struct({ kind: Schema.String })),
  startedBy: Schema.NullOr(BuddySignalStarter),
});
export type BuddySignal = typeof BuddySignal.Type;

type SignalRun = Pick<
  OrchestrationV2Run,
  "id" | "ordinal" | "status" | "userMessageId" | "completedAt"
>;
type SignalRequest = Pick<OrchestrationV2RuntimeRequest, "kind" | "createdAt"> & {
  /** The run whose turn asked, where its node names one. */
  readonly runId: RunId | null;
};
export type BuddySignalStarterMessage = Pick<
  OrchestrationV2ConversationMessage,
  "createdBy" | "senderThreadId" | "scheduledTaskId"
>;

export interface BuddySignalInput {
  readonly threadId: ThreadId;
  readonly lastVisitedAt: DateTime.Utc | null;
  readonly runs: ReadonlyArray<SignalRun>;
  readonly pendingRequests: ReadonlyArray<SignalRequest>;
  /** Runs someone asked to stop (a `run_interrupt_request` item); any other interrupt is a fault. */
  readonly stopRequested: ReadonlySet<RunId>;
  /** The last failed run of each scheduled task bound to the thread. */
  readonly failedTaskRuns: ReadonlyArray<DateTime.Utc>;
  readonly messages: ReadonlyMap<MessageId, BuddySignalStarterMessage>;
}

const millis = (value: DateTime.Utc) => DateTime.toEpochMillis(value);
const SETTLED = new Set<OrchestrationV2Run["status"]>(["completed", "failed", "interrupted"]);

/** The last run that settled the thread's line; a stopped or cancelled one is no fault. */
const lastSettledRun = (runs: ReadonlyArray<SignalRun>) =>
  runs
    .filter((run) => SETTLED.has(run.status) && run.completedAt !== null)
    .toSorted((left, right) => left.ordinal - right.ordinal)
    .at(-1);

const isFault = (run: SignalRun, stopRequested: ReadonlySet<RunId>) =>
  run.status === "failed" || (run.status === "interrupted" && !stopRequested.has(run.id));

const unreadCompletedRuns = (input: Pick<BuddySignalInput, "runs" | "lastVisitedAt">) =>
  input.runs.filter(
    (run) =>
      run.status === "completed" &&
      run.completedAt !== null &&
      (input.lastVisitedAt === null || millis(run.completedAt) > millis(input.lastVisitedAt)),
  );

/** The user messages whose senders the signal needs, so a reader loads only those. */
export function buddySignalMessageIds(
  input: Omit<BuddySignalInput, "messages" | "threadId">,
): Array<MessageId> {
  const byId = new Map(input.runs.map((run) => [run.id, run]));
  const runs = [
    ...input.pendingRequests.flatMap((request) =>
      request.runId === null ? [] : [byId.get(request.runId)],
    ),
    lastSettledRun(input.runs),
    ...unreadCompletedRuns(input),
  ];
  return [...new Set(runs.flatMap((run) => (run === undefined ? [] : [run.userMessageId])))];
}

function starterOf(
  run: SignalRun | undefined,
  messages: BuddySignalInput["messages"],
): BuddySignalStarter | null {
  if (run === undefined) return null;
  const message = messages.get(run.userMessageId);
  if (message === undefined) return null;
  return message.createdBy === "user" &&
    message.senderThreadId === undefined &&
    message.scheduledTaskId === undefined
    ? "person"
    : "other";
}

/**
 * Waiting on a pending request, else failed (the last settled turn failed or was interrupted
 * without a stop request, or a bound task failed after it), else answered (completed after
 * `lastVisitedAt`), else quiet. `since` is the oldest cause; `startedBy` is the person's if any.
 */
export function buddySignalOf(input: BuddySignalInput): BuddySignal {
  const base = { version: 1 as const, threadId: input.threadId };
  const byId = new Map(input.runs.map((run) => [run.id, run]));
  const iso = (value: DateTime.Utc) => DateTime.formatIso(value);

  const pending = input.pendingRequests.toSorted(
    (left, right) => millis(left.createdAt) - millis(right.createdAt),
  )[0];
  if (pending !== undefined)
    return {
      ...base,
      state: "waiting",
      since: iso(pending.createdAt),
      request: { kind: pending.kind },
      startedBy: starterOf(
        pending.runId === null ? undefined : byId.get(pending.runId),
        input.messages,
      ),
    };

  const settled = lastSettledRun(input.runs);
  // The latest completed turn clears a task's failure, also when a later turn was stopped.
  const lastCompleted = Math.max(
    Number.NEGATIVE_INFINITY,
    ...input.runs.flatMap((run) =>
      run.status === "completed" && run.completedAt !== null ? [millis(run.completedAt)] : [],
    ),
  );
  const taskFailure = input.failedTaskRuns
    .filter((at) => millis(at) > lastCompleted)
    .toSorted((left, right) => millis(left) - millis(right))[0];
  if (settled !== undefined && isFault(settled, input.stopRequested))
    return {
      ...base,
      state: "failed",
      since: iso(settled.completedAt as DateTime.Utc),
      request: null,
      startedBy: starterOf(settled, input.messages),
    };
  if (taskFailure !== undefined)
    return { ...base, state: "failed", since: iso(taskFailure), request: null, startedBy: "other" };

  const unread = unreadCompletedRuns(input).toSorted(
    (left, right) => millis(left.completedAt!) - millis(right.completedAt!),
  );
  const first = unread[0];
  if (first !== undefined)
    return {
      ...base,
      state: "answered",
      since: iso(first.completedAt!),
      request: null,
      startedBy: unread.some((run) => starterOf(run, input.messages) === "person")
        ? "person"
        : "other",
    };

  return { ...base, state: "quiet", since: null, request: null, startedBy: null };
}

const noThread = { kind: "absent", error: "no-thread" } as const;
// A reading that failed: never the same answer as a thread that is not there.
const unavailable = { kind: "absent", error: "unavailable" } as const;

/**
 * Buddy's thread on this server: GEN3's one thread, GEN4's thread of the shared server. No thread
 * only where the server knows there is none; a store it could not read is `unavailable`.
 */
const buddyThreadId = Effect.fn("LazurioBuddySignal.threadId")(function* () {
  if (isBuddySurfaceEnvironment(yield* HostProcess.Environment)) {
    const shell = yield* (yield* OrchestratorV2)
      .getThreadShell(BUDDY_THREAD_ID)
      .pipe(Effect.option);
    if (Option.isNone(shell)) return unavailable;
    return shell.value === null
      ? noThread
      : ({ kind: "found", threadId: BUDDY_THREAD_ID } as const);
  }
  const buddyFolder = yield* sharedBuddyFolder;
  if (buddyFolder === undefined) return { kind: "absent", error: "not-buddy" } as const;
  const found = yield* findSharedBuddyThread(buddyFolder).pipe(Effect.result);
  if (found._tag === "Failure")
    // Before the startup or the first window open makes Buddy's project there is no thread either.
    return found.failure.reason === "no-project" ? noThread : unavailable;
  return found.success.thread === null
    ? noThread
    : ({ kind: "found", threadId: found.success.thread.id } as const);
});

/** The signal as the route answers it, or why there is none. */
export const readBuddySignal = Effect.fn("LazurioBuddySignal.read")(function* () {
  const target = yield* buddyThreadId();
  if (target.kind === "absent") return target;
  const orchestrator = yield* OrchestratorV2;
  const records = yield* orchestrator
    .getThreadRecords(target.threadId, ["runs", "runtimeRequests"], {
      runtimeRequestStatuses: ["pending"],
    })
    .pipe(Effect.option);
  if (Option.isNone(records)) return unavailable;
  if (records.value.thread.deletedAt !== null) return noThread;
  const { thread, runs, runtimeRequests } = records.value;
  const pending = runtimeRequests.filter((request) => request.status === "pending");
  let nodes: ProjectionRecords<"nodes">["nodes"] = [];
  if (pending.length > 0) {
    const read = yield* orchestrator
      .getThreadRecords(target.threadId, ["nodes"], {
        nodeIds: pending.map((request) => request.nodeId),
      })
      .pipe(Effect.option);
    if (Option.isNone(read)) return unavailable;
    nodes = read.value.nodes;
  }
  const runOfNode = new Map(nodes.map((node) => [node.id, node.runId]));
  const interrupted = runs.filter((run) => run.status === "interrupted").map((run) => run.id);
  let turnItems: ProjectionRecords<"turnItems">["turnItems"] = [];
  if (interrupted.length > 0) {
    const read = yield* orchestrator
      .getThreadRecords(target.threadId, ["turnItems"], {
        turnItemTypes: ["run_interrupt_request"],
        turnItemRunIds: interrupted,
      })
      .pipe(Effect.option);
    if (Option.isNone(read)) return unavailable;
    turnItems = read.value.turnItems;
  }
  const failures = yield* Effect.serviceOption(BuddyTaskFailures);
  const failedTaskRuns = Option.isNone(failures)
    ? []
    : yield* failures.value.failedAt(target.threadId);
  const input = {
    lastVisitedAt: thread.lastVisitedAt,
    runs,
    pendingRequests: pending.map((request) => ({
      kind: request.kind,
      createdAt: request.createdAt,
      runId: runOfNode.get(request.nodeId) ?? null,
    })),
    stopRequested: new Set(turnItems.flatMap((item) => (item.runId === null ? [] : [item.runId]))),
    failedTaskRuns,
  };
  const messageIds = buddySignalMessageIds(input);
  let messages: BuddySignalInput["messages"] = new Map();
  if (messageIds.length > 0) {
    const read = yield* orchestrator
      .getMessagesById(target.threadId, messageIds)
      .pipe(Effect.option);
    if (Option.isNone(read)) return unavailable;
    messages = read.value;
  }
  return {
    kind: "signal",
    signal: buddySignalOf({ ...input, threadId: target.threadId, messages }),
  } as const;
});

export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    // A handler sees only the request's context, so it takes its services from the layer's.
    const orchestrator = yield* OrchestratorV2;
    const config = yield* ServerConfig.ServerConfig;
    const projects = yield* ProjectStoreV2;
    const failures = yield* Effect.serviceOption(BuddyTaskFailures);
    yield* router.add(
      "GET",
      BUDDY_SIGNAL_ROUTE,
      Effect.gen(function* () {
        yield* authenticateOverlayRoute(AuthOrchestrationReadScope);
        const answer = yield* readBuddySignal().pipe(
          Effect.provideService(OrchestratorV2, orchestrator),
          Effect.provideService(ServerConfig.ServerConfig, config),
          Effect.provideService(ProjectStoreV2, projects),
          Option.isSome(failures)
            ? Effect.provideService(BuddyTaskFailures, failures.value)
            : (effect) => effect,
        );
        return answer.kind === "absent"
          ? HttpServerResponse.jsonUnsafe(
              { error: answer.error },
              { status: answer.error === "unavailable" ? 503 : 404 },
            )
          : HttpServerResponse.jsonUnsafe(answer.signal, {
              headers: { "cache-control": "no-store" },
            });
      }),
    );
  }),
);
