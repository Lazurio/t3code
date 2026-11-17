/**
 * Lazurio overlay (LZD-0033): Buddy's project, over the Buddy folder a managed Environment declares
 * (`lazurioBuddyFolder`), is Lazurio's own. Lists leave it and its threads out; point reads, and so
 * a link to one of its threads, still find them. Tag-hidden threads stay closed, these do not.
 */
import type { EnvironmentId, OrchestrationV2ThreadShell, ProjectId } from "@t3tools/contracts";

import { threadKey } from "../state/entities.ts";
import { hiddenThreadKeys, NO_HIDDEN_THREADS } from "../state/threadTagFilter.ts";

const NO_UNLISTED_PROJECTS: ReadonlySet<ProjectId> = new Set();

/** The projects lists leave out: the one over the declared Buddy folder, if any. */
export function unlistedProjectIds(
  projects: ReadonlyArray<{ readonly id: ProjectId; readonly workspaceRoot: string }>,
  buddyFolder: string | undefined,
): ReadonlySet<ProjectId> {
  if (buddyFolder === undefined) return NO_UNLISTED_PROJECTS;
  const ids = projects.flatMap((project) =>
    project.workspaceRoot === buddyFolder ? [project.id] : [],
  );
  return ids.length === 0 ? NO_UNLISTED_PROJECTS : new Set(ids);
}

const sameKeys = <K>(a: ReadonlySet<K>, b: ReadonlySet<K>) =>
  a === b || (a.size === b.size && [...a].every((key) => b.has(key)));
export const sameProjectIds = (a: ReadonlySet<ProjectId>, b: ReadonlySet<ProjectId>) =>
  sameKeys(a, b);
export const sameThreadKeys = (a: ReadonlySet<string>, b: ReadonlySet<string>) => sameKeys(a, b);

/** Keys of threads in unlisted projects, with the subagents, side chats and tasks under them. */
export function unlistedThreadKeys(
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly projectIds: ReadonlySet<ProjectId>;
    readonly threads: ReadonlyArray<
      Pick<OrchestrationV2ThreadShell, "id" | "projectId" | "lineage" | "tags" | "delegatedFrom">
    >;
  }>,
): ReadonlySet<string> {
  const inProjects = new Set<string>();
  for (const { environmentId, projectIds, threads } of environments) {
    for (const thread of threads) {
      if (projectIds.has(thread.projectId))
        inProjects.add(threadKey({ environmentId, threadId: thread.id }));
    }
  }
  if (inProjects.size === 0) return NO_HIDDEN_THREADS;
  return hiddenThreadKeys(
    environments.map(({ environmentId, threads }) => ({
      environmentId,
      threads,
      hiddenTags: null,
    })),
    inProjects,
  );
}

/** What lists leave out: tag-hidden threads and unlisted ones. */
export function listHiddenKeys(
  hidden: ReadonlySet<string>,
  unlisted: ReadonlySet<string>,
): ReadonlySet<string> {
  if (unlisted.size === 0) return hidden;
  if (hidden.size === 0) return unlisted;
  return new Set([...hidden, ...unlisted]);
}
