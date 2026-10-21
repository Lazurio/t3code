/**
 * Lazurio overlay: how the overlay's HTTP routes (threadTabsRoute.ts, modelRecommendationRoute.ts,
 * providerRefreshRoute.ts) authenticate, the way upstream's own raw routes do
 * (`authenticateRawRouteWithScope` in http.ts, which upstream keeps private): EnvironmentAuth checks
 * the session cookie or the bearer or DPoP token once, then the session must hold every scope the
 * route needs. A missing or bad credential answers 401, a missing scope 403.
 */
import type { AuthEnvironmentScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import {
  failEnvironmentAuthInvalid,
  failEnvironmentInternal,
  failEnvironmentScopeRequired,
} from "../auth/http.ts";

export const authenticateOverlayRoute = Effect.fn("LazurioOverlay.authenticateRoute")(function* (
  ...scopes: ReadonlyArray<AuthEnvironmentScope>
) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
  const session = yield* serverAuth.authenticateHttpRequest(request).pipe(
    Effect.catchIf(EnvironmentAuth.isServerAuthCredentialError, (error) =>
      failEnvironmentAuthInvalid(
        EnvironmentAuth.serverAuthCredentialReason(error),
        EnvironmentAuth.serverAuthDpopFailureReason(error),
      ),
    ),
    Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
      failEnvironmentInternal("internal_error", error),
    ),
  );
  for (const scope of scopes)
    if (!session.scopes.includes(scope)) return yield* failEnvironmentScopeRequired(scope);
});
