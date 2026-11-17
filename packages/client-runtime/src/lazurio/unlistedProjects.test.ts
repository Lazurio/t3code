import {
  EnvironmentId,
  ProjectId,
  type ServerConfig,
  ThreadId,
  type OrchestrationV2ShellSnapshot,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { PrimaryConnectionTarget } from "../connection/model.ts";
import { v2Project, v2ShellSnapshot, v2ThreadShell } from "../state/orchestrationV2TestFixtures.ts";
import { createEnvironmentProjectAtoms } from "../state/projectEntities.ts";
import { createEnvironmentThreadShellAtoms } from "../state/threadShell.ts";

const environmentId = EnvironmentId.make("local");
const buddyProject = {
  ...v2Project,
  id: ProjectId.make("buddy"),
  workspaceRoot: "/home/person/Buddy",
};
const buddyThread = { ...v2ThreadShell, id: ThreadId.make("buddy"), projectId: buddyProject.id };
const buddyChild = {
  ...buddyThread,
  id: ThreadId.make("buddy-child"),
  projectId: v2ThreadShell.projectId,
  lineage: {
    ...buddyThread.lineage,
    parentThreadId: buddyThread.id,
    relationshipToParent: "subagent" as const,
  },
};

function makeHarness() {
  const snapshotAtom = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<OrchestrationV2ShellSnapshot | null>({
      ...v2ShellSnapshot,
      projects: [v2Project, buddyProject],
      threads: [v2ThreadShell, buddyThread, buddyChild],
    }),
  );
  const configAtom = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<Pick<ServerConfig, "scratchWorkspaceRoot" | "lazurioBuddyFolder"> | null>(null),
  );
  const catalogValueAtom = Atom.make({
    isReady: true,
    entries: new Map([
      [
        environmentId,
        {
          target: new PrimaryConnectionTarget({
            environmentId,
            label: "Environment",
            httpBaseUrl: "https://example.test",
            wsBaseUrl: "wss://example.test",
          }),
          profile: Option.none(),
          enabled: true,
        },
      ],
    ]),
  });
  const projects = createEnvironmentProjectAtoms({
    catalogValueAtom,
    snapshotAtom,
    serverConfigValueAtom: configAtom,
  });
  const threads = createEnvironmentThreadShellAtoms({
    catalogValueAtom,
    snapshotAtom,
    hiddenThreadTagsAtom: () => Atom.make(null),
    unlistedProjectIdsAtom: projects.unlistedProjectIdsAtom,
  });
  return { registry: AtomRegistry.make(), projects, threads, configAtom };
}

describe("Buddy's project in a managed Environment", () => {
  it("stays out of project and thread lists, with its subagents, and still opens", () => {
    const { registry, projects, threads, configAtom } = makeHarness();
    try {
      const ids = (list: ReadonlyArray<{ readonly id: string }>) => list.map(({ id }) => id);
      const ref = { environmentId, projectId: buddyProject.id };
      // Without a declared Buddy folder it is listed as upstream lists it.
      expect(ids(registry.get(projects.projectsAtom))).toEqual([v2Project.id, buddyProject.id]);
      expect(registry.get(threads.navigationThreadShellsAtom)).toHaveLength(2);

      registry.set(configAtom(environmentId), { lazurioBuddyFolder: buddyProject.workspaceRoot });
      expect(ids(registry.get(projects.projectsAtom))).toEqual([v2Project.id]);
      expect(ids(registry.get(threads.navigationThreadShellsAtom))).toEqual([v2ThreadShell.id]);
      expect(ids(registry.get(threads.visibleThreadShellsAtom))).toEqual([v2ThreadShell.id]);
      expect(ids(registry.get(threads.quietThreadShellsAtom))).toEqual([v2ThreadShell.id]);
      // Point reads find it, and it is not tag-hidden, which the thread route keeps closed.
      expect(registry.get(projects.projectAtom(ref))?.workspaceRoot).toBe(
        buddyProject.workspaceRoot,
      );
      expect(registry.get(threads.threadShellsAtom)).toHaveLength(3);
      expect(registry.get(threads.hiddenThreadKeysAtom).size).toBe(0);
    } finally {
      registry.dispose();
    }
  });
});
