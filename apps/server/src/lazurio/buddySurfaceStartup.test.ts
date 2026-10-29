import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import { startBuddySurface } from "./buddySurfaceStartup.ts";

/** The real settings writer over a fresh state directory. */
const layerStartup = () =>
  ServerSettings.layer.pipe(
    Layer.provide(ServerSecretStore.layer),
    Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
    Layer.provideMerge(
      Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3-lazurio-buddy-startup-" })),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

describe("Buddy's T3 Code at startup", () => {
  it.effect("applies Buddy's defaults once, so what the person changes later stays", () =>
    Effect.gen(function* () {
      const settings = yield* ServerSettings.ServerSettingsService;
      yield* startBuddySurface;
      const applied = yield* settings.getSettings;
      assert.strictEqual(applied.continueThreadsAfterServerUpdate, false);
      assert.strictEqual(applied.enableAgentBrowserAccess, false);
      assert.strictEqual(
        applied.providerInstances[ProviderInstanceId.make("codex")]?.enabled,
        false,
      );
      assert.strictEqual(
        applied.providerInstances[ProviderInstanceId.make("claudeAgent")]?.enabled,
        false,
      );

      yield* settings.updateSettingsWith!((current) => ({
        ...current,
        enableAgentBrowserAccess: true,
      }));
      yield* startBuddySurface;
      assert.strictEqual((yield* settings.getSettings).enableAgentBrowserAccess, true);
      assert.strictEqual((yield* settings.getSettings).continueThreadsAfterServerUpdate, false);
    }).pipe(
      Effect.provide(layerStartup()),
      Effect.provideService(HostProcess.Environment, { T3CODE_LAZURIO_BUDDY: "1" }),
    ),
  );

  it.effect("starts when it cannot record the defaults, and records them at a later start", () =>
    Effect.gen(function* () {
      const { stateDir } = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const blocked = path.join(stateDir, "lazurio");
      yield* fileSystem.makeDirectory(stateDir, { recursive: true });
      yield* fileSystem.writeFileString(blocked, "");
      yield* startBuddySurface;
      yield* fileSystem.remove(blocked);
      yield* startBuddySurface;
      const settings = yield* ServerSettings.ServerSettingsService;
      assert.strictEqual((yield* settings.getSettings).continueThreadsAfterServerUpdate, false);
      assert.isTrue(yield* fileSystem.exists(path.join(blocked, "buddy-surface.json")));
    }).pipe(
      Effect.provide(layerStartup()),
      Effect.provideService(HostProcess.Environment, { T3CODE_LAZURIO_BUDDY: "1" }),
    ),
  );

  it.effect("changes nothing outside Buddy's T3 Code", () =>
    Effect.gen(function* () {
      const settings = yield* ServerSettings.ServerSettingsService;
      yield* startBuddySurface;
      const current = yield* settings.getSettings;
      assert.strictEqual(current.continueThreadsAfterServerUpdate, true);
      assert.strictEqual(current.enableAgentBrowserAccess, true);
    }).pipe(
      Effect.provide(layerStartup()),
      Effect.provideService(HostProcess.Environment, { T3CODE_LAZURIO_BUDDY: "true" }),
    ),
  );
});
