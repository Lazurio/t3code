/**
 * Lazurio overlay (plan DEV-6676): T3 scopes a tool's `clientRequestId` to the MCP client's session,
 * and every agent command (agentCli.ts) has its own, so their sessions share one request namespace
 * and a keyed `t3 thread send` runs once, also after a restart. In it the key is digested with the
 * thread and the sender (`agentCliSendKey`); every other MCP client keeps upstream's namespace.
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

/**
 * An agent command's scope in the one namespace of the agent commands, without a web origin, so its
 * thread links stay `t3-thread://` links T3 Code's chat opens; any other unchanged.
 */
const agentCliRequestScope = (
  scope: McpInvocationContext.McpInvocationScope,
): McpInvocationContext.McpInvocationScope => {
  if (scope.client?.label !== AGENT_CLI_SESSION_LABEL) return scope;
  const { webOrigin: _webOrigin, ...client } = scope.client;
  return { ...scope, client, requestNamespace: AGENT_CLI_REQUEST_NAMESPACE };
};

/** `authenticator`, with the agent commands' sessions in one request namespace. */
export const withAgentCliRequestNamespace = <E, R>(
  authenticator: Layer.Layer<McpHttpServer.McpClientAuthenticator, E, R>,
) =>
  Layer.effect(
    McpHttpServer.McpClientAuthenticator,
    Effect.gen(function* () {
      const upstream = yield* McpHttpServer.McpClientAuthenticator;
      return McpHttpServer.McpClientAuthenticator.of({
        authenticate: Effect.fn("LazurioAgentCli.authenticate")(function* (request) {
          const scope = yield* upstream.authenticate(request);
          return scope === undefined ? scope : agentCliRequestScope(scope);
        }),
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

/**
 * The ids T3 gives the send of `sendKey` in the agent commands' namespace. OrchestratorMcpService
 * derives them as `<kind>:mcp:<namespace>:<operation>:<key>`, each part URI-encoded; the release
 * contract pins that. With them the command asks T3 what became of its send (agentCliSendState.ts).
 */
export const agentCliSendIds = (sendKey: string) => {
  const suffix = ["mcp", AGENT_CLI_REQUEST_NAMESPACE, "thread-send", sendKey]
    .map(encodeURIComponent)
    .join(":");
  return { commandId: `command:${suffix}`, messageId: `message:${suffix}` };
};
