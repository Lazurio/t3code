// @effect-diagnostics nodeBuiltinImport:off - Each case writes its Machine's handover to a temporary folder.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { NodeHttpServer } from "@effect/platform-node";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentHttpApi,
  type ExecutionEnvironmentDescriptor,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as AuthHttp from "../auth/http.ts";
import * as McpOAuth from "../auth/McpOAuth.ts";
import * as McpOAuthHttp from "../auth/mcpOAuthHttp.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as CloudLink from "../cloud/CloudLink.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ServerHttp from "../http.ts";
import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import * as PeerLinks from "../peer/PeerLinks.ts";
import { descriptorOf, layerLinkingEnvironment } from "../peer/PeerLinks.testkit.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  INBOUND_LINKS_REFUSED,
  refuseInboundLinkRegistration,
  refuseLinkedClients,
  refusesInboundLinks,
} from "./inboundLinks.ts";

/** A handover as Machines write it, reduced to what the guard reads. */
const handover = (kind: string, zone?: string) =>
  JSON.stringify({
    schema_version: "lazurio.machine.v1",
    machine: { id: `env-${kind}`, kind, name: "env", vmid: 101 },
    ...(zone === undefined ? {} : { relationships: { zone, peers: [] } }),
  });

/** The path of a handover holding `content`, or of none when `content` is undefined. */
const handoverAt = (content?: string) => {
  const folder = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "lazurio-machine-"));
  const path = NodePath.join(folder, "lazurio.machine.json");
  if (content !== undefined) NodeFS.writeFileSync(path, content);
  return path;
};

describe("which machine refuses links into it", () => {
  const cases: ReadonlyArray<readonly [string, string | undefined, boolean, NodeJS.ProcessEnv?]> = [
    ["no handover: not a Lazurio Environment", undefined, false],
    ["a Work Environment", handover("workspace-vm", "work"), false],
    ["a Work Environment without relationships", handover("workspace-vm"), false],
    ["a Personal Environment", handover("personal-vm", "personal"), true],
    ["a Personal Environment without relationships", handover("personal-vm"), true],
    ["a handover whose zone is personal", handover("workspace-vm", "personal"), true],
    ["a kind the guard does not know", handover("conglomerate-host"), true],
    ["a handover it cannot understand", "{ not json", true],
    ["Buddy's T3 Code, also without a handover", undefined, true, { T3CODE_LAZURIO_BUDDY: "1" }],
  ];
  it.effect.each(cases)("%s", ([, content, refuses, environment = {}]) =>
    Effect.gen(function* () {
      assert.strictEqual(yield* refusesInboundLinks(handoverAt(content)), refuses);
    }).pipe(
      Effect.provide(NodeServices.layer),
      Effect.provideService(HostProcess.Environment, environment),
    ),
  );
});

const Probe = Schema.Struct({ caller: Schema.String });
const ProbeToolkit = Toolkit.make(
  Tool.make("probe", {
    description: "Reports the calling client.",
    success: Probe,
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies: [McpInvocationContext.McpInvocationContext],
  }),
);
const probeTools = McpHttpServer.toolkitRegistration(
  ProbeToolkit,
  McpToolAccess.toLayer(ProbeToolkit, {
    probe: McpToolAccess.reads(() =>
      Effect.map(McpInvocationContext.McpInvocationContext, (scope) => ({
        caller: scope.client?.label ?? "none",
      })),
    ),
  }),
);

class PeerTestApi extends HttpApi.make("environment")
  .add(EnvironmentHttpApi.groups.metadata)
  .add(EnvironmentHttpApi.groups.mcpOAuth) {}

/**
 * The environment a link points at, as `server.ts` builds its MCP OAuth and `/mcp`, on a machine
 * whose handover is at `identityPath`. `guardRegistration: false` stands for a link registered
 * before the guard was there.
 */
