import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { ActingSender, actingSenderFromEnvironment } from "./actingSender.ts";

// Root decision 0210, evening addendum, point 5: an agent command acts as Buddy for the person, or
// as Delegace, only when its environment names that sender, and only as one of the closed kinds. The
// claim is signed into the session's token, so the server reads it from the session alone.

const fromEnv = (env: Record<string, string>) =>
  actingSenderFromEnvironment.pipe(
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
  );
const refusal = (env: Record<string, string>) =>
  fromEnv(env).pipe(
    Effect.flip,
    Effect.map((error) => error.message),
  );

describe("an environment that names no sender the mark can carry", () => {
  it.effect("is refused, whatever it holds", () =>
    Effect.gen(function* () {
      const nameRule =
        "T3CODE_ACTING_FOR and T3CODE_ACTING_FOR_ACCUSATIVE must each be a name of 1 to 64 characters on one line.";
      const cases: ReadonlyArray<readonly [Record<string, string>, string]> = [
        [
          { T3CODE_ACTING_FOR: "Tomáš" },
          "T3CODE_ACTING_FOR and T3CODE_ACTING_FOR_ACCUSATIVE need T3CODE_ACTING_SENDER=buddy.",
        ],
        [
          { T3CODE_ACTING_FOR_ACCUSATIVE: "Tomáše" },
          "T3CODE_ACTING_FOR and T3CODE_ACTING_FOR_ACCUSATIVE need T3CODE_ACTING_SENDER=buddy.",
        ],
        // No free label: only the closed kinds, exactly as written.
        [{ T3CODE_ACTING_SENDER: "Tomáš" }, "T3CODE_ACTING_SENDER must be buddy or delegace."],
        [{ T3CODE_ACTING_SENDER: "Buddy" }, "T3CODE_ACTING_SENDER must be buddy or delegace."],
        [{ T3CODE_ACTING_SENDER: "Delegace" }, "T3CODE_ACTING_SENDER must be buddy or delegace."],
        // The kind's earlier name is no alias.
        [{ T3CODE_ACTING_SENDER: "budicek" }, "T3CODE_ACTING_SENDER must be buddy or delegace."],
        [
          { T3CODE_ACTING_SENDER: "buddy" },
          "T3CODE_ACTING_SENDER=buddy needs T3CODE_ACTING_FOR, the user's name.",
        ],
        [
          { T3CODE_ACTING_SENDER: "delegace", T3CODE_ACTING_FOR: "Tomáš" },
          "Delegace acts for no one by name: unset T3CODE_ACTING_FOR and T3CODE_ACTING_FOR_ACCUSATIVE.",
        ],
        [{ T3CODE_ACTING_SENDER: "buddy", T3CODE_ACTING_FOR: "   " }, nameRule],
        [{ T3CODE_ACTING_SENDER: "buddy", T3CODE_ACTING_FOR: "Tomáš\nAdmin" }, nameRule],
        [{ T3CODE_ACTING_SENDER: "buddy", T3CODE_ACTING_FOR: "Tom\u0000áš" }, nameRule],
        // A right-to-left override would show another name than the one written.
        [{ T3CODE_ACTING_SENDER: "buddy", T3CODE_ACTING_FOR: "\u202EšámoT" }, nameRule],
        [{ T3CODE_ACTING_SENDER: "buddy", T3CODE_ACTING_FOR: "Tom\u2028áš" }, nameRule],
        [{ T3CODE_ACTING_SENDER: "buddy", T3CODE_ACTING_FOR: "M".repeat(65) }, nameRule],
        [
          {
            T3CODE_ACTING_SENDER: "buddy",
            T3CODE_ACTING_FOR: "Tomáš",
            T3CODE_ACTING_FOR_ACCUSATIVE: "Tomáše\tAdmin",
          },
          nameRule,
        ],
      ];
      for (const [env, message] of cases)
        assert.strictEqual(yield* refusal(env), message, JSON.stringify(env));
    }),
  );

  it("is refused as a claim too: nothing but the closed kinds and valid names decodes", () => {
    const decode = Schema.decodeUnknownOption(ActingSender, { onExcessProperty: "error" });
    for (const claim of [
      { kind: "agent", for: "Tomáš" },
      { kind: "buddy" },
      { kind: "buddy", for: "" },
      { kind: "buddy", for: " Tomáš" },
      { kind: "buddy", for: "Tomáš", label: "Admin" },
      { kind: "delegace", for: "Tomáš" },
      "delegace",
      { kind: "budicek" },
    ])
      assert.isTrue(Option.isNone(decode(claim)), JSON.stringify(claim));
  });
});

