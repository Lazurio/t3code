import { useAtomValue } from "@effect/atom-react";
import {
  type ArchivedSnapshotEntry,
  createArchivedThreadSnapshotsAtomFamily,
  makeArchivedThreadsEnvironmentKey,
} from "@t3tools/client-runtime/state/threads";
import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { environmentCatalog } from "../connection/catalog";

import { orchestrationEnvironment } from "../state/orchestration";
import { serverEnvironment } from "../state/server";
import { environmentProjects } from "../state/projects";
import { environmentThreadShells } from "../state/threads";
import { appAtomRegistry } from "../rpc/atomRegistry";

function archivedSnapshotAtom(environmentId: EnvironmentId) {
  return orchestrationEnvironment.archivedShellSnapshot({
    environmentId,
    input: {},
  });
}

const archivedSnapshotsAtom = createArchivedThreadSnapshotsAtomFamily({
  getSnapshotAtom: archivedSnapshotAtom,
  hiddenThreadTagsAtom: serverEnvironment.hiddenThreadTagsAtom,
  // Lazurio overlay (LZD-0033): live and archived threads of Buddy's project stay out too.
  hiddenThreadKeysAtom: environmentThreadShells.listHiddenThreadKeysAtom,
  liveThreadRefsAtom: environmentThreadShells.threadRefsAtom,
  anyEnvironmentHidingAtom: environmentThreadShells.anyEnvironmentHidingAtom,
  unlistedProjectIdsAtom: environmentProjects.unlistedProjectIdsAtom,
  unlistedEnvironmentIdsAtom: Atom.make((get) =>
    Array.from(enabledEnvironmentIds(get(environmentCatalog.catalogValueAtom))).filter(
      (environmentId) => get(environmentProjects.unlistedProjectIdsAtom(environmentId)).size > 0,
    ),
  ),
  labelPrefix: "web:archived-thread-snapshots",
});

export function refreshArchivedThreadsForEnvironment(environmentId: EnvironmentId): void {
  appAtomRegistry.refresh(archivedSnapshotAtom(environmentId));
}

export function useArchivedThreadSnapshots(environmentIds: ReadonlyArray<EnvironmentId>): {
  readonly snapshots: ReadonlyArray<ArchivedSnapshotEntry>;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly refresh: () => void;
} {
  const environmentKey = makeArchivedThreadsEnvironmentKey(environmentIds);
  const result = useAtomValue(archivedSnapshotsAtom(environmentKey));
  const refresh = () => {
    for (const environmentId of environmentIds) {
      appAtomRegistry.refresh(archivedSnapshotAtom(environmentId));
    }
  };

  return {
    ...result,
    refresh,
  };
}
