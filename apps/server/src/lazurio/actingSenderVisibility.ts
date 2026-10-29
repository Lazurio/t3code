/**
 * Lazurio overlay (root decision 0210, evening addendum, point 5): which messages of a thread the
 * person sees, by the record of who acted. The timeline (web) and Buddy's day pane (server) decide
 * it alike: apps/server and apps/web hold this same file, and the release contract test keeps it so.
 * Each side uses part of it, so its functions are @public to knip.
 */

/** A message as a thread holds it, as far as who sent it goes. */
export interface MessageSenderFields {
  readonly id: string;
  readonly role: string;
  readonly createdBy?: string | undefined;
  readonly creationSource?: string | undefined;
  readonly senderThreadId?: string | undefined;
  readonly scheduledTaskId?: string | undefined;
}

/**
 * The key of a message Buddy or Delegace could have sent: a user message an agent sent from outside
 * any thread, not an automation's or T3's own. Every other message is never theirs.
 * @public
 */
export const actingSenderMessageKey = (message: MessageSenderFields): string | null =>
  message.role === "user" &&
  message.createdBy === "agent" &&
  message.creationSource !== "server" &&
  message.senderThreadId === undefined &&
  message.scheduledTaskId === undefined
    ? `message:${message.id}`
    : null;

/** The record's answer: every step from before `at` (epoch ms) that someone acted in is here. */
export interface ActingSendersRecord<Sender> {
  readonly at: number;
  readonly senders: ReadonlyMap<string, Sender>;
}

/**
 * A step's sender by the record, `null` once it covers the step without one, else "pending".
 * @public
 */
export const actingSenderInRecord = <Sender>(
  record: ActingSendersRecord<Sender>,
  key: string,
  time: number,
): Sender | null | "pending" => record.senders.get(key) ?? (time < record.at ? null : "pending");

/**
 * Whether the thread hides the message: Delegace's wake always, any other until it is answered.
 * @public
 */
export const hidesActingSenderState = (
  state: { readonly kind: string } | null | "pending" | "unavailable",
): boolean => state === "pending" || (typeof state === "object" && state?.kind === "delegace");

/**
 * Whether the person sees a message sent at `time` (epoch ms), by the record; with no record (an
 * older T3, an error) every message shows, as upstream shows it.
 * @public
 */
export const personSeesMessage = (
  message: MessageSenderFields,
  time: number,
  record: ActingSendersRecord<{ readonly kind: string }> | null,
): boolean => {
  const key = actingSenderMessageKey(message);
  return (
    key === null ||
    record === null ||
    !hidesActingSenderState(actingSenderInRecord(record, key, time))
  );
};
