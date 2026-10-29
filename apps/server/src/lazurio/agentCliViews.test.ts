import {
  EnvironmentId,
  NodeId,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2TurnItem,
  type OrchestratorMcpThreadListItem,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import { formatThreadLink } from "@t3tools/shared/threadLinks";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import * as McpToolAccessTestkit from "../mcp/McpToolAccess.testkit.ts";
import { makeEventTracker, mergeThreadLists, pendingRequestsOf } from "./agentCliViews.ts";

const at = (iso: string) => DateTime.makeUnsafe(iso);
const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const NOW = at("2026-10-20T12:00:00.000Z").epochMilliseconds;

const listItem = (threadId: string, updatedAt: string): OrchestratorMcpThreadListItem => ({
  threadId: ThreadId.make(threadId),
  projectId: ProjectId.make("project-lazurio"),
  title: threadId,
  createdBy: "user",
  creationSource: "web",
  status: "running",
  latestRunId: null,
  providerInstanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5",
  runtimeMode: "full-access",
  interactionMode: "default",
  linkedPullRequest: null,
  settled: false,
  settledAt: null,
  snoozed: false,
  snoozedUntil: null,
  parentThreadId: null,
  relationshipToParent: null,
  itemCount: 0,
  createdAt: updatedAt,
  updatedAt,
});

describe("mergeThreadLists", () => {
  it("puts every project's threads in one list, newest change first, and counts them all", () => {
    const lazurio = { id: "project-lazurio", title: "Lazurio" };
    const web = { id: "project-web", title: "web-app" };
    const merged = mergeThreadLists(
      [
        {
          project: lazurio,
          page: {
            projectId: ProjectId.make(lazurio.id),
            currentThreadId: null,
            threads: [
              listItem("a-newest", "2026-10-20T11:00:00.000Z"),
              listItem("a-old", "2026-10-18T09:00:00.000Z"),
            ],
            nextCursor: 2,
            total: 5,
          },
        },
        {
          project: web,
          page: {
            projectId: ProjectId.make(web.id),
            currentThreadId: null,
            threads: [listItem("b-middle", "2026-10-19T10:00:00.000Z")],
            nextCursor: null,
            total: 1,
          },
        },
      ],
      2,
    );
    assert.deepStrictEqual(
      merged.threads.map((thread) => [thread.threadId, thread.projectTitle]),
      [
        ["a-newest", "Lazurio"],
        ["b-middle", "web-app"],
      ],
    );
    assert.strictEqual(merged.threads[0]?.projectId, "project-lazurio");
    assert.strictEqual(merged.total, 6);
  });
});

const threadShell = (
  id: string,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell => ({
  ...McpToolAccessTestkit.liveThreadShell(ThreadId.make(id)),
  title: id,
  updatedAt: at("2026-10-20T10:00:00.000Z"),
  ...overrides,
});

const runtimeRequest = (
  id: string,
  kind: OrchestrationV2RuntimeRequest["kind"],
  overrides: Partial<OrchestrationV2RuntimeRequest> = {},
): OrchestrationV2RuntimeRequest => ({
  id: RuntimeRequestId.make(id),
  nodeId: NodeId.make("node-1"),
  providerTurnId: null,
  nativeRequestRef: null,
  kind,
  status: "pending",
  responseCapability: { type: "live", providerSessionId: ProviderSessionId.make("session-1") },
  createdAt: at("2026-10-20T10:00:00.000Z"),
  resolvedAt: null,
  ...overrides,
});

const itemBase = (threadId: string, id: string) => ({
  id: TurnItemId.make(id),
  threadId: ThreadId.make(threadId),
  runId: RunId.make("run-1"),
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 1,
  status: "waiting" as const,
  title: null,
  startedAt: null,
  completedAt: null,
  updatedAt: at("2026-10-20T10:00:00.000Z"),
});

describe("pendingRequestsOf", () => {
  const base = McpToolAccessTestkit.idleThreadProjection(threadShell("thread-1"));
  const question: OrchestrationV2TurnItem = {
    ...itemBase("thread-1", "item-question"),
    type: "user_input_request",
    requestId: RuntimeRequestId.make("request-question"),
    questions: [{ id: "q1", header: "Deploy", question: "Deploy now?", options: [] }],
  };
  const approval: OrchestrationV2TurnItem = {
    ...itemBase("thread-1", "item-approval"),
    type: "approval_request",
    requestId: RuntimeRequestId.make("request-approval"),
    requestKind: "command",
    prompt: "rm -rf build",
  };

  it("lists pending questions and approvals with what answering them takes", () => {
    const { requests, complete } = pendingRequestsOf({
      ...base,
      runtimeRequests: [
        runtimeRequest("request-question", "user_input"),
        runtimeRequest("request-approval", "command"),
        // Neither a question nor an approval, and an answered one: not the person's to decide.
        runtimeRequest("request-tool", "dynamic_tool_call"),
        runtimeRequest("request-done", "command", { status: "resolved" }),
      ],
      turnItems: [question, approval],
    });
    assert.isTrue(complete);
    assert.deepStrictEqual(
      requests.map((request) => [request.requestId, request.type, request.kind]),
      [
        ["request-question", "question", "user_input"],
        ["request-approval", "approval", "command"],
      ],
    );
    assert.deepStrictEqual(requests[0]?.questions, [
      { id: "q1", header: "Deploy", question: "Deploy now?", options: [] },
    ]);
    assert.strictEqual(requests[1]?.prompt, "rm -rf build");
    // Without the provider's own choices, the decisions the web's card offers.
    assert.deepStrictEqual(requests[1]?.decisions, [
      "cancel",
      "decline",
      "acceptForSession",
      "accept",
    ]);
    assert.isTrue(requests[1]?.answerable);
  });

  it("offers only the provider's decisions, and says when an answer can no longer arrive", () => {
    const { requests } = pendingRequestsOf({
      ...base,
      runtimeRequests: [
        runtimeRequest("request-approval", "command", {
          responseCapability: { type: "not_resumable", reason: "The provider restarted." },
        }),
      ],
      turnItems: [
        {
          ...approval,
          options: [
            { decision: "accept", label: "Yes" },
            { decision: "decline", label: "No" },
          ],
        },
      ],
    });
    assert.deepStrictEqual(requests[0]?.decisions, ["accept", "decline"]);
    assert.isFalse(requests[0]?.answerable);
  });

  it("is incomplete when a request's details lie outside the timeline it got", () => {
    const { requests, complete } = pendingRequestsOf({
      ...base,
      runtimeRequests: [runtimeRequest("request-approval", "file-change")],
      turnItems: [],
    });
    assert.isFalse(complete);
    assert.strictEqual(requests[0]?.type, "approval");
  });
});

describe("makeEventTracker", () => {
  const snapshot = (sequence: number, threads: ReadonlyArray<OrchestrationV2ThreadShell>) => ({
    kind: "snapshot" as const,
    snapshot: {
      schemaVersion: 1,
      snapshotSequence: sequence,
      projects: [
        {
          id: ProjectId.make("project:mcp-test"),
          title: "Lazurio",
          workspaceRoot: "/lazurio",
          defaultModelSelection: null,
          scripts: [],
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
      ],
      threads,
      archivedThreads: [],
    },
  });

  it("prints every thread once, then only the changes an agent cares about", () => {
    const tracker = makeEventTracker({ environmentId: ENVIRONMENT_ID, subagents: false });
    const running = threadShell("thread-1");
    const child = threadShell("thread-child", {
      lineage: {
        rootThreadId: ThreadId.make("thread-1"),
        parentThreadId: ThreadId.make("thread-1"),
        relationshipToParent: "subagent",
      },
    });
    const initial = tracker.apply(snapshot(10, [running, child]) as never, NOW);
    assert.deepStrictEqual(
      initial.map(
        (line) => line.kind === "thread" && [line.threadId, line.status, line.projectTitle],
      ),
      [["thread-1", "running", "Lazurio"]],
    );
    assert.strictEqual(
      initial[0]?.kind === "thread" && initial[0].link,
      formatThreadLink({ environmentId: ENVIRONMENT_ID, threadId: ThreadId.make("thread-1") }),
    );
    assert.deepStrictEqual(tracker.apply({ kind: "synchronized" }, NOW), [
      { kind: "synced", sequence: 10 },
    ]);

    // Streaming output only grows the item count: no line.
    assert.deepStrictEqual(
      tracker.apply(
        {
          kind: "thread.updated",
          sequence: 11,
          location: "active",
          thread: { ...running, itemCount: 9 },
        },
        NOW,
      ),
      [],
    );
    const waiting = tracker.apply(
      {
        kind: "thread.updated",
        sequence: 12,
        location: "active",
        thread: {
          ...running,
          activityRunStatus: "waiting",
          pendingRuntimeRequest: {
            id: RuntimeRequestId.make("request-approval"),
            kind: "command",
            createdAt: at("2026-10-20T11:00:00.000Z"),
          },
        },
      },
      NOW,
    );
    assert.strictEqual(waiting.length, 1);
    const line = waiting[0];
    assert.isTrue(line?.kind === "thread");
    if (line?.kind === "thread") {
      assert.strictEqual(line.status, "waiting");
      assert.strictEqual(line.sequence, 12);
      assert.deepStrictEqual(line.pendingRequest, {
        requestId: "request-approval",
        kind: "command",
        type: "approval",
      });
    }
    const archived = tracker.apply(
      { kind: "thread.updated", sequence: 13, location: "archive", thread: running },
      NOW,
    );
    assert.isTrue(archived[0]?.kind === "thread" && archived[0].archived);
    assert.deepStrictEqual(
      tracker.apply(
        { kind: "thread.removed", sequence: 14, location: "archive", threadId: running.id },
        NOW,
      ),
      [{ kind: "thread.removed", sequence: 14, threadId: "thread-1" }],
    );
    // Resuming continues after the last sequence it saw.
    assert.strictEqual(tracker.sequence, 14);
  });

  it("keeps the threads a metadata refresh leaves out, and drops those a fresh list does", () => {
    const tracker = makeEventTracker({ environmentId: ENVIRONMENT_ID, subagents: false });
    const one = threadShell("thread-1");
    const two = threadShell("thread-2");
    tracker.apply(snapshot(10, [one, two]) as never, NOW);
    // A refresh of project metadata carries no threads; it removes none.
    assert.deepStrictEqual(
      tracker.apply(
        { ...snapshot(10, []), resolvedRepositoryIdentityRoots: ["/lazurio"] } as never,
        NOW,
      ),
      [],
    );
    // After a reconnect T3 may send a whole new list; a thread missing from it is gone.
    assert.deepStrictEqual(tracker.apply(snapshot(20, [one]) as never, NOW), [
      { kind: "thread.removed", sequence: 20, threadId: "thread-2" },
    ]);
  });

  it("follows only the project or thread asked for", () => {
    const tracker = makeEventTracker({
      environmentId: ENVIRONMENT_ID,
      subagents: true,
      threadId: "thread-2",
    });
    const lines = tracker.apply(
      snapshot(10, [threadShell("thread-1"), threadShell("thread-2")]) as never,
      NOW,
    );
    assert.deepStrictEqual(
      lines.map((line) => (line.kind === "thread" ? String(line.threadId) : line.kind)),
      ["thread-2"],
    );
  });
});
