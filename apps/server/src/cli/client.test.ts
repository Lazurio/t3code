// @effect-diagnostics nodeBuiltinImport:off - this test verifies the CLI's on-disk secret boundary.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthStandardClientScopes } from "@t3tools/contracts";
import { remoteHttpClientLayer } from "@t3tools/client-runtime/rpc";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  ClientCliError,
  decodeClientCommandDocument,
  pairClientConnection,
  readClientConnection,
} from "./client.ts";

const pairingFetch = () => {
  const calls: Array<string> = [];
  const fetchFn = ((input) => {
    const url = String(input);
    calls.push(url);

    if (url.endsWith("/.well-known/t3/environment")) {
      return Promise.resolve(
        Response.json({
          environmentId: "environment-shared",
          label: "Shared Lazurio T3",
          platform: { os: "linux", arch: "x64" },
          serverVersion: "0.0.0-test",
          capabilities: { repositoryIdentity: true },
        }),
      );
    }

    if (url.endsWith("/oauth/token")) {
      return Promise.resolve(
        Response.json({
          access_token: "secret-bearer-token",
          issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
          token_type: "Bearer",
          expires_in: 3_600,
          scope: AuthStandardClientScopes.join(" "),
        }),
      );
    }

    return Promise.reject(new Error(`Unexpected request: ${url}`));
  }) as typeof fetch;

  return { calls, fetchFn };
};

describe("headless client", () => {
  it.effect("pairs into one caller-owned connection file without presenting the bearer", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-client-test-"));
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => NodeFS.rmSync(directory, { recursive: true })),
        );
        const connectionPath = NodePath.join(directory, "connection.json");
        const remote = pairingFetch();

        const result = yield* pairClientConnection({
          endpoint: "https://t3.example.test/some/path?ignored=yes",
          connectionPath,
          pairingCredential: "one-time-pairing-token",
          client: {
            label: "Lazurio client",
            deviceType: "bot",
            os: "linux",
          },
        }).pipe(
          Effect.provide(Layer.mergeAll(NodeServices.layer, remoteHttpClientLayer(remote.fetchFn))),
        );

        assert.deepEqual(remote.calls, [
          "https://t3.example.test/.well-known/t3/environment",
          "https://t3.example.test/oauth/token",
        ]);
        assert.equal(result.environmentId, "environment-shared");
        assert.equal(result.httpBaseUrl, "https://t3.example.test/");
        assert.notProperty(result, "bearerToken");

        const persisted = yield* readClientConnection(connectionPath).pipe(
          Effect.provide(NodeServices.layer),
        );
        assert.equal(persisted.bearerToken, "secret-bearer-token");
        assert.deepEqual(persisted.scopes, AuthStandardClientScopes);
        if ((yield* HostProcessPlatform) !== "win32") {
          assert.equal(NodeFS.statSync(connectionPath).mode & 0o777, 0o600);
        }
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
