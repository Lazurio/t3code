/**
 * Lazurio overlay (LazurioPlatform F51): `POST /api/lazurio/model-recommendation` for
 * `t3 lazurio model`, under upstream's settings-write scope. Answers `{version: 1, current,
 * lastManaged}`; 400 for another body, 409 for another folder than the managed Folder, 503 when the
 * settings cannot be reconciled or the Folder's project is not recorded.
 */
import { WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { failEnvironmentInternal } from "../auth/http.ts";
import { requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import { makeFolderGuard } from "./managedFolder.ts";
import {
  applyModelRecommendation,
  MODEL_RECOMMENDATION_ROUTE,
  ModelRecommendationRequest,
} from "./modelRecommendation.ts";
import { authenticateOverlayRoute } from "./routeAuth.ts";

const unavailable = () => HttpServerResponse.jsonUnsafe({ error: "unavailable" }, { status: 503 });

export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const settings = yield* ServerSettings.ServerSettingsService;
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const folderGuard = yield* makeFolderGuard;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    // One recommendation at a time: each reads the record the one before it wrote.
    const oneAtATime = yield* Semaphore.make(1);
    yield* router.add(
      "POST",
      MODEL_RECOMMENDATION_ROUTE,
      Effect.gen(function* () {
        yield* authenticateOverlayRoute(requiredScopeForRpcMethod(WS_METHODS.serverUpdateSettings));
        const request = yield* HttpServerRequest.schemaBodyJson(ModelRecommendationRequest).pipe(
          Effect.option,
        );
        if (Option.isNone(request))
          return HttpServerResponse.jsonUnsafe(
            { error: "invalid-recommendation" },
            { status: 400 },
          );
        if (!(yield* folderGuard.isFolder(request.value.folder)))
          return HttpServerResponse.jsonUnsafe({ error: "folder-mismatch" }, { status: 409 });
        const updateSettingsWith = settings.updateSettingsWith;
        if (updateSettingsWith === undefined) return unavailable();
        const applied = yield* applyModelRecommendation({
          stateDir,
          updateSettingsWith,
          selection: request.value.selection,
        }).pipe(
          oneAtATime.withPermits(1),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.catch((cause) => failEnvironmentInternal("internal_error", cause)),
        );
        return Option.match(applied, {
          onNone: unavailable,
          onSome: (answer) => HttpServerResponse.jsonUnsafe(answer),
        });
      }),
    );
  }),
);
