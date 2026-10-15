/**
 * Lazurio overlay (root decision 0201 point 4, Lazurio/t3code#46): on a Lazurio Environment
 * (`T3CODE_LAZURIO_FOLDER`) Codex signs in only through its own CLI, started from the Launchpad's
 * Getting started page, so the sign-in is where T3, the terminal, Codex Desktop over SSH and every
 * agent read it. T3's own ChatGPT sign-in for Codex would keep a token that only T3 sees, so the
 * auth service refuses to start it or to import a ChatGPT profile into a Codex instance. The web
 * hides the way there; this holds for every client, official desktop and mobile apps included.
 * Signing out, cancelling and every other provider stay upstream's, and without the variable the
 * service is upstream's as it is.
 */
import { ProviderSetupError, type ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import { ProviderAuthService } from "../provider/Services/ProviderAuthService.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";

export const LAZURIO_CODEX_SIGN_IN =
  "On a Lazurio Environment, Codex signs in through Lazurio on the Environment's Getting started page, not in T3 Code.";

/** Upstream's auth service from `live`, which refuses T3's own Codex sign-in on a Lazurio Environment. */
export const guard = <E, R>(live: Layer.Layer<ProviderAuthService, E, R>) =>
  Layer.effect(
    ProviderAuthService,
    Effect.gen(function* () {
      const auth = yield* ProviderAuthService;
      const config = yield* ServerConfig.ServerConfig;
      if (config.lazurioFolder === undefined) return auth;
      const registry = yield* ProviderInstanceRegistry;
      const refuseCodex = (instanceId: ProviderInstanceId, operation: string) =>
        Effect.flatMap(registry.getInstance(instanceId), (instance) =>
          instance?.driverKind === "codex"
            ? Effect.fail(
                new ProviderSetupError({ instanceId, operation, detail: LAZURIO_CODEX_SIGN_IN }),
              )
            : Effect.void,
        );
      return ProviderAuthService.of({
        ...auth,
        start: (input, ownerSessionId) =>
          Effect.andThen(refuseCodex(input.instanceId, "start"), () =>
            auth.start(input, ownerSessionId),
          ),
        importProfile: (input) =>
          Effect.andThen(refuseCodex(input.instanceId, "import"), () => auth.importProfile(input)),
      });
    }),
  ).pipe(Layer.provide(live));
