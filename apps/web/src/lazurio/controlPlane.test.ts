import { describe, expect, it } from "vite-plus/test";

import type { ThreadRightPanelState } from "~/rightPanelStore";

import {
  CONTROL_PLANE_NAME,
  controlPlaneAttachment,
  parseControlPlaneSnapshot,
  withControlPlaneOpen,
  withControlPlaneRevision,
  withControlPlaneSentence,
} from "./controlPlane";

const snapshot = (revision: string) => ({
  threadId: "thread-buddy",
  attachmentId: `buddy-0000000${revision}-0000-4000-8000-00000000000${revision}-html`,
  title: "Control Plane",
  revision,
  answers: [],
});
const a = controlPlaneAttachment(snapshot("a"));
const b = controlPlaneAttachment(snapshot("b"));
const files = { id: "files", kind: "files" } as ThreadRightPanelState["surfaces"][number];

describe("the Control Plane in the right panel", () => {
  it("reads only a snapshot whose page the asset route serves as a sandboxed document", () => {
    expect(parseControlPlaneSnapshot(snapshot("a"))).toEqual(snapshot("a"));
    expect(parseControlPlaneSnapshot({ ...snapshot("a"), attachmentId: "buddy-x" })).toBeNull();
    expect(parseControlPlaneSnapshot({ ...snapshot("a"), revision: 1 })).toBeNull();
    expect(parseControlPlaneSnapshot(null)).toBeNull();
  });

  it("reads the answers as plain label and sentence, within the server's limits", () => {
    const answer = { label: "Yes", sentence: "Example: yes" };
    const read = (answers: unknown) => parseControlPlaneSnapshot({ ...snapshot("a"), answers });
    // A snapshot without answers is shown as before.
    expect(parseControlPlaneSnapshot({ ...snapshot("a"), answers: undefined })?.answers).toEqual(
      [],
    );
    expect(read([answer, { ...answer, send: true }])?.answers).toEqual([answer, answer]);
    expect(read([{ label: "", sentence: "x" }, { label: "x" }, "x", null])?.answers).toEqual([]);
    expect(read([{ label: "a".repeat(81), sentence: "x" }])?.answers).toEqual([]);
    expect(read([{ label: "x", sentence: "é".repeat(1025) }])?.answers).toEqual([]);
    expect(read([{ label: "x", sentence: "a".repeat(2048) }])?.answers).toHaveLength(1);
    expect(read(Array.from({ length: 13 }, () => answer))?.answers).toHaveLength(12);
    expect(read("Yes")?.answers).toEqual([]);
  });

  it("puts a new revision in the open tab at its place, without opening or focusing the panel", () => {
    const opened = withControlPlaneOpen(
      { isOpen: true, activeSurfaceId: null, surfaces: [files] },
      a,
    );
    const elsewhere = { ...opened, isOpen: false, activeSurfaceId: "files" };
    const next = withControlPlaneRevision(elsewhere, b);
    expect(next.surfaces.map((surface) => surface.id)).toEqual(["files", `attachment:${b.id}`]);
    expect(next.isOpen).toBe(false);
    expect(next.activeSurfaceId).toBe("files");
    // The tab being looked at follows its new revision.
    expect(withControlPlaneRevision(opened, b).activeSurfaceId).toBe(`attachment:${b.id}`);
    // Without a tab the person opened, nothing changes.
    const none = { isOpen: false, activeSurfaceId: null, surfaces: [files] };
    expect(withControlPlaneRevision(none, b)).toBe(none);
  });

  it("opens one tab under its stable name, also when it is already there", () => {
    const once = withControlPlaneOpen({ isOpen: false, activeSurfaceId: null, surfaces: [] }, a);
    expect(once.isOpen).toBe(true);
    expect(once.activeSurfaceId).toBe(`attachment:${a.id}`);
    const again = withControlPlaneOpen({ ...once, activeSurfaceId: null }, b);
    expect(again.surfaces).toHaveLength(1);
    expect(again.activeSurfaceId).toBe(`attachment:${b.id}`);
    const surface = again.surfaces[0];
    expect(surface?.kind === "file" ? surface.relativePath : null).toBe(CONTROL_PLANE_NAME);
  });
});

describe("a Control Plane answer's sentence in the composer", () => {
  it("replaces only its own untouched sentence, never the person's words", () => {
    const first = withControlPlaneSentence("", null, "A: yes");
    expect(first.prompt).toBe("A: yes");
    // Untouched: the next answer takes its place.
    expect(withControlPlaneSentence(first.prompt, first, "A: no").prompt).toBe("A: no");
    // After the person's own words, on its own line; then replaced there.
    const after = withControlPlaneSentence("Please also check", null, "A: yes");
    expect(after.prompt).toBe("Please also check\nA: yes");
    expect(withControlPlaneSentence(after.prompt, after, "A: no").prompt).toBe(
      "Please also check\nA: no",
    );
    // The person edited it ("yes" to "yesterday"): their text stays, the answer follows.
    expect(withControlPlaneSentence("A: yesterday", first, "A: no").prompt).toBe(
      "A: yesterday\nA: no",
    );
    // The person wrote "yes", an answer added "yes", the person deleted the added line: their own
    // "yes" stays, the answer follows it.
    const added = withControlPlaneSentence("yes", null, "yes");
    expect(added.prompt).toBe("yes\nyes");
    expect(withControlPlaneSentence("yes", added, "no").prompt).toBe("yes\nno");
    // The same phrase typed again by the person is not taken for the inserted one.
    expect(withControlPlaneSentence("A: yes\nA: yes", first, "A: no").prompt).toBe(
      "A: yes\nA: yes\nA: no",
    );
  });
});
