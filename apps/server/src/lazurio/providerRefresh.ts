/**
 * Lazurio overlay (root decision 0201 point 4, plan DEV-6665, Lazurio/t3code#46): on a Lazurio
 * Environment Codex and Claude sign in through their own CLIs (`codex login`, `claude auth login`),
 * started from the Launchpad's Getting started page, so the sign-in is where T3, the terminal and
 * every agent read it. Afterwards the Launchpad runs `t3 lazurio providers` (cli.ts), which reaches
 * this service through `POST /api/lazurio/providers` (providerRefreshRoute.ts): T3 turns on the
 * providers the person chose and reads their sign-in again at once, not at the next background
 * check.
 *
 * Requests name the CLI the person signed in with: `codex` is T3's Codex driver, `claude` its
 * Claude driver.
 */
import {
  ProviderDriverKind,
  ProviderInstanceId,
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
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";

export const PROVIDER_REFRESH_ROUTE = "/api/lazurio/providers";
/** The session scopes the route needs: upstream's for refreshing providers and writing settings. */
export const PROVIDER_REFRESH_SCOPES = [
  ...new Set([
    requiredScopeForRpcMethod(WS_METHODS.serverRefreshProviders),
    requiredScopeForRpcMethod(WS_METHODS.serverUpdateSettings),
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

/** The default instance's settings key and driver of each CLI. */
const DRIVER_OF = { codex: "codex", claude: "claudeAgent" } as const satisfies Record<
  ProviderCli,
  keyof ServerSettings["providers"]
>;
const cliOf = (driver: ProviderDriverKind): ProviderCli | undefined =>
  driver === DRIVER_OF.codex ? "codex" : driver === DRIVER_OF.claude ? "claude" : undefined;

/**
 * The explicit instances at a named CLI's default instance ID that run another driver. An ID names
 * no driver: the settings schema accepts any driver at `codex`, and the registry then has no
 * default Codex at all, because hydration skips the legacy default when the ID exists.
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
  const key = DRIVER_OF[cli];
  const instanceId = ProviderInstanceId.make(key);
  const explicit = current.providerInstances[instanceId];
  // Another provider's instance at this ID is never this provider's to turn on.
  if (explicit !== undefined && explicit.driver !== key) return current;
  if (explicit === undefined)
    return current.providers[key].enabled
      ? current
      : {
          ...current,
          providers: { ...current.providers, [key]: { ...current.providers[key], enabled: true } },
        };
  if (resolveProviderInstanceEnabled(explicit)) return current;
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
     * Turn the named providers on when asked, then read the sign-in of every instance of theirs
     * that is on. An instance this request turns on is rebuilt from the new settings by the
     * registry, and a new instance checks its provider as it starts, so it is not read twice.
     * When a named provider's default instance ID holds another driver, nothing is turned on or
     * read again: the request fails closed.
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
  const settings = yield* ServerSettingsService;
  const instances = yield* ProviderInstanceRegistry;
  const registry = yield* ProviderRegistry;
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
