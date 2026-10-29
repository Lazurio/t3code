// @effect-diagnostics nodeBuiltinImport:off - The mock ACP agent logs its requests to a temporary file.
// Buddy's prompts through the production V2 runtime, as Buddy's T3 Code builds it
// (buddySurface.testkit.ts): the provider instance `buddy` runs the repository's mock ACP agent in
// Hermes' place, and the agent logs every request it receives.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  type ComposerContextRecord,
  MessageId,
  type ModelSelection,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { isTerminalRunStatus } from "../orchestration-v2/ThreadManagementService.ts";
import { lazurioPageContextBlock } from "./buddyPrompt.ts";
import {
  addProject,
  BUDDY,
  buddyModel,
  layerBuddyServer,
  receivedPrompts,
} from "./buddySurface.testkit.ts";
import { resolveBuddyThread } from "./buddySurfaceThread.ts";

const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "buddy-prompt-orchestrator-"));
const buddyLayer = NodePath.join(home, "Lazurio", ".agents", "buddy");
NodeFS.mkdirSync(buddyLayer, { recursive: true });
const requestLog = NodePath.join(home, "requests.jsonl");
const page = {
  v: 1,
  environment: { id: "vm-01.example", kind: "work", name: "Pracovní" },
  organization: { slug: "example", name: "Example Company" },
  app: "chat",
  page: { path: "/a1b2c3" },
} as const;

/**
 * Send a message as the person's web client does, and run the effect worker until the message's
 * run settles.
 */
const send = Effect.fn("test.buddyPrompt.send")(function* (
  threadId: ThreadId,
  ordinal: number,
  message: {
    readonly text: string;
    readonly records?: ReadonlyArray<ComposerContextRecord>;
    readonly modelSelection?: ModelSelection;
  },
) {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
  const afterSequence = yield* orchestrator.getThreadEventSequence(threadId);
  const settled = orchestrator
    .streamStoredEventsFrom({ threadId, afterSequence, eventType: "run.updated" })
    .pipe(
      Stream.filter(
        (stored) =>
          stored.event.type === "run.updated" && isTerminalRunStatus(stored.event.payload.status),
      ),
      Stream.take(1),
      Stream.runDrain,
    );
  yield* orchestrator.dispatch({
    type: "message.dispatch",
    createdBy: "user",
    creationSource: "web",
    commandId: CommandId.make(`command:buddy-prompt:${ordinal}`),
    threadId,
    messageId: MessageId.make(`message:buddy-prompt:${ordinal}`),
    text: message.text,
    ...(message.records === undefined
      ? {}
      : { context: { version: 1 as const, records: [...message.records] } }),
    attachments: [],
    modelSelection: message.modelSelection ?? buddyModel,
    dispatchMode: { type: "start_immediately" },
  });
  yield* Effect.raceFirst(
    settled,
    Effect.forever(worker.drain().pipe(Effect.andThen(worker.awaitWork))),
  );
});

describe("Buddy's T3 Code", () => {
  it.live("gives Hermes the person's words and the page as a Czech block, turn after turn", () =>
    Effect.gen(function* () {
      // Buddy's project is Buddy's layer, a folder without Git, and the thread is Buddy's own.
      yield* addProject(ProjectId.make("project:buddy"), buddyLayer);
      const { threadId } = yield* resolveBuddyThread();
      const record = {
        version: 1,
        kind: "lazurio-page",
        contextId: "lazurio-page-1",
        label: "Kontext stránky",
        payload: page,
      } as unknown as ComposerContextRecord;
      yield* send(threadId, 1, {
        text: "Co tu vidíte? [Kontext stránky](t3-context://v1/lazurio-page/lazurio-page-1)",
        records: [record],
      });
      yield* send(threadId, 2, { text: "A teď bez stránky." });

      assert.deepStrictEqual(receivedPrompts(requestLog), [
        [`Co tu vidíte?\n\n${lazurioPageContextBlock(page)}`],
        ["A teď bez stránky."],
      ]);
    }).pipe(
      Effect.provide(layerBuddyServer),
      Effect.scoped,
      Effect.provideService(HostProcess.Environment, {
        ...process.env,
        HOME: home,
        T3CODE_LAZURIO_BUDDY: "1",
        T3_ACP_REQUEST_LOG_PATH: requestLog,
      }),
    ),
  );
});

describe("Buddy's T3 Code and Hermes's settings", () => {
  it.live("sets Hermes no model, mode or other option a message's selection names", () => {
    const selectionHome = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "buddy-selection-orchestrator-"),
    );
    const selectionLayer = NodePath.join(selectionHome, "Lazurio", ".agents", "buddy");
    NodeFS.mkdirSync(selectionLayer, { recursive: true });
    const selectionLog = NodePath.join(selectionHome, "requests.jsonl");
    return Effect.gen(function* () {
      yield* addProject(ProjectId.make("project:buddy"), selectionLayer);
      const { threadId } = yield* resolveBuddyThread();
      // As the web sends it: Hermes's current model and remembered options in place of "default".
      yield* send(threadId, 1, {
        text: "Ahoj.",
        modelSelection: {
          instanceId: BUDDY,
          model: "composer-2",
          options: [
            { id: "mode", value: "code" },
            { id: "fast", value: "fast" },
          ],
        },
      });
      assert.deepStrictEqual(receivedPrompts(selectionLog), [["Ahoj."]]);
      const methods = NodeFS.readFileSync(selectionLog, "utf8")
        .split("\n")
        .flatMap((line) => (line.trim() === "" ? [] : [JSON.parse(line).method]));
      assert.notInclude(methods, "session/set_config_option");
      assert.notInclude(methods, "session/set_model");
    }).pipe(
      Effect.provide(layerBuddyServer),
      Effect.scoped,
      Effect.provideService(HostProcess.Environment, {
        ...process.env,
        HOME: selectionHome,
        T3CODE_LAZURIO_BUDDY: "1",
        T3_ACP_REQUEST_LOG_PATH: selectionLog,
      }),
    );
  });
});
