import { describe, expect, it } from "vite-plus/test";

import {
  classifyHostedHttpsCompatibility,
  createAdvertisedEndpoint,
  deriveWsBaseUrl,
  normalizeHttpBaseUrl,
  environmentEndpointUrl,
  environmentSocketUrl,
} from "./endpoint.ts";

const coreProvider = {
  id: "desktop-core",
  label: "Desktop",
  kind: "core",
  isAddon: false,
} as const;

describe("advertised endpoint helpers", () => {
  it("normalizes HTTP and WebSocket base URLs", () => {
    expect(normalizeHttpBaseUrl("https://example.com/path?x=1#hash")).toBe(
      "https://example.com/path/",
    );
    expect(normalizeHttpBaseUrl("wss://example.com/socket")).toBe("https://example.com/socket/");
    expect(deriveWsBaseUrl("https://example.com/api")).toBe("wss://example.com/api/");
    expect(deriveWsBaseUrl("http://127.0.0.1:3773")).toBe("ws://127.0.0.1:3773/");
  });

  it("marks HTTP endpoints as blocked from hosted HTTPS apps", () => {
    expect(classifyHostedHttpsCompatibility("http://192.168.1.44:3773")).toBe(
      "mixed-content-blocked",
    );
    expect(classifyHostedHttpsCompatibility("https://desktop.example.com", "compatible")).toBe(
      "compatible",
    );
  });

  it("creates provider-neutral endpoint records", () => {
    expect(
      createAdvertisedEndpoint({
        id: "lan:http://192.168.1.44:3773",
        label: "LAN",
        provider: coreProvider,
        httpBaseUrl: "http://192.168.1.44:3773",
        reachability: "lan",
        source: "desktop-core",
        isDefault: true,
      }),
    ).toEqual({
      id: "lan:http://192.168.1.44:3773",
      label: "LAN",
      provider: coreProvider,
      httpBaseUrl: "http://192.168.1.44:3773/",
      wsBaseUrl: "ws://192.168.1.44:3773/",
      reachability: "lan",
      compatibility: {
        hostedHttpsApp: "mixed-content-blocked",
        desktopApp: "compatible",
      },
      source: "desktop-core",
      status: "available",
      isDefault: true,
    });
  });
});

it("keeps the application prefix for HTTP and WebSocket requests", () => {
  expect(environmentEndpointUrl("https://example.com/t3code/?old=1#old", "/api/auth/session")).toBe(
    "https://example.com/t3code/api/auth/session",
  );
  for (const base of ["/t3code", "/t3code/", "/t3code/ws"]) {
    expect(environmentSocketUrl(`wss://example.com${base}?ticket=x`).toString()).toBe(
      "wss://example.com/t3code/ws?ticket=x",
    );
  }
});
