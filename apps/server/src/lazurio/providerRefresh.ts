/**
 * Lazurio overlay (root decision 0201 point 4, Lazurio/t3code#46): after Codex or Claude signed in
 * through its CLI, `t3 lazurio providers` reaches it through `POST /api/lazurio/providers`
 * to turn the chosen providers on and read their sign-in at once. A project that turned a provider
 * off for itself keeps that choice.
 */
import {
  ProviderDriverKind,
  ProviderInstanceId,
  requiredScopesForServerSettingsPatch,
  resolveProviderInstanceEnabled,
  type ServerProvider,
  type ServerSettings,
  type ServerSettingsError,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as Settings from "../serverSettings.ts";

export const PROVIDER_REFRESH_ROUTE = "/api/lazurio/providers";
/**
 * The session scopes the route needs: upstream's for refreshing providers and for changing provider
 * instances through the settings, so it does only what such a client could over the WebSocket.
 */
export const PROVIDER_REFRESH_SCOPES = [
  ...new Set([
    requiredScopeForRpcMethod(WS_METHODS.serverRefreshProviders),
    ...requiredScopesForServerSettingsPatch({ providerInstances: {} }),
  ]),
];

const ProviderCli = Schema.Literals(["codex", "claude"]);
type ProviderCli = typeof ProviderCli.Type;

export const ProviderRefreshRequest = Schema.Struct({
  providers: Schema.NonEmptyArray(ProviderCli),
  /** Turn the named providers on first. Without it the request only reads them again. */
  enable: Schema.optionalKey(Schema.Boolean),
});
type ProviderRefreshRequest = typeof ProviderRefreshRequest.Type;

/** The driver of each CLI, which is also the ID of its default instance. */
const DRIVER_OF = { codex: "codex", claude: "claudeAgent" } as const satisfies Record<
  ProviderCli,
  string
>;
const cliOf = (driver: ProviderDriverKind): ProviderCli | undefined =>
  driver === DRIVER_OF.codex ? "codex" : driver === DRIVER_OF.claude ? "claude" : undefined;

/**
 * The explicit instances at a named CLI's default instance ID that run another driver. An ID names
 * no driver: the settings schema accepts any driver at `codex`, and the registry then has no
 * default Codex at all, because hydration skips the default slot when the ID exists.
 */
export const defaultInstanceMismatches = (
  current: ServerSettings,
  clis: ReadonlyArray<ProviderCli>,
) =>
  [...new Set(clis)].flatMap((cli) => {
    // The default instance's ID is its driver's kind (`defaultInstanceIdForDriver`).
    const instanceId = ProviderInstanceId.make(DRIVER_OF[cli]);
    const driver = current.providerInstances[instanceId]?.driver;
    return driver === undefined || driver === DRIVER_OF[cli]
      ? []
      : [{ provider: cli, instanceId, driver }];
  });

/** The settings with the default instance of `cli` turned on, or as they are when it is on. */
const enableProvider = (current: ServerSettings, cli: ProviderCli): ServerSettings => {
  const driver = DRIVER_OF[cli];
  const instanceId = ProviderInstanceId.make(driver);
  const explicit = current.providerInstances[instanceId];
  // A default slot without an entry runs on already. Another provider's instance at this
  // ID is never this provider's to turn on.
  if (
    explicit === undefined ||
    explicit.driver !== driver ||
    resolveProviderInstanceEnabled(explicit)
  )
    return current;
  const config = explicit.config;
  return {
    ...current,
    providerInstances: {
      ...current.providerInstances,
      [instanceId]: {
        ...explicit,
        enabled: true,
        ...(config !== null && typeof config === "object" && !Array.isArray(config)
          ? { config: { ...config, enabled: true } }
          : {}),
      },
    },
  };
};

/**
 * The settings with the default Codex or Claude instance of each named CLI turned on, and
 * nothing else changed. An explicit default instance turns on through both of its flags, since an
 * explicit `false` on either keeps it off; one that runs another driver stays as it is
 * (`defaultInstanceMismatches`). Settings that already have them on come back as they are.
 */
export const enableProviders = (
  current: ServerSettings,
  clis: ReadonlyArray<ProviderCli>,
): ServerSettings => [...new Set(clis)].reduce(enableProvider, current);

/** What the route answers and `t3 lazurio providers` prints: the named CLIs' instances, by CLI. */
export function providerRefreshAnswer(
  providers: ReadonlyArray<ServerProvider>,
  clis: ReadonlyArray<ProviderCli>,
) {
  return {
    version: 1 as const,
    providers: providers.flatMap((provider) => {
      const cli = cliOf(provider.driver);
      return cli !== undefined && clis.includes(cli)
        ? [
            {
              provider: cli,
              instanceId: provider.instanceId,
              enabled: provider.enabled,
              status: provider.status,
              auth: provider.auth.status,
            },
          ]
        : [];
    }),
  };
}

/** The settings service cannot turn providers on (only the server's own layer can). */
export class ProviderRefreshUnavailableError extends Schema.TaggedError<ProviderRefreshUnavailableError>()(
  "ProviderRefreshUnavailableError",
  {},
) {
  override get message(): string {
    return "This T3 service cannot turn providers on.";
  }
}

/**
 * A named CLI's default instance ID holds another provider's instance, so there is no default
 * instance of that CLI to turn on. Nothing was changed; the person decides what that instance is.
 */
export class ProviderRefreshDriverMismatchError extends Schema.TaggedError<ProviderRefreshDriverMismatchError>()(
  "ProviderRefreshDriverMismatchError",
  {
    mismatches: Schema.Array(
      Schema.Struct({
        provider: ProviderCli,
        instanceId: ProviderInstanceId,
        driver: ProviderDriverKind,
      }),
    ),
  },
) {
  override get message(): string {
    return "A default provider instance ID holds another provider's instance, so nothing was turned on.";
  }
}

export class ProviderRefresh extends Context.Service<
  ProviderRefresh,
  {
    /**
     * Turn the named providers on when asked, then read the sign-in of every instance of theirs that
     * is on; an instance this request turns on is checked as it starts, not read twice. A default
     * instance ID that holds another driver fails the request closed, with nothing changed.
     */
    readonly refresh: (
      request: ProviderRefreshRequest,
    ) => Effect.Effect<
      ReturnType<typeof providerRefreshAnswer>,
      ProviderRefreshUnavailableError | ProviderRefreshDriverMismatchError | ServerSettingsError
    >;
  }
>()("t3/lazurio/providerRefresh") {}

const make = Effect.gen(function* () {
  const settings = yield* Settings.ServerSettingsService;
  const instances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const registry = yield* ProviderRegistry.ProviderRegistry;
  return ProviderRefresh.of({
    refresh: Effect.fn("ProviderRefresh.refresh")(function* (request) {
      if (request.enable === true) {
        if (settings.updateSettingsWith === undefined)
          return yield* new ProviderRefreshUnavailableError();
        // Checked in the same write that turns them on, against the settings it writes.
        let mismatches: ReturnType<typeof defaultInstanceMismatches> = [];
        yield* settings.updateSettingsWith((current) => {
          mismatches = defaultInstanceMismatches(current, request.providers);
          return mismatches.length > 0 ? current : enableProviders(current, request.providers);
        });
        if (mismatches.length > 0)
          return yield* new ProviderRefreshDriverMismatchError({ mismatches });
      }
      const drivers = new Set(
        request.providers.map((cli) => ProviderDriverKind.make(DRIVER_OF[cli])),
      );
      // Claude caches what its probe read, so the sign-in is read again only past its caches.
      yield* Effect.forEach(
        (yield* instances.listInstances).filter(
          (instance) => instance.enabled && drivers.has(instance.driverKind),
        ),
        (instance) =>
          (instance.invalidateCaches ?? Effect.void).pipe(
            Effect.andThen(registry.refreshInstance(instance.instanceId)),
          ),
        { concurrency: "unbounded", discard: true },
      );
      return providerRefreshAnswer(yield* registry.getProviders, request.providers);
    }),
  });
});

export const layer = Layer.effect(ProviderRefresh, make);
