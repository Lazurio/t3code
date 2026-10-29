import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EnvironmentId,
  EventId,
  MessageId,
  NodeId,
  type OrchestrationV2Command,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { assert, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import type { ActingSender } from "./actingSender.ts";
import * as ActingSenders from "./actingSenders.ts";

// Contract: T3 answers an accepted command id with the events of the dispatch that committed it.
// Only the dispatch that takes a step marks it: sending its command id again never marks, changes
// or rewrites the mark, also while the first dispatch still runs. On upstream's own orchestrator.

const buddy: ActingSender = { kind: "buddy", for: "Alena", forAccusative: "Alenu" };
const delegace: ActingSender = { kind: "delegace" };

/** An agent CLI's MCP invocation scope, as McpOAuth builds it from the CLI's session. */
const asMcpClient =
  (actingSender?: ActingSender) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(effect, McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("environment-acting-senders-replay"),
      capabilities: new Set<McpInvocationContext.McpCapability>(["orchestration"]),
      issuedAt: 0,
      requestNamespace: `client:session-${actingSender?.kind ?? "person"}`,
      thread: undefined,
      client: {
        sessionId: `session-${actingSender?.kind ?? "person"}`,
        label: "t3 agent cli",
        access: "full-access",
        ...(actingSender === undefined ? {} : { actingSender }),
      },
    });

const instanceId = ProviderInstanceId.make("codex");
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No turn starts in these threads."),
} as ProviderAdapter.ProviderAdapterV2["Service"];

/**
 * Upstream's orchestrator, which holds the next dispatch of `held.commandId` before it enters, as
 * a dispatch that waits for its thread while another one commits the same command id.
 */
const gate = {
  held: undefined as
    | {
        readonly commandId: CommandId;
        readonly entered: Deferred.Deferred<void>;
        readonly release: Deferred.Deferred<void>;
      }
    | undefined,
};
const layerGate = Layer.effect(
  Orchestrator.OrchestratorV2,
  Effect.map(Orchestrator.OrchestratorV2, (orchestrator) =>
    Orchestrator.OrchestratorV2.of({
      ...orchestrator,
      dispatch: (command) => {
        const held = gate.held;
        if (held === undefined || held.commandId !== command.commandId) {
          return orchestrator.dispatch(command);
        }
        gate.held = undefined;
        return Deferred.succeed(held.entered, undefined).pipe(
          Effect.andThen(Deferred.await(held.release)),
          Effect.andThen(orchestrator.dispatch(command)),
        );
      },
    }),
  ),
);

const layerDatabase = SqlitePersistence.layerMemory;
const layerUpstream = ProviderReplayHarness.layerWithRegistry(
  { name: "acting-senders-replay" },
  ProviderAdapterRegistry.layerFromAdapters([adapter]),
  { databaseLayer: layerDatabase, runEffectWorker: false },
);
// As T3 builds it: the decorator around upstream's orchestrator, and the store the web reads.
const layerUnderTest = Layer.mergeAll(
  ActingSenders.recordSteps(layerGate.pipe(Layer.provide(layerUpstream))),
  ActingSenders.layer,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
).pipe(
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-acting-senders-replay-" }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const dispatch = (command: OrchestrationV2Command) =>
  Orchestrator.OrchestratorV2.pipe(
    Effect.flatMap((orchestrator) => orchestrator.dispatch(command)),
  );
const recordsOf = (threadId: ThreadId) =>
  ActingSenders.ActingSenders.pipe(
    Effect.flatMap((senders) => senders.read(threadId)),
    Effect.map((answer) => answer.records),
  );
/** The thread's record file, found by what it holds rather than by its name, and its lines. */
const recordFileOf = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const directory = path.join(stateDir, "lazurio", "acting-senders");
    for (const name of yield* fs.readDirectory(directory)) {
      const file = path.join(directory, name);
      const lines = (yield* fs.readFileString(file))
        .split("\n")
        .filter(
          (line) =>
            line !== "" &&
            (JSON.parse(line) as { readonly threadId?: unknown }).threadId === threadId,
        );
      if (lines.length > 0) return { file, lines };
    }
    return { file: undefined, lines: [] };
  });

type StepKind = ActingSenders.ActingSenderStep["kind"];
interface StepToTake {
  readonly threadId: ThreadId;
  readonly step: ActingSenders.ActingSenderStep;
  readonly command: OrchestrationV2Command;
}

/**
 * A new thread with a step to take: a message, sent without starting a turn, or the answer to
 * the thread's agent's question, seeded as T3 projects a pending one.
 */
