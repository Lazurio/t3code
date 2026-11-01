import { type EnvironmentId, ORCHESTRATION_PROTOCOL_VERSION } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import * as TokenStore from "../authorization/tokenStore.ts";
import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import type { NetworkStatus } from "../connection/model.ts";
import { preparePairingRegistration } from "../connection/onboarding.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import * as RpcHttp from "../rpc/http.ts";

// Copy of APPLICATION_PUBLIC_PATHS in HumanAndMachine-ai/Machines
// workloads/workspace-vm/routes.ts (root decision 0157); change both together.
// Every other request gets a 302 to the gateway sign-in.
const GATEWAY_ADMITS = [
  "GET /.well-known/t3/environment",
  "POST /oauth/token",
  "GET /api/auth/session",
  "POST /api/auth/websocket-ticket",
  "POST /api/auth/websocket-ticket/rpc",
] as const;
const GATEWAY_WEBSOCKET = { path: "/ws", query: "wsTicket" } as const;
const GATEWAY_BEFORE_RPC_TICKET = GATEWAY_ADMITS.filter((route) => !route.endsWith("/rpc"));

const HOST = "t3code.workspace.example.test";

// Pairing only asks the registry whether the address is known; nothing is saved here.
const registryAcceptingAnyAddress = Layer.unwrap(
  Effect.gen(function* () {
    return Layer.mock(EnvironmentRegistry.EnvironmentRegistry)({
      entries: yield* SubscriptionRef.make<ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>>(
        new Map(),
      ),
      networkStatus: yield* SubscriptionRef.make<NetworkStatus>("online"),
      assertKnownAddress: () => Effect.void,
    });
  }),
);

const t3Answer = (route: string): Response => {
  switch (route) {
    case "GET /.well-known/t3/environment":
      return Response.json({
        environmentId: "environment-workspace",
        label: "Example / Workspace",
        platform: { os: "linux", arch: "x64" },
        serverVersion: "0.0.0-test",
        orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
        capabilities: { repositoryIdentity: true },
      });
    case "POST /oauth/token":
      return Response.json({
        access_token: "access-token",
        issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "orchestration:read",
      });
    case "GET /api/auth/session":
      return Response.json({
        authenticated: true,
        auth: {
          policy: "remote-reachable",
          bootstrapMethods: ["one-time-token"],
          sessionMethods: ["bearer-access-token"],
          sessionCookieName: "t3_session",
        },
        scopes: ["orchestration:read"],
        sessionMethod: "bearer-access-token",
      });
    default:
      return Response.json({ ticket: "ws-ticket", expiresAt: "2026-05-01T12:05:00.000Z" });
  }
};

const gateway = (admits: ReadonlyArray<string>) => {
  const reached: Array<string> = [];
  const refused: Array<string> = [];
  const fetchFn = ((input, init = {}) => {
    const url = new URL(String(input));
    const route = `${init.method ?? "GET"} ${url.pathname}`;
    if (url.host !== HOST || !admits.includes(route)) {
      refused.push(route);
      return Promise.resolve(
        new Response(null, { status: 302, headers: { location: `https://${HOST}/oauth2/start` } }),
      );
    }
    reached.push(route);
    return Promise.resolve(t3Answer(route));
  }) satisfies typeof fetch;
  // Signed out of T3 Connect: a direct bearer connection must not use the relay.
  const layer = RemoteEnvironmentAuthorization.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        RpcHttp.layerRemoteHttpClient(fetchFn),
        Layer.mock(ManagedRelay.ManagedRelayDpopSigner)({}),
        Layer.mock(ManagedRelay.ManagedRelayClient)({ relayUrl: "https://relay.invalid" }),
        Layer.mock(ClientCapabilities.CloudSession)({ identity: Effect.succeedNone }),
        Layer.mock(ClientCapabilities.RelayDeviceIdentity)({}),
        Layer.mock(TokenStore.RemoteDpopAccessTokenStore)({}),
        registryAcceptingAnyAddress,
        Layer.succeed(
          ClientCapabilities.ClientPresentation,
          ClientCapabilities.ClientPresentation.of({
            metadata: { label: "T3 Code Test", deviceType: "desktop", os: "Test OS" },
          }),
        ),
      ),
    ),
  );
  return { reached, refused, layer };
};

// What a desktop or mobile client does with a pairing link to a hosted Environment:
// redeem it, then authorize the direct socket the way every reconnect does.
const pairAndConnect = Effect.gen(function* () {
  const registration = yield* preparePairingRegistration({
    host: HOST,
    pairingCode: "pairing-token",
  });
  if (registration._tag !== "BearerConnectionRegistration") {
    return yield* Effect.die(`unexpected registration ${registration._tag}`);
  }
  const remote = yield* RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization;
  return yield* remote.authorizeBearer({
    expectedEnvironmentId: registration.target.environmentId,
    httpBaseUrl: registration.profile.httpBaseUrl,
    wsBaseUrl: registration.profile.wsBaseUrl,
    bearerToken: registration.credential.token,
    connectionMethod: "direct",
  });
});

describe("pairing through a Lazurio workspace gateway", () => {
  it.effect("reaches the socket with only requests the gateway admits", () =>
    Effect.gen(function* () {
      const { reached, refused, layer } = gateway(GATEWAY_ADMITS);
      const authorized = yield* pairAndConnect.pipe(Effect.provide(layer));
      const socket = new URL(authorized.socketUrl);
      expect(socket.host).toBe(HOST);
      expect(socket.pathname).toBe(GATEWAY_WEBSOCKET.path);
      expect(socket.searchParams.get(GATEWAY_WEBSOCKET.query)).toBe("ws-ticket");
      expect(refused).toEqual([]);
      expect(reached).toContain("POST /api/auth/websocket-ticket/rpc");
    }),
  );

  it.effect("stops before the socket when the gateway refuses the rpc ticket", () =>
    Effect.gen(function* () {
      const { refused, layer } = gateway(GATEWAY_BEFORE_RPC_TICKET);
      yield* pairAndConnect.pipe(Effect.provide(layer), Effect.flip);
      expect(refused).toEqual(["POST /api/auth/websocket-ticket/rpc"]);
    }),
  );
});
