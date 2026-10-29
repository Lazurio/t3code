import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  collectServerUpdateTargets,
  type UpdateEverythingMachine,
} from "../components/sidebar/updateEverything.logic";

// The sidebar's update button offers the release a boot-service server advertised from its own
// channel, even to the web app that same server hosts, where there is no version skew.
function machine(
  id: string,
  serverVersion: string,
  options: {
    readonly selfUpdate: "boot-service" | "desktop-managed";
    readonly available?: string;
  },
): UpdateEverythingMachine {
  return {
    environmentId: EnvironmentId.make(id),
    label: id,
    serverConfig: {
      environment: {
        environmentId: EnvironmentId.make(id),
        label: id,
        platform: { os: "linux", arch: "x64" },
        serverVersion,
        capabilities: {
          repositoryIdentity: true,
          serverSelfUpdate: options.selfUpdate,
          ...(options.selfUpdate === "desktop-managed" ? { desktopAppUpdate: true } : {}),
        },
        ...(options.available ? { availableServerUpdate: { version: options.available } } : {}),
      },
      settings: { continueThreadsAfterServerUpdate: false },
    },
    connected: true,
    hostedByThisApp: false,
    canMaintain: true,
    updateState: { status: "idle" },
  };
}

describe("the sidebar update button and a server-advertised release", () => {
  it("updates a server to the release it advertised, not to this app's version", () => {
    const { targets, skipped } = collectServerUpdateTargets(
      [
        machine("hosting", "0.1.3-lazurio.0", {
          selfUpdate: "boot-service",
          available: "0.1.3-lazurio.1",
        }),
        machine("current", "0.1.3-lazurio.0", { selfUpdate: "boot-service" }),
      ],
      "0.1.3-lazurio.0",
      false,
    );

    expect(targets.map((target) => [target.serverLabel, target.targetVersion])).toEqual([
      ["hosting", "0.1.3-lazurio.1"],
    ]);
    expect(skipped).toEqual([]);
  });

  it("does not wait for npm for a release a server advertised from its own channel", () => {
    const { targets, waitForNpm } = collectServerUpdateTargets(
      [
        machine("hosting", "0.1.3-lazurio.0", {
          selfUpdate: "boot-service",
          available: "0.1.4-lazurio.1",
        }),
        machine("npm-only", "0.1.3-lazurio.0", { selfUpdate: "boot-service" }),
      ],
      "0.1.4-lazurio.1",
      false,
    );

    expect(targets.map((target) => [target.serverLabel, target.targetVersion])).toEqual([
      ["hosting", "0.1.4-lazurio.1"],
      ["npm-only", "0.1.4-lazurio.1"],
    ]);
    expect(waitForNpm.map((target) => target.serverLabel)).toEqual(["npm-only"]);
  });

  it("ignores an advertisement from a server the boot service does not manage", () => {
    const { targets } = collectServerUpdateTargets(
      [
        machine("desktop", "0.1.3-lazurio.0", {
          selfUpdate: "desktop-managed",
          available: "0.1.3-lazurio.1",
        }),
      ],
      "0.1.3-lazurio.0",
      false,
    );

    expect(targets).toEqual([]);
  });
});
