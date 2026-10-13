/**
 * Lazurio overlay (LazurioPlatform F51): `t3 lazurio`. Machines checks `t3 lazurio capabilities`
 * (contract version 1) and the Platform's `lazurio chat defaults --apply` runs `t3 lazurio model`,
 * so both commands' output is a contract: cli.test.ts pins it byte for byte.
 */
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Config from "effect/Config";
import { AuthOrchestrationOperateScope, ServerSettings } from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import { resolveBaseDir } from "../os-jank.ts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command, GlobalFlag } from "effect/unstable/cli";
import { FetchHttpClient, HttpBody, HttpClient } from "effect/unstable/http";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { isProcessAlive, readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "../cli/config.ts";
import { MODEL_RECOMMENDATION_ROUTE, ModelRecommendationRequest } from "./modelRecommendation.ts";

class RecommendationCommandError extends Schema.TaggedError<RecommendationCommandError>()(
  "RecommendationCommandError",
  { detail: Schema.String },
) {
  override get message() {
    return this.detail;
  }
}

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
        const fs = yield* FileSystem.FileSystem;
        const settings = (yield* fs.exists(paths.settingsPath))
          ? yield* Schema.decodeEffect(fromLenientJson(ServerSettings))(
              yield* fs.readFileString(paths.settingsPath),
            )
          : { defaultModelSelection: null, lazurioManagedModelSelection: null };
        yield* Console.log(
          yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
            version: 1,
            current: settings.defaultModelSelection,
            lastManaged: settings.lazurioManagedModelSelection,
          }),
        );
        return;
      }
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveCliAuthConfig(flags, logLevel);
      const selection = yield* Schema.decodeEffect(
        Schema.fromJsonString(ModelRecommendationRequest),
      )(flags.selection.value);
      const state = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
      if (Option.isNone(state) || !isProcessAlive(state.value.pid))
        return yield* new RecommendationCommandError({
          detail: "The T3 service must be running. No settings were changed.",
        });
      return yield* Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const client = yield* HttpClient.HttpClient;
        const output = yield* Effect.acquireUseRelease(
          auth.issueSession({
            scopes: [AuthOrchestrationOperateScope],
            label: "lazurio model reconciliation",
          }),
          (issued) =>
            Effect.gen(function* () {
              const headers = { authorization: `Bearer ${issued.token}` };
              const url = `${state.value.origin}${MODEL_RECOMMENDATION_ROUTE}`;
              const response = yield* client.post(url, {
                headers,
                body: yield* HttpBody.json(selection),
              });
              if (response.status !== 200)
                return yield* new RecommendationCommandError({
                  detail: `The live T3 service refused the recommendation (${response.status}). No offline fallback was attempted.`,
                });
              return yield* response.json;
            }).pipe(Effect.timeout("10 seconds")),
          (issued) => auth.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
        );
        yield* Console.log(
          yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(output),
        );
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            EnvironmentAuth.runtimeLayer.pipe(Layer.provide(ServerConfig.layer(config))),
            FetchHttpClient.layer,
          ),
        ),
      );
    }),
  ),
);
const capabilitiesCommand = Command.make("capabilities").pipe(
  Command.withDescription(
    "Report the versioned Lazurio hosting contract without reading or changing user state.",
  ),
  Command.withHandler(() =>
    Console.log(JSON.stringify({ version: 1, managedFolder: true, modelRecommendation: true })),
  ),
);

export const lazurioCommand = Command.make("lazurio").pipe(
  Command.withSubcommands([modelCommand, capabilitiesCommand]),
);
