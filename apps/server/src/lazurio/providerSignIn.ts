/**
 * Lazurio overlay (root decision 0201 point 4, Lazurio/t3code#46): on a Lazurio Environment Codex
 * signs in only through its own CLI, so the auth service every transport uses refuses T3's ChatGPT
 * sign-in and profile import for Codex, a token only T3 would see. Everything else, and the whole
 * service without `T3CODE_LAZURIO_FOLDER`, stays upstream's.
 */
import { ProviderSetupError, type ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ProviderAuthService from "../provider/ProviderAuthService.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";

export const LAZURIO_CODEX_SIGN_IN =
  "On a Lazurio Environment, Codex signs in through Lazurio on the Environment's Getting started page, not in T3 Code.";

/** Upstream's auth service from `live`, which refuses T3's own Codex sign-in on a Lazurio Environment. */
export const guard = <E, R>(live: Layer.Layer<ProviderAuthService.ProviderAuthService, E, R>) =>
  Layer.effect(
    ProviderAuthService.ProviderAuthService,
    Effect.gen(function* () {
      const auth = yield* ProviderAuthService.ProviderAuthService;
      const config = yield* ServerConfig.ServerConfig;
      if (config.lazurioFolder === undefined) return auth;
      const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
      const refuseCodex = (instanceId: ProviderInstanceId, operation: string) =>
        Effect.flatMap(registry.getInstance(instanceId), (instance) =>
          instance?.driverKind === "codex"
            ? Effect.fail(
                new ProviderSetupError({ instanceId, operation, detail: LAZURIO_CODEX_SIGN_IN }),
              )
            : Effect.void,
        );
      return ProviderAuthService.ProviderAuthService.of({
        ...auth,
        start: Effect.fn("LazurioProviderSignIn.start")((input, ownerSessionId) =>
          Effect.andThen(refuseCodex(input.instanceId, "start"), () =>
            auth.start(input, ownerSessionId),
          ),
        ),
        importProfile: Effect.fn("LazurioProviderSignIn.importProfile")((input) =>
          Effect.andThen(refuseCodex(input.instanceId, "import"), () => auth.importProfile(input)),
        ),
      });
    }),
  ).pipe(Layer.provide(live));
