/**
 * Lazurio overlay (LazurioPlatform F51, root decision 0201): `t3 lazurio`. Machines checks
 * `t3 lazurio capabilities` (contract version 1), the Platform's `lazurio chat defaults --apply`
 * runs `t3 lazurio model`, the Launchpad runs `t3 lazurio providers` after Codex or Claude signed
 * in through its CLI and `t3 lazurio pairing` when the Environment pairs its own browser, so the
 * commands' output is a contract: cli.test.ts pins it.
 */
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  type AuthEnvironmentScope,
  AuthStandardClientScopes,
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
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag, GlobalFlag } from "effect/cli";
import { FetchHttpClient, HttpBody, HttpClient } from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import { requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import { DurationFromString, projectLocationFlags, resolveCliAuthConfig } from "../cli/config.ts";
import { formatIssuedPairingCredential } from "../cliAuthFormat.ts";
import * as ServerConfig from "../config.ts";
import { resolveBaseDir } from "../os-jank.ts";
import { isProcessAlive, readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import {
  MODEL_RECOMMENDATION_ROUTE,
  ModelRecommendationRequest,
  readModelRecommendationRecord,
} from "./modelRecommendation.ts";
import {
  PROVIDER_REFRESH_ROUTE,
  PROVIDER_REFRESH_SCOPES,
  ProviderRefreshRequest,
} from "./providerRefresh.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeModelRecommendationRequest = Schema.decodeEffect(
  Schema.fromJsonString(ModelRecommendationRequest),
);
const decodeProviderRefreshRequest = Schema.decodeEffect(
  Schema.fromJsonString(ProviderRefreshRequest),
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
        // The service says why, e.g. which instance holds a default instance's ID.
        refused: (status, body) =>
          `The live T3 service refused the provider refresh (${status}): ${body}`,
      });
    }),
  ),
);

/**
 * The operator's scopes, which the Environment's own browser pairs with (the Admin's decision of
 * 2026-10-17): T3's standard client scopes and access to Settings → Connections, where the person
 * sees the authorized clients and pairs the desktop and mobile apps. Never relay:write: T3 Connect
 * would be a public way in around the Environment's gateway and the tailnet. A session cannot
 * delegate a scope it does not hold, so no link made in Connections has it either.
 */
export const OPERATOR_PAIRING_SCOPES = [
  ...AuthStandardClientScopes,
  AuthAccessReadScope,
  AuthAccessWriteScope,
] as const;

const pairingCommand = Command.make("pairing", {
  ...projectLocationFlags,
  ttl: Flag.String("ttl").pipe(
    Flag.withSchema(DurationFromString),
    Flag.withDescription(
      "TTL, for example `60s` or `5m`. Without it, T3's default for a one-time token.",
    ),
    Flag.optional,
  ),
  label: Flag.String("label").pipe(
    Flag.withDescription("Optional human-readable label."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription(
    "Issue a one-time pairing token with the operator's scopes for the Environment's own browser, printed as `t3 auth pairing create --json` prints one.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveCliAuthConfig(flags, logLevel);
      // Upstream's one-time pairing grant, as `t3 auth pairing create` issues it, only with these
      // scopes. The Launchpad reads both commands' JSON alike, so logs stay quiet as with --json.
      const issued = yield* Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        return yield* auth.createPairingLink({
          scopes: OPERATOR_PAIRING_SCOPES,
          subject: "one-time-token",
          ...(Option.isSome(flags.ttl) ? { ttl: flags.ttl.value } : {}),
          ...(Option.isSome(flags.label) ? { label: flags.label.value } : {}),
        });
      }).pipe(
        Effect.provide(
          EnvironmentAuth.layerRuntime.pipe(
            Layer.provide(ServerConfig.layer(config)),
            Layer.provide(Layer.succeed(References.MinimumLogLevel, "Error")),
          ),
        ),
      );
      yield* Console.log(formatIssuedPairingCredential(issued, { json: true }));
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
        operatorPairing: true,
      }),
    ),
  ),
);

export const lazurioCommand = Command.make("lazurio").pipe(
  Command.withSubcommands([modelCommand, providersCommand, pairingCommand, capabilitiesCommand]),
);
