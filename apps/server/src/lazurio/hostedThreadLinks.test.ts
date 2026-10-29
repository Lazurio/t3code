import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthSessionId, EnvironmentId } from "@t3tools/contracts";
import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as McpOAuth from "../auth/McpOAuth.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as McpHttpServer from "../mcp/McpHttpServer.ts";

// A hosted Environment serves T3 on loopback behind its own HTTPS origin (T3CODE_EXTERNAL_ORIGIN).
const EXTERNAL_ORIGIN = new URL("https://t3code.management.example.test/");

/** The hosted app link an outside MCP client's thread links open through. */
const outsideClientHostedAppUrl = (externalOrigin: URL | undefined) =>
  Effect.gen(function* () {
    const clients = yield* McpHttpServer.McpClientAuthenticator;
    const scope = yield* clients.authenticate(
      HttpServerRequest.fromWeb(new Request("http://127.0.0.1/mcp")),
    );
    return scope?.client?.hostedAppUrl;
  }).pipe(
    Effect.provide(
      McpOAuth.layerMcpClientAuthenticator.pipe(
        Layer.provide(
          Layer.mock(EnvironmentAuth.EnvironmentAuth)({
            authenticateMcpClient: () =>
              Effect.succeed({
                sessionId: AuthSessionId.make("session-outside-client"),
                label: "Outside client",
                access: "auto",
                peerLink: false,
              }),
          }),
        ),
        Layer.provide(
          Layer.mock(ServerEnvironment.ServerEnvironment)({
            getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-hosted-links")),
          }),
        ),
        Layer.provide(
          Layer.effect(
            ServerConfig.ServerConfig,
            Effect.map(ServerConfig.ServerConfig, (config) => ({ ...config, externalOrigin })),
          ).pipe(
            Layer.provide(
              ServerConfig.layerTest(process.cwd(), { prefix: "t3-hosted-thread-links-test-" }),
            ),
          ),
        ),
      ),
    ),
  );

it.effect("links an outside MCP client's threads to the external origin people open", () =>
  Effect.gen(function* () {
    expect(yield* outsideClientHostedAppUrl(EXTERNAL_ORIGIN)).toBe(
      "https://t3code.management.example.test",
    );
    expect(yield* outsideClientHostedAppUrl(undefined)).toBe(DEFAULT_HOSTED_APP_URL);
  }).pipe(Effect.provide(NodeServices.layer)),
);
