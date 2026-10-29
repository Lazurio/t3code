/**
 * Lazurio overlay (root decision 0201 point 4, Lazurio/t3code#46): on a Lazurio Environment Codex
 * signs in only through its CLI, so the auth service refuses T3's ChatGPT sign-in, profile import
 * and export for Codex, and runs no ChatGPT handoff. The rest, and all of it without
 * `T3CODE_LAZURIO_FOLDER`, stays upstream's.
 */
import {
  ProviderSetupError,
  type ChatGptHandoffInput,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ProviderAuthService from "../provider/ProviderAuthService.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";

export const LAZURIO_CODEX_SIGN_IN =
  "On a Lazurio Environment, Codex signs in through Lazurio on the Environment's Getting started page, not in T3 Code.";

export const LAZURIO_CHATGPT_HANDOFF =
  "A Lazurio Environment does not sign in to ChatGPT for another Environment.";

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
        reconnectProfile: Effect.fn("LazurioProviderSignIn.reconnectProfile")((input) =>
          Effect.andThen(refuseCodex(input.instanceId, "export"), () =>
            auth.reconnectProfile(input),
          ),
        ),
      });
    }),
  ).pipe(Layer.provide(live));

/**
 * Upstream's ChatGPT handoff (Lazurio/t3code#145): a client asks the server on its own device to
 * sign in to ChatGPT in memory and hands the account to another Environment's instance. A Lazurio
 * Environment runs none, whatever the instance: it cannot tell a peer's Codex from another
 * provider, and the token would pass through its T3 Code all the same.
 */
export const handoff = <A, E, R>(
  config: { readonly lazurioFolder?: string | undefined },
  input: ChatGptHandoffInput,
  upstream: () => Stream.Stream<A, E, R>,
): Stream.Stream<A, E | ProviderSetupError, R> =>
  config.lazurioFolder === undefined
    ? Stream.suspend(upstream)
    : Stream.fail(
        new ProviderSetupError({
          instanceId: input.instanceId,
          operation: "handoff",
          detail: LAZURIO_CHATGPT_HANDOFF,
        }),
      );
