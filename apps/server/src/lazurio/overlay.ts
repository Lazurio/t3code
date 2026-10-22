/**
 * Lazurio overlay (root decision 0191, plan DEV-6646; LazurioPlatform F51): the server overlay's
 * one layer, which one line of `server.ts` joins into upstream's routes, inside `layerMakeRoutes`,
 * where it shares the routes' one preview broker. The Environment browser host drives the
 * Environment browser for T3's browser tools (environmentBrowser.ts); each thread keeps its tabs
 * of that browser in its holder file (threadTabs.ts), which the web reaches through
 * threadTabsRoute.ts, and archiving or deleting a thread lets go of them (threadLifecycle.ts). The
 * model recommendation route takes the Platform's recommended model for the managed Folder's
 * project (modelRecommendationRoute.ts), and the provider refresh route turns Codex or Claude on
 * and reads their sign-in again after it happened through their CLIs (providerRefreshRoute.ts,
 * root decision 0201). In Buddy's T3 Code the Buddy thread route finds or makes Buddy's one thread
 * (buddySurfaceThreadRoute.ts, root decision 0210), and the days route lists the days of that
 * conversation for the surface's day pane (buddySurfaceDays.ts). The send state route tells an
 * agent command what became of its keyed send (agentCliSendState.ts).
 */

import * as Layer from "effect/Layer";

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

export const layer = Layer.mergeAll(
  EnvironmentBrowser.layer,
  ThreadTabsRoute.layer,
  ModelRecommendationRoute.layer,
  ProviderRefreshRoute.layer.pipe(Layer.provide(ProviderRefresh.layer)),
  BuddySurfaceThreadRoute.layer,
  AgentCliSendState.layer,
  BuddySurfaceDays.layer,
).pipe(Layer.provide(ThreadTabs.layer.pipe(Layer.provide(ThreadLifecycle.layer))));
