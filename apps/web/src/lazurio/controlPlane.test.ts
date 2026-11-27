import { describe, expect, it } from "vite-plus/test";

import type { ThreadRightPanelState } from "~/rightPanelStore";

import {
  acceptsControlPlaneDraft,
  CONTROL_PLANE_NAME,
  controlPlaneAttachment,
  parseControlPlaneDraft,
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

describe("a Control Plane page's sentence for the composer", () => {
  const request = (text: unknown, extra: Record<string, unknown> = {}) => ({
    type: "lazurio.control-plane.draft",
    v: 1,
    text,
    ...extra,
  });

  it("is read only as a sentence, never with anything that asks to send it", () => {
    expect(parseControlPlaneDraft(request("  Example: yes  "))).toBe("Example: yes");
    expect(parseControlPlaneDraft(request("Example: yes", { send: true }))).toBeNull();
    expect(parseControlPlaneDraft({ ...request("x"), v: 2 })).toBeNull();
    expect(parseControlPlaneDraft(request("   "))).toBeNull();
    expect(parseControlPlaneDraft(request("é".repeat(1025)))).toBeNull();
    expect(parseControlPlaneDraft(request("a".repeat(2048)))).toBe("a".repeat(2048));
    expect(parseControlPlaneDraft("lazurio.control-plane.draft")).toBeNull();
  });

  it("is taken only from a Control Plane frame while the person's input activates the window", () => {
    const active = { isActive: true };
    const base = {
      fromControlPlaneFrame: true,
      frameFocused: true,
      origin: "null",
      userActivation: active,
    };
    expect(acceptsControlPlaneDraft(base)).toBe(true);
    // No input from the person: a page's script on load or later.
    expect(acceptsControlPlaneDraft({ ...base, userActivation: { isActive: false } })).toBe(false);
    // A browser that cannot tell.
    expect(acceptsControlPlaneDraft({ ...base, userActivation: undefined })).toBe(false);
    // Another frame, or a frame that is not sandboxed to an opaque origin.
    // The person's input elsewhere in the window: the focus is not in the page.
    expect(acceptsControlPlaneDraft({ ...base, frameFocused: false })).toBe(false);
    expect(acceptsControlPlaneDraft({ ...base, fromControlPlaneFrame: false })).toBe(false);
    expect(acceptsControlPlaneDraft({ ...base, origin: "https://example.com" })).toBe(false);
  });

  it("replaces the sentence it put there before instead of adding another", () => {
    expect(withControlPlaneSentence("", null, "A: yes")).toBe("A: yes");
    const first = withControlPlaneSentence("Please also check", null, "A: yes");
    expect(first).toBe("Please also check\nA: yes");
    expect(withControlPlaneSentence(first, "A: yes", "A: no")).toBe("Please also check\nA: no");
    // The person removed it: the new one is added again, once.
    expect(withControlPlaneSentence("Please also check", "A: yes", "A: no")).toBe(
      "Please also check\nA: no",
    );
  });
});
