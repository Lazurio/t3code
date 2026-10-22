/**
 * Lazurio overlay (plan DEV-6676): what became of an agent command's keyed send, so that
 * `t3 thread send --idempotency-key` can tell a final refusal from a failure worth retrying, and a
 * repeat of a delivered key from a different message under the same key (agentCli.ts). T3's MCP
 * tool answers only with its own failure codes, which do not name either case.
 *
 * `POST /api/lazurio/agent-cli/send-state` takes `{threadId, commandId, messageId}`, the ids T3
 * derives from the key (`agentCliSendIds`), and answers T3's receipt of that command and the
 * message it made: `{receipt: {status, threadId, error} | null, message: {text} | null}`. It reads
 * and changes nothing else, with the scope of reading threads.
 */
import { AuthOrchestrationReadScope, CommandId, MessageId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { OrchestrationCommandReceiptRepository } from "../persistence/OrchestrationCommandReceipts.ts";
import { authenticateOverlayRoute } from "./routeAuth.ts";

export const AGENT_CLI_SEND_STATE_ROUTE = "/api/lazurio/agent-cli/send-state";

export const SendStateRequest = Schema.Struct({
  threadId: ThreadId,
  commandId: CommandId,
  messageId: MessageId,
});

export const SendState = Schema.Struct({
  receipt: Schema.NullOr(
    Schema.Struct({
      status: Schema.Literals(["accepted", "rejected"]),
      threadId: Schema.String,
      error: Schema.NullOr(Schema.String),
    }),
  ),
  message: Schema.NullOr(Schema.Struct({ text: Schema.String })),
});
export type SendState = typeof SendState.Type;

export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    // A handler sees only the request's context, so it takes these from the layer's.
    const receipts = yield* OrchestrationCommandReceiptRepository;
    const orchestrator = yield* OrchestratorV2;
    yield* router.add(
      "POST",
      AGENT_CLI_SEND_STATE_ROUTE,
      Effect.gen(function* () {
        yield* authenticateOverlayRoute(AuthOrchestrationReadScope);
        const request = yield* HttpServerRequest.schemaBodyJson(SendStateRequest).pipe(
          Effect.option,
        );
        if (Option.isNone(request))
          return HttpServerResponse.jsonUnsafe({ error: "invalid-request" }, { status: 400 });
        const { threadId, commandId, messageId } = request.value;
        const receipt = yield* receipts.getByCommandId({ commandId }).pipe(Effect.orDie);
        // A thread that does not exist has no message.
        const message = yield* orchestrator
          .getThreadRecords(threadId, ["messages"], { messageIds: [messageId] })
          .pipe(
            Effect.map((records) => records.messages.find((record) => record.id === messageId)),
            Effect.orElseSucceed(() => undefined),
          );
        return HttpServerResponse.jsonUnsafe({
          receipt: Option.match(receipt, {
            onNone: () => null,
            onSome: ({ status, aggregateId, error }) => ({
              status,
              threadId: aggregateId,
              error,
            }),
          }),
          message: message === undefined ? null : { text: message.text },
        } satisfies SendState);
      }),
    );
  }),
);
