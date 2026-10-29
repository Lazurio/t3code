// @effect-diagnostics nodeBuiltinImport:off - CLI integration exercises Node HTTP and filesystem boundaries.
import * as NodeHttp from "node:http";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
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

// `t3 lazurio` is a contract: Machines checks `capabilities` and the Platform's
// `lazurio chat defaults --apply` reads `model`'s answer. These pin their output byte for byte.

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

/** An abandoned upload in `baseDir`'s T3 home, which config resolution logs that it removes. */
const withAbandonedUpload = (baseDir: string) =>
  Effect.gen(function* () {
    const attachmentsDir = NodePath.join(baseDir, "userdata", "attachments");
    NodeFS.mkdirSync(attachmentsDir, { recursive: true });
    const abandoned = NodePath.join(attachmentsDir, "abandoned.part");
    NodeFS.writeFileSync(abandoned, "");
    const jan2020Seconds = 1_577_836_800;
    NodeFS.utimesSync(abandoned, jan2020Seconds, jan2020Seconds);
    yield* TestClock.setTime((jan2020Seconds + 7 * 24 * 60 * 60) * 1000);
    return abandoned;
  });

/** The overlay's route on 127.0.0.1 over `baseDir`'s auth and settings, as the running service has it. */
const withLiveService = <A, E, R>(baseDir: string, body: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const configLayer = Layer.effect(
      ServerConfig.ServerConfig,
      Effect.map(ServerConfig.ServerConfig, (config) => ({
        ...config,
        host: "127.0.0.1",
        lazurioFolder: folder,
      })),
    ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)));
    const serviceLayer = HttpRouter.serve(ModelRecommendationRoute.layer, {
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
        '{"version":1,"managedFolder":true,"modelRecommendation":true}',
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

  it.effect("model <request>: prints nothing after the T3 home removes an upload", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const abandoned = yield* withAbandonedUpload(baseDir);
      yield* run(["lazurio", "model", "--base-dir", baseDir, request]).pipe(Effect.flip);
      assert.isFalse(NodeFS.existsSync(abandoned));
      assert.deepStrictEqual(yield* TestConsole.logLines, []);
    }).pipe(Effect.provide(TestConsole.layer)),
  );
});