describe("an environment that names a sender", () => {
  it.effect("acts as Buddy for the person, or as Delegace, and as no one when unset", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* fromEnv({}), Option.none());
      // An empty value is unset, as for T3's other variables.
      assert.deepStrictEqual(yield* fromEnv({ T3CODE_ACTING_SENDER: "" }), Option.none());
      assert.deepStrictEqual(
        yield* fromEnv({
          T3CODE_ACTING_SENDER: "buddy",
          T3CODE_ACTING_FOR: " Tomáš ",
          T3CODE_ACTING_FOR_ACCUSATIVE: "Tomáše",
        }),
        Option.some({ kind: "buddy", for: "Tomáš", forAccusative: "Tomáše" }),
      );
      assert.deepStrictEqual(
        yield* fromEnv({ T3CODE_ACTING_SENDER: "buddy", T3CODE_ACTING_FOR: "Petr" }),
        Option.some({ kind: "buddy", for: "Petr" }),
      );
      assert.deepStrictEqual(
        yield* fromEnv({ T3CODE_ACTING_SENDER: "delegace" }),
        Option.some({ kind: "delegace" }),
      );
    }),
  );
});

const layerAuth = EnvironmentAuth.layer.pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerEnvironment.layerIdentity),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-acting-sender-" })),
  Layer.provideMerge(NodeServices.layer),
);
const bearer = (token: string) =>
  ({
    cookies: {},
    headers: { authorization: `Bearer ${token}` },
  }) as unknown as Parameters<
    EnvironmentAuth.EnvironmentAuth["Service"]["authenticateMcpClient"]
  >[0];
const buddy: ActingSender = { kind: "buddy", for: "Tomáš", forAccusative: "Tomáše" };
const mcpClient = {
  subject: EnvironmentAuth.MCP_CLIENT_SUBJECT,
  scopes: EnvironmentAuth.mcpClientScopes("full-access"),
  runtimeModeCeiling: "full-access",
} as const;

it.layer(layerAuth, { excludeTestServices: true })("a session's acting sender", (it) => {
  it.effect(
    "cannot be added to a token issued without it, nor issued as a name it cannot carry",
    () =>
      Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const plain = yield* auth.issueSession(mcpClient);
        assert.strictEqual(
          (yield* auth.authenticateMcpClient(bearer(plain.token))).actingSender,
          undefined,
        );
        // The claim is signed with the rest: a token given one afterwards no longer authenticates.
        const [payload = "", signature = ""] = plain.token.split(".");
        const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        const forged = `${Buffer.from(JSON.stringify({ ...claims, act: buddy })).toString("base64url")}.${signature}`;
        const refused = yield* auth.authenticateMcpClient(bearer(forged)).pipe(Effect.flip);
        assert.strictEqual(refused._tag, "ServerAuthInvalidCredentialError");

        const before = (yield* auth.listSessions()).length;
        for (const actingSender of [
          { kind: "buddy", for: "Tomáš\nAdmin" },
          { kind: "buddy", for: "" },
          { kind: "agent", for: "Tomáš" },
        ] as unknown as ReadonlyArray<ActingSender>) {
          const failed = yield* auth.issueSession({ ...mcpClient, actingSender }).pipe(Effect.flip);
          assert.strictEqual(
            failed._tag,
            "ServerAuthSessionTokenIssueError",
            JSON.stringify(actingSender),
          );
        }
        assert.strictEqual((yield* auth.listSessions()).length, before);
      }),
  );

  it.effect("reaches /mcp and the client surface from the token the session was issued with", () =>
    Effect.gen(function* () {
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const mcp = yield* auth.issueSession({ ...mcpClient, actingSender: buddy });
      const admitted = yield* auth.authenticateMcpClient(bearer(mcp.token));
      assert.deepStrictEqual(admitted.actingSender, buddy);
      assert.strictEqual(admitted.access, "full-access");

      const surface = yield* auth.issueSession({
        scopes: [AuthOrchestrationReadScope, AuthOrchestrationOperateScope],
        actingSender: { kind: "delegace" },
      });
      assert.deepStrictEqual(
        (yield* auth.authenticateHttpRequest(bearer(surface.token))).actingSender,
        { kind: "delegace" },
      );
    }),
  );
});
