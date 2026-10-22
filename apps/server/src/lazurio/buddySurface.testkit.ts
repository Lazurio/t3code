// @effect-diagnostics nodeBuiltinImport:off - The mock ACP agent logs its requests to a file.
/**
 * Buddy's T3 Code for tests: the production V2 runtime with real provider-instance hydration,
 * wrapped as server.ts wraps it, and the provider instance `buddy` of the ACP registry running the
 * repository's mock ACP agent in Hermes' place. The agent logs every request it receives to the
 * file `T3_ACP_REQUEST_LOG_PATH` of `HostProcess.Environment` names.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  EventId,
  type ModelSelection,
  type ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import * as OpenCodeRuntime from "@t3tools/provider-opencode/server/OpenCodeRuntime";
import * as OpenCodeServerLedger from "@t3tools/provider-opencode/server/OpenCodeServerLedger";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FetchHttpClient } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as HostPowerMonitor from "../background/HostPowerMonitor.ts";
import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as McpSessionRegistryTestkit from "../mcp/McpSessionRegistry.testkit.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderTurnStartServiceTestkit from "../orchestration-v2/ProviderTurnStartService.testkit.ts";
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
import { withBuddyInstructions } from "./buddyPrompt.ts";

export const BUDDY = ProviderInstanceId.make("buddy");
export const buddyModel = { instanceId: BUDDY, model: "default" } satisfies ModelSelection;

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
export const layerBuddyServer = Layer.mergeAll(
  RuntimeLayer.layer,
  ProjectStore.layer,
  RuntimeLayer.layerEventInfrastructure,
).pipe(
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
  Layer.provideMerge(layerPlatformTest),
  Layer.provide(McpProviderSessions.layer),
);

/** A project, as the projection records one. */
export const addProject = Effect.fn("test.buddySurface.addProject")(function* (
  projectId: ProjectId,
  workspaceRoot: string,
) {
  yield* (yield* ProjectStore.ProjectStoreV2).apply({
    sequence: 1,
    eventId: EventId.make(`event:${projectId}`),
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
      title: NodePath.basename(workspaceRoot),
      workspaceRoot,
      defaultModelSelection: buddyModel,
      scripts: [],
      createdAt: "2026-10-22T00:00:00.000Z",
      updatedAt: "2026-10-22T00:00:00.000Z",
    },
  });
});

/** The text blocks of every `session/prompt` the agent received, in order. */
export function receivedPrompts(requestLog: string): Array<Array<string>> {
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
