import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  everyEnvironmentManaged,
  managedFirstRunDecision,
  managedNewThread,
  offeredInProjectPicker,
} from "./managedFolder";

const folder = "/home/person/Lazurio";
const managedId = "environment-managed" as EnvironmentId;
const otherId = "environment-other" as EnvironmentId;
const unmanaged = { environmentId: otherId, serverConfig: {} };
const managed = { environmentId: managedId, serverConfig: { lazurioFolder: folder } };
const loading = { environmentId: otherId, serverConfig: null };

describe("Add project in a managed Environment", () => {
  // The command palette and the sidebar show "Add project" exactly when this is false.
  it("stays as upstream without T3CODE_LAZURIO_FOLDER, also with no Environment at all", () => {
    expect(everyEnvironmentManaged([])).toBe(false);
    expect(everyEnvironmentManaged([unmanaged])).toBe(false);
    expect(everyEnvironmentManaged([unmanaged, unmanaged])).toBe(false);
    expect(everyEnvironmentManaged([loading])).toBe(false);
  });

  it("leaves only when every known Environment is managed", () => {
    expect(everyEnvironmentManaged([managed])).toBe(true);
    expect(everyEnvironmentManaged([managed, managed])).toBe(true);
    expect(everyEnvironmentManaged([managed, unmanaged])).toBe(false);
    expect(everyEnvironmentManaged([unmanaged, managed])).toBe(false);
    // Until its config arrives, an Environment is not known to be managed.
    expect(everyEnvironmentManaged([managed, loading])).toBe(false);
  });

  // The sidebar knows its Environments by identity and their configs by ID.
  it("reads the same from identities and the configs beside them", () => {
    const configs = new Map([
      [managedId, { lazurioFolder: folder }],
      [otherId, {}],
    ]);
    const identity = (environmentId: EnvironmentId) => ({ environmentId });
    expect(everyEnvironmentManaged([], configs)).toBe(false);
    expect(everyEnvironmentManaged([identity(managedId)], configs)).toBe(true);
    expect(everyEnvironmentManaged([identity(managedId), identity(otherId)], configs)).toBe(false);
    // An Environment whose config has not arrived is not in the map, so not managed.
    expect(everyEnvironmentManaged([identity(managedId)], new Map())).toBe(false);
  });
});

describe("the project pickers", () => {
  const offered = offeredInProjectPicker([managed, unmanaged]);
  const entry = (environmentId: EnvironmentId, workspaceRoot: string) => ({
    targetProject: { environmentId, workspaceRoot },
  });

  it("offer of a managed Environment only its Folder's project", () => {
    expect(offered(entry(managedId, folder))).toBe(true);
    expect(offered(entry(managedId, "/home/person/older-repository"))).toBe(false);
  });

  it("offer every project of any other Environment, as upstream", () => {
    expect(offered(entry(otherId, "/home/person/repository"))).toBe(true);
    expect(offeredInProjectPicker([])(entry(managedId, "/anywhere"))).toBe(true);
  });
});

describe("a new thread", () => {
  const folderProjectId = "project-folder" as ProjectId;
  const projects = [
    { id: "project-old" as ProjectId, environmentId: managedId, workspaceRoot: "/old/repository" },
    { id: folderProjectId, environmentId: managedId, workspaceRoot: folder },
  ];
  const configs = new Map([
    [managedId, { lazurioFolder: folder }],
    [otherId, {}],
  ]);
  const worktree = {
    branch: "feature",
    worktreePath: "/tmp/worktree",
    envMode: "worktree" as const,
  };

  it("goes where the caller asked without a managed Folder", () => {
    const request = scopeProjectRef(otherId, "project-other" as ProjectId);
    expect(managedNewThread(configs, projects, request, worktree)).toEqual({
      projectRef: request,
      options: worktree,
    });
  });

  it("starts in a managed Environment's Folder project, in the Folder itself", () => {
    const request = scopeProjectRef(managedId, "project-old" as ProjectId);
    expect(managedNewThread(configs, projects, request, { ...worktree, replace: true })).toEqual({
      projectRef: scopeProjectRef(managedId, folderProjectId),
      options: {
        branch: null,
        worktreePath: null,
        envMode: "local",
        startFromOrigin: false,
        replace: true,
      },
    });
  });

  it("waits while the Folder's project has not reached the web", () => {
    const request = scopeProjectRef(managedId, "project-old" as ProjectId);
    expect(managedNewThread(configs, projects.slice(0, 1), request, undefined)).toBeNull();
  });
});

describe("managed first run", () => {
  it("waits for live server evidence of the native Folder project", () => {
    expect(managedFirstRunDecision({ hydrated: true, live: false, projectReady: true })).toBe(
      "pending",
    );
    expect(managedFirstRunDecision({ hydrated: true, live: true, projectReady: false })).toBe(
      "pending",
    );
    expect(managedFirstRunDecision({ hydrated: false, live: true, projectReady: true })).toBe(
      "pending",
    );
  });
  it("then opens the app, never a welcome or upstream's wizard", () => {
    expect(managedFirstRunDecision({ hydrated: true, live: true, projectReady: true })).toBe("app");
  });
});
