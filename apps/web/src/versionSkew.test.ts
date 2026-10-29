import { EnvironmentId } from "@t3tools/contracts";
import type { ServerUpdateState } from "@t3tools/client-runtime/state/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const branding = vi.hoisted(() => ({ APP_VERSION: "0.0.34" }));
vi.mock("./branding", () => branding);

import { APP_VERSION } from "./branding";
import {
  buildVersionMismatchDismissalKey,
  dismissServerUpdateFailure,
  dismissVersionMismatch,
  isServerUpdateFailureDismissed,
  isVersionMismatchDismissed,
  manualServerUpdateCommand,
  resolveServerConfigVersionMismatch,
  resolveVersionMismatch,
} from "./versionSkew";

const MISMATCH_HINT =
  "Version mismatch. Try syncing the client and server to the same T3 Code version.";

describe("versionSkew", () => {
  it("updates only the proven npm prefix and safely quotes its path", () => {
    expect(manualServerUpdateCommand("0.0.45", { kind: "npm-global", prefix: "/opt/node" })).toBe(
      "npm install --global --prefix '/opt/node' t3@0.0.45",
    );
    expect(
      manualServerUpdateCommand("0.0.45", { kind: "npm-global", prefix: "/opt/maria's node" }),
    ).toBe("npm install --global --prefix '/opt/maria'\\''s node' t3@0.0.45");
  });
  beforeEach(() => {
    branding.APP_VERSION = "0.0.34";
  });

  it("dismisses only the current failed attempt without clearing its retry state", () => {
    const failure = {
      status: "failed",
      stage: "downloading",
      fromVersion: "0.0.33",
      targetVersion: "0.0.34",
      message: "Download failed.",
    } as const satisfies ServerUpdateState;
    const retryFailure = { ...failure };
    const otherEnvironmentFailure = { ...failure };

    dismissServerUpdateFailure(failure);

    expect(isServerUpdateFailureDismissed(failure)).toBe(true);
    expect(failure.status).toBe("failed");
    expect(failure.message).toBe("Download failed.");
    expect(isServerUpdateFailureDismissed(retryFailure)).toBe(false);
    expect(isServerUpdateFailureDismissed(otherEnvironmentFailure)).toBe(false);
  });

  it("returns a mismatch when the server is behind the client", () => {
    expect(resolveVersionMismatch("0.0.33")).toEqual({
      clientVersion: "0.0.34",
      serverVersion: "0.0.33",
      targetVersion: "0.0.34",
      hint: MISMATCH_HINT,
    });
  });

  it("does not warn when the server is ahead of the client", () => {
    expect(resolveVersionMismatch("0.0.35")).toBeNull();
    expect(resolveVersionMismatch("9.9.9")).toBeNull();
  });

  it("does not warn when a nightly and a stable build share a core version", () => {
    expect(resolveVersionMismatch("0.0.34-nightly.20260818.1124")).toBeNull();

    branding.APP_VERSION = "0.0.34-nightly.20260818.1124";
    expect(resolveVersionMismatch("0.0.34")).toBeNull();
  });

  it.each(["0.0.34-nightly.20260823.1124", "0.0.34-nightly.20260824.1124"])(
    "warns when nightly server %s is behind a nightly client on the same release",
    (serverVersion) => {
      branding.APP_VERSION = "0.0.34-nightly.20260824.1125";

      expect(resolveVersionMismatch(serverVersion)).toEqual({
        clientVersion: "0.0.34-nightly.20260824.1125",
        serverVersion,
        targetVersion: "0.0.34-nightly.20260824.1125",
        hint: MISMATCH_HINT,
      });
    },
  );

  // regression: #7579 versions were compared as strings, not semver
  it("treats a nightly server built past the client as ahead, not skew", () => {
    expect(resolveVersionMismatch("0.0.35-nightly.20260818.1124")).toBeNull();
  });

  it("still warns when a nightly client outruns the server by a release", () => {
    branding.APP_VERSION = "0.0.35-nightly.20260818.1124";

    expect(resolveVersionMismatch("0.0.34")).toEqual({
      clientVersion: "0.0.35-nightly.20260818.1124",
      serverVersion: "0.0.34",
      targetVersion: "0.0.35-nightly.20260818.1124",
      hint: MISMATCH_HINT,
    });
  });

  it("falls back to string inequality when a version is not semver", () => {
    expect(resolveVersionMismatch("dev")).toEqual({
      clientVersion: "0.0.34",
      serverVersion: "dev",
      targetVersion: "0.0.34",
      hint: MISMATCH_HINT,
    });

    branding.APP_VERSION = "dev";
    expect(resolveVersionMismatch("dev")).toBeNull();
    expect(resolveVersionMismatch("0.0.34")).toMatchObject({ serverVersion: "0.0.34" });
  });

  it("keys dismissals by environment, target version, and server version", () => {
    const environmentId = EnvironmentId.make("environment-dismissal");
    const key = buildVersionMismatchDismissalKey(environmentId, {
      targetVersion: APP_VERSION,
      serverVersion: "9.9.9",
    });

    expect(isVersionMismatchDismissed(key)).toBe(false);

    dismissVersionMismatch(key);

    expect(isVersionMismatchDismissed(key)).toBe(true);
    expect(
      isVersionMismatchDismissed(
        buildVersionMismatchDismissalKey(environmentId, {
          targetVersion: APP_VERSION,
          serverVersion: "9.9.10",
        }),
      ),
    ).toBe(false);
  });

  describe("server-advertised updates", () => {
    const serverConfig = (
      serverVersion: string,
      options: {
        readonly serverSelfUpdate?: "boot-service" | "desktop-managed";
        readonly available?: string;
      },
    ) => ({
      environment: {
        environmentId: EnvironmentId.make("environment-vm"),
        label: "VM",
        platform: { os: "linux", arch: "x64" } as const,
        serverVersion,
        capabilities: {
          repositoryIdentity: true,
          ...(options.serverSelfUpdate ? { serverSelfUpdate: options.serverSelfUpdate } : {}),
        },
        ...(options.available ? { availableServerUpdate: { version: options.available } } : {}),
      },
    });

    it("offers the advertised release to a browser served by the same server", () => {
      branding.APP_VERSION = "0.0.42-acme.1";
      expect(
        resolveServerConfigVersionMismatch(
          serverConfig("0.0.42-acme.1", {
            serverSelfUpdate: "boot-service",
            available: "0.0.42-acme.2",
          }),
        ),
      ).toMatchObject({ serverVersion: "0.0.42-acme.1", targetVersion: "0.0.42-acme.2" });
    });

    it("prefers the advertised release over a newer client from another train", () => {
      branding.APP_VERSION = "0.0.45";
      expect(
        resolveServerConfigVersionMismatch(
          serverConfig("0.0.42-acme.1", {
            serverSelfUpdate: "boot-service",
            available: "0.0.43-acme.1",
          }),
        )?.targetVersion,
      ).toBe("0.0.43-acme.1");
    });

    it("falls back to client skew without an advertised release", () => {
      branding.APP_VERSION = "0.0.45";
      expect(
        resolveServerConfigVersionMismatch(
          serverConfig("0.0.42", { serverSelfUpdate: "boot-service" }),
        )?.targetVersion,
      ).toBe("0.0.45");
      expect(
        resolveServerConfigVersionMismatch(
          serverConfig("0.0.45", { serverSelfUpdate: "boot-service" }),
        ),
      ).toBeNull();
    });

    it("ignores an advertisement from a server the boot service does not manage", () => {
      expect(
        resolveServerConfigVersionMismatch(
          serverConfig("0.0.34", { serverSelfUpdate: "desktop-managed", available: "0.0.40" }),
        ),
      ).toBeNull();
    });
  });
});
