// @effect-diagnostics nodeBuiltinImport:off -- a thread's record file is named by a synchronous SHA-256 of its id.
/**
 * Lazurio overlay (root decision 0210, evening addendum, point 5): who sent or decided what in a
 * thread, read only from the session (`actingAs` in ws.ts, an MCP client's invocation scope), never
 * from the words. One JSON line per step in `<state>/lazurio/acting-senders/<sha256(thread)>.jsonl`,
 * so T3's database stays upstream's; `read` waits for running dispatches and answers until `at`.
 */
import * as NodeCrypto from "node:crypto";

import type {
  CommandId,
  OrchestrationV2ServerCommand,
  OrchestrationV2StoredEvent,
  ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ServerConfig from "../config.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { ActingSender } from "./actingSender.ts";

/** How long `read` waits for the thread's acting dispatches that still run. */
const SETTLE_WAIT = Duration.seconds(2);

export interface ActingSenderStep {
  readonly kind: "message" | "request";
  /** The message's id, or the request's. */
  readonly id: string;
}
export interface ActingSenderRecord extends ActingSenderStep {
  readonly sender: ActingSender;
}
export interface ActingSendersAnswer {
  /** Every step of a message or decision from before this time (epoch ms) is in `records`. */
  readonly at: number;
  readonly records: ReadonlyArray<ActingSenderRecord>;
}

export class ActingSendersUnavailableError extends Schema.TaggedError<ActingSendersUnavailableError>()(
  "ActingSendersUnavailableError",
  { cause: Schema.Defect() },
) {}

export class ActingSenders extends Context.Service<
  ActingSenders,
  {
    readonly record: (
      threadId: ThreadId,
      steps: ReadonlyArray<ActingSenderStep>,
      sender: ActingSender,
    ) => Effect.Effect<void>;
    readonly read: (
      threadId: ThreadId,
    ) => Effect.Effect<ActingSendersAnswer, ActingSendersUnavailableError>;
    /** Runs one acting dispatch of the thread: until it ends, `read` answers no later `at`. */
    readonly tracking: <A, E, R>(
      threadId: ThreadId,
      dispatch: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;
  }
>()("t3/lazurio/actingSenders") {}

/** The acting sender of the client surface session a dispatch runs as (`actingAs`). */
export class ClientSurfaceActingSender extends Context.Reference<ActingSender | undefined>(
  "t3/lazurio/actingSenders/ClientSurfaceActingSender",
  { defaultValue: () => undefined },
) {}

/** Run a client surface session's dispatch as its acting sender, when it has one (ws.ts). */
export const actingAs =
  (session: { readonly actingSender?: ActingSender | undefined }) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    session.actingSender === undefined
      ? effect
      : Effect.provideService(effect, ClientSurfaceActingSender, session.actingSender);

/** Who the running dispatch acts as: its client surface session, else its MCP client. */
export const currentActingSender: Effect.Effect<ActingSender | undefined> = Effect.gen(
  function* () {
    const surface = yield* ClientSurfaceActingSender;
    if (surface !== undefined) return surface;
    const invocation = yield* Effect.serviceOption(McpInvocationContext.McpInvocationContext);
    return Option.isSome(invocation) ? invocation.value.client?.actingSender : undefined;
  },
);

const RecordLine = Schema.Struct({
  threadId: Schema.String,
  kind: Schema.Literals(["message", "request"]),
  id: Schema.String,
  sender: ActingSender,
  recordedAt: Schema.Number,
});
const encodeLine = Schema.encodeSync(Schema.fromJsonString(RecordLine));
const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(RecordLine));

const keyOf = (step: ActingSenderStep) => `${step.kind}:${step.id}`;
/** The thread's records in its file, by step: a step's first line stands, a later one is skipped. */
const recordsIn = (text: string, threadId: ThreadId): ReadonlyMap<string, ActingSenderRecord> => {
  const records = new Map<string, ActingSenderRecord>();
  for (const line of text.split("\n")) {
    // A line cut short by a crash, or another thread's under the same name, is skipped.
    const decoded = decodeLine(line);
    if (Option.isNone(decoded) || decoded.value.threadId !== threadId) continue;
    const { kind, id, sender } = decoded.value;
    const key = keyOf({ kind, id });
    if (!records.has(key)) records.set(key, { kind, id, sender });
  }
  return records;
};

const sha256Hex = (value: string): string =>
  NodeCrypto.createHash("sha256").update(value, "utf8").digest("hex");

type Running = ReadonlyMap<ThreadId, ReadonlyArray<number>>;
const withStart = (running: Running, threadId: ThreadId, start: number): Running =>
  new Map(running).set(threadId, [...(running.get(threadId) ?? []), start]);
const withoutStart = (running: Running, threadId: ThreadId, start: number): Running => {
  const starts = [...(running.get(threadId) ?? [])];
  const index = starts.indexOf(start);
  if (index !== -1) starts.splice(index, 1);
  const next = new Map(running);
  if (starts.length === 0) next.delete(threadId);
  else next.set(threadId, starts);
  return next;
};

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const directory = path.join(stateDir, "lazurio", "acting-senders");
  const fileOf = (threadId: ThreadId) => path.join(directory, `${sha256Hex(threadId)}.jsonl`);
  const appends = yield* Semaphore.make(1);
  const running = yield* SubscriptionRef.make<Running>(new Map());

  const readText = (threadId: ThreadId) =>
    fs
      .readFileString(fileOf(threadId))
      .pipe(
        Effect.catch((error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed("")
            : Effect.fail(new ActingSendersUnavailableError({ cause: error })),
        ),
      );

  const record = Effect.fn("LazurioActingSenders.record")(
    function* (threadId: ThreadId, steps: ReadonlyArray<ActingSenderStep>, sender: ActingSender) {
      const recorded = recordsIn(yield* readText(threadId), threadId);
      const unrecorded = steps.filter((step) => !recorded.has(keyOf(step)));
      if (unrecorded.length === 0) return;
      const recordedAt = yield* Clock.currentTimeMillis;
      yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
      yield* fs.writeFileString(
        fileOf(threadId),
        unrecorded
          .map((step) => `${encodeLine({ threadId, ...step, sender, recordedAt })}\n`)
          .join(""),
        { flag: "a", mode: 0o600 },
      );
    },
    appends.withPermits(1),
    // The command already committed: a record that cannot be written only loses the mark.
    (effect, threadId) =>
      Effect.catchCause(effect, (cause) =>
        Effect.logWarning("Could not record an acting sender's step.", { threadId, cause }),
      ),
  );

  const read = Effect.fn("LazurioActingSenders.read")(function* (threadId: ThreadId) {
    yield* SubscriptionRef.changes(running).pipe(
      Stream.filter((current) => !current.has(threadId)),
      Stream.take(1),
      Stream.runDrain,
      Effect.timeoutOption(SETTLE_WAIT),
    );
    const starts = (yield* SubscriptionRef.get(running)).get(threadId) ?? [];
    const at = Math.min(yield* Clock.currentTimeMillis, ...starts);
    const records = recordsIn(yield* readText(threadId), threadId);
    return { at, records: [...records.values()] } satisfies ActingSendersAnswer;
  });

  const tracking = <A, E, R>(threadId: ThreadId, dispatch: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      Clock.currentTimeMillis.pipe(
        Effect.tap((start) =>
          SubscriptionRef.update(running, (current) => withStart(current, threadId, start)),
        ),
      ),
      () => dispatch,
      (start) =>
        SubscriptionRef.update(running, (current) => withoutStart(current, threadId, start)),
    );

  return ActingSenders.of({ record, read, tracking });
});

