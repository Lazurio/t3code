/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): `t3 lazurio buddy thread`, which names the
 * thread to post a wake into: Buddy's one thread (buddySurfaceThread.ts). It runs as an agent
 * command (agentCli.ts): `--json` prints `{"threadId", "projectId"}` or `{"error": {"code",
 * "message"}}`, and the exit code is 0, 1 for a refusal, 3 when T3 Code is not running.
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Command } from "effect/cli";

import { agentCommandFlags, runAgentCommand } from "./agentCli.ts";
import { agentCliFailure } from "./agentCliConnection.ts";
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

export const buddyCommand = Command.make("buddy").pipe(
  Command.withDescription("Buddy's T3 Code."),
  Command.withSubcommands([threadCommand]),
);
