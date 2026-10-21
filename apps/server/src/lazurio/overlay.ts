/**
 * Lazurio overlay (root decision 0191, plan DEV-6646; LazurioPlatform F51): the server overlay's
 * one layer, which one line of `server.ts` joins into upstream's routes, inside `layerMakeRoutes`,
 * where it shares the routes' one preview broker. The Environment browser host drives the
 * Environment browser for T3's browser tools (environmentBrowser.ts); each thread keeps its tabs
 * of that browser in its holder file (threadTabs.ts), which the web reaches through
 * threadTabsRoute.ts, and archiving or deleting a thread lets go of them (threadLifecycle.ts). The
 * model recommendation route takes the Platform's recommended model for the managed Folder's
 * project (modelRecommendationRoute.ts).
 */

import * as Layer from "effect/Layer";

import * as EnvironmentBrowser from "./environmentBrowser.ts";
import * as ModelRecommendationRoute from "./modelRecommendationRoute.ts";
import * as ThreadLifecycle from "./threadLifecycle.ts";
import * as ThreadTabs from "./threadTabs.ts";
import * as ThreadTabsRoute from "./threadTabsRoute.ts";

export const layer = Layer.mergeAll(
  EnvironmentBrowser.layer,
  ThreadTabsRoute.layer,
  ModelRecommendationRoute.layer,
).pipe(Layer.provide(ThreadTabs.layer.pipe(Layer.provide(ThreadLifecycle.layer))));
