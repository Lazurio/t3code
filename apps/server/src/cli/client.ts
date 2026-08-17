import {
  AuthClientMetadataDeviceType,
  type AuthClientPresentationMetadata,
  AuthEnvironmentScopes,
  ClientOrchestrationCommand,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { bootstrapRemoteBearerSession } from "@t3tools/client-runtime/authorization";
import { fetchRemoteEnvironmentDescriptor } from "@t3tools/client-runtime/environment";
import {
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiClient,
  remoteHttpClientLayer,
} from "@t3tools/client-runtime/rpc";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { parseOAuthScope } from "@t3tools/shared/oauthScope";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/unstable/cli";

const CLIENT_CONNECTION_SCHEMA_VERSION = "t3.client.connection.v1" as const;
const CLIENT_REQUEST_TIMEOUT_MS = 10_000;
const CLIENT_PAIRING_TOKEN_ENV = "T3CODE_CLIENT_PAIRING_TOKEN";

const ClientConnectionDocument = Schema.Struct({
  schemaVersion: Schema.Literal(CLIENT_CONNECTION_SCHEMA_VERSION),
  environmentId: EnvironmentId,
  label: Schema.String,
  httpBaseUrl: Schema.String,
  bearerToken: Schema.String,
  scopes: AuthEnvironmentScopes,
  expiresAtEpochMs: Schema.Number,
});
type ClientConnectionDocument = typeof ClientConnectionDocument.Type;
const ClientConnectionDocumentJson = Schema.fromJsonString(ClientConnectionDocument);
const ClientOrchestrationCommandJson = Schema.fromJsonString(ClientOrchestrationCommand);
const decodeClientConnectionJson = Schema.decodeUnknownEffect(ClientConnectionDocumentJson);
const decodeOrchestrationCommandJson = Schema.decodeUnknownEffect(ClientOrchestrationCommandJson);
const encodeClientConnectionJson = Schema.encodeEffect(ClientConnectionDocumentJson);
const decodeEnvironmentScopes = Schema.decodeUnknownEffect(AuthEnvironmentScopes);

const encodePresentationJson = (value: unknown): string => JSON.stringify(value);

const ClientCliErrorCode = Schema.Literals([
  "invalid-endpoint",
  "missing-pairing-credential",
  "invalid-scope-grant",
  "connection-read-failed",
  "connection-invalid",
  "connection-expired",
  "environment-mismatch",
  "connection-write-failed",
  "command-read-failed",
  "command-invalid",
]);
type ClientCliErrorCode = typeof ClientCliErrorCode.Type;

export class ClientCliError extends Schema.TaggedErrorClass<ClientCliError>()("ClientCliError", {
  code: ClientCliErrorCode,
  message: Schema.String,
}) {}

const clientCliError = (code: ClientCliErrorCode, message: string) =>
  new ClientCliError({ code, message });

const normalizeClientEndpoint = (endpoint: string) =>
  Effect.try({
    try: () => {
      const url = new URL(endpoint.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
      url.pathname = "/";
      url.search = "";
      url.hash = "";
      return url.toString();
    },
    catch: () => clientCliError("invalid-endpoint", `Invalid T3 environment endpoint: ${endpoint}`),
  });

const decodeConnectionDocument = (path: string, contents: string) =>
  decodeClientConnectionJson(contents).pipe(
    Effect.mapError(() =>
      clientCliError("connection-invalid", `T3 client connection file ${path} is invalid.`),
    ),
  );

export const decodeClientCommandDocument = (path: string, contents: string) =>
  decodeOrchestrationCommandJson(contents).pipe(
    Effect.mapError(() =>
      clientCliError("command-invalid", `T3 orchestration command file ${path} is invalid.`),
    ),
  );

const writeConnectionDocument = Effect.fn("clientCli.writeConnectionDocument")(function* (
  path: string,
  document: ClientConnectionDocument,
) {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const directory = paths.dirname(path);

  yield* fs
    .makeDirectory(directory, { recursive: true })
    .pipe(
      Effect.mapError(() => clientCliError("connection-write-failed", `Could not write ${path}.`)),
    );
  const temporaryPath = yield* fs
    .makeTempFileScoped({ directory, prefix: `.${paths.basename(path)}.` })
    .pipe(
      Effect.mapError(() => clientCliError("connection-write-failed", `Could not write ${path}.`)),
    );
  const contents = yield* encodeClientConnectionJson(document).pipe(
    Effect.mapError(() => clientCliError("connection-write-failed", `Could not write ${path}.`)),
  );
  yield* fs.writeFileString(temporaryPath, contents, { mode: 0o600 }).pipe(
    Effect.andThen(fs.chmod(temporaryPath, 0o600)),
    Effect.andThen(fs.rename(temporaryPath, path)),
    Effect.andThen(fs.chmod(path, 0o600)),
    Effect.mapError(() => clientCliError("connection-write-failed", `Could not write ${path}.`)),
  );
});

export const readClientConnection = Effect.fn("clientCli.readClientConnection")(function* (
  path: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const contents = yield* fs
    .readFileString(path)
    .pipe(
      Effect.mapError(() => clientCliError("connection-read-failed", `Could not read ${path}.`)),
    );
  const document = yield* decodeConnectionDocument(path, contents);
  const now = yield* DateTime.now;
  if (document.expiresAtEpochMs <= now.epochMilliseconds) {
    return yield* clientCliError(
      "connection-expired",
      `T3 client connection ${document.environmentId} has expired; pair it again.`,
    );
  }
  return document;
});

const validateConnectionEnvironment = Effect.fn("clientCli.validateConnectionEnvironment")(
  function* (connection: ClientConnectionDocument) {
    const descriptor = yield* fetchRemoteEnvironmentDescriptor({
      httpBaseUrl: connection.httpBaseUrl,
      timeoutMs: CLIENT_REQUEST_TIMEOUT_MS,
    });
    if (descriptor.environmentId !== connection.environmentId) {
      return yield* clientCliError(
        "environment-mismatch",
        `T3 client connection expected environment ${connection.environmentId}, but reached ${descriptor.environmentId}.`,
      );
    }
    return descriptor;
  },
);

const withClientConnection = <A, E, R>(
  path: string,
  run: (connection: ClientConnectionDocument) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const connection = yield* readClientConnection(path);
    yield* validateConnectionEnvironment(connection);
    return yield* run(connection);
  });

export const pairClientConnection = Effect.fn("clientCli.pairClientConnection")(function* (input: {
  readonly endpoint: string;
  readonly connectionPath: string;
  readonly pairingCredential: string;
  readonly client: AuthClientPresentationMetadata;
}) {
  const httpBaseUrl = yield* normalizeClientEndpoint(input.endpoint);
  const descriptor = yield* fetchRemoteEnvironmentDescriptor({
    httpBaseUrl,
    timeoutMs: CLIENT_REQUEST_TIMEOUT_MS,
  });
  const access = yield* bootstrapRemoteBearerSession({
    httpBaseUrl,
    credential: input.pairingCredential,
    clientMetadata: input.client,
    timeoutMs: CLIENT_REQUEST_TIMEOUT_MS,
  });
  const parsedScopes = parseOAuthScope(access.scope);
  if (parsedScopes === null) {
    return yield* clientCliError(
      "invalid-scope-grant",
      "The T3 environment returned an invalid scope grant.",
    );
  }
  const scopes = yield* decodeEnvironmentScopes(parsedScopes).pipe(
    Effect.mapError(() =>
      clientCliError("invalid-scope-grant", "The T3 environment returned an invalid scope grant."),
    ),
  );
  const now = yield* DateTime.now;
  const document: ClientConnectionDocument = {
    schemaVersion: CLIENT_CONNECTION_SCHEMA_VERSION,
    environmentId: descriptor.environmentId,
    label: descriptor.label,
    httpBaseUrl,
    bearerToken: access.access_token,
    scopes,
    expiresAtEpochMs: now.epochMilliseconds + access.expires_in * 1_000,
  };
  yield* writeConnectionDocument(input.connectionPath, document);
  return {
    schemaVersion: document.schemaVersion,
    environmentId: document.environmentId,
    label: document.label,
    httpBaseUrl: document.httpBaseUrl,
    scopes: document.scopes,
    expiresAtEpochMs: document.expiresAtEpochMs,
    connectionPath: input.connectionPath,
  };
});

const fetchClientSnapshot = (connection: ClientConnectionDocument) =>
  Effect.gen(function* () {
    const client = yield* makeEnvironmentHttpApiClient(connection.httpBaseUrl);
    return yield* executeEnvironmentHttpRequest(
      new URL("/api/orchestration/snapshot", connection.httpBaseUrl).toString(),
      CLIENT_REQUEST_TIMEOUT_MS,
      client.orchestration.snapshot({
        headers: { authorization: `Bearer ${connection.bearerToken}` },
      }),
    );
  });

const fetchClientThreadSnapshot = (connection: ClientConnectionDocument, threadId: ThreadId) =>
  Effect.gen(function* () {
    const client = yield* makeEnvironmentHttpApiClient(connection.httpBaseUrl);
    return yield* executeEnvironmentHttpRequest(
      new URL(
        `/api/orchestration/threads/${encodeURIComponent(threadId)}`,
        connection.httpBaseUrl,
      ).toString(),
      CLIENT_REQUEST_TIMEOUT_MS,
      client.orchestration.threadSnapshot({
        headers: { authorization: `Bearer ${connection.bearerToken}` },
        params: { threadId },
        payload: {},
      }),
    );
  });

const dispatchClientCommand = (
  connection: ClientConnectionDocument,
  command: ClientOrchestrationCommand,
) =>
  Effect.gen(function* () {
    const client = yield* makeEnvironmentHttpApiClient(connection.httpBaseUrl);
    return yield* executeEnvironmentHttpRequest(
      new URL("/api/orchestration/dispatch", connection.httpBaseUrl).toString(),
      CLIENT_REQUEST_TIMEOUT_MS,
      client.orchestration.dispatch({
        headers: { authorization: `Bearer ${connection.bearerToken}` },
        payload: command,
        // HttpApiClient distributes endpoint inputs over every payload union member. The command
        // was decoded against this endpoint's exact ClientOrchestrationCommand schema above.
      } as Parameters<typeof client.orchestration.dispatch>[0]),
    );
  });

const provideClientHttp = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(remoteHttpClientLayer(globalThis.fetch)));

