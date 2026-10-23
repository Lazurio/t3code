import { describe, expect, it } from "vite-plus/test";

import {
  acceptBuddyContext,
  buddyHostOriginOf,
  buddyLayoutRequest,
  buddyReady,
  isBuddyPagePath,
} from "./buddySurfaceProtocol";

const host = "https://t3code.vm-01.example.lazurio.io";
const context = (overrides: Record<string, unknown> = {}) => ({
  type: "lazurio.buddy.context",
  v: 1,
  lang: "cs",
  theme: "light",
  environment: { id: "vm-01.example", kind: "work", name: "Pracovní" },
  organization: { slug: "example", name: "Example" },
  app: "chat",
  page: { path: "/thread-1" },
  guide: null,
  ...overrides,
});
const event = (data: unknown, origin = host, fromParent = true) => ({ data, origin, fromParent });

describe("the host Buddy's surface listens to", () => {
  it("is the page around the frame, by its ancestor or else its referrer", () => {
    expect(buddyHostOriginOf(host, "")).toBe(host);
    expect(buddyHostOriginOf(null, `${host}/thread-1`)).toBe(host);
    expect(buddyHostOriginOf(undefined, "https://launchpad.matej.lazurio.io/files")).toBe(
      "https://launchpad.matej.lazurio.io",
    );
  });

  it("is no one for another app, domain, depth or the frame's own origin", () => {
    for (const origin of [
      "https://buddy.matej.lazurio.io",
      "https://dashboard.lazurio.io",
      "https://t3code.vm-01.example.lazurio.ai",
      "https://t3code.a.vm-01.example.lazurio.io",
      "https://t3code.vm-01.example.lazurio.io:8443",
      "http://t3code.vm-01.example.lazurio.io",
    ]) {
      expect(buddyHostOriginOf(origin, "")).toBeNull();
      expect(buddyHostOriginOf(null, `${origin}/`)).toBeNull();
    }
    expect(buddyHostOriginOf("null", "")).toBeNull();
  });
});

describe("a context from the host", () => {
  it("is taken from the parent on the host's origin about the host's own Environment", () => {
    expect(acceptBuddyContext(event(context()), host)).toEqual({
      lang: "cs",
      theme: "light",
      environment: { id: "vm-01.example", kind: "work", name: "Pracovní" },
      organization: { slug: "example", name: "Example" },
      app: "chat",
      page: { path: "/thread-1" },
      guide: null,
    });
    const personal = "https://launchpad.matej.lazurio.io";
    expect(
      acceptBuddyContext(
        event(
          context({
            environment: { id: "matej", kind: "personal", name: "Osobní" },
            organization: null,
            app: "apps",
            page: { path: "/" },
          }),
          personal,
        ),
        personal,
      )?.environment,
    ).toEqual({ id: "matej", kind: "personal", name: "Osobní" });
  });

  it("is dropped from another window, origin or Environment", () => {
    expect(acceptBuddyContext(event(context(), host, false), host)).toBeNull();
    expect(
      acceptBuddyContext(event(context(), "https://launchpad.vm-01.example.lazurio.io"), host),
    ).toBeNull();
    expect(
      acceptBuddyContext(
        event(context({ environment: { id: "vm-02.example", kind: "work", name: "Jiné" } })),
        host,
      ),
    ).toBeNull();
    expect(
      acceptBuddyContext(
        event(context({ environment: { id: "vm-01.example", kind: "personal", name: "Osobní" } })),
        host,
      ),
    ).toBeNull();
    expect(acceptBuddyContext(event(context()), null)).toBeNull();
  });

  it("is dropped whole for any defect in its data", () => {
    for (const data of [
      context({ v: 2 }),
      context({ extra: true }),
      context({ environment: { id: "vm-01.example", kind: "work", name: "Pracovní", token: "x" } }),
      context({ environment: { id: "vm-01.example", kind: "work", name: "Line\nbreak" } }),
      context({ environment: { id: "vm-01.example", kind: "work", name: "N".repeat(129) } }),
      context({ page: { path: "/files?token=secret" } }),
      context({ page: { path: "/files#ticket" } }),
      context({ app: "module" }),
      context({ guide: { explainer: "files", step: 17 } }),
      context({ organization: { slug: " example", name: "Example" } }),
      context({ environment: null }),
      JSON.parse(`{"__proto__":{"admin":true},${JSON.stringify(context()).slice(1)}`),
      [context()],
      "lazurio.buddy.context",
    ])
      expect(acceptBuddyContext(event(data), host)).toBeNull();
  });
});

describe("what the frame sends", () => {
  it("is ready and a request for one of the three sizes", () => {
    expect(buddyReady()).toEqual({ type: "lazurio.buddy.ready", v: 1 });
    expect(buddyLayoutRequest("panel")).toEqual({
      type: "lazurio.buddy.layout",
      v: 1,
      mode: "panel",
    });
    expect(buddyLayoutRequest("fullscreen")?.mode).toBe("fullscreen");
    expect(buddyLayoutRequest("closed")?.mode).toBe("closed");
    expect(buddyLayoutRequest("maximized")).toBeNull();
  });

  it("names a page by its path only", () => {
    expect(isBuddyPagePath("/settings/general")).toBe(true);
    for (const path of ["files", "//evil.example/x", "/a b", "/a\\b", "/a?b", "/a#b", ""])
      expect(isBuddyPagePath(path)).toBe(false);
  });
});
