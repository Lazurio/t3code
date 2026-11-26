/**
 * Lazurio overlay (root decision 0191): the server overlay's one layer, joined into upstream's
 * `layerMakeRoutes` by one line of `server.ts`, so it shares the routes' one preview broker.
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import * as ActingSenders from "./actingSenders.ts";
import * as ActingSendersRoute from "./actingSendersRoute.ts";
import * as AgentCliSendState from "./agentCliSendState.ts";
import * as BuddySignal from "./buddySignal.ts";
import * as BuddySurfaceDays from "./buddySurfaceDays.ts";
import * as BuddySurfaceThreadRoute from "./buddySurfaceThreadRoute.ts";
import * as BuddyTaskFailures from "./buddyTaskFailures.ts";
import * as ControlPlane from "./controlPlane.ts";
import * as ControlPlaneRoute from "./controlPlaneRoute.ts";
import * as ControlPlaneTool from "./controlPlaneTool.ts";
import * as EnvironmentBrowser from "./environmentBrowser.ts";
import { isLazurioEnvironment } from "./lazurioEnvironment.ts";
import * as ModelRecommendationRoute from "./modelRecommendationRoute.ts";
import * as ProviderRefresh from "./providerRefresh.ts";
import * as ProviderRefreshRoute from "./providerRefreshRoute.ts";
import * as ThreadLifecycle from "./threadLifecycle.ts";
import * as ThreadTabs from "./threadTabs.ts";
import * as ThreadTabsRoute from "./threadTabsRoute.ts";

const threadTabs = ThreadTabs.layer.pipe(Layer.provide(ThreadLifecycle.layer));
// One host and one set of strips, by layer memoization, for the routes and for /mcp.
const environmentBrowser = EnvironmentBrowser.layer.pipe(Layer.provide(threadTabs));
// One page store for the route and for /mcp's tool, by layer memoization (plan LZD-0051).
const controlPlane = ControlPlane.layer.pipe(Layer.provide(ThreadLifecycle.layer));

export const layer = Layer.mergeAll(
  ThreadTabsRoute.layer.pipe(Layer.provide(environmentBrowser)),
  ModelRecommendationRoute.layer,
  ProviderRefreshRoute.layer.pipe(Layer.provide(ProviderRefresh.layer)),
  BuddySurfaceThreadRoute.layer,
  BuddySignal.layer.pipe(Layer.provide(BuddyTaskFailures.layer)),
  AgentCliSendState.layer,
  ControlPlaneRoute.layer.pipe(Layer.provide(controlPlane), Layer.provide(ThreadLifecycle.layer)),
  Layer.mergeAll(BuddySurfaceDays.layer, ActingSendersRoute.layer).pipe(
    Layer.provide(ActingSenders.layer),
  ),
).pipe(Layer.provide(threadTabs));

/** /mcp's preview list and close see the threads' strips (Lazurio/t3code#200). */
export const withEnvironmentBrowserTabs = <A, E, R>(mcp: Layer.Layer<A, E, R>) =>
  mcp.pipe(Layer.provide(environmentBrowser));

/**
 * /mcp: on a Lazurio Environment upstream's tools with Buddy's `control_plane_publish` beside them
 * (plan LZD-0051), elsewhere upstream's layer as it is.
 */
export const withControlPlaneTool = (tools: typeof McpHttpServer.layerTools) => {
  const withTool = McpHttpServer.layerMcpTransport(
    Layer.mergeAll(
      tools,
      McpHttpServer.layerToolSearch,
      McpHttpServer.toolkitRegistration(
        ControlPlaneTool.ControlPlaneToolkit,
        ControlPlaneTool.handlersLayer,
      ).pipe(Layer.provide(controlPlane)),
    ),
  );
  const upstream: typeof withTool = McpHttpServer.layer;
  return Layer.unwrap(
    Effect.map(isLazurioEnvironment, (lazurio) => (lazurio ? withTool : upstream)),
  );
};
