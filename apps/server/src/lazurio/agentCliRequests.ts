/**
 * Lazurio overlay (plan DEV-6676): an agent command's idempotency key holds across commands. T3
 * makes a tool's `clientRequestId` idempotent within the request namespace of its MCP client,
 * which is the client's session, and every agent command (agentCli.ts) signs in with a session of
 * its own. A retry from a new command would therefore run the operation again. The agent commands'
 * sessions share one namespace instead, so the same key maps to the same command, and T3's command
 * receipts make it run once, also after a restart: `t3 thread send --idempotency-key` sends once per
 * key (budíček's wake). Every other MCP client keeps upstream's namespace.
 *
 * In that one namespace a key alone would name one message for every thread and every sender, so a
 * second thread, or another sender, would get the first send's result instead of its message. The
 * command therefore hands T3 a digest of the key with the thread and the sender (`agentCliSendKey`).
 *
 * The namespace also owns the uploads a client prepares (`t3_attachment_prepare_upload`), so one
 * agent command can attach what another prepared. Every agent command acts as the Environment's
 * owner, so nothing crosses a boundary there.
 */
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";

import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import type * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import { AGENT_CLI_SESSION_LABEL } from "./agentCliConnection.ts";

export const AGENT_CLI_REQUEST_NAMESPACE = "lazurio:agent-cli";

/** An agent command's scope in the one namespace of the agent commands; any other unchanged. */
export const agentCliRequestScope = (
  scope: McpInvocationContext.McpInvocationScope,
): McpInvocationContext.McpInvocationScope =>
  scope.client?.label === AGENT_CLI_SESSION_LABEL
    ? { ...scope, requestNamespace: AGENT_CLI_REQUEST_NAMESPACE }
    : scope;

/** `authenticator`, with the agent commands' sessions in one request namespace. */
export const withAgentCliRequestNamespace = <E, R>(
  authenticator: Layer.Layer<McpHttpServer.McpClientAuthenticator, E, R>,
) =>
  Layer.effect(
    McpHttpServer.McpClientAuthenticator,
    Effect.gen(function* () {
      const upstream = yield* McpHttpServer.McpClientAuthenticator;
      return McpHttpServer.McpClientAuthenticator.of({
        authenticate: (request) =>
          upstream
            .authenticate(request)
            .pipe(
              Effect.map((scope) => (scope === undefined ? scope : agentCliRequestScope(scope))),
            ),
      });
    }),
  ).pipe(Layer.provide(authenticator));

/** The variables that name who an agent command sends as: Buddy for a person, or budíček. */
const SENDER_VARIABLES = ["T3CODE_ACTING_SENDER", "T3CODE_ACTING_FOR"] as const;

/**
 * The `clientRequestId` of `t3 thread send --idempotency-key <key>`: a digest of the key, the thread
 * and who sends it, as the command's environment names the sender (unset for the person's own
 * commands). The same command line names one message in every run and after restarts; the same
 * key for another thread or from another sender names another.
 */
export const agentCliSendKey = Effect.fn("LazurioAgentCli.sendKey")(function* (input: {
  readonly threadId: string;
  readonly key: string;
}) {
  const environment = yield* HostProcess.Environment;
  const parts = [
    "thread-send",
    input.threadId,
    ...SENDER_VARIABLES.map((name) => environment[name] ?? ""),
    input.key,
  ];
  // Each part with its length first, so no two lists of parts read as the same text.
  const text = parts.map((part) => `${part.length}:${part}`).join("");
  const digest = yield* (yield* Crypto.Crypto)
    .digest("SHA-256", new TextEncoder().encode(text))
    .pipe(Effect.orDie);
  return `lazurio-send:${Hex.encode(digest)}`;
});
