/**
 * Lazurio overlay (root decision 0191): the server overlay's one layer, joined into upstream's
 * `layerMakeRoutes` by one line of `server.ts`, so it shares the routes' one preview broker.
 */

import * as Layer from "effect/Layer";

import * as EnvironmentBrowser from "./environmentBrowser.ts";
import * as ThreadLifecycle from "./threadLifecycle.ts";
import * as ThreadTabs from "./threadTabs.ts";
import * as ThreadTabsRoute from "./threadTabsRoute.ts";

export const layer = Layer.mergeAll(EnvironmentBrowser.layer, ThreadTabsRoute.layer).pipe(
  Layer.provide(ThreadTabs.layer.pipe(Layer.provide(ThreadLifecycle.layer))),
);
