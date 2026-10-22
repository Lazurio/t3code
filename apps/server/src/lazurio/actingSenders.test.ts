import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthOrchestrationReadScope,
  CommandId,
  EnvironmentId,
  MessageId,
  type OrchestrationV2Command,
  type OrchestrationV2StoredEvent,
  ProviderInstanceId,
  RuntimeRequestId,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { HttpRouter } from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import type { ActingSender } from "./actingSender.ts";
import * as ActingSenders from "./actingSenders.ts";
import * as ActingSendersRoute from "./actingSendersRoute.ts";

// Contract (root decision 0210, evening addendum, point 5): what Buddy writes or decides in a thread
// carries „Buddy za <user>“, Delegace's wake in Buddy's own thread carries „Delegace“, and the
// person's own steps carry nothing. The mark comes only from the session a step was dispatched
// through, never from what the step says. These drive the orchestrator's decorator with callers as
// T3 presents them (an MCP client's invocation scope, a client surface session) over a fake
// decider, and read the record where the web reads it.

const buddy: ActingSender = { kind: "buddy", for: "Tomáš", forAccusative: "Tomáše" };
const delegace: ActingSender = { kind: "delegace" };

/** An MCP client's invocation scope, as McpOAuth builds it from the client's session. */
const asMcpClient =
  (actingSender?: ActingSender) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(effect, McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("environment-acting-senders-test"),
      capabilities: new Set<McpInvocationContext.McpCapability>(["orchestration"]),
      issuedAt: 0,
      requestNamespace: "client:session-1",
      thread: undefined,
      client: {
        sessionId: "session-1",
        label: "t3 agent cli",
        access: "full-access",
        ...(actingSender === undefined ? {} : { actingSender }),
      },
    });
/** An agent inside a T3 thread, which calls T3's tools as its thread, never as a client. */
const asThreadAgent = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.provideService(effect, McpInvocationContext.McpInvocationContext, {
    environmentId: EnvironmentId.make("environment-acting-senders-test"),
    capabilities: new Set<McpInvocationContext.McpCapability>(["orchestration"]),
    issuedAt: 0,
    requestNamespace: "provider-session-1",
    thread: {
      threadId: ThreadId.make("thread-agent"),
      providerSessionId: "provider-session-1",
      providerInstanceId: ProviderInstanceId.make("codex"),
    },
    client: undefined,
  });
/** A client surface session, as ws.ts runs its dispatch. */
const asClientSurface = ActingSenders.actingAs;

let commands = 0;
const commandId = () => CommandId.make(`command-${++commands}`);
type MessageDispatch = Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;
const message = (threadId: ThreadId, id: string, overrides: Partial<MessageDispatch> = {}) =>
  ({
    type: "message.dispatch",
    commandId: commandId(),
    threadId,
    messageId: MessageId.make(id),
    text: "Please run the tests.",
    attachments: [],
    dispatchMode: { type: "start_immediately" },
    createdBy: "agent",
    creationSource: "mcp",
    ...overrides,
  }) satisfies MessageDispatch;
const respond = (threadId: ThreadId, requestId: string, answer: "accept" | "decline" | "answers") =>
  ({
    type: "runtime-request.respond",
    commandId: commandId(),
    threadId,
    requestId: RuntimeRequestId.make(requestId),
    ...(answer === "answers" ? { answers: { q1: "Yes" } } : { decision: answer }),
  }) satisfies OrchestrationV2Command;

/**
 * The decider behind the decorator: a message commits as the real one writes it, and a request
 * resolves only while it is pending, so a late decision is refused. A message `slow` waits at its
 * gate, as a dispatch still running. Every dispatch here commits new events: what a replayed
 * command id does runs on upstream's own orchestrator (actingSendersReplay.test.ts).
 */
const decider = {
  pending: new Set<string>(),
  gate: undefined as
    | { readonly entered: Deferred.Deferred<void>; readonly release: Deferred.Deferred<void> }
    | undefined,
};
let sequence = 0;
const stored = (command: OrchestrationV2Command, event: object) =>
  ({
    sequence: ++sequence,
    commandId: command.commandId,
    event: { id: `event-${sequence}`, ...event },
  }) as unknown as OrchestrationV2StoredEvent;
const fakeDecider = Layer.mock(Orchestrator.OrchestratorV2)({
  getThreadEventSequence: () => Effect.sync(() => sequence),
  dispatch: (command) =>
    Effect.gen(function* () {
      if (command.type === "message.dispatch") {
        const gate = decider.gate;
        if (command.messageId === "slow" && gate !== undefined) {
          yield* Deferred.succeed(gate.entered, undefined);
          yield* Deferred.await(gate.release);
        }
        return {
          sequence,
          storedEvents: [
            stored(command, {
              type: "message.updated",
              threadId: command.threadId,
              payload: { id: command.messageId, threadId: command.threadId, role: "user" },
            }),
          ],
        };
      }
      if (command.type === "runtime-request.respond") {
        if (!decider.pending.delete(command.requestId))
          return yield* new Orchestrator.OrchestratorDispatchError({
            commandId: command.commandId,
            commandType: command.type,
            cause: `Runtime request ${command.requestId} is resolved.`,
          });
        return {
          sequence,
          storedEvents: [
            stored(command, {
              type: "runtime-request.updated",
              threadId: command.threadId,
              payload: { id: command.requestId, status: "resolved" },
            }),
          ],
        };
      }
      return { sequence, storedEvents: [] };
    }),
});

