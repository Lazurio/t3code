import { EnvironmentId, type ServerSelfUpdateCapability } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  collectRestartingMachines,
  collectServerUpdateTargets,
  describeUpdateEverything,
  runUpdateEverything,
  type UpdateEverythingMachine,
} from "./updateEverything.logic";

function machine(
  id: string,
  serverVersion: string,
  selfUpdate: ServerSelfUpdateCapability | undefined,
  overrides: Partial<UpdateEverythingMachine> = {},
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
          ...(selfUpdate ? { serverSelfUpdate: selfUpdate } : {}),
          ...(selfUpdate === "desktop-managed" ? { desktopAppUpdate: true } : {}),
        },
      },
      settings: { continueThreadsAfterServerUpdate: false },
    },
    connected: true,
    hostedByThisApp: false,
    canMaintain: true,
    updateState: { status: "idle" },
    ...overrides,
  };
}

describe("collectServerUpdateTargets", () => {
  it("updates remote servers that can move to the target and names every skipped one", () => {
    const { targets, skipped } = collectServerUpdateTargets(
      [
        machine("this-app", "0.0.40", "desktop-managed", { hostedByThisApp: true }),
        machine("service", "0.0.40", "boot-service"),
        machine("nightly-service", "0.0.49-nightly.20261001.3", "boot-service"),
        machine("other-desktop", "0.0.49-nightly.20261001.3", "desktop-managed"),
        machine("offline", "0.0.40", "boot-service", { connected: false }),
        machine("never-connected", "0.0.40", "boot-service", { serverConfig: null }),
        machine("no-scope", "0.0.40", "boot-service", { canMaintain: false }),
        machine("busy", "0.0.40", "boot-service", {
          updateState: {
            status: "running",
            stage: "downloading",
            fromVersion: "0.0.40",
            targetVersion: "0.0.50",
          },
        }),
        machine("current", "0.0.50", "boot-service"),
        machine("current-offline", "0.0.50", "boot-service", { connected: false }),
        machine("manual", "0.0.40", undefined),
      ],
      "0.0.50",
    );

    expect(targets.map((target) => [target.serverLabel, target.targetVersion])).toEqual([
      ["service", "0.0.50"],
      ["other-desktop", "0.0.50"],
    ]);
    expect(skipped.map((entry) => [entry.label, entry.reason])).toEqual([
      ["nightly-service", "on the nightly channel"],
      ["offline", "not connected"],
      ["never-connected", "not connected"],
      ["no-scope", "no permission"],
      ["busy", "already updating"],
      ["manual", "needs a manual update"],
    ]);
  });
});

describe("collectRestartingMachines", () => {
  it("lists updated servers, and this app's servers only when it installs", () => {
    const withContinuation = (
      id: string,
      overrides: Partial<UpdateEverythingMachine> = {},
      enabled = false,
      capability = true,
      serverVersion = "0.1.4",
    ) => {
      const base = machine(id, serverVersion, "boot-service", overrides);
      const environment = base.serverConfig!.environment;
      return {
        ...base,
        serverConfig: {
          environment: {
            ...environment,
            capabilities: {
              ...environment.capabilities,
              ...(capability ? { threadRestartContinuation: true } : {}),
            },
          },
          settings: { continueThreadsAfterServerUpdate: enabled },
        },
      };
    };
    const machines = [
      withContinuation("this-app", { hostedByThisApp: true }, true),
      withContinuation("alvin", {}, true),
      withContinuation("opted-out", {}, false),
      machine("old", "0.0.40", "boot-service"),
      withContinuation("no-capability", {}, true, false),
      withContinuation("no-shutdown-continuation", {}, true, true, "0.0.45-lazurio.9"),
      withContinuation("providers-only"),
    ];
    const servers = ["alvin", "opted-out", "old", "no-capability", "no-shutdown-continuation"].map(
      (id) => ({
        environmentId: EnvironmentId.make(id),
      }),
    );

    expect(collectRestartingMachines(machines, servers, true)).toEqual([
      { environmentId: "this-app", continuesThreads: true },
      { environmentId: "alvin", continuesThreads: true },
      { environmentId: "opted-out", continuesThreads: false },
      { environmentId: "old", continuesThreads: false },
      { environmentId: "no-capability", continuesThreads: false },
      { environmentId: "no-shutdown-continuation", continuesThreads: false },
    ]);
    expect(
      collectRestartingMachines(machines, servers, false).map((entry) => entry.environmentId),
    ).toEqual(["alvin", "opted-out", "old", "no-capability", "no-shutdown-continuation"]);
  });
});

