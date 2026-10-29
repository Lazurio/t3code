/**
 * Lazurio overlay: the overlay's HTTP routes authenticate as upstream's raw routes do
 * (`authenticateRawRouteWithScope`, private in http.ts): 401 for a missing or bad credential,
 * 403 for a missing scope.
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
