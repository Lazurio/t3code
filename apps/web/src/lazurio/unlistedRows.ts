import type { ProjectId } from "@t3tools/contracts";

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
