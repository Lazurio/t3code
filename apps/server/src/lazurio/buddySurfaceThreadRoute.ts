/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): `POST /api/lazurio/buddy/thread`, which
 * finds or makes Buddy's thread (buddySurfaceThread.ts). Buddy's web surface asks it when it opens,
 * and `t3 lazurio buddy thread` (buddySurfaceCli.ts) for budíček. Making the thread dispatches a
 * command, so the route needs the orchestration scopes the person's client surface reads threads
 * and operates them with.
 *
 * Answers `{"threadId", "projectId"}`; 404 `{"error": "not-buddy"}` on a server that is not
 * Buddy's, 409 `{"error": "no-project"}` while Buddy's project is not added and
 * `{"error": "thread-conflict"}` while a thread with Buddy's id is someone else's, 503 otherwise.
 */
import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { HttpRouter, HttpServerResponse } from "effect/http";

import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
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
    yield* router.add(
      "POST",
      BUDDY_THREAD_ROUTE,
      Effect.gen(function* () {
        yield* authenticateOverlayRoute(AuthOrchestrationReadScope, AuthOrchestrationOperateScope);
        return yield* resolveBuddyThread().pipe(
          Effect.provideService(OrchestratorV2, orchestrator),
          Effect.provideService(ProjectStoreV2, projects),
          Effect.provideService(Path.Path, path),
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
