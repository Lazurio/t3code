/**
 * Lazurio overlay (root decision 0210, addendum of 2026-10-22, point 1; plan DEV-6676): Buddy's chat
 * shows what Buddy writes and what the person acts on, never T3's record of the work (tool calls,
 * commands, edits, reasoning, "Worked for"); one quiet row while a turn runs, and one human row for
 * a failed turn (BuddySurface.tsx draws both).
 */
import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";

type Row = MessagesTimelineRow;
type TurnItem = Extract<Row, { kind: "event" }>["projectedItem"]["item"];

/** The quiet row while Buddy's turn runs. One object, so the list keeps it across renders. */
export const BUDDY_WORKING_ROW: Row = {
  kind: "working",
  id: "lazurio-buddy-working",
  createdAt: null,
};

/** T3's record that a turn failed, as opposed to a failed step inside it. */
const isTurnFailure = (item: TurnItem | undefined) =>
  item?.type === "error" && item.status === "failed" && item.parentItemId === null;

/** The failed turn's item a row shows; null for any other row. */
export function buddyFailureOf(row: Row): TurnItem | null {
  if (row.kind === "event")
    return isTurnFailure(row.projectedItem.item) ? row.projectedItem.item : null;
  if (row.kind !== "work") return null;
  return row.groupedEntries.map((entry) => entry.projectedItem?.item).find(isTurnFailure) ?? null;
}

/**
 * Rows for the person: messages and what Buddy shows them, a secret Buddy asks for and the answers
 * the person gave to Buddy's questions. T3's work rows, folds, subagents, interrupts and compactions
 * stay out.
 */
function isForThePerson(row: Row): boolean {
  switch (row.kind) {
    case "message":
    case "assistant-meta":
    case "proposed-plan":
    case "html-render":
    case "mcp-app":
      return true;
    case "event":
      return row.projectedItem.item.type === "secret_request";
    case "work":
      return row.groupedEntries.some((entry) => entry.questionAnswer !== undefined);
    default:
      return false;
  }
}

/**
 * Buddy's conversation out of T3's timeline rows: one failure row for each failed turn, however many
 * T3 recorded for it, and the quiet row last while Buddy works.
 */
export function buddyConversationRows(rows: ReadonlyArray<Row>, working: boolean): Row[] {
  const failedRuns = new Set<string>();
  const shown: Row[] = [];
  for (const row of rows) {
    const failure = buddyFailureOf(row);
    if (failure === null) {
      if (isForThePerson(row)) shown.push(row);
      continue;
    }
    if (failure.runId !== null && failedRuns.has(failure.runId)) continue;
    if (failure.runId !== null) failedRuns.add(failure.runId);
    shown.push(row);
  }
  if (working) shown.push(BUDDY_WORKING_ROW);
  return shown;
}
