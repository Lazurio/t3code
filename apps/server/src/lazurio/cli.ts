/**
 * Lazurio overlay (LazurioPlatform F51, root decision 0201): `t3 lazurio`. Machines checks
 * `t3 lazurio capabilities` (contract version 1), the Platform's `lazurio chat defaults --apply`
 * runs `t3 lazurio model` and the Launchpad runs `t3 lazurio providers` after Codex or Claude signed
 * in through its CLI, so the commands' output is a contract: cli.test.ts pins it byte for byte.
 */
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Config from "effect/Config";
import { type AuthEnvironmentScope, ServerSettings, WS_METHODS } from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import { resolveBaseDir } from "../os-jank.ts";
import * as Console from "effect/Console";
import type * as Duration from "effect/Duration";
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
import {
  PROVIDER_REFRESH_ROUTE,
  PROVIDER_REFRESH_SCOPES,
  ProviderRefreshRequest,
} from "./providerRefresh.ts";
import { requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeModelRecommendationRequest = Schema.decodeEffect(
  Schema.fromJsonString(ModelRecommendationRequest),
);
const decodeProviderRefreshRequest = Schema.decodeEffect(
  Schema.fromJsonString(ProviderRefreshRequest),
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
    readonly refused: (status: number) => string;
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
                detail: call.refused(response.status),
              });
            return yield* response.json;
          }).pipe(Effect.timeout(call.timeout)),
        (issued) => auth.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
      );
      yield* Console.log(yield* encodeJson(output));
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          EnvironmentAuth.runtimeLayer.pipe(Layer.provide(ServerConfig.layer(config))),
          FetchHttpClient.layer,
        ),
      ),
    );
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
        const fs = yield* FileSystem.FileSystem;
        const settings = (yield* fs.exists(paths.settingsPath))
          ? yield* Schema.decodeEffect(fromLenientJson(ServerSettings))(
              yield* fs.readFileString(paths.settingsPath),
            )
          : { defaultModelSelection: null, lazurioManagedModelSelection: null };
        yield* Console.log(
          yield* encodeJson({
            version: 1,
            current: settings.defaultModelSelection,
            lastManaged: settings.lazurioManagedModelSelection,
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
const providersCommand = Command.make("providers", {
  ...projectLocationFlags,
  request: Argument.String("request-json"),
}).pipe(
  Command.withDescription(
    'After Codex or Claude signed in through its CLI, turn it on and read its sign-in again through the running service, e.g. {"providers":["codex"],"enable":true}.',
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const request = yield* decodeProviderRefreshRequest(flags.request);
      yield* postToRunningService(flags, {
        route: PROVIDER_REFRESH_ROUTE,
        scopes: PROVIDER_REFRESH_SCOPES,
        body: request,
        label: "lazurio provider refresh",
        // Reading a provider's sign-in starts its CLI; Codex's check alone may take ten seconds.
        timeout: "60 seconds",
        notRunning: "The T3 service must be running. Nothing was changed.",
        refused: (status) => `The live T3 service refused the provider refresh (${status}).`,
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
        providerRefresh: true,
      }),
    ),
  ),
);

export const lazurioCommand = Command.make("lazurio").pipe(
  Command.withSubcommands([modelCommand, providersCommand, capabilitiesCommand]),
);
