import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  CommandId,
  EventId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ThreadId,
  TurnId,
} from "./baseSchemas.ts";
import {
  ChatImageAttachment,
  OrchestrationMessageRole,
  OrchestrationThread,
  OrchestrationThreadDetailPage,
} from "./orchestration.ts";

/**
 * Frozen compatibility decoders for upstream stable v0.0.34
 * (badae6a5cc8325dcd5a145bea6f7b8ac692818a1) and v0.0.35
 * (f925d639421844f02b3166d29281905dbba6d529).
 *
 * Both stable clients know only the image member of ChatAttachment and have no
 * contextFiles property. v0.0.35 added only the optional thread-level
 * unsettledAt field to the shapes exercised here. Keeping the message/event
 * decoders independent from the additive field, and removing unsettledAt from
 * the v0.0.34 snapshot shape, proves that file-bearing snapshots and events
 * remain readable by both official image-only clients.
 */
const VanillaV0034ChatAttachment = Schema.Union([ChatImageAttachment]);
const VanillaV0034Message = Schema.Struct({
  id: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(VanillaV0034ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
const { unsettledAt: vanillaV0035OnlyUnsettledAt, ...vanillaV0034ThreadFields } =
  OrchestrationThread.fields;
void vanillaV0035OnlyUnsettledAt;
const VanillaV0034Thread = Schema.Struct({
  ...vanillaV0034ThreadFields,
  messages: Schema.Array(VanillaV0034Message),
});
const VanillaV0034Snapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  thread: VanillaV0034Thread,
  page: Schema.optional(OrchestrationThreadDetailPage),
});
const VanillaV0034ThreadMessageSentEvent = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: Schema.Literal("thread"),
  aggregateId: ThreadId,
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: Schema.Struct({}),
  type: Schema.Literal("thread.message-sent"),
  payload: Schema.Struct({
    threadId: ThreadId,
    messageId: MessageId,
    role: OrchestrationMessageRole,
    text: Schema.String,
    attachments: Schema.optional(Schema.Array(VanillaV0034ChatAttachment)),
    turnId: Schema.NullOr(TurnId),
    streaming: Schema.Boolean,
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  }),
});
const VanillaV0034StreamItem = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("snapshot"), snapshot: VanillaV0034Snapshot }),
  Schema.Struct({ kind: Schema.Literal("event"), event: VanillaV0034ThreadMessageSentEvent }),
]);
const decodeVanillaV0034StreamItem = Schema.decodeUnknownEffect(VanillaV0034StreamItem);

const VanillaV0035ChatAttachment = Schema.Union([ChatImageAttachment]);
const VanillaV0035Message = Schema.Struct({
  id: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(VanillaV0035ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
const VanillaV0035Thread = Schema.Struct({
  ...OrchestrationThread.fields,
  messages: Schema.Array(VanillaV0035Message),
});
const VanillaV0035Snapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  thread: VanillaV0035Thread,
  page: Schema.optional(OrchestrationThreadDetailPage),
});
const VanillaV0035ThreadMessageSentEvent = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: Schema.Literal("thread"),
  aggregateId: ThreadId,
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: Schema.Struct({}),
  type: Schema.Literal("thread.message-sent"),
  payload: Schema.Struct({
    threadId: ThreadId,
    messageId: MessageId,
    role: OrchestrationMessageRole,
    text: Schema.String,
    attachments: Schema.optional(Schema.Array(VanillaV0035ChatAttachment)),
    turnId: Schema.NullOr(TurnId),
    streaming: Schema.Boolean,
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  }),
});
const VanillaV0035StreamItem = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("snapshot"), snapshot: VanillaV0035Snapshot }),
  Schema.Struct({ kind: Schema.Literal("event"), event: VanillaV0035ThreadMessageSentEvent }),
]);
const decodeVanillaV0035StreamItem = Schema.decodeUnknownEffect(VanillaV0035StreamItem);

