/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): `GET /api/lazurio/buddy/days?tz=<zone>`
 * lists the local days of the person's messages to Buddy that the conversation shows, newest first,
 * each with its first message and first line, for the day pane. 404 outside Buddy's T3 Code.
 */
import {
  AuthOrchestrationReadScope,
  type MessageId,
  type OrchestrationV2ConversationMessage,
} from "@t3tools/contracts";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ActingSenders } from "./actingSenders.ts";
import { type ActingSendersRecord, personSeesMessage } from "./actingSenderVisibility.ts";
import { isBuddySurfaceEnvironment } from "./buddySurface.ts";
import { BUDDY_THREAD_ID } from "./buddySurfaceThread.ts";
import { authenticateOverlayRoute } from "./routeAuth.ts";

const BUDDY_DAYS_ROUTE = "/api/lazurio/buddy/days";

const PREVIEW_MAX = 120;

export interface BuddyDay {
  /** The local date, `YYYY-MM-DD`. */
  readonly day: string;
  readonly firstMessageId: MessageId;
  readonly preview: string;
  readonly messages: number;
}

/** The zone a request names, if the runtime knows it; UTC otherwise. */
export function timeZoneOf(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "UTC";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

/** A message's first line, its context links taken out, as the pane shows it. */
function previewOf(text: string): string {
  let plain = text;
  for (const occurrence of collectComposerContextReferences(text).toReversed())
    plain = plain.slice(0, occurrence.start) + plain.slice(occurrence.end);
  const line = plain.split("\n").find((candidate) => candidate.trim() !== "") ?? "";
  const trimmed = line.trim().replace(/\s+/g, " ");
  return trimmed.length > PREVIEW_MAX ? `${trimmed.slice(0, PREVIEW_MAX - 1)}…` : trimmed;
}

type DayMessage = Pick<
  OrchestrationV2ConversationMessage,
  | "id"
  | "role"
  | "text"
  | "createdAt"
  | "createdBy"
  | "creationSource"
  | "senderThreadId"
  | "scheduledTaskId"
>;

/**
 * The messages the conversation shows grouped by local day in `timeZone`, newest day first:
 * without Delegace's wake (actingSenderVisibility.ts), so a day's first message is one the jump finds.
 */
export function buddyDaysOf(
  messages: ReadonlyArray<DayMessage>,
  timeZone: string,
  record: ActingSendersRecord<{ readonly kind: string }> | null,
): Array<BuddyDay> {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const days = new Map<
    string,
    { first: (typeof messages)[number]; firstAt: number; count: number }
  >();
  for (const message of messages) {
    const at = DateTime.toEpochMillis(message.createdAt);
    if (!personSeesMessage(message, at, record)) continue;
    const day = format.format(at);
    const current = days.get(day);
    if (current === undefined) days.set(day, { first: message, firstAt: at, count: 1 });
    else {
      current.count += 1;
      if (at < current.firstAt) {
        current.first = message;
        current.firstAt = at;
      }
    }
  }
  return [...days.entries()]
    .toSorted(([left], [right]) => right.localeCompare(left))
    .map(([day, { first, count }]) => ({
      day,
      firstMessageId: first.id,
      preview: previewOf(first.text),
      messages: count,
    }));
}

export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    // A handler sees only the request's context, so it takes the orchestrator from the layer's.
    const orchestrator = yield* OrchestratorV2;
    const senders = yield* ActingSenders;
    yield* router.add(
      "GET",
      BUDDY_DAYS_ROUTE,
      Effect.gen(function* () {
        yield* authenticateOverlayRoute(AuthOrchestrationReadScope);
        if (!isBuddySurfaceEnvironment(yield* HostProcess.Environment))
          return HttpServerResponse.jsonUnsafe({ error: "not-buddy" }, { status: 404 });
        const request = yield* HttpServerRequest.HttpServerRequest;
        const timeZone = timeZoneOf(new URL(request.url, "http://local").searchParams.get("tz"));
        const shell = yield* orchestrator.getThreadShell(BUDDY_THREAD_ID).pipe(Effect.orDie);
        if (shell === null) return HttpServerResponse.jsonUnsafe({ days: [] });
        const records = yield* orchestrator
          .getThreadRecords(BUDDY_THREAD_ID, ["messages"], { messageRoles: ["user"] })
          .pipe(Effect.orDie);
        // As the web without the record: every message shows.
        const answer = yield* senders.read(BUDDY_THREAD_ID).pipe(Effect.option);
        const record = Option.match(answer, {
          onNone: () => null,
          onSome: ({ at, records }) => ({
            at,
            senders: new Map(records.map((step) => [`${step.kind}:${step.id}`, step.sender])),
          }),
        });
        return HttpServerResponse.jsonUnsafe({
          days: buddyDaysOf(records.messages, timeZone, record),
        });
      }),
    );
  }),
);
