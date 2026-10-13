/**
 * Lazurio overlay: how the overlay's HTTP routes (threadTabsRoute.ts, modelRecommendationRoute.ts)
 * authenticate, the way upstream's own raw routes do (`authenticateRawRouteWithScope` in http.ts,
 * which upstream keeps private): EnvironmentAuth checks the session cookie or the bearer or DPoP
 * token, then the session must hold the route's scope. A missing or bad credential answers 401, a
 * missing scope 403.
 */
import type { AuthEnvironmentScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/unstable/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import {
  failEnvironmentAuthInvalid,
  failEnvironmentInternal,
  failEnvironmentScopeRequired,
} from "../auth/http.ts";

export const authenticateOverlayRoute = (scope: AuthEnvironmentScope) =>
  Effect.gen(function* () {
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
    if (!session.scopes.includes(scope)) return yield* failEnvironmentScopeRequired(scope);
  });
