import {
  EnvironmentId,
  ProjectId,
  type ServerConfig,
  ThreadId,
  type OrchestrationV2ArchivedShellSnapshot,
  type OrchestrationV2ShellSnapshot,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { PrimaryConnectionTarget } from "../connection/model.ts";
import { v2Project, v2ShellSnapshot, v2ThreadShell } from "../state/orchestrationV2TestFixtures.ts";
import {
  createArchivedThreadSnapshotsAtomFamily,
  makeArchivedThreadsEnvironmentKey,
} from "../state/archivedThreads.ts";
import { threadKey } from "../state/entities.ts";
import { createEnvironmentProjectAtoms } from "../state/projectEntities.ts";
import { createEnvironmentThreadShellAtoms } from "../state/threadShell.ts";

const environmentId = EnvironmentId.make("local");
const remoteEnvironmentId = EnvironmentId.make("remote");
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

// A task another environment runs for Buddy's thread.
const remoteTask = {
  ...v2ThreadShell,
  id: ThreadId.make("remote-task"),
  delegatedFrom: { environmentId, threadId: buddyThread.id, title: "Buddy" },
};

function makeHarness() {
  const snapshotAtom = Atom.family((id: EnvironmentId) =>
    Atom.make<OrchestrationV2ShellSnapshot | null>(
      id === environmentId
        ? {
            ...v2ShellSnapshot,
            projects: [v2Project, buddyProject],
            threads: [v2ThreadShell, buddyThread, buddyChild],
          }
        : { ...v2ShellSnapshot, projects: [v2Project], threads: [remoteTask] },
    ),
  );
  const configAtom = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<Pick<ServerConfig, "scratchWorkspaceRoot" | "lazurioBuddyFolder"> | null>(null),
  );
  const catalogValueAtom = Atom.make({
    isReady: true,
    entries: new Map(
      [environmentId, remoteEnvironmentId].map((id) => [
        id,
        {
          target: new PrimaryConnectionTarget({
            environmentId: id,
            label: id,
            httpBaseUrl: `https://${id}.example.test`,
            wsBaseUrl: `wss://${id}.example.test`,
          }),
          profile: Option.none(),
          enabled: true,
        },
      ]),
    ),
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
      expect(ids(registry.get(projects.projectsAtom))).toEqual([
        v2Project.id,
        buddyProject.id,
        v2Project.id,
      ]);
      expect(ids(registry.get(threads.visibleThreadShellsAtom))).toHaveLength(4);

      registry.set(configAtom(environmentId), { lazurioBuddyFolder: buddyProject.workspaceRoot });
      expect(ids(registry.get(projects.projectsAtom))).toEqual([v2Project.id, v2Project.id]);
      // Its subagent and the task another environment runs for it leave the lists too.
      expect(ids(registry.get(threads.navigationThreadShellsAtom))).toEqual([v2ThreadShell.id]);
      expect(ids(registry.get(threads.visibleThreadShellsAtom))).toEqual([v2ThreadShell.id]);
      expect(ids(registry.get(threads.quietThreadShellsAtom))).toEqual([v2ThreadShell.id]);
      // Linked-thread rows of a pull request read the same set.
      expect([...registry.get(threads.listHiddenThreadKeysAtom)].toSorted()).toEqual(
        [
          threadKey({ environmentId, threadId: buddyThread.id }),
          threadKey({ environmentId, threadId: buddyChild.id }),
          threadKey({ environmentId: remoteEnvironmentId, threadId: remoteTask.id }),
        ].toSorted(),
      );
      // Point reads find it, and it is not tag-hidden, which the thread route keeps closed.
      expect(registry.get(projects.projectAtom(ref))?.workspaceRoot).toBe(
        buddyProject.workspaceRoot,
      );
      expect(registry.get(threads.threadShellsAtom)).toHaveLength(4);
      expect(registry.get(threads.hiddenThreadKeysAtom).size).toBe(0);
    } finally {
      registry.dispose();
    }
  });

  it("stays out of the archive, with archived children of its live thread", () => {
    const { registry, projects, threads, configAtom } = makeHarness();
    const archivedBuddy = { ...buddyThread, id: ThreadId.make("archived-buddy") };
    const archivedChild = {
      ...buddyChild,
      id: ThreadId.make("archived-child"),
      lineage: { ...buddyChild.lineage, parentThreadId: buddyThread.id },
    };
    const archivedOther = { ...v2ThreadShell, id: ThreadId.make("archived-other") };
    const archive = createArchivedThreadSnapshotsAtomFamily<Error>({
      getSnapshotAtom: () =>
        Atom.make(
          AsyncResult.success<OrchestrationV2ArchivedShellSnapshot, Error>({
            schemaVersion: 1,
            snapshotSequence: 1,
            projects: [v2Project, buddyProject],
            threads: [archivedBuddy, archivedChild, archivedOther],
          }),
        ),
      hiddenThreadTagsAtom: () => Atom.make(null),
      hiddenThreadKeysAtom: threads.listHiddenThreadKeysAtom,
      liveThreadRefsAtom: threads.threadRefsAtom,
      anyEnvironmentHidingAtom: threads.anyEnvironmentHidingAtom,
      unlistedProjectIdsAtom: projects.unlistedProjectIdsAtom,
      labelPrefix: "test:unlisted-archive",
    });
    try {
      registry.set(configAtom(environmentId), { lazurioBuddyFolder: buddyProject.workspaceRoot });
      const [entry] = registry.get(
        archive(makeArchivedThreadsEnvironmentKey([environmentId])),
      ).snapshots;
      expect(entry?.snapshot.threads.map(({ id }) => id)).toEqual([archivedOther.id]);
    } finally {
      registry.dispose();
    }
  });

  it("keeps a task archived elsewhere out when its archived Buddy parent is in another archive", () => {
    const { registry, projects, threads, configAtom } = makeHarness();
    const archivedBuddy = { ...buddyThread, id: ThreadId.make("archived-buddy") };
    const archivedTask = {
      ...v2ThreadShell,
      id: ThreadId.make("archived-remote-task"),
      delegatedFrom: { environmentId, threadId: archivedBuddy.id, title: "Buddy" },
    };
    const archivedRemote = { ...v2ThreadShell, id: ThreadId.make("archived-remote") };
    const page = (
      threadsOnPage: OrchestrationV2ArchivedShellSnapshot["threads"],
    ): OrchestrationV2ArchivedShellSnapshot => ({
      schemaVersion: 1,
      snapshotSequence: 1,
      projects: [v2Project, buddyProject],
      threads: threadsOnPage,
    });
    const archive = createArchivedThreadSnapshotsAtomFamily<Error>({
      getSnapshotAtom: (id) =>
        Atom.make(
          AsyncResult.success<OrchestrationV2ArchivedShellSnapshot, Error>(
            id === environmentId ? page([archivedBuddy]) : page([archivedTask, archivedRemote]),
          ),
        ),
      hiddenThreadTagsAtom: () => Atom.make(null),
      hiddenThreadKeysAtom: threads.listHiddenThreadKeysAtom,
      liveThreadRefsAtom: threads.threadRefsAtom,
      anyEnvironmentHidingAtom: threads.anyEnvironmentHidingAtom,
      unlistedProjectIdsAtom: projects.unlistedProjectIdsAtom,
      unlistedEnvironmentIdsAtom: Atom.make([environmentId]),
      labelPrefix: "test:unlisted-archive-elsewhere",
    });
    try {
      registry.set(configAtom(environmentId), { lazurioBuddyFolder: buddyProject.workspaceRoot });
      // Scoped to the remote environment only, with no tag filter anywhere.
      expect(registry.get(threads.anyEnvironmentHidingAtom)).toBe(false);
      const { snapshots } = registry.get(
        archive(makeArchivedThreadsEnvironmentKey([remoteEnvironmentId])),
      );
      expect(snapshots.map(({ environmentId: id }) => id)).toEqual([remoteEnvironmentId]);
      expect(snapshots[0]?.snapshot.threads.map(({ id }) => id)).toEqual([archivedRemote.id]);
    } finally {
      registry.dispose();
    }
  });
});
