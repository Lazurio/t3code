import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { environmentProjects } from "../state/projects";

const NO_PROJECTS = Atom.make((): ReadonlySet<ProjectId> => new Set()).pipe(
  Atom.withLabel("lazurio-no-unlisted-projects"),
);

/** Buddy's project in `environmentId`, the one pull request rows leave out; none without one. */
export function useLinkedUnlistedProjectIds(
  environmentId: EnvironmentId | null,
): ReadonlySet<ProjectId> {
  return useAtomValue(
    environmentId === null
      ? NO_PROJECTS
      : environmentProjects.unlistedProjectIdsAtom(environmentId),
  );
}

/**
 * Lazurio overlay (LZD-0033): a pull request's linked-thread rows without the threads of Buddy's
 * project, archived ones too. The rows carry their project, the live shell does not hold them.
 */
export function listedLinkedRows<Row extends { readonly projectId: ProjectId }>(
  rows: ReadonlyArray<Row>,
  unlistedProjectIds: ReadonlySet<ProjectId>,
): ReadonlyArray<Row> {
  return unlistedProjectIds.size === 0
    ? rows
    : rows.filter((row) => !unlistedProjectIds.has(row.projectId));
}
