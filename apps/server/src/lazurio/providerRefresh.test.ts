import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthOrchestrationReadScope,
  AuthProvidersManageScope,
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  resolveProviderInstanceEnabled,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as Settings from "../serverSettings.ts";
import * as ProviderRefresh from "./providerRefresh.ts";

const codex = ProviderInstanceId.make("codex");
const claude = ProviderInstanceId.make("claudeAgent");
// Codex and Claude run at their default slots without an entry; an entry turns one off.
const turnedOff: ServerSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  providerInstances: {
    [codex]: { driver: ProviderDriverKind.make("codex"), enabled: false },
    [claude]: { driver: ProviderDriverKind.make("claudeAgent"), enabled: false },
  },
};
const isOn = (settings: ServerSettings, instanceId: ProviderInstanceId) => {
  const instance = settings.providerInstances[instanceId];
  return instance === undefined || resolveProviderInstanceEnabled(instance);
};

it("needs what the WebSocket needs to refresh providers and change provider instances", () => {
  assert.deepStrictEqual(ProviderRefresh.PROVIDER_REFRESH_SCOPES, [
    AuthOrchestrationReadScope,
    AuthProvidersManageScope,
  ]);
});

it("turns on the default Codex or Claude the person chose, and nothing else", () => {
  const codexOn = ProviderRefresh.enableProviders(turnedOff, ["codex"]);
  assert.isTrue(isOn(codexOn, codex));
  assert.isFalse(isOn(codexOn, claude));
  // The rest of the instance stays as it was.
  assert.deepStrictEqual(codexOn.providerInstances[codex], {
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
  });

  const both = ProviderRefresh.enableProviders(turnedOff, ["codex", "claude"]);
  assert.isTrue(isOn(both, codex));
  assert.isTrue(isOn(both, claude));
});

it("turns on an explicit default instance through both of its flags", () => {
  // An explicit false on the envelope or in the config keeps an instance off (most restrictive).
  const explicitOff: ServerSettings = {
    ...DEFAULT_SERVER_SETTINGS,
    providerInstances: {
      [claude]: {
        driver: ProviderDriverKind.make("claudeAgent"),
        displayName: "Work Claude",
        enabled: false,
        config: { enabled: false, binaryPath: "/opt/claude" },
      },
    },
  };
  const next = ProviderRefresh.enableProviders(explicitOff, ["claude"]);
  const instance = next.providerInstances[claude];
  assert.ok(instance);
  assert.isTrue(resolveProviderInstanceEnabled(instance));
  assert.deepStrictEqual(instance, {
    driver: ProviderDriverKind.make("claudeAgent"),
    displayName: "Work Claude",
    enabled: true,
    config: { enabled: true, binaryPath: "/opt/claude" },
  });
});

it("leaves settings that already have the provider on exactly as they are", () => {
  // Unconfigured default slots are on.
  assert.strictEqual(
    ProviderRefresh.enableProviders(DEFAULT_SERVER_SETTINGS, ["codex", "claude"]),
    DEFAULT_SERVER_SETTINGS,
  );
  const explicitOn: ServerSettings = {
    ...DEFAULT_SERVER_SETTINGS,
    providerInstances: { [codex]: { driver: ProviderDriverKind.make("codex") } },
  };
  assert.strictEqual(ProviderRefresh.enableProviders(explicitOn, ["codex"]), explicitOn);
});

// An instance ID names no driver: the schema accepts any driver at `codex`, and the registry then
// has no default Codex at all (hydration skips the default slot when the ID exists).
const claudeAtCodexId: ServerSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  providerInstances: {
    [codex]: { driver: ProviderDriverKind.make("claudeAgent"), enabled: false },
    [claude]: { driver: ProviderDriverKind.make("claudeAgent"), enabled: false },
  },
};

