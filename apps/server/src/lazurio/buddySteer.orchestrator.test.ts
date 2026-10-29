// @effect-diagnostics nodeBuiltinImport:off - The mock ACP agent logs its requests to a temporary file.
// A message sent while Buddy works, through the production V2 runtime and its effect worker
// (buddySurface.testkit.ts): the repository's mock ACP agent answers `_lazurio/steer` in Hermes'
// place, and Buddy's turn ends while its answer to the steer is on the way (Lazurio/t3code#141).
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  type OrchestrationV2Run,
  type ThreadId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { isTerminalRunStatus } from "../orchestration-v2/ThreadManagementService.ts";
import {
  addProject,
  buddyModel,
  layerBuddyServer,
  receivedPrompts,
} from "./buddySurface.testkit.ts";
import { resolveBuddyThread } from "./buddySurfaceThread.ts";

const WORK = "Projdi změny.";
const STEER = "Jen změny ACP.";
const THANKS = "Díky.";

/** A home with Buddy's layer, and the environment of Buddy's T3 Code with the agent in *agent*'s mode. */
function buddyHome(prefix: string, agent: Readonly<Record<string, string>>) {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
  const buddyLayer = NodePath.join(home, "Lazurio", ".agents", "buddy");
  NodeFS.mkdirSync(buddyLayer, { recursive: true });
  const requestLog = NodePath.join(home, "requests.jsonl");
  return {
    buddyLayer,
    requestLog,
    environment: {
      ...process.env,
      HOME: home,
      T3CODE_LAZURIO_BUDDY: "1",
      T3_ACP_REQUEST_LOG_PATH: requestLog,
      T3_ACP_LAZURIO_ACTIVE_STEER: "1",
      T3_ACP_LAZURIO_STEER_ENDS_TURN: "1",
      ...agent,
    },
  };
}

/** The params of every request of *method* the agent received, in order. */
function receivedParams(requestLog: string, method: string): Array<unknown> {
  return NodeFS.readFileSync(requestLog, "utf8")
    .split("\n")
    .flatMap((line) => {
      if (line.trim() === "") return [];
      const request = JSON.parse(line) as { method?: string; params?: unknown };
      return request.method === method ? [request.params] : [];
    });
}

/** Send a message as the person's web client does. */
const send = Effect.fn("test.buddySteer.send")(function* (
  threadId: ThreadId,
  name: string,
  text: string,
  dispatchMode:
    | { readonly type: "start_immediately" }
    | { readonly type: "steer_active"; readonly targetRunId: OrchestrationV2Run["id"] },
) {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const messageId = MessageId.make(`message:buddy-steer:${name}`);
  const afterSequence = yield* orchestrator.getThreadEventSequence(threadId);
  yield* orchestrator.dispatch({
    type: "message.dispatch",
    createdBy: "user",
    creationSource: "web",
    commandId: CommandId.make(`command:buddy-steer:${name}`),
    threadId,
    messageId,
    text,
    attachments: [],
    modelSelection: buddyModel,
    dispatchMode,
  });
  return { messageId, afterSequence };
});

/** Resolves once the run a message of *sent* started ends. */
const runEnds = Effect.fn("test.buddySteer.runEnds")(function* (
  threadId: ThreadId,
  sent: { readonly messageId: MessageId; readonly afterSequence: number },
) {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  yield* orchestrator
    .streamStoredEventsFrom({
      threadId,
      afterSequence: sent.afterSequence,
      eventType: "run.updated",
    })
    .pipe(
      Stream.filter(
        (stored) =>
          stored.event.type === "run.updated" &&
          stored.event.payload.userMessageId === sent.messageId &&
          isTerminalRunStatus(stored.event.payload.status),
      ),
      Stream.take(1),
      Stream.runDrain,
    );
});

/** Buddy at work on a first message, and a message steered into that work. */
const steerWhileBuddyWorks = Effect.fn("test.buddySteer.steerWhileBuddyWorks")(function* (
  buddyLayer: string,
) {
  yield* addProject(ProjectId.make("project:buddy"), buddyLayer);
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  yield* EffectWorker.runDaemon.pipe(Effect.forkScoped);
  const { threadId } = yield* resolveBuddyThread();
  const work = yield* send(threadId, "work", WORK, { type: "start_immediately" });
  // The agent takes a steer only once its work is under way.
  yield* orchestrator
    .streamStoredEventsFrom({
      threadId,
      afterSequence: work.afterSequence,
      eventType: "turn-item.updated",
    })
    .pipe(
      Stream.filter(
        (stored) =>
          stored.event.type === "turn-item.updated" &&
          stored.event.payload.nativeItemRef?.nativeId === "lazurio-steer-tool",
      ),
      Stream.take(1),
      Stream.runDrain,
    );
  const run = (yield* orchestrator.getThreadProjection(threadId)).runs.find(
    (candidate) => candidate.userMessageId === work.messageId,
  )!;
  const steer = yield* send(threadId, "steer", STEER, {
    type: "steer_active",
    targetRunId: run.id,
  });
  return { threadId, work, steer };
});

describe("A message sent while Buddy works", () => {
  it.live("reaches Buddy once when the agent took it and its answer was lost", () => {
    const buddy = buddyHome("buddy-steer-lost-", { T3_ACP_LAZURIO_STEER_LOSE_FIRST_REPLY: "1" });
    return Effect.gen(function* () {
      const { threadId, work } = yield* steerWhileBuddyWorks(buddy.buddyLayer);
      yield* runEnds(threadId, work);
      // The thread's effects run in order, so the next message starts once the steer settled.
      yield* runEnds(
        threadId,
        yield* send(threadId, "thanks", THANKS, { type: "start_immediately" }),
      );

      assert.deepStrictEqual(receivedPrompts(buddy.requestLog), [[WORK], [THANKS]]);
      const steers = receivedParams(buddy.requestLog, "_lazurio/steer");
      // Asked again after the turn ended, the agent answered the steer the turn took.
      assert.lengthOf(steers, 2);
      assert.deepStrictEqual(steers[0], steers[1]);
      assert.deepStrictEqual(receivedParams(buddy.requestLog, "session/cancel"), []);
    }).pipe(
      Effect.provide(layerBuddyServer),
      Effect.scoped,
      Effect.provideService(HostProcess.Environment, buddy.environment),
    );
  });

  it.live("starts the next turn with it exactly once when the agent refused it", () => {
    const buddy = buddyHome("buddy-steer-refused-", { T3_ACP_LAZURIO_STEER_REFUSE: "1" });
    return Effect.gen(function* () {
      const { threadId, steer } = yield* steerWhileBuddyWorks(buddy.buddyLayer);
      yield* runEnds(threadId, steer);

      assert.deepStrictEqual(receivedPrompts(buddy.requestLog), [[WORK], [STEER]]);
      const steers = receivedParams(buddy.requestLog, "_lazurio/steer");
      assert.isAtLeast(steers.length, 1);
      assert.isTrue(steers.every((params) => JSON.stringify(params) === JSON.stringify(steers[0])));
      assert.deepStrictEqual(receivedParams(buddy.requestLog, "session/cancel"), []);
    }).pipe(
      Effect.provide(layerBuddyServer),
      Effect.scoped,
      Effect.provideService(HostProcess.Environment, buddy.environment),
    );
  });
});
