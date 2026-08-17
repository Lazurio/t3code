// @effect-diagnostics nodeBuiltinImport:off - this test verifies the CLI's on-disk secret boundary.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthStandardClientScopes, ThreadId } from "@t3tools/contracts";
import {
  RemoteEnvironmentAuthInvalidJsonError,
  RemoteEnvironmentAuthUndeclaredStatusError,
  remoteHttpClientLayer,
} from "@t3tools/client-runtime/rpc";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  ClientCliError,
  decodeClientCommandDocument,
  pairClientConnection,
  readClientConnection,
  readClientSnapshot,
  readClientThreadSnapshot,
  sendClientCommand,
} from "./client.ts";

type FetchCall = readonly [
  input: Parameters<typeof fetch>[0],
  init: NonNullable<Parameters<typeof fetch>[1]>,
];

const environmentDescriptor = (environmentId = "environment-shared") => ({
  environmentId,
  label: "Shared T3 environment",
  platform: { os: "linux" as const, arch: "x64" as const },
  serverVersion: "0.0.0-test",
  capabilities: { repositoryIdentity: true },
});

const bearerGrant = {
  access_token: "secret-bearer-token",
  issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
  token_type: "Bearer",
  expires_in: 3_600,
  scope: AuthStandardClientScopes.join(" "),
};

const orchestrationSnapshot = {
  snapshotSequence: 7,
  updatedAt: "2026-08-17T12:00:00.000Z",
  projects: [],
  threads: [],
};

const threadSnapshot = {
  snapshotSequence: 7,
  thread: {
    id: "thread-1",
    projectId: "project-1",
    title: "Automated maintenance",
    modelSelection: { instanceId: "codex", model: "gpt-5" },
    interactionMode: "default",
    runtimeMode: "approval-required",
    branch: null,
    worktreePath: null,
    createdAt: "2026-08-17T12:00:00.000Z",
    updatedAt: "2026-08-17T12:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    latestTurn: null,
    messages: [],
    session: null,
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    deletedAt: null,
  },
};

const recordedFetch = (...responses: ReadonlyArray<Response>) => {
  const calls: Array<FetchCall> = [];
  let responseIndex = 0;
  const fetchFn = ((input, init) => {
    calls.push([input, init ?? {}]);
    const response = responses[responseIndex++];
    if (!response) {
      return Promise.reject(new Error(`Unexpected request: ${String(input)}`));
    }
    return Promise.resolve(response);
  }) as typeof fetch;

  return { calls, fetchFn };
};

const temporaryConnectionPath = Effect.acquireRelease(
  Effect.sync(() => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-client-test-"));
    return NodePath.join(directory, "connection.json");
  }),
  (path) => Effect.sync(() => NodeFS.rmSync(NodePath.dirname(path), { recursive: true })),
);

const provideTestServices = (fetchFn: typeof fetch) =>
  Effect.provide(Layer.mergeAll(NodeServices.layer, remoteHttpClientLayer(fetchFn)));

const pairForTest = (connectionPath: string) =>
  pairClientConnection({
    endpoint: "https://t3.example.test/some/path?ignored=yes",
    connectionPath,
    pairingCredential: "one-time-pairing-token",
    client: {
      label: "Automation client",
      deviceType: "bot",
      os: "linux",
    },
  });

const requestBody = (call: FetchCall): string => {
  const body = call[1].body;
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  throw new Error("Expected fetch request body");
};

const assertBearerRequest = (
  calls: ReadonlyArray<FetchCall>,
  index: number,
  expected: { readonly url: string; readonly method: string },
) => {
  const call = calls[index];
  assert.isDefined(call);
  assert.equal(String(call[0]), expected.url);
  assert.equal(call[1].method, expected.method);
  assert.equal(new Headers(call[1].headers).get("authorization"), "Bearer secret-bearer-token");
  return call;
};

