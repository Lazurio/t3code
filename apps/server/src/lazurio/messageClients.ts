/**
 * Lazurio overlay (plan LZD-0025 B9): a `<message_origin>` line tells the agent where a user message
 * came from. The client is the dispatching socket's, marked once that dispatch committed the message,
 * and kept in memory: a message queued across a restart has no line, and T3's database stays.
 */
import {
  ClientDeviceType,
  ClientSurface,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2StoredEvent,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import type { ActingSender } from "./actingSender.ts";
import type { MessageSenderFields } from "./actingSenderVisibility.ts";

export interface MessageClient {
  readonly surface: ClientSurface;
  readonly deviceType?: ClientDeviceType;
}

/** Enough for every message queued while the server runs; the oldest mark goes first. */
const MAX_MARKED_MESSAGES = 2000;

export interface MessageClientsShape {
  /** Marks a message its dispatch committed; a message keeps its first mark. */
  readonly record: (messageId: string, client: MessageClient) => Effect.Effect<void>;
  /** The message's mark, once no client dispatch of it still runs (`tracking`). */
  readonly clientOf: (messageId: string) => Effect.Effect<MessageClient | undefined>;
  /** Runs one client dispatch of the message: until it ends, `clientOf` waits. */
  readonly tracking: <A, E, R>(
    messageId: string,
    dispatch: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

/** Without `layer` nothing is marked, so no message reads as typed in a client. */
export class MessageClients extends Context.Reference<MessageClientsShape>(
  "t3/lazurio/messageClients/MessageClients",
  {
    defaultValue: () => ({
      record: () => Effect.void,
      clientOf: () => Effect.undefined,
      tracking: (_messageId, dispatch) => dispatch,
    }),
  },
) {}

type Running = ReadonlyMap<string, number>;
const adjust = (running: Running, messageId: string, by: 1 | -1): Running => {
  const next = new Map(running);
  const count = (running.get(messageId) ?? 0) + by;
  if (count > 0) next.set(messageId, count);
  else next.delete(messageId);
  return next;
};

const make = Effect.gen(function* () {
  const clients = new Map<string, MessageClient>();
  const running = yield* SubscriptionRef.make<Running>(new Map());
  const tracking = <A, E, R>(messageId: string, dispatch: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      SubscriptionRef.update(running, (current) => adjust(current, messageId, 1)),
      () => dispatch,
      () => SubscriptionRef.update(running, (current) => adjust(current, messageId, -1)),
    );
  return MessageClients.of({
    record: Effect.fn("LazurioMessageClients.record")((messageId, client) =>
      Effect.sync(() => {
        if (clients.has(messageId)) return;
        clients.set(messageId, client);
        if (clients.size <= MAX_MARKED_MESSAGES) return;
        const oldest = clients.keys().next().value;
        if (oldest !== undefined) clients.delete(oldest);
      }),
    ),
    clientOf: Effect.fn("LazurioMessageClients.clientOf")(function* (messageId) {
      // The effect worker may start the turn once the command commits, before its dispatch
      // returns and records the mark: wait for that dispatch. Upstream's dispatch never waits for
      // the worker or a turn, so the wait ends with it, however long it takes.
      yield* SubscriptionRef.changes(running).pipe(
        Stream.filter((current) => !current.has(messageId)),
        Stream.take(1),
        Stream.runDrain,
      );
      return clients.get(messageId);
    }),
    tracking,
  });
});

/** One store for the decorator and the turn services: each takes this same layer, built once. */
export const layer = Layer.effect(MessageClients, make);

/** The client of the socket a dispatch runs for (`fromClient` in ws.ts). */
class DispatchClient extends Context.Reference<MessageClient | undefined>(
  "t3/lazurio/messageClients/DispatchClient",
  { defaultValue: () => undefined },
) {}

const isClientSurface = Schema.is(ClientSurface);
const isClientDeviceType = Schema.is(ClientDeviceType);

/**
 * Run a client socket's dispatch as its client, read from the socket's connection params. A
 * session acting as Buddy or Delegace is not the person typing, so its dispatch has none.
 */
export const fromClient =
  (
    session: { readonly actingSender?: ActingSender | undefined },
    props: { readonly surface?: unknown; readonly clientDeviceType?: unknown },
  ) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    session.actingSender !== undefined || !isClientSurface(props.surface)
      ? effect
      : Effect.provideService(effect, DispatchClient, {
          surface: props.surface,
          ...(isClientDeviceType(props.clientDeviceType)
            ? { deviceType: props.clientDeviceType }
            : {}),
        });

/**
 * The message a dispatch may commit as the person's own, a launch's first one included. A guest's
 * message the person sends on is the guest's words, so it gets no mark.
 */
const typedMessageOf = (command: OrchestrationV2ServerCommand): string | undefined =>
  command.type === "message.dispatch" &&
  command.guestMessageId === undefined &&
  command.createdBy === "user"
    ? command.messageId
    : undefined;

const committed = (messageId: string, storedEvents: ReadonlyArray<OrchestrationV2StoredEvent>) =>
  storedEvents.some(
    ({ event }) =>
      event.type === "message.updated" &&
      event.payload.id === messageId &&
      event.payload.role === "user" &&
      event.payload.createdBy === "user",
  );

/**
 * Upstream's orchestrator from `live`, marking each message a client's dispatch commits, after it
 * commits: a rejected dispatch, one that commits no such message and a repeated command id, answered
 * with the first dispatch's events, mark nothing and take nothing back. While the dispatch runs, a
 * turn reading its message's mark waits for it (`tracking`).
 */
export const recordClients = <E, R>(live: Layer.Layer<Orchestrator.OrchestratorV2, E, R>) =>
  Layer.effect(
    Orchestrator.OrchestratorV2,
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const clients = yield* MessageClients;
      return Orchestrator.OrchestratorV2.of({
        ...orchestrator,
        dispatch: Effect.fn("LazurioMessageClients.dispatch")(function* (command) {
          const client = yield* DispatchClient;
          const messageId = client === undefined ? undefined : typedMessageOf(command);
          if (client === undefined || messageId === undefined) {
            return yield* orchestrator.dispatch(command);
          }
          return yield* clients.tracking(
            messageId,
            orchestrator
              .dispatch(command)
              .pipe(
                Effect.tap((result) =>
                  result.replayed !== true && committed(messageId, result.storedEvents)
                    ? clients.record(messageId, client)
                    : Effect.void,
                ),
              ),
          );
        }),
      });
    }),
  ).pipe(Layer.provide(live), Layer.provide(layer));

/** One line of an id: nothing that starts another line or closes the tag. */
const oneLine = (id: string): string =>
  id
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 128);

