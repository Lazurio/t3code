/**
 * Lazurio overlay (plan DEV-6646): a preferred preview host's own explanation of a failure
 * reaches the agent. Upstream carries it in the contract from 0.0.46 (`reason` on
 * PreviewAutomationExecutionError and `staleRef` on PreviewAutomationInvalidSelectorError) for
 * the server's own browser. The 0.0.45 contract has neither field, and an agent reads only an
 * error's `message`, so these keep the contract's tag and fields and say more there.
 *
 * Only a host that runs inside this server connects as preferred (the WebSocket route never
 * passes the option to PreviewAutomationBroker.connect), so no desktop's or page's own text
 * reaches the agent this way. The broker classifies with these in `classifyResponseError`.
 */

import {
  PreviewAutomationExecutionError,
  PreviewAutomationInvalidSelectorError,
} from "@t3tools/contracts";

/** Enough for a browser's own error line, such as a refused connection and its URL. */
const MAX_REASON_CHARS = 500;

/**
 * PreviewAutomationExecutionError that reads the host's reason (upstream's `reason`) from the
 * remote error the broker keeps as `cause`.
 */
export class PreferredHostExecutionError extends PreviewAutomationExecutionError {
  override get message(): string {
    const cause: unknown = this.cause;
    const reason =
      typeof cause === "object" && cause !== null && "message" in cause
        ? String(cause.message)
        : "";
    return reason.length === 0
      ? super.message
      : `Preview automation ${this.operation} failed: ${reason.slice(0, MAX_REASON_CHARS)}`;
  }
}

/** PreviewAutomationInvalidSelectorError for an `aria-ref` from an older snapshot. */
export class StaleElementRefError extends PreviewAutomationInvalidSelectorError {
  override get message(): string {
    return "This element ref is stale or belongs to another tab: navigation and new snapshots replace refs. Take a fresh snapshot and use its refs.";
  }
}

/** Whether a host marked an invalid selector as a stale ref (upstream's `staleRef` detail). */
export const isStaleRefDetail = (detail: unknown): boolean =>
  typeof detail === "object" && detail !== null && "staleRef" in detail && detail.staleRef === true;