const connectionFlag = Flag.string("connection").pipe(
  Flag.withDescription("Path to a T3 client connection file."),
);

const pairCommand = Command.make("pair", {
  endpoint: Argument.string("endpoint").pipe(
    Argument.withDescription("HTTP(S) origin of the T3 environment."),
  ),
  connection: connectionFlag,
  label: Flag.string("label").pipe(
    Flag.withDescription("Client label shown in the environment's authorized-device list."),
    Flag.withDefault("T3 CLI"),
  ),
  deviceType: Flag.choice("device-type", AuthClientMetadataDeviceType.literals).pipe(
    Flag.withDescription("Presentation type shown for this paired client."),
    Flag.withDefault("unknown"),
  ),
}).pipe(
  Command.withDescription("Exchange a one-time pairing credential for a client connection."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const pairingCredential = process.env[CLIENT_PAIRING_TOKEN_ENV]?.trim() ?? "";
      if (pairingCredential.length === 0) {
        return yield* clientCliError(
          "missing-pairing-credential",
          `Set ${CLIENT_PAIRING_TOKEN_ENV} to the one-time pairing credential.`,
        );
      }
      const platform = yield* HostProcessPlatform;
      const result = yield* pairClientConnection({
        endpoint: flags.endpoint,
        connectionPath: flags.connection,
        pairingCredential,
        client: {
          label: flags.label,
          deviceType: flags.deviceType,
          os: platform,
        },
      });
      yield* Console.log(encodePresentationJson(result));
    }).pipe(provideClientHttp),
  ),
);