/** One store for the decorator and the route: both take this same layer, which T3 builds once. */
export const layer = Layer.effect(ActingSenders, make);

/** The step a command takes for the session that sent it, when it is one the record keeps. */
const stepOf = (
  command: OrchestrationV2ServerCommand,
): { readonly threadId: ThreadId; readonly step: ActingSenderStep } | undefined => {
  switch (command.type) {
    case "message.dispatch":
      return command.creationSource === "server" ||
        command.createdBy === "system" ||
        command.scheduledTaskId !== undefined ||
        command.senderThreadId !== undefined ||
        command.notification !== undefined ||
        command.delegatedCompletion !== undefined
        ? undefined
        : { threadId: command.threadId, step: { kind: "message", id: command.messageId } };
    case "runtime-request.respond":
      return { threadId: command.threadId, step: { kind: "request", id: command.requestId } };
    default:
      return undefined;
  }
};

/**
 * Whether the dispatch committed the step: the message itself, or the request's resolution, in
 * the step's thread and newer than `before`, the thread's last event when the dispatch began.
 */
const tookStep = (
  taken: { readonly threadId: ThreadId; readonly step: ActingSenderStep },
  before: number,
  storedEvents: ReadonlyArray<OrchestrationV2StoredEvent>,
) =>
  storedEvents.some(
    ({ sequence, event }) =>
      sequence > before &&
      event.threadId === taken.threadId &&
      (taken.step.kind === "message"
        ? event.type === "message.updated" && event.payload.id === taken.step.id
        : event.type === "runtime-request.updated" &&
          event.payload.id === taken.step.id &&
          event.payload.status === "resolved"),
  );

