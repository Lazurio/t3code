/**
 * Lazurio overlay (root decision 0210): `t3 lazurio buddy thread` names Buddy's one thread
 * (buddySurfaceThread.ts) and `t3 lazurio buddy signal` the sign by his avatar (buddySignal.ts).
 * `--json` prints the answer or `{"error": {"code", "message"}}`; exit 1 refused, 3 not running.
 */
import * as Cause from "effect/Cause";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command, Flag } from "effect/cli";

import { agentCommandFlags, runAgentCommand } from "./agentCli.ts";
import {
  type AgentCliConnection,
  type AgentCliFailure,
  agentCliFailure,
  isAgentCliFailure,
  withAgentCliConnection,
} from "./agentCliConnection.ts";
import { BUDDY_SIGNAL_ROUTE, BuddySignal } from "./buddySignal.ts";
import { BUDDY_THREAD_ROUTE, BuddyThread } from "./buddySurfaceThread.ts";

const decodeBuddyThread = Schema.decodeUnknownOption(BuddyThread);
const decodeRefusal = Schema.decodeUnknownOption(
  Schema.Struct({ error: Schema.String, message: Schema.optional(Schema.String) }),
);

const threadCommand = Command.make("thread", agentCommandFlags).pipe(
  Command.withDescription(
    "Print Buddy's one thread in Buddy's T3 Code, made the first time anyone asks.",
  ),
  Command.withHandler((flags) =>
    runAgentCommand(
      flags,
      (connection) =>
        connection.postRoute(BUDDY_THREAD_ROUTE, {}).pipe(
          Effect.flatMap(({ status, body }) => {
            const thread = decodeBuddyThread(body);
            if (status === 200 && Option.isSome(thread)) return Effect.succeed(thread.value);
            const refusal = Option.getOrUndefined(decodeRefusal(body));
            return Effect.fail(
              agentCliFailure(
                refusal?.error.replaceAll("-", "_") ?? "request_failed",
                refusal?.message ?? `T3 Code answered HTTP ${status}.`,
              ),
            );
          }),
        ),
      (thread) => `Buddy's thread ${thread.threadId} in project ${thread.projectId}.`,
    ),
  ),
);

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeBuddySignal = Schema.decodeUnknownOption(BuddySignal);

/** Buddy's signal now; a refusal fails with its route code (`not_buddy`, `no_thread`). */
const readBuddySignal = (connection: Pick<AgentCliConnection, "getRoute">) =>
  connection.getRoute(BUDDY_SIGNAL_ROUTE).pipe(
    Effect.flatMap(({ status, body }) => {
      const signal = decodeBuddySignal(body);
      if (status === 200 && Option.isSome(signal)) return Effect.succeed(signal.value);
      if (status === 401 || status === 403)
        return Effect.fail(
          agentCliFailure("unauthorized", `T3 Code refused the session (HTTP ${status}).`),
        );
      const refusal = Option.getOrUndefined(decodeRefusal(body));
      return Effect.fail(
        agentCliFailure(
          refusal?.error.replaceAll("-", "_") ?? "request_failed",
          refusal?.message ?? `T3 Code answered HTTP ${status}.`,
        ),
      );
    }),
  );

/** The line `--follow` prints while it cannot say Buddy's state: never a quiet one. */
const unavailableLine = (failure: AgentCliFailure) => ({
  version: 1 as const,
  state: "unavailable" as const,
  reason: failure.code,
  message: failure.message,
});

const FOLLOW_SESSION_TTL = Duration.hours(1);
// Scheduled tasks change no thread, so their failures are read on this beat.
const FOLLOW_REREAD = Duration.seconds(60);
const FOLLOW_RECONNECT = [1, 2, 5, 10, 30].map((seconds) => Duration.seconds(seconds));

/**
 * Print Buddy's signal and then a line whenever any of it changes, `startedBy` and `since` included.
 * While it cannot read it (T3 down, the session refused, the stream dropped) it prints
 * `unavailable` with the reason and reconnects; only a server without Buddy ends it.
 */
export const followBuddySignal = Effect.fn("LazurioBuddySignal.follow")(function* <R>(
  connect: (
    use: (connection: AgentCliConnection) => Effect.Effect<unknown, AgentCliFailure>,
  ) => Effect.Effect<unknown, AgentCliFailure, R>,
  print: (line: string) => Effect.Effect<void>,
) {
  let last: string | undefined;
  let threadId: string | undefined;
  const emit = (line: unknown) => {
    const text = encodeJson(line);
    if (text === last) return Effect.void;
    last = text;
    return print(text);
  };
  let attempt = 0;
  while (true) {
    const exit = yield* Effect.exit(
      connect((connection) => {
        const read = readBuddySignal(connection).pipe(
          Effect.flatMap((signal) => {
            threadId = signal.threadId;
            attempt = 0;
            return emit(signal);
          }),
          // Before his first visit his thread does not exist yet: say so and keep following.
          Effect.catchIf(
            (failure) => failure.code === "no_thread",
            (failure) => {
              threadId = undefined;
              return emit(unavailableLine(failure));
            },
          ),
        );
        return read.pipe(
          Effect.andThen(
            Stream.merge(
              connection
                .subscribeShell({})
                .pipe(
                  Stream.filter(
                    (item) =>
                      item.kind === "thread.updated" &&
                      (threadId === undefined || item.thread.id === threadId),
                  ),
                ),
              // The beat after the first reading; the shell's end ends the connection.
              Stream.tick(FOLLOW_REREAD).pipe(Stream.drop(1)),
              { haltStrategy: "left" },
            ).pipe(Stream.runForEach(() => read)),
          ),
          Effect.andThen(
            Effect.fail(agentCliFailure("connection_lost", "T3 Code ended the stream.")),
          ),
        );
      }),
    );
    if (exit._tag === "Success") return;
    const failure = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
    const reported = isAgentCliFailure(failure)
      ? failure
      : agentCliFailure("request_failed", "Reading Buddy's signal failed.");
    yield* emit(unavailableLine(reported));
    if (reported.code === "not_buddy") return yield* reported;
    yield* Effect.sleep(FOLLOW_RECONNECT[Math.min(attempt, FOLLOW_RECONNECT.length - 1)]!);
    attempt += 1;
  }
});

const signalCommand = Command.make("signal", {
  ...agentCommandFlags,
  follow: Flag.Boolean("follow").pipe(
    Flag.withDescription(
      "Keep printing a JSON line whenever the signal changes, and `unavailable` while it cannot be read.",
    ),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription(
    "Print the sign by Buddy's avatar: whether he waits for the person, failed, or has answered.",
  ),
  Command.withHandler((flags) =>
    flags.follow
      ? followBuddySignal(
          (use) => withAgentCliConnection(flags, use, { sessionTtl: FOLLOW_SESSION_TTL }),
          Console.log,
        )
      : runAgentCommand(
          flags,
          readBuddySignal,
          (signal) =>
            `Buddy is ${signal.state}${signal.since === null ? "" : ` since ${signal.since}`}.`,
        ),
  ),
);

export const buddyCommand = Command.make("buddy").pipe(
  Command.withDescription("Buddy's T3 Code."),
  Command.withSubcommands([threadCommand, signalCommand]),
);
