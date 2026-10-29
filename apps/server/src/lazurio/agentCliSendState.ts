// @effect-diagnostics nodeBuiltinImport:off -- a thread's record file is named by a synchronous SHA-256 of its id.
/**
 * Lazurio overlay (plan DEV-6676): `POST /api/lazurio/agent-cli/send-state` answers a keyed send
 * T3's receipt and message. Until T3 accepts the key's command, a claim makes one send the key's
 * only sender, with its `--wait`, so the wait T3 keeps is the accepted send's.
 */
import * as NodeCrypto from "node:crypto";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  CommandId,
  MessageId,
  ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as ServerConfig from "../config.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { OrchestrationCommandReceiptRepository } from "../persistence/OrchestrationCommandReceipts.ts";
import { authenticateOverlayRoute } from "./routeAuth.ts";

export const AGENT_CLI_SEND_STATE_ROUTE = "/api/lazurio/agent-cli/send-state";

export const SendStateRequest = Schema.Struct({
  threadId: ThreadId,
  commandId: CommandId,
  messageId: MessageId,
  /** Asked before a send: this attempt sends alone, and its wait follows wakes or not. */
  claim: Schema.optional(
    Schema.Struct({ attempt: Schema.String, followWakes: Schema.optional(Schema.Boolean) }),
  ),
  /** Asked after a failed send: the attempt's claim ends unless T3 accepted the command. */
  release: Schema.optional(Schema.String),
});

/** Longer than a send takes, so only a send that never ends, such as a killed one, outlives it. */
export const CLAIM_TTL_MS = 5 * 60 * 1000;

export const SendState = Schema.Struct({
  receipt: Schema.NullOr(
    Schema.Struct({
      status: Schema.Literals(["accepted", "rejected"]),
      threadId: Schema.String,
      error: Schema.NullOr(Schema.String),
    }),
  ),
  message: Schema.NullOr(
    Schema.Struct({ text: Schema.String, runId: Schema.NullOr(Schema.String) }),
  ),
  /** The `followWakes` of the claim in force when T3 accepted the command; null without one. */
  followWakes: Schema.optional(Schema.NullOr(Schema.Boolean)),
  /** Answers a claim: false while another attempt holds the key, so this one must not send. */
  claimed: Schema.optional(Schema.Boolean),
});
export type SendState = typeof SendState.Type;

const ClaimLine = Schema.Struct({
  threadId: Schema.String,
  commandId: Schema.String,
  kind: Schema.Literals(["claim", "release"]),
  attempt: Schema.String,
  at: Schema.Number,
  followWakes: Schema.optional(Schema.Boolean),
});
const encodeClaimLine = Schema.encodeSync(Schema.fromJsonString(ClaimLine));
const decodeClaimLine = Schema.decodeUnknownOption(Schema.fromJsonString(ClaimLine));

/** The command's claim in force, released or not yet; a line cut short by a crash, or another
 * thread's under the same name, is skipped. */
const claimOf = (text: string, threadId: string, commandId: string) => {
  let claim: typeof ClaimLine.Type | null = null;
  for (const line of text.split("\n")) {
    const decoded = decodeClaimLine(line);
    if (Option.isNone(decoded)) continue;
    const { value } = decoded;
    if (value.threadId !== threadId || value.commandId !== commandId) continue;
    if (value.kind === "claim") claim = value;
    else if (claim?.attempt === value.attempt) claim = null;
  }
  return claim;
};

const sha256Hex = (value: string): string =>
  NodeCrypto.createHash("sha256").update(value, "utf8").digest("hex");

export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    // A handler sees only the request's context, so it takes these from the layer's.
    const receipts = yield* OrchestrationCommandReceiptRepository;
    const orchestrator = yield* OrchestratorV2;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const directory = path.join(stateDir, "lazurio", "agent-cli-sends");
    const fileOf = (threadId: string) => path.join(directory, `${sha256Hex(threadId)}.jsonl`);
    const appends = yield* Semaphore.make(1);
    const readClaims = (threadId: string) =>
      fs.readFileString(fileOf(threadId)).pipe(
        Effect.catchIf(
          (error) => error.reason._tag === "NotFound",
          () => Effect.succeed(""),
        ),
      );
    const append = Effect.fn("LazurioAgentCliSendState.append")(function* (
      line: typeof ClaimLine.Type,
    ) {
      yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
      yield* fs.writeFileString(fileOf(line.threadId), `${encodeClaimLine(line)}\n`, {
        flag: "a",
        mode: 0o600,
      });
    });
    /**
     * Claims or releases while T3 has not accepted the command, and answers the claim in force.
     * Only a claim's holder sends, so the claim in force when T3 accepts is the accepted send's.
     */
    const claimFor = Effect.fn("LazurioAgentCliSendState.claimFor")(
      function* (
        threadId: string,
        commandId: string,
        accepted: boolean,
        request: Pick<typeof SendStateRequest.Type, "claim" | "release">,
      ) {
        const current = claimOf(yield* readClaims(threadId), threadId, commandId);
        const at = yield* Clock.currentTimeMillis;
        if (!accepted && request.release !== undefined) {
          yield* append({ threadId, commandId, kind: "release", attempt: request.release, at });
          return {
            followWakes:
              current?.attempt === request.release ? null : (current?.followWakes ?? null),
          };
        }
        if (accepted || request.claim === undefined)
          return { followWakes: current?.followWakes ?? null };
        const { attempt, followWakes } = request.claim;
        if (current !== null && current.attempt !== attempt && at - current.at < CLAIM_TTL_MS)
          return { followWakes: null, claimed: false };
        yield* append({
          threadId,
          commandId,
          kind: "claim",
          attempt,
          at,
          ...(followWakes === undefined ? {} : { followWakes }),
        });
        return { followWakes: followWakes ?? null, claimed: true };
      },
      // A claim that cannot be kept leaves the send alone with its own answer.
      (effect, threadId, _commandId, _accepted, request) =>
        Effect.catchCause(effect, (cause) =>
          Effect.logWarning("Could not record a keyed send's claim.", { threadId, cause }).pipe(
            Effect.as({ followWakes: request.claim?.followWakes ?? null }),
          ),
        ),
    );
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
        const { threadId, commandId, messageId, claim, release } = request.value;
        // A claim is a step of the send, so it takes the scope that sends.
        if (claim !== undefined || release !== undefined)
          yield* authenticateOverlayRoute(AuthOrchestrationOperateScope);
        // One step reads the receipt and claims, so no claim is made after T3 accepted the command.
        const { receipt, claimed } = yield* appends.withPermits(1)(
          Effect.gen(function* () {
            const receipt = yield* receipts.getByCommandId({ commandId }).pipe(Effect.orDie);
            const claimed = yield* claimFor(threadId, commandId, Option.isSome(receipt), {
              claim,
              release,
            });
            return { receipt, claimed };
          }),
        );
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
          message: message === undefined ? null : { text: message.text, runId: message.runId },
          ...claimed,
        } satisfies SendState);
      }),
    );
  }),
);
