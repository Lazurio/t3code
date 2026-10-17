/**
 * Lazurio overlay (LazurioPlatform F51): `t3 lazurio`. Machines checks `t3 lazurio capabilities`
 * (contract version 1) and the Platform's `lazurio chat defaults --apply` runs `t3 lazurio model`,
 * so the commands' output is a contract: cli.test.ts pins it byte for byte.
 */
import {
  type AuthEnvironmentScope,
  ModelSelection,
  type ProjectId,
  WS_METHODS,
} from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command, GlobalFlag } from "effect/cli";
import { FetchHttpClient, HttpBody, HttpClient } from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import { requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "../cli/config.ts";
import * as ServerConfig from "../config.ts";
import { resolveBaseDir } from "../os-jank.ts";
import { isProcessAlive, readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import {
  MODEL_RECOMMENDATION_ROUTE,
  ModelRecommendationRequest,
  readModelRecommendationRecord,
} from "./modelRecommendation.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeModelRecommendationRequest = Schema.decodeEffect(
  Schema.fromJsonString(ModelRecommendationRequest),
);
// The offline read takes from `settings.json` only the projects' overrides, and of the Folder
// project's only its model, so the rest of the file, which only the server reads, never fails it.
const decodePersistedProjectOverrides = Schema.decodeUnknownOption(
  fromLenientJson(
    Schema.Struct({
      projectSettingsOverrides: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  ),
);
const decodeProjectModelOverride = Schema.decodeUnknownOption(
  Schema.Struct({ defaultModelSelection: Schema.optionalKey(Schema.NullOr(ModelSelection)) }),
);

class RunningServiceCommandError extends Schema.TaggedError<RunningServiceCommandError>()(
  "RunningServiceCommandError",
  { detail: Schema.String },
) {
  override get message() {
    return this.detail;
  }
}

/**
 * Post `body` to `route` on this Environment's running T3 service with a session issued for this
 * call alone, revoked afterwards, and print the service's answer as it is. Never an offline
 * fallback: without the running service nothing changes.
 */
const postToRunningService = (
  flags: { readonly baseDir: Option.Option<string> },
  call: {
    readonly route: string;
    readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
    readonly body: unknown;
    readonly label: string;
    readonly timeout: Duration.Input;
    readonly notRunning: string;
    /** The error for an answer other than 200, given its status and body. */
    readonly refused: (status: number, body: string) => string;
  },
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveCliAuthConfig(flags, logLevel);
    const state = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
    if (Option.isNone(state) || !isProcessAlive(state.value.pid))
      return yield* new RunningServiceCommandError({ detail: call.notRunning });
    return yield* Effect.gen(function* () {
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const client = yield* HttpClient.HttpClient;
      const output = yield* Effect.acquireUseRelease(
        auth.issueSession({ scopes: call.scopes, label: call.label }),
        (issued) =>
          Effect.gen(function* () {
            const headers = { authorization: `Bearer ${issued.token}` };
            const response = yield* client.post(`${state.value.origin}${call.route}`, {
              headers,
              body: yield* HttpBody.json(call.body),
            });
            if (response.status !== 200)
              return yield* new RunningServiceCommandError({
                detail: call.refused(response.status, yield* response.text),
              });
            return yield* response.json;
          }).pipe(Effect.timeout(call.timeout)),
        (issued) => auth.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
      );
      yield* Console.log(yield* encodeJson(output));
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          EnvironmentAuth.layerRuntime.pipe(Layer.provide(ServerConfig.layer(config))),
          FetchHttpClient.layer,
        ),
      ),
    );
  });

/** The Folder project's model as `settings.json` holds it, null when it has none. */
const readFolderModel = (settingsPath: string, projectId: ProjectId) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* fs.exists(settingsPath))) return null;
    const override = Option.flatMap(
      decodePersistedProjectOverrides(yield* fs.readFileString(settingsPath)),
      (settings) => decodeProjectModelOverride(settings.projectSettingsOverrides?.[projectId]),
    );
    return Option.isSome(override) ? (override.value.defaultModelSelection ?? null) : null;
  });

const modelCommand = Command.make("model", {
  ...projectLocationFlags,
  selection: Argument.String("selection-json").pipe(Argument.optional),
}).pipe(
  Command.withDescription(
    "Read saved model metadata without changing state, or reconcile a Platform recommendation through the running service.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      // Metadata-only status must not mint a session, create directories or
      // start a second settings writer. The server remains the sole writer.
      if (Option.isNone(flags.selection)) {
        const configuredHome = yield* Config.String("T3CODE_HOME").pipe(Config.option);
        const baseDir = yield* resolveBaseDir(
          Option.getOrUndefined(Option.orElse(flags.baseDir, () => configuredHome)),
        );
        const paths = yield* ServerConfig.deriveServerPaths(baseDir, undefined, {
          baseDirIsExplicit: true,
        });
        // The startup records the Folder's project; without the record there is none yet.
        const record = yield* readModelRecommendationRecord(paths.stateDir);
        yield* Console.log(
          yield* encodeJson({
            version: 1,
            current: Option.isSome(record)
              ? yield* readFolderModel(paths.settingsPath, record.value.projectId)
              : null,
            lastManaged: Option.isSome(record) ? record.value.selection : null,
          }),
        );
        return;
      }
      const selection = yield* decodeModelRecommendationRequest(flags.selection.value);
      yield* postToRunningService(flags, {
        route: MODEL_RECOMMENDATION_ROUTE,
        scopes: [requiredScopeForRpcMethod(WS_METHODS.serverUpdateSettings)],
        body: selection,
        label: "lazurio model reconciliation",
        timeout: "10 seconds",
        notRunning: "The T3 service must be running. No settings were changed.",
        refused: (status) =>
          `The live T3 service refused the recommendation (${status}). No offline fallback was attempted.`,
      });
    }),
  ),
);
const capabilitiesCommand = Command.make("capabilities").pipe(
  Command.withDescription(
    "Report the versioned Lazurio hosting contract without reading or changing user state.",
  ),
  Command.withHandler(() =>
    Console.log(
      JSON.stringify({
        version: 1,
        managedFolder: true,
        modelRecommendation: true,
      }),
    ),
  ),
);

export const lazurioCommand = Command.make("lazurio").pipe(
  Command.withSubcommands([modelCommand, capabilitiesCommand]),
);