const stepToTake = (kind: StepKind, name: string) =>
  Effect.gen(function* () {
    const threadId = ThreadId.make(`thread:${name}`);
    yield* dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create:${name}`),
      threadId,
      projectId: ProjectId.make("project:acting-senders-replay"),
      title: name,
      modelSelection: { instanceId, model: "gpt-5.1-codex" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
    if (kind === "message") {
      const messageId = MessageId.make(`message:${name}`);
      return {
        threadId,
        step: { kind, id: messageId },
        command: {
          type: "message.dispatch",
          commandId: CommandId.make(`send:${name}`),
          threadId,
          messageId,
          text: "Please run the tests.",
          attachments: [],
          dispatchMode: { type: "defer_start" },
          createdBy: "agent",
          creationSource: "mcp",
        },
      } satisfies StepToTake;
    }
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const now = yield* DateTime.now;
    const providerSessionId = ProviderSessionId.make(`session:${name}`);
    const requestId = RuntimeRequestId.make(`request:${name}`);
    const nodeId = NodeId.make(`node:${name}`);
    yield* projections.apply({
      id: EventId.make(`attach:${name}`),
      type: "provider-session.attached",
      threadId,
      occurredAt: now,
      payload: {
        id: providerSessionId,
        driver: adapter.driver,
        providerInstanceId: instanceId,
        status: "ready",
        cwd: "/repo",
        model: "gpt-5.1-codex",
        capabilities: CodexProviderCapabilitiesV2,
        createdAt: now,
        updatedAt: now,
        lastError: null,
      },
    });
    yield* projections.apply({
      id: EventId.make(`request:${name}`),
      type: "runtime-request.updated",
      threadId,
      occurredAt: now,
      payload: {
        id: requestId,
        nodeId,
        providerTurnId: null,
        nativeRequestRef: null,
        kind: "user_input",
        status: "pending",
        responseCapability: { type: "live", providerSessionId },
        createdAt: now,
        resolvedAt: null,
      },
    });
    yield* projections.apply({
      id: EventId.make(`node:${name}`),
      type: "node.updated",
      threadId,
      occurredAt: now,
      payload: {
        id: nodeId,
        threadId,
        runId: null,
        parentNodeId: null,
        rootNodeId: nodeId,
        kind: "user_input_request",
        status: "waiting",
        countsForRun: false,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        runtimeRequestId: requestId,
        checkpointScopeId: null,
        startedAt: now,
        completedAt: null,
      },
    });
    yield* projections.apply({
      id: EventId.make(`item:${name}`),
      type: "turn-item.updated",
      threadId,
      occurredAt: now,
      payload: {
        id: TurnItemId.make(`item:${name}`),
        threadId,
        runId: null,
        nodeId,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 1,
        status: "waiting",
        title: null,
        startedAt: now,
        completedAt: null,
        updatedAt: now,
        type: "user_input_request",
        requestId,
        questions: [],
      },
    });
    return {
      threadId,
      step: { kind, id: requestId },
      command: {
        type: "runtime-request.respond",
        commandId: CommandId.make(`answer:${name}`),
        threadId,
        requestId,
        answers: { text: "Yes" },
      },
    } satisfies StepToTake;
  });

/** Whether a dispatch answered with the step's message, or its request's resolution. */
const answeredWith = (
  result: Orchestrator.OrchestratorV2DispatchResult,
  step: ActingSenders.ActingSenderStep,
) =>
  result.storedEvents.some(({ event }) =>
    step.kind === "message"
      ? event.type === "message.updated" && event.payload.id === step.id
      : event.type === "runtime-request.updated" &&
        event.payload.id === step.id &&
        event.payload.status === "resolved",
  );

const kinds = ["message", "request"] as const satisfies ReadonlyArray<StepKind>;

it.layer(layerUnderTest, { excludeTestServices: true })("a command id sent again", (it) => {
  it.effect.each(kinds)("does not mark the %s another session's dispatch took", (kind) =>
    Effect.gen(function* () {
      const { threadId, step, command } = yield* stepToTake(kind, `another-${kind}`);
      // The person's own agent CLI takes the step, then Buddy's sends the same command id.
      yield* dispatch(command).pipe(asMcpClient());
      const again = yield* dispatch(command).pipe(asMcpClient(buddy));

      expect(answeredWith(again, step)).toBe(true);
      expect(yield* recordsOf(threadId)).toEqual([]);
    }),
  );

  it.effect.each(kinds)(
    "does not mark the %s another dispatch of its command id took while it waited",
    (kind) =>
      Effect.gen(function* () {
        const { threadId, step, command } = yield* stepToTake(kind, `overlap-${kind}`);
        const held = {
          commandId: command.commandId,
          entered: yield* Deferred.make<void>(),
          release: yield* Deferred.make<void>(),
        };
        gate.held = held;
        // Buddy's dispatch starts first and waits for the thread, while the person's own dispatch
        // of the same command id takes the step: its events are newer than Buddy's start.
        const buddys = yield* dispatch(command).pipe(asMcpClient(buddy), Effect.forkChild);
        yield* Deferred.await(held.entered);
        yield* dispatch(command).pipe(asMcpClient());
        yield* Deferred.succeed(held.release, undefined);

        expect(answeredWith(yield* Fiber.join(buddys), step)).toBe(true);
        expect(yield* recordsOf(threadId)).toEqual([]);
      }),
  );

  it.effect.each(kinds)("keeps the mark of the session that took the %s", (kind) =>
    Effect.gen(function* () {
      const { threadId, step, command } = yield* stepToTake(kind, `kept-${kind}`);
      yield* dispatch(command).pipe(asMcpClient(buddy));
      const again = yield* dispatch(command).pipe(asMcpClient(delegace));

      expect(answeredWith(again, step)).toBe(true);
      expect(yield* recordsOf(threadId)).toEqual([{ ...step, sender: buddy }]);
    }),
  );

  it.effect.each(kinds)("writes the %s's mark once when its session retries", (kind) =>
    Effect.gen(function* () {
      const { threadId, step, command } = yield* stepToTake(kind, `retried-${kind}`);
      yield* dispatch(command).pipe(asMcpClient(buddy));
      const again = yield* dispatch(command).pipe(asMcpClient(buddy));

      expect(answeredWith(again, step)).toBe(true);
      expect(yield* recordsOf(threadId)).toEqual([{ ...step, sender: buddy }]);
      expect((yield* recordFileOf(threadId)).lines).toHaveLength(1);
    }),
  );

  it.effect("marks Buddy's launch of a new thread", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const threadId = ThreadId.make("thread:launched");
      const messageId = MessageId.make("message:launched");
      const modelSelection = { instanceId, model: "gpt-5.1-codex" };
      // A thread without events yet is at sequence 0: reading it does not fail.
      expect(yield* orchestrator.getThreadEventSequence(threadId)).toBe(0);
      // `t3 thread launch` as ThreadLaunchService dispatches it: the thread, then its first
      // message under the launch's command id.
      yield* dispatch({
        type: "thread.create",
        commandId: CommandId.make("launch:new"),
        threadId,
        projectId: ProjectId.make("project:acting-senders-replay"),
        title: "Launched",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "agent",
        creationSource: "mcp",
      }).pipe(asMcpClient(buddy));
      const before = yield* orchestrator.getThreadEventSequence(threadId);
      const sent = yield* dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("launch:new:initial-message"),
        threadId,
        messageId,
        text: "Please run the tests.",
        attachments: [],
        modelSelection,
        dispatchMode: { type: "defer_start", workspaceStrategy: { type: "root" } },
        createdBy: "agent",
        creationSource: "mcp",
      }).pipe(asMcpClient(buddy));
      const after = yield* orchestrator.getThreadEventSequence(threadId);

      // The events a dispatch answers with are numbered as the thread's last event is.
      const sequences = sent.storedEvents
        .filter(({ event }) => event.threadId === threadId)
        .map(({ sequence }) => sequence);
      expect(sequences.length).toBeGreaterThan(0);
      expect(before).toBeGreaterThan(0);
      expect(Math.min(...sequences)).toBeGreaterThan(before);
      expect(Math.max(...sequences)).toBeLessThanOrEqual(after);
      expect(yield* recordsOf(threadId)).toEqual([
        { kind: "message", id: messageId, sender: buddy },
      ]);
    }),
  );

  it.effect("keeps a step's first record in the file, and reads past a later line for it", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread:first-record");
      const step: ActingSenders.ActingSenderStep = { kind: "message", id: "message:first" };
      const senders = yield* ActingSenders.ActingSenders;
      yield* senders.record(threadId, [step], buddy);
      yield* senders.record(threadId, [step], delegace);
      const { file, lines } = yield* recordFileOf(threadId);
      expect(lines).toHaveLength(1);

      // However a second line for the step got there, it never overrides the first.
      assert.ok(file);
      const fs = yield* FileSystem.FileSystem;
      const later = { threadId, ...step, sender: delegace, recordedAt: 0 };
      yield* fs.writeFileString(file, `${JSON.stringify(later)}\n`, { flag: "a" });
      expect(yield* recordsOf(threadId)).toEqual([{ ...step, sender: buddy }]);
    }),
  );
});
