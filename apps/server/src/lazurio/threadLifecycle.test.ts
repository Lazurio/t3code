import { describe, expect, it } from "vite-plus/test";

import { threadLifecycleEvent } from "./threadLifecycle.ts";

const threadId = "4a1f9c2e-7b3d-4e5f-8a6b-9c0d1e2f3a4b";

/** v0.0.45's orchestration events (packages/contracts/src/orchestration.ts): the thread in the payload. */
const v045 = {
  created: {
    type: "thread.created",
    payload: { threadId, projectId: "p", title: "Web", createdAt: "x", updatedAt: "x" },
  },
  renamed: { type: "thread.meta-updated", payload: { threadId, title: "Web shop" } },
  reordered: { type: "thread.meta-updated", payload: { threadId, activeOrderKey: "a0" } },
  archived: { type: "thread.archived", payload: { threadId, archivedAt: "x", updatedAt: "x" } },
  unarchived: { type: "thread.unarchived", payload: { threadId, updatedAt: "x" } },
  deleted: { type: "thread.deleted", payload: { threadId, deletedAt: "x" } },
};

/** Upstream main's orchestration v2 events (orchestrationV2.ts): the thread on the event, the
 * whole thread as the payload. */
const appThread = (title: string) => ({ id: threadId, projectId: "p", title, branch: null });
const v2 = {
  created: { type: "thread.created", threadId, payload: appThread("Web") },
  renamed: { type: "thread.metadata-updated", threadId, payload: appThread("Web shop") },
  archived: { type: "thread.archived", threadId, payload: appThread("Web shop") },
  unarchived: { type: "thread.unarchived", threadId, payload: appThread("Web shop") },
  deleted: { type: "thread.deleted", threadId, payload: appThread("Web shop") },
};

describe("the threads' lifecycle", () => {
  it("reads the same retired, restored and titled from both orchestrations", () => {
    for (const events of [v045, v2]) {
      expect(threadLifecycleEvent(events.created)).toEqual({
        type: "titled",
        threadId,
        title: "Web",
      });
      expect(threadLifecycleEvent(events.renamed)).toEqual({
        type: "titled",
        threadId,
        title: "Web shop",
      });
      expect(threadLifecycleEvent(events.archived)).toEqual({ type: "retired", threadId });
      expect(threadLifecycleEvent(events.deleted)).toEqual({ type: "retired", threadId });
      expect(threadLifecycleEvent(events.unarchived)).toEqual({ type: "restored", threadId });
    }
  });

  it("ignores every other event, and one without a thread or a title", () => {
    expect(threadLifecycleEvent(v045.reordered)).toBeNull();
    expect(
      threadLifecycleEvent({ type: "thread.turn-start-requested", payload: { threadId } }),
    ).toBeNull();
    expect(threadLifecycleEvent({ type: "run.created", threadId, payload: {} })).toBeNull();
    expect(threadLifecycleEvent({ type: "thread.archived", payload: {} })).toBeNull();
    expect(
      threadLifecycleEvent({ type: "thread.created", payload: { threadId, title: " " } }),
    ).toBeNull();
  });
});