it("never turns on another provider's instance that sits at a default instance's ID", () => {
  assert.deepStrictEqual(ProviderRefresh.defaultInstanceMismatches(claudeAtCodexId, ["codex"]), [
    { provider: "codex", instanceId: codex, driver: ProviderDriverKind.make("claudeAgent") },
  ]);
  // The named CLI's own default instance is not mismatched, and neither is an empty default slot.
  assert.deepStrictEqual(
    ProviderRefresh.defaultInstanceMismatches(claudeAtCodexId, ["claude"]),
    [],
  );
  assert.deepStrictEqual(
    ProviderRefresh.defaultInstanceMismatches(DEFAULT_SERVER_SETTINGS, ["codex"]),
    [],
  );
  // Even called directly, enabling leaves the Claude instance at `codex` as it was.
  const next = ProviderRefresh.enableProviders(claudeAtCodexId, ["codex", "claude"]);
  assert.deepStrictEqual(next.providerInstances[codex], claudeAtCodexId.providerInstances[codex]);
  assert.isTrue(isOn(next, claude));
});

it("answers with the requested CLIs' instances under the CLI's name", () => {
  const snapshot = (
    instanceId: string,
    driver: string,
    fields: Pick<ServerProvider, "enabled" | "status" | "auth">,
  ) =>
    ({
      instanceId: ProviderInstanceId.make(instanceId),
      driver: ProviderDriverKind.make(driver),
      ...fields,
    }) as ServerProvider;
  const providers = [
    snapshot("codex", "codex", {
      enabled: true,
      status: "ready",
      auth: { status: "authenticated" },
    }),
    snapshot("codex_work", "codex", {
      enabled: true,
      status: "warning",
      auth: { status: "unauthenticated" },
    }),
    snapshot("claudeAgent", "claudeAgent", {
      enabled: false,
      status: "disabled",
      auth: { status: "unknown" },
    }),
    snapshot("cursor", "cursor", {
      enabled: true,
      status: "ready",
      auth: { status: "authenticated" },
    }),
  ];
  assert.deepStrictEqual(ProviderRefresh.providerRefreshAnswer(providers, ["claude"]), {
    version: 1,
    providers: [
      {
        provider: "claude",
        instanceId: "claudeAgent",
        enabled: false,
        status: "disabled",
        auth: "unknown",
      },
    ],
  });
  assert.deepStrictEqual(
    ProviderRefresh.providerRefreshAnswer(providers, ["codex", "claude"]).providers.map(
      (provider) => provider.instanceId,
    ),
    ["codex", "codex_work", "claudeAgent"],
  );
});

/** What the registries saw: which instances' caches were dropped and which were read again. */
const makeRegistries = (live: ReadonlyArray<{ driver: string; enabled: boolean }>) => {
  const seen = { invalidated: [] as string[], refreshed: [] as string[] };
  const instances = live.map(
    ({ driver, enabled }) =>
      ({
        instanceId: ProviderInstanceId.make(driver),
        driverKind: ProviderDriverKind.make(driver),
        enabled,
        invalidateCaches: Effect.sync(() => {
          seen.invalidated.push(driver);
        }),
      }) as unknown as ProviderInstance,
  );
  const snapshots = live.map(
    ({ driver, enabled }) =>
      ({
        instanceId: ProviderInstanceId.make(driver),
        driver: ProviderDriverKind.make(driver),
        enabled,
        status: enabled ? "ready" : "disabled",
        auth: { status: enabled ? "authenticated" : "unknown" },
      }) as ServerProvider,
  );
  const layer = Layer.mergeAll(
    Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
      getInstance: (instanceId) =>
        Effect.succeed(instances.find((instance) => instance.instanceId === instanceId)),
      listInstances: Effect.succeed(instances),
    }),
    Layer.mock(ProviderRegistry.ProviderRegistry)({
      getProviders: Effect.succeed(snapshots),
      refreshInstance: (instanceId) =>
        Effect.sync(() => {
          seen.refreshed.push(instanceId);
          return snapshots;
        }),
    }),
  );
  return { seen, layer };
};

const layerSettings = Settings.layer.pipe(
  Layer.provide(ServerSecretStore.layer),
  Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  Layer.provideMerge(
    Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3-provider-refresh-" })),
  ),
  Layer.provideMerge(NodeServices.layer),
);

