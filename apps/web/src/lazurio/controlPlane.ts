/**
 * Lazurio overlay (plan LZD-0051, C2): the Control Plane in the right panel, as upstream's own file
 * surface of an HTML attachment (`htmlRender`), so no panel code of upstream changes. Each revision
 * is its own attachment; a new one replaces the tab in place, without opening the panel.
 */
import type { ThreadRightPanelState } from "~/rightPanelStore";
import type { ChatFileAttachment } from "~/types";

export const CONTROL_PLANE_ROUTE = "/api/lazurio/control-plane";
export const CONTROL_PLANE_NAME = "Control Plane";

/** A Control Plane revision's panel surface: upstream's attachment surface id. */
export const controlPlaneSurfaceId = (attachmentId: string) =>
  `attachment:${attachmentId}` as const;

/** An answer the app shows as its own button; a click puts `sentence` into the composer. */
export interface ControlPlaneAnswer {
  readonly label: string;
  readonly sentence: string;
}

export interface ControlPlaneSnapshot {
  readonly threadId: string;
  readonly attachmentId: string;
  readonly title: string;
  readonly revision: string;
  readonly answers: ReadonlyArray<ControlPlaneAnswer>;
}

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

// The server's limits (apps/server/src/lazurio/controlPlane.ts); anything beyond them is not shown.
const MAX_ANSWERS = 12;
const MAX_ANSWER_LABEL = 80;
const MAX_ANSWER_BYTES = 2048;

const isAnswer = (label: unknown, sentence: unknown): label is string =>
  isText(label) &&
  label.length <= MAX_ANSWER_LABEL &&
  isText(sentence) &&
  new TextEncoder().encode(sentence).length <= MAX_ANSWER_BYTES;

/** The buttons a revision offers: plain label and sentence, nothing the page itself can run. */
const answersOf = (value: unknown): ReadonlyArray<ControlPlaneAnswer> =>
  Array.isArray(value)
    ? value
        .flatMap((answer: unknown) => {
          if (typeof answer !== "object" || answer === null) return [];
          const { label, sentence } = answer as Record<string, unknown>;
          return isAnswer(label, sentence) ? [{ label, sentence: sentence as string }] : [];
        })
        .slice(0, MAX_ANSWERS)
    : [];

/** A server-sent snapshot, or null for anything else. */
export function parseControlPlaneSnapshot(data: unknown): ControlPlaneSnapshot | null {
  if (typeof data !== "object" || data === null) return null;
  const { threadId, attachmentId, title, revision, answers } = data as Record<string, unknown>;
  // The server's page ids end in `-html`, which the asset route serves as a sandboxed document.
  if (!isText(threadId) || !isText(attachmentId) || !attachmentId.endsWith("-html")) return null;
  if (!isText(title) || !isText(revision)) return null;
  return { threadId, attachmentId, title, revision, answers: answersOf(answers) };
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
  id: controlPlaneSurfaceId(attachment.id),
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

/** Where the Control Plane last put its sentence, and the whole composer it left. */
export interface ControlPlaneInsertion {
  readonly prompt: string;
  readonly start: number;
  readonly end: number;
}

/**
 * The composer after a request. While the composer is exactly as the Control Plane left it, the
 * new sentence replaces the earlier one at its place, so repeated requests never pile up; once the
 * person changed anything, their text stays as it is and the sentence follows on its own line.
 */
export function withControlPlaneSentence(
  prompt: string,
  previous: ControlPlaneInsertion | null,
  sentence: string,
): ControlPlaneInsertion {
  if (previous !== null && previous.prompt === prompt) {
    const next = prompt.slice(0, previous.start) + sentence + prompt.slice(previous.end);
    return { prompt: next, start: previous.start, end: previous.start + sentence.length };
  }
  if (prompt.trim().length === 0) return { prompt: sentence, start: 0, end: sentence.length };
  const before = `${prompt}${prompt.endsWith("\n") ? "" : "\n"}`;
  return { prompt: before + sentence, start: before.length, end: before.length + sentence.length };
}