describe("headless client", () => {
  it.effect("pairs into one caller-owned connection file without presenting the bearer", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const connectionPath = yield* temporaryConnectionPath;
        const remote = recordedFetch(
          Response.json(environmentDescriptor()),
          Response.json(bearerGrant),
        );

        const result = yield* pairForTest(connectionPath).pipe(provideTestServices(remote.fetchFn));

        assert.deepEqual(
          remote.calls.map(([input]) => String(input)),
          [
            "https://t3.example.test/.well-known/t3/environment",
            "https://t3.example.test/oauth/token",
          ],
        );
        assert.equal(result.environmentId, "environment-shared");
        assert.equal(result.httpBaseUrl, "https://t3.example.test/");
        assert.notProperty(result, "bearerToken");

        const persisted = yield* readClientConnection(connectionPath).pipe(
          provideTestServices(remote.fetchFn),
        );
        assert.equal(persisted.bearerToken, "secret-bearer-token");
        assert.deepEqual(persisted.scopes, AuthStandardClientScopes);
        if ((yield* HostProcessPlatform.pipe(Effect.provide(NodeServices.layer))) !== "win32") {
          assert.equal(NodeFS.statSync(connectionPath).mode & 0o777, 0o600);
        }
      }),
    ),
  );

  it.effect("reads a snapshot from the paired URL with bearer authentication", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const connectionPath = yield* temporaryConnectionPath;
        const remote = recordedFetch(
          Response.json(environmentDescriptor()),
          Response.json(bearerGrant),
          Response.json(environmentDescriptor()),
          Response.json(orchestrationSnapshot),
        );

        yield* pairForTest(connectionPath).pipe(provideTestServices(remote.fetchFn));
        const result = yield* readClientSnapshot(connectionPath).pipe(
          provideTestServices(remote.fetchFn),
        );

        assert.deepEqual(result, orchestrationSnapshot);
        assertBearerRequest(remote.calls, 3, {
          url: "https://t3.example.test/api/orchestration/snapshot",
          method: "GET",
        });
      }),
    ),
  );

  it.effect("reads and decodes one thread snapshot", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const connectionPath = yield* temporaryConnectionPath;
        const remote = recordedFetch(
          Response.json(environmentDescriptor()),
          Response.json(bearerGrant),
          Response.json(environmentDescriptor()),
          Response.json(threadSnapshot),
        );

        yield* pairForTest(connectionPath).pipe(provideTestServices(remote.fetchFn));
        const result = yield* readClientThreadSnapshot(
          connectionPath,
          ThreadId.make("thread-1"),
        ).pipe(provideTestServices(remote.fetchFn));

        assert.equal(result.snapshotSequence, threadSnapshot.snapshotSequence);
        assert.equal(result.thread.id, threadSnapshot.thread.id);
        assert.equal(result.thread.title, threadSnapshot.thread.title);
        assert.equal(result.thread.runtimeMode, threadSnapshot.thread.runtimeMode);
        assert.equal(result.thread.interactionMode, threadSnapshot.thread.interactionMode);
        assertBearerRequest(remote.calls, 3, {
          url: "https://t3.example.test/api/orchestration/threads/thread-1",
          method: "GET",
        });
      }),
    ),
  );

  it.effect("dispatches the validated command body and decodes its result", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const connectionPath = yield* temporaryConnectionPath;
        const remote = recordedFetch(
          Response.json(environmentDescriptor()),
          Response.json(bearerGrant),
          Response.json(environmentDescriptor()),
          Response.json({ sequence: 8 }),
        );
        const command = yield* decodeClientCommandDocument(
          "command.json",
          '{"type":"thread.turn.start","commandId":"command-1","threadId":"thread-1","message":{"messageId":"message-1","role":"user","text":"Run the focused checks.","attachments":[]},"runtimeMode":"approval-required","interactionMode":"default","createdAt":"2026-08-17T12:00:00.000Z"}',
        );

        yield* pairForTest(connectionPath).pipe(provideTestServices(remote.fetchFn));
        const result = yield* sendClientCommand(connectionPath, command).pipe(
          provideTestServices(remote.fetchFn),
        );

        assert.deepEqual(result, { sequence: 8 });
        const call = assertBearerRequest(remote.calls, 3, {
          url: "https://t3.example.test/api/orchestration/dispatch",
          method: "POST",
        });
        const sentCommand = yield* decodeClientCommandDocument("request body", requestBody(call));
        assert.deepEqual(sentCommand, command);
      }),
    ),
  );

  it.effect("preserves a structured authentication failure from snapshot", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const connectionPath = yield* temporaryConnectionPath;
        const remote = recordedFetch(
          Response.json(environmentDescriptor()),
          Response.json(bearerGrant),
          Response.json(environmentDescriptor()),
          Response.json(
            {
              _tag: "EnvironmentAuthInvalidError",
              code: "auth_invalid",
              reason: "invalid_credential",
              traceId: "trace-client-test",
            },
            { status: 401 },
          ),
        );

        yield* pairForTest(connectionPath).pipe(provideTestServices(remote.fetchFn));
        const error = yield* readClientSnapshot(connectionPath).pipe(
          provideTestServices(remote.fetchFn),
          Effect.flip,
        );

        assert.equal(error._tag, "EnvironmentAuthInvalidError");
        if (error._tag === "EnvironmentAuthInvalidError") {
          assert.equal(error.reason, "invalid_credential");
          assert.equal(error.traceId, "trace-client-test");
        }
      }),
    ),
  );

  it.effect("rejects a malformed successful thread response", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const connectionPath = yield* temporaryConnectionPath;
        const remote = recordedFetch(
          Response.json(environmentDescriptor()),
          Response.json(bearerGrant),
          Response.json(environmentDescriptor()),
          Response.json({ snapshotSequence: 7, thread: { id: "thread-1" } }),
        );

        yield* pairForTest(connectionPath).pipe(provideTestServices(remote.fetchFn));
        const error = yield* readClientThreadSnapshot(
          connectionPath,
          ThreadId.make("thread-1"),
        ).pipe(provideTestServices(remote.fetchFn), Effect.flip);

        assert.instanceOf(error, RemoteEnvironmentAuthInvalidJsonError);
      }),
    ),
  );

  it.effect("reports an undeclared dispatch status", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const connectionPath = yield* temporaryConnectionPath;
        const remote = recordedFetch(
          Response.json(environmentDescriptor()),
          Response.json(bearerGrant),
          Response.json(environmentDescriptor()),
          Response.json({ error: "unavailable" }, { status: 502 }),
        );
        const command = yield* decodeClientCommandDocument(
          "command.json",
          '{"type":"thread.turn.start","commandId":"command-1","threadId":"thread-1","message":{"messageId":"message-1","role":"user","text":"Run the focused checks.","attachments":[]},"runtimeMode":"approval-required","interactionMode":"default","createdAt":"2026-08-17T12:00:00.000Z"}',
        );

        yield* pairForTest(connectionPath).pipe(provideTestServices(remote.fetchFn));
        const error = yield* sendClientCommand(connectionPath, command).pipe(
          provideTestServices(remote.fetchFn),
          Effect.flip,
        );

        assert.instanceOf(error, RemoteEnvironmentAuthUndeclaredStatusError);
        assert.equal(error.status, 502);
      }),
    ),
  );

  it.effect("refuses a connection when the paired environment identity changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const connectionPath = yield* temporaryConnectionPath;
        const remote = recordedFetch(
          Response.json(environmentDescriptor()),
          Response.json(bearerGrant),
          Response.json(environmentDescriptor("environment-other")),
        );

        yield* pairForTest(connectionPath).pipe(provideTestServices(remote.fetchFn));
        const error = yield* readClientSnapshot(connectionPath).pipe(
          provideTestServices(remote.fetchFn),
          Effect.flip,
        );

        assert.instanceOf(error, ClientCliError);
        assert.equal(error.code, "environment-mismatch");
        assert.lengthOf(remote.calls, 3);
      }),
    ),
  );

  it.effect("requires callers to choose runtime and interaction modes explicitly", () =>
    Effect.gen(function* () {
      const error = yield* decodeClientCommandDocument(
        "command.json",
        '{"type":"thread.turn.start","commandId":"command-1","threadId":"thread-1","message":{"messageId":"message-1","role":"user","text":"Run the focused checks.","attachments":[]},"createdAt":"2026-08-17T12:00:00.000Z"}',
      ).pipe(Effect.flip);
      assert.instanceOf(error, ClientCliError);
      assert.equal(error.code, "command-invalid");

      const decoded = yield* decodeClientCommandDocument(
        "command.json",
        '{"type":"thread.turn.start","commandId":"command-1","threadId":"thread-1","message":{"messageId":"message-1","role":"user","text":"Run the focused checks.","attachments":[]},"runtimeMode":"approval-required","interactionMode":"default","createdAt":"2026-08-17T12:00:00.000Z"}',
      );
      assert.equal(decoded.type, "thread.turn.start");
      if (decoded.type === "thread.turn.start") {
        assert.equal(decoded.runtimeMode, "approval-required");
        assert.equal(decoded.interactionMode, "default");
      }
    }),
  );
});