/** Where the person typed it; nothing for the CLI or a message without a recorded client. */
const typedIn = (client: MessageClient | undefined): string | null => {
  switch (client?.surface) {
    case "web":
      return client.deviceType === "phone"
        ? "The user wrote this in T3 Code on the web, on a phone."
        : "The user wrote this in T3 Code on the web.";
    case "desktop":
      return "The user wrote this in the T3 Code desktop app.";
    case "mobile":
      return "The user wrote this in the T3 Code mobile app.";
    default:
      return null;
  }
};

/** A message as far as the line goes: its sender, a linked environment's thread, and T3's notice. */
export interface MessageOriginFields extends MessageSenderFields {
  readonly linkedSender?:
    | {
        readonly environmentId: string;
        readonly threadId: string;
        readonly title: string;
        readonly environmentLabel?: string | undefined;
      }
    | undefined;
  readonly notification?:
    | { readonly source: { readonly kind: string; readonly taskIds?: ReadonlyArray<string> } }
    | undefined;
}

/** A linked environment's thread, by what this environment knows of it; all of it is the peer's word. */
const linkedThread = (sender: NonNullable<MessageOriginFields["linkedSender"]>): string => {
  const label = sender.environmentLabel === undefined ? "" : oneLine(sender.environmentLabel);
  const environment = oneLine(sender.environmentId);
  return `T3 thread ${oneLine(sender.threadId)} ("${oneLine(sender.title).replaceAll('"', "'")}") in the linked environment ${
    label === "" ? environment : `${label} (${environment})`
  }`;
};

/** T3 Code's own notice; a message it only sends on (a restart's continuation) has none. */
const serverNotice = (source: {
  readonly kind: string;
  readonly taskIds?: ReadonlyArray<string>;
}) =>
  source.kind === "delegated_task" && source.taskIds !== undefined
    ? `Sent by T3 Code itself about delegated task ${source.taskIds.map(oneLine).join(", ")}, not typed by the user.`
    : `Sent by T3 Code itself as a ${oneLine(source.kind).replaceAll("_", " ")} notice, not typed by the user.`;

/** The line saying where a user message came from, or null where that is not known. */
export const messageOriginLine = (
  message: MessageOriginFields,
  client: MessageClient | undefined,
): string | null => {
  const origin =
    message.role !== "user"
      ? null
      : message.linkedSender !== undefined
        ? `Sent by the agent of ${linkedThread(message.linkedSender)}, not typed by the user.`
        : message.senderThreadId !== undefined
          ? `Sent by the agent of T3 thread ${oneLine(message.senderThreadId)} in this environment, not typed by the user.`
          : message.scheduledTaskId !== undefined
            ? `Sent by scheduled task ${oneLine(message.scheduledTaskId)}, not typed by the user.`
            : message.createdBy === "user"
              ? typedIn(client)
              : message.createdBy === "agent" && message.creationSource === "mcp"
                ? "Sent through T3 Code's tools by an agent outside T3 threads, not from a T3 Code client."
                : message.createdBy === "agent" &&
                    message.creationSource === "server" &&
                    message.notification !== undefined
                  ? serverNotice(message.notification.source)
                  : null;
  return origin === null ? null : `<message_origin>${origin}</message_origin>`;
};
