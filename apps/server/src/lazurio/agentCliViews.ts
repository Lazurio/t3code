/**
 * Lazurio overlay (plan DEV-6676): what the agent commands make of T3's answers, apart from the
 * commands so it is tested without a server. A thread in a list or an event is the item
 * `t3_thread_list` returns, from the same mapping, so an agent learns one shape.
 */
import {
  type EnvironmentId,
  type OrchestrationV2ShellStreamItem,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  type OrchestratorMcpThreadListItem,
  type OrchestratorMcpThreadListResult,
  type ProviderApprovalDecision,
  ProviderRequestKind,
  type ProviderApprovalOption,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { listItemFromShell } from "../mcp/OrchestratorMcpService.ts";

/** Threads across projects, newest change first, with the project each belongs to. */
export const mergeThreadLists = (
  pages: ReadonlyArray<{
    readonly project: { readonly id: string; readonly title: string };
    readonly page: OrchestratorMcpThreadListResult;
  }>,
  limit: number,
) => ({
  threads: pages
    .flatMap(({ project, page }) =>
      page.threads.map((thread) => ({
        ...thread,
        projectId: project.id,
        projectTitle: project.title,
      })),
    )
    .toSorted(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.threadId.localeCompare(right.threadId),
    )
    .slice(0, limit),
  /** Every matching thread, beyond the ones listed. */
  total: pages.reduce((sum, { page }) => sum + page.total, 0),
});

const isApprovalKind = (kind: string): kind is ProviderRequestKind =>
  (ProviderRequestKind.literals as ReadonlyArray<string>).includes(kind);

/** What the web's approval card offers when the provider names no choices of its own. */
const DEFAULT_APPROVAL_DECISIONS: ReadonlyArray<ProviderApprovalDecision> = [
  "cancel",
  "decline",
  "acceptForSession",
  "accept",
];

/** A question or a permission request a thread waits on, with what answering it needs. */
export interface PendingRequest {
  readonly requestId: string;
  readonly threadId: string;
  readonly projectId: string;
  readonly threadTitle: string;
  readonly type: "question" | "approval";
  /** `user_input` for a question; for an approval what it asks for, such as `command`. */
  readonly kind: string;
  readonly createdAt: string;
  /** False when the provider can no longer take an answer, for example after a restart. */
  readonly answerable: boolean;
  /** Approvals: what the agent asks to do. */
  readonly prompt?: string;
  readonly appName?: string;
  /** Approvals: the decisions the person may choose, as the web offers them. */
  readonly decisions?: ReadonlyArray<ProviderApprovalDecision>;
  readonly options?: ReadonlyArray<ProviderApprovalOption>;
  /** Questions: what the agent asks, answered by question id. */
  readonly questions?: ReadonlyArray<unknown>;
}

/**
 * The pending questions and approvals of one thread, from its control state. `complete` is false
 * when the details of a request lie outside the projection's timeline window, so the caller reads
 * the whole thread.
 */
export const pendingRequestsOf = (projection: OrchestrationV2ThreadProjection) => {
  const items = new Map<string, OrchestrationV2ThreadProjection["turnItems"][number]>();
  for (const item of projection.turnItems) {
    if (item.type === "approval_request" || item.type === "user_input_request") {
      items.set(item.requestId, item);
    }
  }
  let complete = true;
  const requests: Array<PendingRequest> = [];
  for (const request of projection.runtimeRequests) {
    if (request.status !== "pending") continue;
    const type =
      request.kind === "user_input" ? "question" : isApprovalKind(request.kind) ? "approval" : null;
    if (type === null) continue;
    const item = items.get(request.id);
    if (item === undefined) complete = false;
    requests.push({
      requestId: request.id,
      threadId: projection.thread.id,
      projectId: projection.thread.projectId,
      threadTitle: projection.thread.title,
      type,
      kind: request.kind,
      createdAt: DateTime.formatIso(request.createdAt),
      answerable: request.responseCapability.type !== "not_resumable",
      ...(item?.type === "approval_request"
        ? {
            ...(item.prompt === undefined ? {} : { prompt: item.prompt }),
            ...(item.appName === undefined ? {} : { appName: item.appName }),
            decisions: item.options?.map((option) => option.decision) ?? DEFAULT_APPROVAL_DECISIONS,
            ...(item.options === undefined ? {} : { options: item.options }),
          }
        : type === "approval"
          ? { decisions: DEFAULT_APPROVAL_DECISIONS }
          : {}),
      ...(item?.type === "user_input_request" ? { questions: item.questions } : {}),
    });
  }
  return { requests, complete };
};

/** What a thread's pending request is, from its shell: enough to see that it waits on someone. */
const pendingRequestSummary = (shell: OrchestrationV2ThreadShell) =>
  shell.pendingRuntimeRequest === null
    ? null
    : {
        requestId: shell.pendingRuntimeRequest.id,
        kind: shell.pendingRuntimeRequest.kind,
        type:
          shell.pendingRuntimeRequest.kind === "user_input"
            ? ("question" as const)
            : isApprovalKind(shell.pendingRuntimeRequest.kind)
              ? ("approval" as const)
              : ("other" as const),
      };

/** One line of `t3 events`: a thread's state as `t3_thread_list` shows it, and where it stands. */
export type ThreadEventLine = OrchestratorMcpThreadListItem & {
  readonly kind: "thread";
  readonly sequence: number;
  readonly projectId: string;
  readonly projectTitle: string | null;
  readonly archived: boolean;
  readonly pendingRequest: ReturnType<typeof pendingRequestSummary>;
  readonly lastError: string | null;
};

export type EventLine =
  | ThreadEventLine
  | { readonly kind: "thread.removed"; readonly sequence: number; readonly threadId: string }
  | { readonly kind: "synced"; readonly sequence: number | null };

/** The fields whose change is news to an agent; streaming output alone does not print a line. */
const fingerprint = (line: ThreadEventLine) =>
  [
    line.status,
    line.pendingRequest?.requestId ?? "",
    line.title,
    line.settled,
    line.snoozed,
    line.archived,
    line.latestRunId ?? "",
    line.lastError ?? "",
  ].join("\u0000");

/**
 * Turns the shell stream into `t3 events` lines: every thread once when the stream starts, then a
 * line when one changes in a way an agent cares about, or leaves the list. It remembers the last
 * sequence so a reconnect resumes where it stopped.
 */
export const makeEventTracker = (filter: {
  /** The Environment the threads live in, for each thread's `t3-thread://` link. */
  readonly environmentId: EnvironmentId;
  readonly projectId?: string | undefined;
  readonly threadId?: string | undefined;
  readonly subagents: boolean;
}) => {
  const printed = new Map<string, string>();
  const projectTitles = new Map<string, string>();
  let sequence: number | null = null;
  const follows = (shell: OrchestrationV2ThreadShell) =>
    (filter.projectId === undefined || shell.projectId === filter.projectId) &&
    (filter.threadId === undefined || shell.id === filter.threadId) &&
    // A side chat belongs to its parent's view, as in `t3 thread list --subagents`.
    (filter.subagents ? shell.lineage.sideChat !== true : shell.lineage.parentThreadId === null);
  const threadLine = (
    shell: OrchestrationV2ThreadShell,
    archived: boolean,
    at: number,
    nowMs: number,
  ): ReadonlyArray<EventLine> => {
    if (!follows(shell)) return [];
    const line: ThreadEventLine = {
      kind: "thread",
      sequence: at,
      ...listItemFromShell(
        { environmentId: filter.environmentId, client: undefined },
        shell,
        nowMs,
      ),
      projectId: shell.projectId,
      projectTitle: projectTitles.get(shell.projectId) ?? null,
      archived,
      pendingRequest: pendingRequestSummary(shell),
      lastError: shell.lastError ?? null,
    };
    const next = fingerprint(line);
    if (printed.get(shell.id) === next) return [];
    printed.set(shell.id, next);
    return [line];
  };
  const removed = (threadId: string, at: number): ReadonlyArray<EventLine> =>
    printed.delete(threadId) ? [{ kind: "thread.removed", sequence: at, threadId }] : [];

  return {
    /** The last sequence seen, to resume after. */
    get sequence() {
      return sequence;
    },
    apply: (item: OrchestrationV2ShellStreamItem, nowMs: number): ReadonlyArray<EventLine> => {
      switch (item.kind) {
        case "snapshot": {
          for (const project of item.snapshot.projects)
            projectTitles.set(project.id, project.title);
          // A frame with resolved roots only refreshes project metadata; its thread list is empty.
          if (item.resolvedRepositoryIdentityRoots !== undefined) return [];
          const at = item.snapshot.snapshotSequence;
          sequence = at;
          const present = new Set(item.snapshot.threads.map((thread) => String(thread.id)));
          return [
            ...item.snapshot.threads.flatMap((thread) => threadLine(thread, false, at, nowMs)),
            ...[...printed.keys()]
              .filter((threadId) => !present.has(threadId))
              .flatMap((threadId) => removed(threadId, at)),
          ];
        }
        case "project.updated":
          sequence = item.sequence;
          projectTitles.set(item.project.id, item.project.title);
          return [];
        case "project.removed":
          sequence = item.sequence;
          projectTitles.delete(item.projectId);
          return [];
        case "thread.updated":
          sequence = item.sequence;
          return threadLine(item.thread, item.location === "archive", item.sequence, nowMs);
        case "thread.removed":
          sequence = item.sequence;
          return removed(item.threadId, item.sequence);
        case "synchronized":
          return [{ kind: "synced", sequence }];
      }
    },
  };
};
