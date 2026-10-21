/**
 * Lazurio overlay (root decision 0201 point 4, plan DEV-6665): `POST /api/lazurio/providers`, which
 * `t3 lazurio providers <request-json>` (cli.ts) calls on the running service after Codex or Claude
 * signed in through its CLI. ProviderRefresh (providerRefresh.ts) does the work. The session needs
 * upstream's scopes for refreshing providers and for changing provider instances
 * (`orchestration:read` and `providers:manage`), so only a client paired with them, or the CLI on
 * this Environment, which issues its own session from the Environment's secret store, can call it.
 *
 * Answers `{"version": 1, "providers": [...]}`; 400 for another body; 409
 * `{"error": "driver-mismatch", "mismatches": [{"provider", "instanceId", "driver"}]}` when a named
 * provider's default instance ID holds another driver, with nothing changed; 503 when the settings
 * service cannot turn providers on (only its test layer).
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { failEnvironmentInternal } from "../auth/http.ts";
import * as ProviderRefresh from "./providerRefresh.ts";
import { authenticateOverlayRoute } from "./routeAuth.ts";

export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const providers = yield* ProviderRefresh.ProviderRefresh;
    yield* router.add(
      "POST",
      ProviderRefresh.PROVIDER_REFRESH_ROUTE,
      Effect.gen(function* () {
        yield* authenticateOverlayRoute(...ProviderRefresh.PROVIDER_REFRESH_SCOPES);
        const request = yield* HttpServerRequest.schemaBodyJson(
          ProviderRefresh.ProviderRefreshRequest,
        ).pipe(Effect.option);
        if (Option.isNone(request))
          return HttpServerResponse.jsonUnsafe({ error: "invalid-request" }, { status: 400 });
        return yield* providers.refresh(request.value).pipe(
          Effect.map((answer) => HttpServerResponse.jsonUnsafe(answer)),
          Effect.catchTags({
            ProviderRefreshDriverMismatchError: ({ mismatches }) =>
              Effect.succeed(
                HttpServerResponse.jsonUnsafe(
                  { error: "driver-mismatch", mismatches },
                  { status: 409 },
                ),
              ),
            ProviderRefreshUnavailableError: () =>
              Effect.succeed(
                HttpServerResponse.jsonUnsafe({ error: "unavailable" }, { status: 503 }),
              ),
            ServerSettingsError: (cause) => failEnvironmentInternal("internal_error", cause),
          }),
        );
      }),
    );
  }),
);
