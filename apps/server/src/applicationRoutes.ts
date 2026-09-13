import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/unstable/http";
import { normalizeApplicationPath } from "@t3tools/shared/applicationPath";
import { ServerConfig } from "./config.ts";

// Mount every route together, including upgrades and static fallback. The
// framework preserves originalUrl for authentication proofs while handlers
// receive the route-relative URL they already understand.
export const applicationPathRouterLayer = Layer.effect(
  HttpRouter.HttpRouter,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const router = yield* HttpRouter.HttpRouter;
    const prefix = normalizeApplicationPath(config.basePath ?? "");
    return prefix ? router.prefixed(prefix) : router;
  }),
);
