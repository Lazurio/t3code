/**
 * Lazurio overlay (root decision 0191): the server overlay's one layer, joined into upstream's
 * `layerMakeRoutes` by one line of `server.ts`, so it shares the routes' one preview broker.
 */

import * as Layer from "effect/Layer";

import * as ActingSenders from "./actingSenders.ts";
import * as ActingSendersRoute from "./actingSendersRoute.ts";
import * as AgentCliSendState from "./agentCliSendState.ts";
import * as BuddySurfaceDays from "./buddySurfaceDays.ts";
import * as BuddySurfaceThreadRoute from "./buddySurfaceThreadRoute.ts";
import * as EnvironmentBrowser from "./environmentBrowser.ts";
import * as ModelRecommendationRoute from "./modelRecommendationRoute.ts";
import * as ProviderRefresh from "./providerRefresh.ts";
import * as ProviderRefreshRoute from "./providerRefreshRoute.ts";
import * as ThreadLifecycle from "./threadLifecycle.ts";
import * as ThreadTabs from "./threadTabs.ts";
import * as ThreadTabsRoute from "./threadTabsRoute.ts";

const threadTabs = ThreadTabs.layer.pipe(Layer.provide(ThreadLifecycle.layer));
// One host and one set of strips, by layer memoization, for the routes and for /mcp.
const environmentBrowser = EnvironmentBrowser.layer.pipe(Layer.provide(threadTabs));

export const layer = Layer.mergeAll(
  ThreadTabsRoute.layer.pipe(Layer.provide(environmentBrowser)),
  ModelRecommendationRoute.layer,
  ProviderRefreshRoute.layer.pipe(Layer.provide(ProviderRefresh.layer)),
  BuddySurfaceThreadRoute.layer,
  AgentCliSendState.layer,
  Layer.mergeAll(BuddySurfaceDays.layer, ActingSendersRoute.layer).pipe(
    Layer.provide(ActingSenders.layer),
  ),
).pipe(Layer.provide(threadTabs));

/** /mcp's preview list and close see the threads' strips (Lazurio/t3code#200). */
export const withEnvironmentBrowserTabs = <A, E, R>(mcp: Layer.Layer<A, E, R>) =>
  mcp.pipe(Layer.provide(environmentBrowser));
