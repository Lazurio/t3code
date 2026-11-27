/**
 * Lazurio overlay (plan LZD-0051, C2): the Control Plane in the right panel, as upstream's own file
 * surface of an HTML attachment (`htmlRender`), so no panel code of upstream changes. Each revision
 * is its own attachment; a new one replaces the tab in place, without opening the panel.
 */
import type { ThreadRightPanelState } from "~/rightPanelStore";
import type { ChatFileAttachment } from "~/types";

export const CONTROL_PLANE_ROUTE = "/api/lazurio/control-plane";
export const CONTROL_PLANE_NAME = "Control Plane";

export interface ControlPlaneSnapshot {
  readonly threadId: string;
  readonly attachmentId: string;
  readonly title: string;
  readonly revision: string;
}

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** A server-sent snapshot, or null for anything else. */
export function parseControlPlaneSnapshot(data: unknown): ControlPlaneSnapshot | null {
  if (typeof data !== "object" || data === null) return null;
  const { threadId, attachmentId, title, revision } = data as Record<string, unknown>;
  // The server's page ids end in `-html`, which the asset route serves as a sandboxed document.
  if (!isText(threadId) || !isText(attachmentId) || !attachmentId.endsWith("-html")) return null;
  if (!isText(title) || !isText(revision)) return null;
  return { threadId, attachmentId, title, revision };
}

/** The revision as an attachment that upstream's file surface renders as an agent page. */
export const controlPlaneAttachment = (snapshot: ControlPlaneSnapshot): ChatFileAttachment => ({
  type: "file",
  id: snapshot.attachmentId,
  name: CONTROL_PLANE_NAME,
  mimeType: "text/html",
  sizeBytes: 0,
  htmlRender: true,
});

type Surface = ThreadRightPanelState["surfaces"][number];

/** The same shape as upstream's attachment surface (rightPanelStore.ts `attachmentSurface`). */
const surfaceOf = (attachment: ChatFileAttachment): Surface => ({
  id: `attachment:${attachment.id}`,
  kind: "file",
  relativePath: attachment.name,
  revealLine: null,
  revealRequestId: 0,
  attachment,
});

const isControlPlaneSurface = (surface: Surface): boolean =>
  surface.kind === "file" &&
  surface.attachment?.htmlRender === true &&
  surface.attachment.name === CONTROL_PLANE_NAME;

/** A new revision in the tab the person opened, at its place; the panel is neither opened nor focused. */
export function withControlPlaneRevision(
  state: ThreadRightPanelState,
  attachment: ChatFileAttachment,
): ThreadRightPanelState {
  const at = state.surfaces.findIndex(isControlPlaneSurface);
  if (at < 0) return state;
  const previous = state.surfaces[at]!;
  const next = surfaceOf(attachment);
  if (previous.id === next.id) return state;
  return {
    ...state,
    surfaces: state.surfaces.map((surface, index) => (index === at ? next : surface)),
    activeSurfaceId: state.activeSurfaceId === previous.id ? next.id : state.activeSurfaceId,
  };
}

/** The person opens the Control Plane: its tab, made if it is not there, shown in the panel. */
export function withControlPlaneOpen(
  state: ThreadRightPanelState,
  attachment: ChatFileAttachment,
): ThreadRightPanelState {
  const current = withControlPlaneRevision(state, attachment);
  const existing = current.surfaces.find(isControlPlaneSurface);
  const surface = existing ?? surfaceOf(attachment);
  return {
    ...current,
    isOpen: true,
    activeSurfaceId: surface.id,
    surfaces: existing === undefined ? [...current.surfaces, surface] : current.surfaces,
  };
}

/**
 * The one message a Control Plane page may send its parent (plan LZD-0051, C3): a sentence for the
 * composer of Buddy's thread. It is put into the composer and never sent; the person sends it.
 */
const CONTROL_PLANE_DRAFT_MESSAGE = "lazurio.control-plane.draft";
const CONTROL_PLANE_DRAFT_MAX_BYTES = 2048;

/** The sentence of a well-formed request, or null; any other field, such as one asking to send, is refused. */
export function parseControlPlaneDraft(data: unknown): string | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const keys = Object.keys(data);
  if (keys.length !== 3 || !["type", "v", "text"].every((key) => keys.includes(key))) return null;
  const { type, v, text } = data as Record<string, unknown>;
  if (type !== CONTROL_PLANE_DRAFT_MESSAGE || v !== 1 || typeof text !== "string") return null;
  const sentence = text.trim();
  if (sentence.length === 0) return null;
  return new TextEncoder().encode(sentence).length > CONTROL_PLANE_DRAFT_MAX_BYTES
    ? null
    : sentence;
}

/**
 * A request is taken only from a focused Control Plane frame (opaque origin) while the window has
 * transient activation: the person's input inside the page, which the page cannot make and input
 * elsewhere does not lend it. No `navigator.userActivation` means no.
 */
export function acceptsControlPlaneDraft(input: {
  readonly fromControlPlaneFrame: boolean;
  readonly frameFocused: boolean;
  readonly origin: string;
  readonly userActivation: { readonly isActive: boolean } | undefined;
}): boolean {
  return (
    input.fromControlPlaneFrame &&
    input.frameFocused &&
    input.origin === "null" &&
    input.userActivation?.isActive === true
  );
}

/**
 * The composer after a request: the new sentence replaces the one the Control Plane put there
 * before, if it is still there, so repeated requests never pile up; otherwise it follows what the
 * person wrote, on its own line.
 */
export function withControlPlaneSentence(
  prompt: string,
  previous: string | null,
  sentence: string,
): string {
  if (previous !== null) {
    const at = prompt.lastIndexOf(previous);
    if (at >= 0) return prompt.slice(0, at) + sentence + prompt.slice(at + previous.length);
  }
  if (prompt.trim().length === 0) return sentence;
  return `${prompt}${prompt.endsWith("\n") ? "" : "\n"}${sentence}`;
}
