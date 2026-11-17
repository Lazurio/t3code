import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { listedLinkedRows } from "./unlistedRows";

describe("a pull request's linked threads in a managed Environment", () => {
  it("leave out Buddy's threads, archived ones too", () => {
    const buddy = ProjectId.make("buddy");
    const lazurio = ProjectId.make("lazurio");
    const rows = [
      { id: ThreadId.make("chat"), projectId: lazurio, archivedAt: null },
      { id: ThreadId.make("buddy-live"), projectId: buddy, archivedAt: null },
      { id: ThreadId.make("buddy-archived"), projectId: buddy, archivedAt: "2026-11-17T12:00:00Z" },
    ];
    expect(listedLinkedRows(rows, new Set([buddy])).map(({ id }) => id)).toEqual(["chat"]);
    expect(listedLinkedRows(rows, new Set())).toBe(rows);
  });
});
