import { type ModelSelection, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { authenticateRawRouteWithScope } from "../http.ts";
import { requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import { failEnvironmentInternal } from "../auth/http.ts";
import { ServerSettingsService } from "../serverSettings.ts";

import { MODEL_RECOMMENDATION_ROUTE, ModelRecommendationRequest } from "./modelRecommendation.ts";
import { ServerConfig } from "../config.ts";
// Platform supplies product recommendations. T3 only owns reconciliation and
// persistence of its own preference, including evidence of its last managed write.
export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService;
    const config = yield* ServerConfig;
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
        yield* authenticateRawRouteWithScope(
          requiredScopeForRpcMethod(WS_METHODS.serverUpdateSettings),
        );
        const selection = yield* HttpServerRequest.schemaBodyJson(ModelRecommendationRequest).pipe(
          Effect.option,
        );
        if (Option.isNone(selection))
          return HttpServerResponse.jsonUnsafe(
            { error: "invalid-recommendation" },
            { status: 400 },
          );
        if (config.lazurioFolder === undefined || selection.value.folder !== config.lazurioFolder)
          return HttpServerResponse.jsonUnsafe({ error: "folder-mismatch" }, { status: 409 });
        return answer(
          yield* settings
            .reconcileRecommendedModel(selection.value.selection)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("internal_error", cause))),
        );
      }),
    );
  }),
);
