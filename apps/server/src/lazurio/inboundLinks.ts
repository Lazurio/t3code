/**
 * Lazurio overlay (decisions 0246 and 0091, Lazurio/LazurioPlatform): nothing links into a Personal
 * Environment. Its T3 Code links out to its person's Work Environments as upstream does, but it
 * refuses a peer link's registration and a linked client on `/mcp`. Machines name the Environment's
 * kind in its handover; Buddy's T3 Code runs only on a Personal Environment.
 */
import { AuthMcpRegistrationError, MCP_PEER_LINK_SOFTWARE_ID } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as McpOAuth from "../auth/McpOAuth.ts";
import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import { isBuddySurfaceEnvironment } from "./buddySurface.ts";

/** The handover Machines write into every hosted Environment, root-owned and world-readable. */
const MACHINE_IDENTITY_PATH = "/etc/lazurio/lazurio.machine.json";

export const INBOUND_LINKS_REFUSED =
  "That machine is a Personal Environment, and nothing links into one. Link from it instead.";

const MachineIdentity = Schema.Struct({
  machine: Schema.Struct({ kind: Schema.String }),
  relationships: Schema.optionalKey(Schema.Struct({ zone: Schema.optionalKey(Schema.String) })),
});
const decodeMachineIdentity = Schema.decodeUnknownOption(Schema.fromJsonString(MachineIdentity));

/**
 * Whether this machine refuses links into it: Buddy's T3 Code, or a handover that names a Personal
 * Environment. Without a handover it is not Lazurio's, so upstream's; one it cannot read, or of a
 * kind it does not know, refuses.
 */
export const refusesInboundLinks = Effect.fn("LazurioInboundLinks.refuses")(function* (
  identityPath: string,
) {
  if (isBuddySurfaceEnvironment(yield* HostProcess.Environment)) return true;
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(identityPath).pipe(
    Effect.asSome,
    Effect.catch((error) =>
      Effect.succeed(error.reason._tag === "NotFound" ? Option.none<string>() : Option.some("")),
    ),
  );
  if (Option.isNone(text)) return false;
  const identity = Option.getOrUndefined(decodeMachineIdentity(text.value));
  const zone = identity?.relationships?.zone;
  if (identity?.machine.kind === "workspace-vm" && zone !== "personal") return false;
  if (identity?.machine.kind !== "personal-vm") {
    yield* Effect.logWarning("Refusing links into this machine: its Lazurio handover is unclear.", {
      identityPath,
    });
  }
  return true;
});

/** `live`, refusing a peer link's registration on a machine that refuses links into it. */
export const refuseInboundLinkRegistration = <E, R>(
  live: Layer.Layer<McpOAuth.McpOAuth, E, R>,
  identityPath: string = MACHINE_IDENTITY_PATH,
) =>
  Layer.effect(
    McpOAuth.McpOAuth,
    Effect.gen(function* () {
      const oauth = yield* McpOAuth.McpOAuth;
      if (!(yield* refusesInboundLinks(identityPath))) return oauth;
      return McpOAuth.McpOAuth.of({
        ...oauth,
        register: Effect.fn("LazurioInboundLinks.register")(function* (input) {
          if (input.software_id !== MCP_PEER_LINK_SOFTWARE_ID) return yield* oauth.register(input);
          return yield* new AuthMcpRegistrationError({
            error: "invalid_client_metadata",
            error_description: INBOUND_LINKS_REFUSED,
          });
        }),
      });
    }),
  ).pipe(Layer.provide(live));

/** `live`, admitting no linked client to `/mcp` on a machine that refuses links into it. */
export const refuseLinkedClients = <E, R>(
  live: Layer.Layer<McpHttpServer.McpClientAuthenticator, E, R>,
  identityPath: string = MACHINE_IDENTITY_PATH,
) =>
  Layer.effect(
    McpHttpServer.McpClientAuthenticator,
    Effect.gen(function* () {
      const authenticator = yield* McpHttpServer.McpClientAuthenticator;
      if (!(yield* refusesInboundLinks(identityPath))) return authenticator;
      return McpHttpServer.McpClientAuthenticator.of({
        authenticate: Effect.fn("LazurioInboundLinks.authenticate")(function* (request) {
          const scope = yield* authenticator.authenticate(request);
          if (scope?.client?.linked !== true) return scope;
          yield* Effect.logWarning(INBOUND_LINKS_REFUSED, { client: scope.client.label });
          return undefined;
        }),
      });
    }),
  ).pipe(Layer.provide(live));