describe("runUpdateEverything", () => {
  it("still updates remote machines when the local download fails", async () => {
    const calls: string[] = [];
    const result = await runUpdateEverything({
      downloadLocal: async () => false,
      updateProviders: async () => {
        calls.push("providers");
      },
      updateServers: async () => {
        calls.push("servers");
      },
    });

    expect(calls).toEqual(["providers", "servers"]);
    expect(result.localReady).toBe(false);
  });
});

describe("describeUpdateEverything", () => {
  it("gives each machine one row with its T3 Code and provider updates", () => {
    const id = EnvironmentId.make;
    const { rows } = describeUpdateEverything({
      localVersion: "1.1.0",
      localMachines: [
        { environmentId: id("local"), label: "Mainbook" },
        { environmentId: id("wsl"), label: "Mainbook WSL" },
      ],
      servers: [
        {
          environmentId: id("npm"),
          serverLabel: "bb-1",
          selfUpdate: "respawn",
          targetVersion: "1.1.0",
        },
      ],
      providerMachines: [
        { environmentId: id("npm"), label: "bb-1", providers: ["Codex", "Claude"] },
        { environmentId: id("local"), label: "Mainbook", providers: ["Codex"] },
        { environmentId: id("manual"), label: "alvin", providers: ["Claude"] },
      ],
      skipped: [
        { environmentId: id("manual"), label: "alvin", reason: "needs a manual update" },
        { environmentId: id("offline"), label: "TheoRoom", reason: "not connected" },
      ],
    });

    expect(
      rows.map(({ label, app, skipped, providers }) => [label, app, skipped, providers]),
    ).toEqual([
      ["Mainbook", "this-app", null, ["Codex"]],
      ["Mainbook WSL", "this-app", null, []],
      ["bb-1", "server", null, ["Codex", "Claude"]],
      ["alvin", null, "needs a manual update", ["Claude"]],
      ["TheoRoom", null, "not connected", []],
    ]);
  });

  it("names each server's own target when the servers go to different releases", () => {
    const id = EnvironmentId.make;
    const server = (environmentId: string, targetVersion: string) => ({
      environmentId: id(environmentId),
      serverLabel: environmentId,
      selfUpdate: "boot-service" as const,
      targetVersion,
    });
    const plan = {
      localVersion: null,
      localMachines: [],
      providerMachines: [],
      skipped: [],
    };

    const mixed = describeUpdateEverything({
      ...plan,
      servers: [server("stable", "0.1.4-lazurio.1"), server("canary", "0.1.4-preview.20261029.1")],
    });
    expect(mixed.version).toBeNull();
    expect(mixed.rows.map(({ label, targetVersion }) => [label, targetVersion])).toEqual([
      ["stable", "0.1.4-lazurio.1"],
      ["canary", "0.1.4-preview.20261029.1"],
    ]);

    const shared = describeUpdateEverything({
      ...plan,
      servers: [server("one", "0.1.4-lazurio.1"), server("two", "0.1.4-lazurio.1")],
    });
    expect(shared.version).toBe("0.1.4-lazurio.1");
    expect(shared.rows.map((row) => row.targetVersion)).toEqual([null, null]);

    const local = describeUpdateEverything({
      ...plan,
      localVersion: "0.1.4",
      servers: [server("advertised", "0.1.4-lazurio.1"), server("same", "0.1.4")],
    });
    expect(local.version).toBe("0.1.4");
    expect(local.rows.map(({ label, targetVersion }) => [label, targetVersion])).toEqual([
      ["This app", null],
      ["advertised", "0.1.4-lazurio.1"],
      ["same", null],
    ]);
  });
});