const snapshotCommand = Command.make("snapshot", {
  connection: connectionFlag,
}).pipe(
  Command.withDescription("Read the environment's orchestration command snapshot as JSON."),
  Command.withHandler((flags) =>
    withClientConnection(flags.connection, (connection) =>
      fetchClientSnapshot(connection).pipe(
        Effect.flatMap((snapshot) => Console.log(encodePresentationJson(snapshot))),
      ),
    ).pipe(provideClientHttp),
  ),
);

const threadCommand = Command.make("thread", {
  connection: connectionFlag,
  threadId: Argument.string("thread-id").pipe(Argument.withDescription("T3 thread id.")),
}).pipe(
  Command.withDescription("Read one thread snapshot as JSON."),
  Command.withHandler((flags) =>
    withClientConnection(flags.connection, (connection) =>
      fetchClientThreadSnapshot(connection, ThreadId.make(flags.threadId)).pipe(
        Effect.flatMap((snapshot) => Console.log(encodePresentationJson(snapshot))),
      ),
    ).pipe(provideClientHttp),
  ),
);

const dispatchCommand = Command.make("dispatch", {
  connection: connectionFlag,
  commandFile: Argument.string("command-file").pipe(
    Argument.withDescription("Path to one ClientOrchestrationCommand JSON document."),
  ),
}).pipe(
  Command.withDescription("Validate and dispatch one idempotent orchestration command."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const contents = yield* fs
        .readFileString(flags.commandFile)
        .pipe(
          Effect.mapError(() =>
            clientCliError(
              "command-read-failed",
              `Could not read T3 orchestration command file ${flags.commandFile}.`,
            ),
          ),
        );
      const command = yield* decodeClientCommandDocument(flags.commandFile, contents);
      return yield* withClientConnection(flags.connection, (connection) =>
        dispatchClientCommand(connection, command).pipe(
          Effect.flatMap((result) => Console.log(encodePresentationJson(result))),
        ),
      );
    }).pipe(provideClientHttp),
  ),
);

export const clientCommand = Command.make("client").pipe(
  Command.withDescription("Use T3 as a paired headless client."),
  Command.withSubcommands([pairCommand, snapshotCommand, threadCommand, dispatchCommand]),
);