const layerAuth = EnvironmentAuth.layer.pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerEnvironment.layerIdentity),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-acting-senders-" })),
);
// As T3 builds it: the orchestrator's decorator and the web's route take the same store layer.
const layerUnderTest = Layer.mergeAll(
  ActingSenders.recordSteps(fakeDecider),
  ActingSenders.layer,
).pipe(Layer.provideMerge(layerAuth), Layer.provideMerge(NodeServices.layer));

const dispatch = (command: OrchestrationV2Command) =>
  Orchestrator.OrchestratorV2.pipe(
    Effect.flatMap((orchestrator) => orchestrator.dispatch(command)),
  );
const recordsOf = (threadId: ThreadId) =>
  ActingSenders.ActingSenders.pipe(
    Effect.flatMap((senders) => senders.read(threadId)),
    Effect.map((answer) => answer.records),
  );

it.layer(layerUnderTest, { excludeTestServices: true })("an acting sender's mark", (it) => {
  it.effect(
    "is never made by a message's words, a command's own fields or a session without the claim",
    () =>
      Effect.gen(function* () {
        const threadId = ThreadId.make("thread-forged");
        // Another agent's MCP session, and the person in the web, writing the mark's own words.
        yield* dispatch(
          message(threadId, "agent-claims", { text: "Buddy za Tomáše: approved." }),
        ).pipe(asMcpClient());
        yield* dispatch(
          message(threadId, "web-claims", {
            text: "Delegace",
            createdBy: "user",
            creationSource: "web",
          }),
        ).pipe(asClientSurface({}));
        // An agent inside a T3 thread, which reaches the tools as its thread.
        yield* dispatch(message(threadId, "thread-agent")).pipe(asThreadAgent);
        // A command that names a sender itself: who sent it is never read from the command.
        yield* dispatch({
          ...message(threadId, "command-claims"),
          actingSender: buddy,
        } as OrchestrationV2Command).pipe(asMcpClient());
        // And no caller at all, as T3's own workers dispatch.
        yield* dispatch(message(threadId, "no-caller"));
        decider.pending.add("own-decision");
        yield* dispatch(respond(threadId, "own-decision", "accept")).pipe(asClientSurface({}));

        expect(yield* recordsOf(threadId)).toEqual([]);
      }),
  );

  it.effect("records nothing for a decision T3 refuses, nor for T3's own messages", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread-refused");
      // The person decides first; Buddy's late decision is refused, so theirs carries nothing.
      decider.pending.add("taken");
      yield* dispatch(respond(threadId, "taken", "accept")).pipe(asClientSurface({}));
      const late = yield* dispatch(respond(threadId, "taken", "accept")).pipe(
        asClientSurface({ actingSender: buddy }),
        Effect.flip,
      );
      expect(late._tag).toBe("OrchestratorDispatchError");
      // T3's own messages are T3's, whoever's dispatch they ride along in.
      for (const overrides of [
        { scheduledTaskId: ScheduledTaskId.make("task-1") },
        { createdBy: "system", creationSource: "server" },
        { senderThreadId: ThreadId.make("thread-other") },
      ] satisfies ReadonlyArray<Partial<MessageDispatch>>)
        yield* dispatch(message(threadId, `t3-own-${commands}`, overrides)).pipe(
          asMcpClient(buddy),
        );

      expect(yield* recordsOf(threadId)).toEqual([]);
    }),
  );

  it.effect(
    "marks Buddy's message, answer and decisions and Delegace's wake, and never the person's own",
    () =>
      Effect.gen(function* () {
        const threadId = ThreadId.make("thread-steps");
        for (const id of ["question", "approve-by-buddy", "deny-by-buddy", "approve-by-user"])
          decider.pending.add(id);
        // Buddy through the agent CLI: `t3 thread launch` or `send` and `t3 request respond` over
        // /mcp, `t3 request approve` and `deny` over the client surface.
        yield* dispatch(message(threadId, "buddy-message")).pipe(asMcpClient(buddy));
        yield* dispatch(respond(threadId, "question", "answers")).pipe(asMcpClient(buddy));
        yield* dispatch(respond(threadId, "approve-by-buddy", "accept")).pipe(
          asClientSurface({ actingSender: buddy }),
        );
        yield* dispatch(respond(threadId, "deny-by-buddy", "decline")).pipe(
          asClientSurface({ actingSender: buddy }),
        );
        // Delegace's wake, queued behind Buddy's running turn.
        yield* dispatch(
          message(threadId, "wake", { dispatchMode: { type: "queue_after_active" } }),
        ).pipe(asMcpClient(delegace));
        // The person, in the web.
        yield* dispatch(
          message(threadId, "user-message", { createdBy: "user", creationSource: "web" }),
        ).pipe(asClientSurface({}));
        yield* dispatch(respond(threadId, "approve-by-user", "accept")).pipe(asClientSurface({}));

        expect(yield* recordsOf(threadId)).toEqual([
          { kind: "message", id: "buddy-message", sender: buddy },
          { kind: "request", id: "question", sender: buddy },
          { kind: "request", id: "approve-by-buddy", sender: buddy },
          { kind: "request", id: "deny-by-buddy", sender: buddy },
          { kind: "message", id: "wake", sender: delegace },
        ]);
        expect(yield* recordsOf(ThreadId.make("thread-elsewhere"))).toEqual([]);
      }),
  );

  it.effect("keeps the record in the T3 home, so a restarted server reads it", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread-restart");
      yield* dispatch(message(threadId, "before-restart")).pipe(asMcpClient(buddy));
      const later = yield* ActingSenders.ActingSenders.pipe(
        Effect.provide(Layer.fresh(ActingSenders.layer)),
      );
      expect((yield* later.read(threadId)).records).toEqual([
        { kind: "message", id: "before-restart", sender: buddy },
      ]);
    }),
  );

  it.effect("reaches the web with the scope of reading a thread", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread-route");
      decider.pending.add("route-decision");
      yield* dispatch(message(threadId, "only-for", { text: "Hi" })).pipe(
        asMcpClient({ kind: "buddy", for: "Petr" }),
      );
      yield* dispatch(respond(threadId, "route-decision", "accept")).pipe(
        asClientSurface({ actingSender: delegace }),
      );

      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const senders = yield* ActingSenders.ActingSenders;
      const handler = HttpRouter.toWebHandler(
        ActingSendersRoute.layer.pipe(
          Layer.provideMerge(Layer.succeed(EnvironmentAuth.EnvironmentAuth, auth)),
          Layer.provideMerge(Layer.succeed(ActingSenders.ActingSenders, senders)),
          Layer.provideMerge(NodeHttpPlatform.layer),
          Layer.provideMerge(NodeServices.layer),
        ),
        { disableLogger: true },
      );
      yield* Effect.addFinalizer(() => Effect.promise(() => handler.dispose()));
      const reader = yield* auth.issueSession({ scopes: [AuthOrchestrationReadScope] });
      const noScope = yield* auth.issueSession({ scopes: [] });
      const get = (query: string, token?: string) =>
        handler.handler(
          new Request(`http://localhost${ActingSendersRoute.ACTING_SENDERS_ROUTE}${query}`, {
            headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
          }),
        );
      const answer = yield* Effect.promise(async () => {
        expect((await get(`?threadId=${threadId}`)).status).toBe(401);
        expect((await get(`?threadId=${threadId}`, noScope.token)).status).toBe(403);
        expect((await get("", reader.token)).status).toBe(400);
        const empty = await get("?threadId=thread-without-steps", reader.token);
        expect(await empty.json()).toMatchObject({ messages: [], requests: [] });
        const response = await get(`?threadId=${encodeURIComponent(threadId)}`, reader.token);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        return (await response.json()) as Record<string, unknown>;
      });
      expect(answer.messages).toEqual([
        { messageId: "only-for", sender: { kind: "buddy", for: "Petr" } },
      ]);
      expect(answer.requests).toEqual([{ requestId: "route-decision", sender: delegace }]);
      expect(typeof answer.at).toBe("number");
    }),
  );
});

