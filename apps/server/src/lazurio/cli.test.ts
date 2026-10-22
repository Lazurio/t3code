// @effect-diagnostics nodeBuiltinImport:off - CLI integration exercises Node HTTP and filesystem boundaries.
import * as NodeHttp from "node:http";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthRelayWriteScope,
  ProviderDriverKind,
  ProviderInstanceId,
  sessionHasLegacyPermissions,
} from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";
import { HttpRouter, HttpServer } from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { cli } from "../binCli.ts";
import * as ServerConfig from "../config.ts";
import {
  makePersistedServerRuntimeState,
  persistServerRuntimeState,
} from "../serverRuntimeState.ts";
import * as Settings from "../serverSettings.ts";
import * as ModelRecommendationRoute from "./modelRecommendationRoute.ts";
import * as ProviderRefresh from "./providerRefresh.ts";
import * as ProviderRefreshRoute from "./providerRefreshRoute.ts";

// `t3 lazurio` is a contract: Machines checks `capabilities`, the Platform's
// `lazurio chat defaults --apply` reads `model`'s answer and the Launchpad reads `providers`'s and
// `pairing`'s. These pin their output byte for byte, and `pairing`'s as `t3 auth pairing create
// --json` prints a token of its own.

const run = (args: ReadonlyArray<string>) =>
  Command.runWith(cli, { version: "0.0.0" })(args).pipe(
    Effect.provide(Layer.mergeAll(NodeServices.layer, NetService.layer)),
  );
const printed = Effect.map(TestConsole.logLines, (lines) =>
  lines.filter((line): line is string => typeof line === "string"),
);
const makeBaseDir = () => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-lazurio-cli-"));
// The recommendation as the Platform sends it, and as T3 prints it back.
const selectionJson =
  '{"instanceId":"codex","model":"gpt-6.1-sol","options":[{"id":"reasoningEffort","value":"high"}]}';
// The Folder exists, as Machines' T3CODE_LAZURIO_FOLDER does; the Platform sends its realpath.
const folder = NodeFS.realpathSync(
  NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-lazurio-cli-folder-")),
);
const request = `{"folder":"${folder}","selection":${selectionJson}}`;
// The Folder's project, which the managed startup records in the overlay's own file.
const folderProject = "project-lazurio";
const writeRecord = (baseDir: string, selection: string) => {
  const directory = NodePath.join(baseDir, "userdata", "lazurio");
  NodeFS.mkdirSync(directory, { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(directory, "model-recommendation.json"),
    `{"projectId":"${folderProject}","selection":${selection}}`,
  );
};

/** The provider refresh as the Launchpad asks for it, and the running service's answer. */
const providersRequest = '{"providers":["codex"],"enable":true}';
const providersAnswer = {
  version: 1 as const,
  providers: [
    {
      provider: "codex" as const,
      instanceId: ProviderInstanceId.make("codex"),
      enabled: true,
      status: "ready" as const,
      auth: "authenticated" as const,
    },
  ],
};
const providerRefreshRoute = ProviderRefreshRoute.layer.pipe(
  Layer.provide(
    Layer.succeed(ProviderRefresh.ProviderRefresh, {
      // Claude alone stands for a request the service refuses: its ID holds another driver.
      refresh: (request) =>
        request.providers.includes("claude")
          ? Effect.fail(
              new ProviderRefresh.ProviderRefreshDriverMismatchError({
                mismatches: [
                  {
                    provider: "claude",
                    instanceId: ProviderInstanceId.make("claudeAgent"),
                    driver: ProviderDriverKind.make("codex"),
                  },
                ],
              }),
            )
          : Effect.succeed(providersAnswer),
    }),
  ),
);

/**
 * The overlay's routes on 127.0.0.1 over `baseDir`'s auth and settings, as the running service
 * has them: the model route, or `routes` in its place.
 */
const withLiveService = <A, E, R>(
  baseDir: string,
  body: Effect.Effect<A, E, R>,
  routes:
    | typeof ModelRecommendationRoute.layer
    | typeof providerRefreshRoute = ModelRecommendationRoute.layer,
) =>
  Effect.gen(function* () {
    const configLayer = Layer.effect(
      ServerConfig.ServerConfig,
      Effect.map(ServerConfig.ServerConfig, (config) => ({
        ...config,
        host: "127.0.0.1",
        lazurioFolder: folder,
      })),
    ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)));
    const serviceLayer = HttpRouter.serve(routes, {
      disableListenLog: true,
      disableLogger: true,
    }).pipe(
      Layer.provideMerge(Settings.layer.pipe(Layer.provide(ServerSecretStore.layer))),
      Layer.provideMerge(EnvironmentAuth.layerRuntime),
      Layer.provideMerge(
        NodeHttpServer.layer(NodeHttp.createServer, { host: "127.0.0.1", port: 0 }),
      ),
      Layer.provideMerge(configLayer),
      Layer.provideMerge(NodeServices.layer),
    );
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const address = (yield* HttpServer.HttpServer).address;
        if (typeof address === "string" || !("port" in address)) {
          return yield* Effect.die(`Expected a TCP address, got ${String(address)}`);
        }
        yield* persistServerRuntimeState({
          path: config.serverRuntimeStatePath,
          state: yield* makePersistedServerRuntimeState({ config, port: address.port }),
        });
        return yield* body;
      }).pipe(Effect.provide(serviceLayer)),
    );
  });