const serveTarget = (
  descriptor: ExecutionEnvironmentDescriptor,
  identityPath: string,
  { guardRegistration = true }: { readonly guardRegistration?: boolean } = {},
) =>
  Effect.gen(function* () {
    const authContext = yield* EnvironmentAuth.layer.pipe(
      Layer.provide(ManagedPolicy.layerTest()),
      Layer.provideMerge(ServerSettings.layerTest({ linkedEnvironmentsEnabled: true })),
      Layer.provide(Sqlite.layerMemory),
      Layer.provideMerge(ServerSecretStore.layer),
      Layer.provideMerge(ServerEnvironment.layerIdentity),
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-inbound-links-" })),
      Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
      Layer.fresh,
      Layer.build,
    );
    const oauth = guardRegistration
      ? refuseInboundLinkRegistration(McpOAuth.layer, identityPath)
      : McpOAuth.layer;
    const layerRoutes = Layer.mergeAll(
      HttpApiBuilder.layer(PeerTestApi).pipe(
        Layer.provide(
          McpOAuthHttp.layer.pipe(
            Layer.provide(oauth),
            Layer.provide(
              Layer.mock(CloudLink.CloudLink)({
                linkState: () =>
                  Effect.succeed({
                    linked: false,
                    cloudUserId: null,
                    relayUrl: null,
                    relayIssuer: null,
                    publishAgentActivity: false,
                  }),
              }),
            ),
          ),
        ),
        Layer.provide(ServerHttp.layerServerEnvironmentHttpApi),
        Layer.provide(AuthHttp.layerAuthenticatedAuth),
      ),
      McpHttpServer.layerMcpTransport(probeTools).pipe(
        Layer.provide(
          Layer.mock(McpSessionRegistry.McpSessionRegistry)({ resolve: () => Effect.undefined }),
        ),
        Layer.provide(refuseLinkedClients(McpOAuth.layerMcpClientAuthenticator, identityPath)),
      ),
    ).pipe(
      Layer.provide(
        Layer.succeed(ServerEnvironment.ServerEnvironment, {
          getEnvironmentId: Effect.succeed(descriptor.environmentId),
          getDescriptor: Effect.succeed(descriptor),
        }),
      ),
      Layer.provide(Layer.succeedContext(authContext)),
    );
    yield* HttpRouter.serve(layerRoutes, { disableListenLog: true, disableLogger: true }).pipe(
      Layer.fresh,
      Layer.build,
    );
    const address = (yield* HttpServer.HttpServer).address;
    if (address._tag === "UnixPathAddress") return yield* Effect.die("expected a TCP address");
    const auth = Context.get(authContext, EnvironmentAuth.EnvironmentAuth);
    return {
      url: `http://127.0.0.1:${address.port}`,
      auth,
      linkedSessions: Effect.map(auth.listSessions(), (sessions) =>
        sessions.filter((session) => session.client.label?.startsWith("T3 Code · ")),
      ),
    };
  });

const personal = descriptorOf("environment-personal", "Personal");
const work = descriptorOf("environment-work", "Work");

/** The Environment that links. Links out read no handover, so its kind does not matter here. */
const linkFrom = (descriptor: ExecutionEnvironmentDescriptor) =>
  layerLinkingEnvironment(descriptor).pipe(
    Layer.build,
    Effect.map((context) => ({
      links: Context.get(context, PeerLinks.PeerLinks),
      peer: Context.get(context, PeerMcpClient.PeerMcpClient),
    })),
  );

const probe = (
  from: Effect.Success<ReturnType<typeof linkFrom>>,
  to: ExecutionEnvironmentDescriptor,
) =>
  from.peer.call({
    environmentId: to.environmentId,
    tool: "probe",
    arguments: {},
    limits: { runtimeMode: "full-access", interactionMode: "default" },
    success: Probe,
  });

describe("links between a Personal and a Work Environment", () => {
  it.effect("a Personal Environment links out to a Work Environment, as upstream does", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const target = yield* serveTarget(work, handoverAt(handover("workspace-vm", "work")));
        const from = yield* linkFrom(personal);
        const pairing = yield* target.auth.issuePairingCredential();
        yield* from.links.link({
          url: target.url,
          pairingCode: pairing.credential,
          access: "auto",
        });
        assert.deepStrictEqual(yield* probe(from, work), { caller: "T3 Code · Personal" });
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("nothing links into a Personal Environment", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const target = yield* serveTarget(
          personal,
          handoverAt(handover("personal-vm", "personal")),
        );
        const from = yield* linkFrom(work);
        const pairing = yield* target.auth.issuePairingCredential();
        const refused = yield* from.links
          .link({ url: target.url, pairingCode: pairing.credential, access: "auto" })
          .pipe(Effect.flip);
        assert.strictEqual(refused.reason, "pairing_rejected");
        assert.include(refused.message, INBOUND_LINKS_REFUSED);
        assert.deepStrictEqual(yield* target.linkedSessions, []);
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("a Personal Environment's /mcp admits no linked client", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const target = yield* serveTarget(
          personal,
          handoverAt(handover("personal-vm", "personal")),
          { guardRegistration: false },
        );
        const from = yield* linkFrom(work);
        const pairing = yield* target.auth.issuePairingCredential();
        yield* from.links.link({
          url: target.url,
          pairingCode: pairing.credential,
          access: "auto",
        });
        // Linking again is then refused at registration, with the reason.
        const refused = yield* probe(from, personal).pipe(Effect.flip);
        assert.strictEqual(refused.code, "capability_denied");
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );
});
