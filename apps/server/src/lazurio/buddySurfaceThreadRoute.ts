/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): `POST /api/lazurio/buddy/thread` finds or
 * makes Buddy's thread (buddySurfaceThread.ts) for the web surface and `t3 lazurio buddy thread`.
 * Making it, or Buddy's project, dispatches a command, so it needs the client's orchestration scopes. Errors: 404
 * `not-buddy`, 409 `no-project` or `thread-conflict`, 503 otherwise.
 */
import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { HttpRouter, HttpServerResponse } from "effect/http";

import * as ServerConfig from "../config.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ProjectService } from "../project/ProjectService.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { BUDDY_THREAD_ROUTE, resolveBuddyThread } from "./buddySurfaceThread.ts";
import { authenticateOverlayRoute } from "./routeAuth.ts";

const STATUS = {
  "not-buddy": 404,
  "no-project": 409,
  "thread-conflict": 409,
  unavailable: 503,
} as const;

export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    // A handler sees only the request's context, so it takes the services from the layer's.
    const orchestrator = yield* OrchestratorV2;
    const projects = yield* ProjectStoreV2;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    // Buddy's project, when the Buddy folder appeared after the startup (managedFolderStartup.ts).
    const projectService = yield* ProjectService;
    const random = yield* SecureRandom.SecureRandom;
    const fileSystem = yield* FileSystem.FileSystem;
    // Only the shared server's first Buddy thread reads it; tests build this layer without one.
    const settings = yield* Effect.serviceOption(ServerSettingsService);
    yield* router.add(
      "POST",
      BUDDY_THREAD_ROUTE,
      Effect.gen(function* () {
        yield* authenticateOverlayRoute(AuthOrchestrationReadScope, AuthOrchestrationOperateScope);
        return yield* resolveBuddyThread().pipe(
          Effect.provideService(OrchestratorV2, orchestrator),
          Effect.provideService(ProjectStoreV2, projects),
          Effect.provideService(Path.Path, path),
          Effect.provideService(ServerConfig.ServerConfig, config),
          Effect.provideService(ProjectService, projectService),
          Effect.provideService(SecureRandom.SecureRandom, random),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Option.isSome(settings)
            ? Effect.provideService(ServerSettingsService, settings.value)
            : (effect) => effect,
          Effect.map((thread) => HttpServerResponse.jsonUnsafe(thread)),
          Effect.catchTags({
            BuddyThreadUnavailable: (error) =>
              Effect.succeed(
                HttpServerResponse.jsonUnsafe(
                  { error: error.reason, message: error.detail },
                  { status: STATUS[error.reason] },
                ),
              ),
          }),
        );
      }),
    );
  }),
);
