// Buddy's prompts through the production V2 runtime, as Buddy's T3 Code builds it: the provider
// instance `buddy` of the ACP registry runs the repository's mock ACP agent in Hermes' place, and
// the agent logs every request it receives.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  type ComposerContextRecord,
  EnvironmentId,
  EventId,
  MessageId,
  type ModelSelection,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import * as OpenCodeRuntime from "@t3tools/provider-opencode/server/OpenCodeRuntime";
import * as OpenCodeServerLedger from "@t3tools/provider-opencode/server/OpenCodeServerLedger";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as HostPowerMonitor from "../background/HostPowerMonitor.ts";
import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as McpSessionRegistryTestkit from "../mcp/McpSessionRegistry.testkit.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderTurnStartServiceTestkit from "../orchestration-v2/ProviderTurnStartService.testkit.ts";
import { isTerminalRunStatus } from "../orchestration-v2/ThreadManagementService.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as AntigravityInstallation from "../provider/AntigravityInstallation.ts";
import * as CodexInstallation from "../provider/CodexInstallation.ts";
import * as ModelManifest from "../provider/ModelManifest.ts";
import * as ProviderInstanceRegistryHydration from "../provider/ProviderInstanceRegistryHydration.ts";
import * as ResetCreditCoordinator from "../provider/resetCreditCoordinator.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { lazurioPageContextBlock, withBuddyInstructions } from "./buddyPrompt.ts";

const BUDDY = ProviderInstanceId.make("buddy");
const buddyModel = { instanceId: BUDDY, model: "default" } satisfies ModelSelection;
const requestLog = NodePath.join(
  NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "buddy-prompt-orchestrator-")),
  "requests.jsonl",
);
const page = {
  v: 1,
  environment: { id: "vm-01.example", kind: "work", name: "Pracovní" },
  organization: { slug: "example", name: "Example Company" },
  app: "chat",
  page: { path: "/a1b2c3" },
} as const;

const layerPlatformTest = Layer.merge(
  NodeServices.layer,
  Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
    resolveLink: () => Effect.die("unused title link"),
  }),
);
const layerServerConfig = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-lazurio-buddy-prompt-",
});
const layerServerSettings = ServerSettings.layerTest({
  providerInstances: {
    [BUDDY]: {
      driver: ProviderDriverKind.make("acpRegistry"),
      displayName: "Buddy",
      enabled: true,
      config: {
        source: "local",
        commandPath: process.execPath,
        commandArgs: [NodePath.join(import.meta.dirname, "../../scripts/acp-mock-agent.ts")],
      },
    },
  },
});
const layerCheckpointStore = CheckpointStore.layer.pipe(
  Layer.provide(
    VcsDriverRegistry.layer.pipe(
      Layer.provide(VcsProcess.layer),
      Layer.provide(layerServerConfig),
      Layer.provide(layerPlatformTest),
    ),
  ),
);
// Wrapped as server.ts wraps it.
const layerProviderInstanceRegistry = withBuddyInstructions(
  ProviderInstanceRegistryHydration.layer,
).pipe(
  Layer.provide(
    Layer.mergeAll(
      layerServerConfig.pipe(Layer.provide(layerPlatformTest)),
      layerServerSettings,
      ServerSecretStore.layer.pipe(
        Layer.provide(layerServerConfig),
        Layer.provide(layerPlatformTest),
      ),
      NodeServices.layer,
      FetchHttpClient.layer,
      OpenCodeRuntime.layer.pipe(
        Layer.provide(OpenCodeServerLedger.layerTest),
        Layer.provide(layerPlatformTest),
      ),
      Layer.succeed(
        ProviderEventLoggers.ProviderEventLoggers,
        ProviderEventLoggers.NoOpProviderEventLoggers,
      ),
      ProviderLatestVersions.layer,
      ModelManifest.layerTest,
      AntigravityInstallation.AntigravityInstallation.layer.pipe(
        Layer.provide(layerServerConfig.pipe(Layer.provide(layerPlatformTest))),
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(layerPlatformTest),
      ),
      Layer.mock(CodexInstallation.CodexInstallation)({
        managedDirectory: "unused-managed-installation",
      }),
      Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
        getEnvironmentId: Effect.succeed(
          EnvironmentId.make("00000000-0000-4000-8000-000000000001"),
        ),
      }),
    ),
  ),
);
const layerBuddyServer = Layer.merge(RuntimeLayer.layer, ProjectStore.layer).pipe(
  Layer.provide(McpSessionRegistryTestkit.layer),
  Layer.provide(SqlitePersistence.layerMemory),
  Layer.provide(layerCheckpointStore),
  Layer.provide(layerServerConfig),
  Layer.provide(layerServerSettings),
  Layer.provide(layerProviderInstanceRegistry),
  Layer.provide(ResetCreditCoordinator.layer),
  Layer.provide(
    BackgroundPolicy.layer.pipe(
      Layer.provide(Layer.effect(HostPowerMonitor.HostPowerMonitor, HostPowerMonitor.make())),
      Layer.provide(layerServerSettings),
    ),
  ),
  Layer.provide(ProviderTurnStartServiceTestkit.layer),
  Layer.provide(layerPlatformTest),
  Layer.provide(McpProviderSessions.layer),
);