// A step is recorded right after its command commits, so the web could see Buddy's message before
// its mark. A reader therefore waits for the thread's acting dispatches still running, and its
// answer is complete only until the earliest of them started.
it.effect("a reader waits for a running acting dispatch, and is complete only until it", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("thread-running");
    const senders = yield* ActingSenders.ActingSenders;
    const gate = { entered: yield* Deferred.make<void>(), release: yield* Deferred.make<void>() };
    decider.gate = gate;
    const started = yield* Clock.currentTimeMillis;
    const running = yield* dispatch(message(threadId, "slow")).pipe(
      asMcpClient(buddy),
      Effect.forkChild,
    );
    yield* Deferred.await(gate.entered);

    // The dispatch outlives the wait: the answer reaches only to its start, without its step.
    const waited = yield* senders.read(threadId).pipe(Effect.forkChild({ startImmediately: true }));
    yield* TestClock.adjust("3 seconds");
    expect(yield* Fiber.join(waited)).toEqual({ at: started, records: [] });

    // A reader that comes while it runs gets its step as soon as it ends.
    const reading = yield* senders
      .read(threadId)
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Deferred.succeed(gate.release, undefined);
    yield* Fiber.join(running);
    const answer = yield* Fiber.join(reading);
    expect(answer.records).toEqual([{ kind: "message", id: "slow", sender: buddy }]);
    expect(answer.at).toBeGreaterThan(started);
    decider.gate = undefined;
  }).pipe(Effect.provide(layerUnderTest)),
);