/**
 * Upstream's orchestrator from `live`, recording the steps of a session acting as someone. T3
 * answers a repeated command id with the committing dispatch's events, maybe another session's, so a
 * dispatch records only events newer than the thread's last one when it began, and only if no other
 * dispatch of its command id ran meanwhile: such a step loses its mark rather than take another's.
 */
export const recordSteps = <E, R>(live: Layer.Layer<Orchestrator.OrchestratorV2, E, R>) =>
  Layer.effect(
    Orchestrator.OrchestratorV2,
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const senders = yield* ActingSenders;
      // The dispatches running through here, one entry per command id while any of them runs.
      const dispatches = new Map<CommandId, { count: number; overlapped: boolean }>();
      const begin = (commandId: CommandId) =>
        Effect.sync(() => {
          const entry = dispatches.get(commandId) ?? { count: 0, overlapped: false };
          entry.count += 1;
          if (entry.count > 1) entry.overlapped = true;
          dispatches.set(commandId, entry);
          return entry;
        });
      const end = (commandId: CommandId) =>
        Effect.sync(() => {
          const entry = dispatches.get(commandId);
          if (entry !== undefined && --entry.count === 0) dispatches.delete(commandId);
        });
      return Orchestrator.OrchestratorV2.of({
        ...orchestrator,
        dispatch: Effect.fn("LazurioActingSenders.dispatch")(function* (command) {
          const sender = yield* currentActingSender;
          const taken = sender === undefined ? undefined : stepOf(command);
          return yield* Effect.acquireUseRelease(
            begin(command.commandId),
            (entry) =>
              sender === undefined || taken === undefined
                ? orchestrator.dispatch(command)
                : senders.tracking(
                    taken.threadId,
                    orchestrator.getThreadEventSequence(taken.threadId).pipe(
                      // Without the thread's last event every step looks old: no mark, never
                      // a wrong one.
                      Effect.orElseSucceed(() => Number.POSITIVE_INFINITY),
                      Effect.flatMap((before) =>
                        orchestrator
                          .dispatch(command)
                          .pipe(
                            Effect.tap((result) =>
                              !entry.overlapped && tookStep(taken, before, result.storedEvents)
                                ? senders.record(taken.threadId, [taken.step], sender)
                                : Effect.void,
                            ),
                          ),
                      ),
                    ),
                  ),
            () => end(command.commandId),
          );
        }),
      });
    }),
  ).pipe(Layer.provide(live), Layer.provide(layer));