/** The text blocks of every `session/prompt` the agent received, in order. */
function receivedPrompts(): Array<Array<string>> {
  if (!NodeFS.existsSync(requestLog)) return [];
  return NodeFS.readFileSync(requestLog, "utf8")
    .split("\n")
    .flatMap((line) => {
      if (line.trim() === "") return [];
      const request = JSON.parse(line) as {
        method?: string;
        params?: { prompt?: Array<{ type: string; text?: string }> };
      };
      return request.method === "session/prompt"
        ? [
            (request.params?.prompt ?? []).flatMap((block) =>
              block.type === "text" && block.text !== undefined ? [block.text] : [],
            ),
          ]
        : [];
    });
}

/**
 * Send a message as the person's web client does, and run the effect worker until the message's
 * run settles.
 */
const send = Effect.fn("test.buddyPrompt.send")(function* (
  threadId: ThreadId,
  ordinal: number,
  message: { readonly text: string; readonly records?: ReadonlyArray<ComposerContextRecord> },
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
    modelSelection: buddyModel,
    dispatchMode: { type: "start_immediately" },
  });
  yield* Effect.raceFirst(
    settled,
    Effect.forever(worker.drain().pipe(Effect.andThen(worker.awaitWork))),
  );
});

describe("Buddy's T3 Code", () => {
  it.live(
    "gives Hermes the person's words and the page as a Czech block, turn after turn",
    () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const projectId = ProjectId.make("project:buddy");
        // Buddy's project is the Buddy layer, a folder without Git.
        yield* (yield* ProjectStore.ProjectStoreV2).apply({
          sequence: 1,
          eventId: EventId.make("event:buddy-prompt:project"),
          aggregateKind: "project",
          aggregateId: projectId,
          occurredAt: "2026-10-22T00:00:00.000Z",
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "project.created",
          payload: {
            projectId,
            title: "Buddy",
            workspaceRoot: NodePath.dirname(requestLog),
            defaultModelSelection: buddyModel,
            scripts: [],
            createdAt: "2026-10-22T00:00:00.000Z",
            updatedAt: "2026-10-22T00:00:00.000Z",
          },
        });
        const threadId = ThreadId.make("thread:buddy-prompt");
        yield* orchestrator.dispatch({
          type: "thread.create",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make("command:buddy-prompt:create"),
          threadId,
          projectId,
          title: "Buddy",
          modelSelection: buddyModel,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
        });
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

        assert.deepStrictEqual(receivedPrompts(), [
          [`Co tu vidíte?\n\n${lazurioPageContextBlock(page)}`],
          ["A teď bez stránky."],
        ]);
      }).pipe(
        Effect.provide(layerBuddyServer),
        Effect.scoped,
        Effect.provideService(HostProcess.Environment, {
          ...process.env,
          T3CODE_LAZURIO_BUDDY: "1",
          T3_ACP_REQUEST_LOG_PATH: requestLog,
        }),
      ),
    120_000,
  );
});
