import { describe, expect, it } from "vite-plus/test";

import type { ThreadRightPanelState } from "~/rightPanelStore";

import {
  CONTROL_PLANE_NAME,
  controlPlaneAttachment,
  parseControlPlaneSnapshot,
  withControlPlaneOpen,
  withControlPlaneRevision,
} from "./controlPlane";

const snapshot = (revision: string) => ({
  threadId: "thread-buddy",
  attachmentId: `buddy-0000000${revision}-0000-4000-8000-00000000000${revision}-html`,
  title: "Control Plane",
  revision,
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