describe("t3 lazurio", () => {
  it.effect("capabilities: contract version 1, without reading any state", () =>
    Effect.gen(function* () {
      yield* run(["lazurio", "capabilities"]);
      assert.deepStrictEqual(yield* printed, [
        '{"version":1,"managedFolder":true,"modelRecommendation":true,"providerRefresh":true,"operatorPairing":true,"agentCli":true,"threadSendIdempotency":true,"buddyThread":true}',
      ]);
    }).pipe(Effect.provide(TestConsole.layer)),
  );

  it.effect("model: reads the saved model without changing or creating anything", () =>
    Effect.gen(function* () {
      const empty = makeBaseDir();
      yield* run(["lazurio", "model", "--base-dir", empty]);
      assert.deepStrictEqual(NodeFS.readdirSync(empty), []);

      // The Lazurio project's model is its override; the record holds the overlay's last write.
      const saved = makeBaseDir();
      writeRecord(saved, selectionJson);
      const settingsPath = NodePath.join(saved, "userdata", "settings.json");
      const settingsText = `{"defaultModelSelection":null,"projectSettingsOverrides":{"project-history":{"defaultModelSelection":{"instanceId":"claudeAgent","model":"claude-model"}},"${folderProject}":{"defaultModelSelection":${selectionJson}}}}`;
      NodeFS.writeFileSync(settingsPath, settingsText);
      yield* run(["lazurio", "model", "--base-dir", saved]);
      assert.strictEqual(NodeFS.readFileSync(settingsPath, "utf8"), settingsText);

      assert.deepStrictEqual(yield* printed, [
        '{"version":1,"current":null,"lastManaged":null}',
        `{"version":1,"current":${selectionJson},"lastManaged":${selectionJson}}`,
      ]);
    }).pipe(Effect.provide(TestConsole.layer)),
  );

  it.effect("model: a Lazurio project without an override of its own reads as none", () =>
    Effect.gen(function* () {
      const saved = makeBaseDir();
      writeRecord(saved, "null");
      // The Environment's default is not the Lazurio project's model.
      NodeFS.writeFileSync(
        NodePath.join(saved, "userdata", "settings.json"),
        `{"defaultModelSelection":${selectionJson}}`,
      );
      yield* run(["lazurio", "model", "--base-dir", saved]);
      assert.deepStrictEqual(yield* printed, ['{"version":1,"current":null,"lastManaged":null}']);
    }).pipe(Effect.provide(TestConsole.layer)),
  );

  it.effect("model <selection>: only through the running service, never offline", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const error = yield* run(["lazurio", "model", "--base-dir", baseDir, request]).pipe(
        Effect.flip,
      );
      assert.strictEqual(
        error.message,
        "The T3 service must be running. No settings were changed.",
      );
      assert.isFalse(NodeFS.existsSync(NodePath.join(baseDir, "userdata", "settings.json")));
      assert.deepStrictEqual(yield* printed, []);
    }).pipe(Effect.provide(TestConsole.layer)),
  );

  it.effect("model <selection>: prints the running service's answer as it is", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      writeRecord(baseDir, "null");
      // The service runs in this process here, so only what the command printed counts.
      const output = yield* withLiveService(
        baseDir,
        Effect.gen(function* () {
          const before = (yield* printed).length;
          yield* run(["lazurio", "model", "--base-dir", baseDir, request]);
          return (yield* printed).slice(before);
        }),
      );
      assert.deepStrictEqual(output, [
        `{"version":1,"current":${selectionJson},"lastManaged":${selectionJson}}`,
      ]);
    }).pipe(Effect.provide(TestConsole.layer)),
  );

  it.effect("providers <request>: only through the running service, never offline", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const error = yield* run([
        "lazurio",
        "providers",
        "--base-dir",
        baseDir,
        providersRequest,
      ]).pipe(Effect.flip);
      assert.strictEqual(error.message, "The T3 service must be running. Nothing was changed.");
      assert.isFalse(NodeFS.existsSync(NodePath.join(baseDir, "userdata", "settings.json")));
      assert.deepStrictEqual(yield* printed, []);
    }).pipe(Effect.provide(TestConsole.layer)),
  );

  it.effect("providers <request>: prints the running service's answer as it is", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const output = yield* withLiveService(
        baseDir,
        Effect.gen(function* () {
          const before = (yield* printed).length;
          yield* run(["lazurio", "providers", "--base-dir", baseDir, providersRequest]);
          return (yield* printed).slice(before);
        }),
        providerRefreshRoute,
      );
      assert.deepStrictEqual(output, [
        '{"version":1,"providers":[{"provider":"codex","instanceId":"codex","enabled":true,"status":"ready","auth":"authenticated"}]}',
      ]);
    }).pipe(Effect.provide(TestConsole.layer)),
  );

  it.effect("providers <request>: a refusal says why, as the running service answered", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const error = yield* withLiveService(
        baseDir,
        run([
          "lazurio",
          "providers",
          "--base-dir",
          baseDir,
          '{"providers":["claude"],"enable":true}',
        ]).pipe(Effect.flip),
        providerRefreshRoute,
      );
      assert.strictEqual(
        error.message,
        'The live T3 service refused the provider refresh (409): {"error":"driver-mismatch","mismatches":[{"provider":"claude","instanceId":"claudeAgent","driver":"codex"}]}',
      );
    }).pipe(Effect.provide(TestConsole.layer)),
  );

  // The Environment pairs its own browser (the Admin's decision of 2026-10-17): the Launchpad
  // mints a token with the operator's scopes and reads it as it reads `t3 auth pairing create`'s.
  // Spelled out, because the Launchpad reads them byte for byte: a scope upstream adds to its
  // standard ones reaches the operator only through a decision here, and relay:write never does.
  const operatorScopes = [
    "orchestration:read",
    "orchestration:operate",
    "settings:write",
    "providers:manage",
    "environment:maintain",
    "preview:operate",
    "diagnostics:read",
    "terminal:read",
    "terminal:operate",
    "source-control:write",
    "filesystem:read",
    "filesystem:write",
    "relay:read",
    "access:read",
    "access:write",
  ] as const;
  /** The printed JSON without what is this token's own: its id, credential and expiry. */
  const withoutToken = (printedJson: string) => {
    const { id, credential, expiresAt } = JSON.parse(printedJson) as Record<string, string>;
    return printedJson
      .replace(String(id), "<id>")
      .replace(String(credential), "<credential>")
      .replace(String(expiresAt), "<expiresAt>");
  };

  it.effect("pairing: a one-time token with the operator's scopes, printed as upstream's", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const startedAt = yield* Clock.currentTimeMillis;
      yield* run([
        "lazurio",
        "pairing",
        "--base-dir",
        baseDir,
        "--ttl",
        "60s",
        "--label",
        "lazurio-chat",
      ]);
      // Upstream's command, asked for the same scopes, prints the same JSON for a token of its own.
      yield* run([
        "auth",
        "pairing",
        "create",
        "--base-dir",
        baseDir,
        "--ttl",
        "60s",
        "--label",
        "lazurio-chat",
        "--json",
        ...operatorScopes.flatMap((scope) => ["--scope", scope]),
      ]);
      const [lazurio = "", upstream = ""] = yield* printed;
      assert.strictEqual(withoutToken(lazurio), withoutToken(upstream));
      const issued = JSON.parse(lazurio) as Record<string, unknown>;
      assert.deepStrictEqual(Object.keys(issued), [
        "id",
        "credential",
        "label",
        "scopes",
        "expiresAt",
      ]);
      assert.deepStrictEqual(issued.scopes, operatorScopes);
      assert.notInclude(issued.scopes as ReadonlyArray<string>, AuthRelayWriteScope);
      assert.strictEqual(issued.label, "lazurio-chat");
      // The web client takes no other credential from the Launchpad's answer.
      assert.match(String(issued.credential), /^[A-Za-z0-9_-]{8,128}$/);
      assert.strictEqual(Date.parse(String(issued.expiresAt)) - startedAt, 60_000);
    }).pipe(Effect.provide(TestConsole.layer)),
  );

  it.effect("pairing: the token pairs one browser like any bootstrap credential", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      yield* run(["lazurio", "pairing", "--base-dir", baseDir]);
      const [printedJson = ""] = yield* printed;
      const { credential } = JSON.parse(printedJson) as { credential: string };
      const browser = { deviceType: "desktop" as const, browser: "Chrome" };
      const [paired, again] = yield* Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const first = yield* auth.createBrowserSession(credential, browser);
        return [first, yield* Effect.flip(auth.createBrowserSession(credential, browser))] as const;
      }).pipe(
        Effect.provide(
          EnvironmentAuth.layerRuntime.pipe(
            Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
            Layer.provide(NodeServices.layer),
          ),
        ),
      );
      assert.deepStrictEqual(paired.response.permissions, operatorScopes);
      // Not the legacy scopes of a browser paired on 0.0.45, so the page never asks again.
      assert.isFalse(sessionHasLegacyPermissions(paired.response));
      assert.strictEqual(again._tag, "ServerAuthInvalidCredentialError");
    }).pipe(Effect.provide(TestConsole.layer)),
  );
});
