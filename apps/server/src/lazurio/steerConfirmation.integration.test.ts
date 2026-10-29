// A steer of an agent that confirms steers (`confirmsSteers`, Lazurio/t3code#141) through the
// orchestrator and its effect worker: the turn ends and the worker's lease passes while the agent's
// first answer is on its way. A message the turn took is never sent again as the next turn, and a
// message the agent did not take is sent as the next turn exactly once.
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  ThreadId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";

const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "test-model" };
const capabilities = {
  ...CodexProviderCapabilitiesV2,
  turns: { ...CodexProviderCapabilitiesV2.turns, supportsActiveSteering: true },
};

it.effect.each([
  { name: "took the message, and its answer was lost", takes: true, refuses: false, steers: 2 },
  { name: "refused the message", takes: false, refuses: true, steers: 1 },
  {
    name: "did not take the message, and its answer was lost",
    takes: false,
    refuses: false,
    steers: 2,
  },
])(
  "sends a steered message as the next turn only if the agent $name",
  ({ takes, refuses, steers }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* checkpointWorkspace(`steer-confirmation-${takes}-${refuses}`);
        const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
        const started: ProviderAdapter.ProviderAdapterV2TurnInput[] = [];
        const taken = new Set<string>();
        const steerEntered = yield* Deferred.make<void>();
        const answerFirstSteer = yield* Deferred.make<void>();
        let steerCalls = 0;
        let interrupts = 0;
        const adapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
          instanceId,
          driver,
          getCapabilities: () => Effect.succeed(capabilities),
          planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
          openSession: (input) =>
            Effect.gen(function* () {
              const now = yield* DateTime.now;
              return {
                instanceId,
                driver,
                providerSessionId: input.providerSessionId,
                providerSession: {
                  id: input.providerSessionId,
                  driver,
                  providerInstanceId: instanceId,
                  status: "ready",
                  cwd,
                  model: modelSelection.model,
                  capabilities,
                  createdAt: now,
                  updatedAt: now,
                  lastError: null,
                },
                events: Stream.fromQueue(events),
                ensureThread: ({ threadId }) =>
                  Effect.succeed({
                    id: ProviderThreadId.make(`provider-thread:${threadId}`),
                    driver,
                    providerInstanceId: instanceId,
                    providerSessionId: input.providerSessionId,
                    appThreadId: threadId,
                    ownerNodeId: null,
                    nativeThreadRef: { driver, nativeId: "native-thread", strength: "strong" },
                    nativeConversationHeadRef: null,
                    status: "idle",
                    firstRunOrdinal: null,
                    lastRunOrdinal: null,
                    handoffIds: [],
                    forkedFrom: null,
                    createdAt: now,
                    updatedAt: now,
                  }),
                resumeThread: ({ providerThread }) => Effect.succeed(providerThread),
                startTurn: (turn) =>
                  Effect.gen(function* () {
                    started.push(turn);
                    yield* Queue.offer(events, {
                      type: "provider_turn.updated",
                      driver,
                      providerTurn: {
                        id: ProviderTurnId.make(`provider-turn:${turn.attemptId}`),
                        providerThreadId: turn.providerThread.id,
                        nodeId: turn.rootNodeId,
                        runAttemptId: turn.attemptId,
                        nativeTurnRef: {
                          driver,
                          nativeId: `native:${turn.attemptId}`,
                          strength: "strong",
                        },
                        ordinal: turn.providerTurnOrdinal,
                        status: "running",
                        startedAt: now,
                        completedAt: null,
                      },
                    });
                  }),
                // The agent keeps the steers its turns took, and answers a repeat of one as it did.
                confirmsSteers: true,
                steerTurn: (turn) =>
                  Effect.gen(function* () {
                    steerCalls += 1;
                    const steer = `${turn.providerTurnId}:${turn.message.messageId}`;
                    const failure = (refused: boolean) =>
                      new ProviderAdapter.ProviderAdapterSteerRunError({
                        driver,
                        providerThreadId: turn.providerThread.id,
                        providerTurnId: turn.providerTurnId,
                        ...(refused ? { refused } : {}),
                        cause: refused ? "The turn ended first." : "The answer was lost.",
                      });
                    if (steerCalls === 1) {
                      if (takes) taken.add(steer);
                      yield* Deferred.succeed(steerEntered, undefined);
                      yield* Deferred.await(answerFirstSteer);
                      return yield* failure(refuses);
                    }
                    if (!taken.has(steer)) return yield* failure(true);
                  }),
                interruptTurn: () =>
                  Effect.sync(() => {
                    interrupts += 1;
                  }),
                respondToRuntimeRequest: () => Effect.void,
                readThreadSnapshot: () => Effect.die("unused"),
                rollbackThread: () => Effect.die("unused"),
                forkThread: () => Effect.die("unused"),
              };
            }),
        };
        yield* Effect.gen(function* () {
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
          const threadId = ThreadId.make("thread:steer-confirmation");
          const watch = (predicate: (event: OrchestrationV2DomainEvent) => boolean) =>
            orchestrator.streamDomainEvents.pipe(
              Stream.filter(predicate),
              Stream.take(1),
              Stream.runDrain,
              Effect.forkScoped,
            );
          yield* orchestrator.dispatch({
            type: "thread.create",
            commandId: CommandId.make("create"),
            threadId,
            projectId: ProjectId.make("project:steer-confirmation"),
            title: "Steer confirmation",
            modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: cwd,
            createdBy: "user",
            creationSource: "web",
          });
          const running = yield* watch(
            (event) => event.type === "provider-turn.updated" && event.payload.status === "running",
          );
          yield* orchestrator.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make("first"),
            threadId,
            messageId: MessageId.make("message:first"),
            text: "first",
            attachments: [],
            dispatchMode: { type: "start_immediately" },
            createdBy: "user",
            creationSource: "web",
          });
          yield* worker.drain();
          yield* Fiber.join(running);
          const first = started[0]!;
          const messageId = MessageId.make("message:steer");
          yield* orchestrator.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make("steer"),
            threadId,
            messageId,
            text: "only the ACP changes",
            attachments: [],
            dispatchMode: { type: "steer_active", targetRunId: first.runId },
            createdBy: "user",
            creationSource: "web",
          });

          // The first steer holds its effect while the worker's lease passes and the turn completes.
          const firstSteer = yield* worker.runOnce.pipe(Effect.forkScoped);
          yield* Deferred.await(steerEntered);
          yield* TestClock.adjust("31 seconds");
          const completed = yield* watch(
            (event) =>
              event.type === "run.updated" &&
              event.payload.id === first.runId &&
              event.payload.status === "waiting",
          );
          const turn = (yield* orchestrator.getThreadProjection(threadId)).providerTurns[0]!;
          yield* Queue.offer(events, {
            type: "provider_turn.updated",
            driver,
            providerTurn: { ...turn, status: "completed", completedAt: yield* DateTime.now },
          });
          yield* Queue.offer(events, {
            type: "turn.terminal",
            driver,
            providerThreadId: turn.providerThreadId,
            providerTurnId: turn.id,
            runOrdinal: first.runOrdinal,
            status: "completed",
            failure: null,
            threadDisposition: "reusable",
          });
          yield* Fiber.join(completed);
          yield* worker.drain();
          assert.equal(steerCalls, 1);

          yield* Deferred.succeed(answerFirstSteer, undefined);
          yield* Fiber.join(firstSteer);
          // Past the retry's backoff; then once more for anything the outcome started.
          yield* TestClock.adjust("1 second");
          yield* worker.drain();
          yield* orchestrator.resumeQueuedRuns;
          yield* worker.drain();

          assert.deepEqual(
            started.map((input) => input.message.messageId),
            takes ? [first.message.messageId] : [first.message.messageId, messageId],
          );
          assert.equal(steerCalls, steers);
          assert.equal(interrupts, 0);
          const final = yield* orchestrator.getThreadProjection(threadId);
          assert.deepEqual(
            final.messages.flatMap((message) => (message.id === messageId ? [message.runId] : [])),
            [started.at(-1)!.runId],
          );
        }).pipe(
          Effect.provide(
            ProviderReplayHarness.layerWithRegistry(
              { name: `steer-confirmation-${takes}-${refuses}` },
              ProviderAdapterRegistry.layerSingle(adapter),
              { runEffectWorker: false },
            ),
          ),
        );
      }),
    ),
);