it.effect("reads again only the named providers' instances that are on, past their caches", () => {
  const { seen, layer } = makeRegistries([
    { driver: "codex", enabled: true },
    { driver: "claudeAgent", enabled: true },
    { driver: "cursor", enabled: true },
  ]);
  return Effect.gen(function* () {
    const service = yield* ProviderRefresh.ProviderRefresh;
    const answer = yield* service.refresh({ providers: ["claude"] });
    assert.deepStrictEqual(seen, { invalidated: ["claudeAgent"], refreshed: ["claudeAgent"] });
    assert.deepStrictEqual(answer, {
      version: 1,
      providers: [
        {
          provider: "claude",
          instanceId: "claudeAgent",
          enabled: true,
          status: "ready",
          auth: "authenticated",
        },
      ],
    });
    // Without `enable` the settings stay as they were.
    const settings = yield* Settings.ServerSettingsService;
    assert.deepStrictEqual((yield* settings.getSettings).providerInstances, {});
  }).pipe(
    Effect.provide(
      ProviderRefresh.layer.pipe(Layer.provideMerge(layer), Layer.provideMerge(layerSettings)),
    ),
  );
});

it.effect(
  "turns a provider on through the settings writer and leaves its rebuild to read it",
  () => {
    const { seen, layer } = makeRegistries([
      { driver: "codex", enabled: true },
      { driver: "claudeAgent", enabled: false },
    ]);
    return Effect.gen(function* () {
      const settings = yield* Settings.ServerSettingsService;
      yield* settings.updateSettings({
        providerInstances: { [claude]: turnedOff.providerInstances[claude]! },
      });
      const service = yield* ProviderRefresh.ProviderRefresh;
      yield* service.refresh({ providers: ["codex", "claude"], enable: true });
      const saved = yield* settings.getSettings;
      assert.isTrue(isOn(saved, claude));
      assert.isTrue(isOn(saved, codex));
      // The Claude instance the registry still holds is the one before this request turned it on.
      assert.deepStrictEqual(seen, { invalidated: ["codex"], refreshed: ["codex"] });
    }).pipe(
      Effect.provide(
        ProviderRefresh.layer.pipe(Layer.provideMerge(layer), Layer.provideMerge(layerSettings)),
      ),
    );
  },
);

it.effect("refuses, changing nothing, when a default instance's ID holds another driver", () => {
  const { seen, layer } = makeRegistries([
    { driver: "claudeAgent", enabled: true },
    { driver: "codex", enabled: true },
  ]);
  return Effect.gen(function* () {
    const settings = yield* Settings.ServerSettingsService;
    yield* settings.updateSettings({ providerInstances: claudeAtCodexId.providerInstances });
    const before = yield* settings.getSettings;
    const service = yield* ProviderRefresh.ProviderRefresh;
    const error = yield* service
      .refresh({ providers: ["claude", "codex"], enable: true })
      .pipe(Effect.flip);
    assert.strictEqual(error._tag, "ProviderRefreshDriverMismatchError");
    assert.deepStrictEqual(
      error._tag === "ProviderRefreshDriverMismatchError" ? error.mismatches : [],
      [{ provider: "codex", instanceId: codex, driver: ProviderDriverKind.make("claudeAgent") }],
    );
    // Fail closed: Claude, which was named too, stays off, and nothing was read again.
    const after = yield* settings.getSettings;
    assert.deepStrictEqual(after.providerInstances, before.providerInstances);
    assert.isFalse(isOn(after, claude));
    assert.deepStrictEqual(seen, { invalidated: [], refreshed: [] });
  }).pipe(
    Effect.provide(
      ProviderRefresh.layer.pipe(Layer.provideMerge(layer), Layer.provideMerge(layerSettings)),
    ),
  );
});

it.effect("refuses to turn providers on where the settings service cannot", () => {
  const { seen, layer } = makeRegistries([{ driver: "codex", enabled: true }]);
  return Effect.gen(function* () {
    const service = yield* ProviderRefresh.ProviderRefresh;
    const error = yield* service.refresh({ providers: ["codex"], enable: true }).pipe(Effect.flip);
    assert.strictEqual(error._tag, "ProviderRefreshUnavailableError");
    assert.deepStrictEqual(seen, { invalidated: [], refreshed: [] });
    // Reading again needs no settings writer.
    yield* service.refresh({ providers: ["codex"] });
    assert.deepStrictEqual(seen.refreshed, ["codex"]);
  }).pipe(
    Effect.provide(
      ProviderRefresh.layer.pipe(
        Layer.provideMerge(layer),
        Layer.provideMerge(Settings.layerTest()),
      ),
    ),
  );
});