const timestamp = "2026-08-27T00:00:00.000Z";
const contextFile = {
  type: "file",
  id: "thread-compat-00000000-0000-4000-8000-000000000001",
  name: "requirements.pdf",
  mimeType: "application/pdf",
  sizeBytes: 42,
} as const;
const message = {
  id: "message-compat",
  role: "user",
  text: "Review the attached file.",
  attachments: [],
  contextFiles: [contextFile],
  turnId: null,
  streaming: false,
  createdAt: timestamp,
  updatedAt: timestamp,
} as const;

it.effect("vanilla v0.0.34 decodes a file-bearing thread snapshot", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeVanillaV0034StreamItem({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        thread: {
          id: "thread-compat",
          projectId: "project-compat",
          title: "Compatibility fixture",
          modelSelection: { provider: "codex", model: "gpt-5.4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          latestTurn: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          deletedAt: null,
          messages: [message],
          proposedPlans: [],
          activities: [],
          checkpoints: [],
          session: null,
        },
      },
    });

    assert.strictEqual(decoded.kind, "snapshot");
    if (decoded.kind !== "snapshot") return;
    assert.strictEqual("contextFiles" in decoded.snapshot.thread.messages[0]!, false);
    assert.deepEqual(decoded.snapshot.thread.messages[0]?.attachments, []);
    assert.strictEqual("unsettledAt" in decoded.snapshot.thread, false);
  }),
);

it.effect("vanilla v0.0.34 decodes a file-bearing message event", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeVanillaV0034StreamItem({
      kind: "event",
      event: {
        sequence: 2,
        eventId: "event-compat",
        aggregateKind: "thread",
        aggregateId: "thread-compat",
        occurredAt: timestamp,
        commandId: "command-compat",
        causationEventId: null,
        correlationId: "command-compat",
        metadata: {},
        type: "thread.message-sent",
        payload: {
          threadId: "thread-compat",
          messageId: message.id,
          role: message.role,
          text: message.text,
          attachments: message.attachments,
          contextFiles: message.contextFiles,
          turnId: message.turnId,
          streaming: message.streaming,
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
        },
      },
    });

    assert.strictEqual(decoded.kind, "event");
    if (decoded.kind !== "event") return;
    assert.strictEqual("contextFiles" in decoded.event.payload, false);
    assert.deepEqual(decoded.event.payload.attachments, []);
  }),
);

it.effect("vanilla v0.0.35 decodes a file-bearing thread snapshot", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeVanillaV0035StreamItem({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        thread: {
          id: "thread-compat",
          projectId: "project-compat",
          title: "Compatibility fixture",
          modelSelection: { provider: "codex", model: "gpt-5.4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          latestTurn: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          deletedAt: null,
          messages: [message],
          proposedPlans: [],
          activities: [],
          checkpoints: [],
          session: null,
        },
      },
    });

    assert.strictEqual(decoded.kind, "snapshot");
    if (decoded.kind !== "snapshot") return;
    assert.strictEqual("contextFiles" in decoded.snapshot.thread.messages[0]!, false);
    assert.deepEqual(decoded.snapshot.thread.messages[0]?.attachments, []);
  }),
);

it.effect("vanilla v0.0.35 decodes a file-bearing message event", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeVanillaV0035StreamItem({
      kind: "event",
      event: {
        sequence: 2,
        eventId: "event-compat",
        aggregateKind: "thread",
        aggregateId: "thread-compat",
        occurredAt: timestamp,
        commandId: "command-compat",
        causationEventId: null,
        correlationId: "command-compat",
        metadata: {},
        type: "thread.message-sent",
        payload: {
          threadId: "thread-compat",
          messageId: message.id,
          role: message.role,
          text: message.text,
          attachments: message.attachments,
          contextFiles: message.contextFiles,
          turnId: message.turnId,
          streaming: message.streaming,
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
        },
      },
    });

    assert.strictEqual(decoded.kind, "event");
    if (decoded.kind !== "event") return;
    assert.strictEqual("contextFiles" in decoded.event.payload, false);
    assert.deepEqual(decoded.event.payload.attachments, []);
  }),
);
