/**
 * Lazurio overlay (root decision 0191): the server overlay's one layer, joined into upstream's
 * `layerMakeRoutes` by one line of `server.ts`, so it shares the routes' one preview broker.
 */

import * as Layer from "effect/Layer";

import * as AgentCliSendState from "./agentCliSendState.ts";
import * as BuddySurfaceThreadRoute from "./buddySurfaceThreadRoute.ts";
import * as EnvironmentBrowser from "./environmentBrowser.ts";
import * as ModelRecommendationRoute from "./modelRecommendationRoute.ts";
import * as ProviderRefresh from "./providerRefresh.ts";
import * as ProviderRefreshRoute from "./providerRefreshRoute.ts";
import * as ThreadLifecycle from "./threadLifecycle.ts";
import * as ThreadTabs from "./threadTabs.ts";
import * as ThreadTabsRoute from "./threadTabsRoute.ts";

export const layer = Layer.mergeAll(
  ThreadTabsRoute.layer.pipe(Layer.provide(EnvironmentBrowser.layer)),
  ModelRecommendationRoute.layer,
  ProviderRefreshRoute.layer.pipe(Layer.provide(ProviderRefresh.layer)),
  BuddySurfaceThreadRoute.layer,
  AgentCliSendState.layer,
).pipe(Layer.provide(ThreadTabs.layer.pipe(Layer.provide(ThreadLifecycle.layer))));
