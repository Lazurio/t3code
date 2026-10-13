/**
 * Lazurio overlay (LazurioPlatform F51): `POST /api/lazurio/model-recommendation`, which
 * `t3 lazurio model <selection-json>` (cli.ts) calls on the running service. The Platform supplies
 * the recommendation; T3 owns reconciling it with the person's own choice and persisting both
 * (modelRecommendation.ts). The scope is upstream's for writing settings.
 *
 * Answers `{"version": 1, "current", "lastManaged"}`; 400 for another body, 409 when the request
 * names another folder than this Environment's managed Folder (a path that resolves to the Folder
 * is the Folder), 503 when the settings service cannot reconcile (only its test layer).
 */
import { type ModelSelection, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { failEnvironmentInternal } from "../auth/http.ts";
import { requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { makeFolderGuard } from "./managedFolder.ts";
import { MODEL_RECOMMENDATION_ROUTE, ModelRecommendationRequest } from "./modelRecommendation.ts";
import { authenticateOverlayRoute } from "./routeAuth.ts";

export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService;
    const folderGuard = yield* makeFolderGuard;
    const answer = (value: {
      defaultModelSelection: ModelSelection | null;
      lazurioManagedModelSelection: ModelSelection | null;
    }) =>
      HttpServerResponse.jsonUnsafe({
        version: 1,
        current: value.defaultModelSelection,
        lastManaged: value.lazurioManagedModelSelection,
      });
    yield* router.add(
      "POST",
      MODEL_RECOMMENDATION_ROUTE,
      Effect.gen(function* () {
        yield* authenticateOverlayRoute(requiredScopeForRpcMethod(WS_METHODS.serverUpdateSettings));
        const selection = yield* HttpServerRequest.schemaBodyJson(ModelRecommendationRequest).pipe(
          Effect.option,
        );
        if (Option.isNone(selection))
          return HttpServerResponse.jsonUnsafe(
            { error: "invalid-recommendation" },
            { status: 400 },
          );
        if (!(yield* folderGuard.isFolder(selection.value.folder)))
          return HttpServerResponse.jsonUnsafe({ error: "folder-mismatch" }, { status: 409 });
        if (settings.reconcileRecommendedModel === undefined)
          return HttpServerResponse.jsonUnsafe({ error: "unavailable" }, { status: 503 });
        return answer(
          yield* settings
            .reconcileRecommendedModel(selection.value.selection)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("internal_error", cause))),
        );
      }),
    );
  }),
);
