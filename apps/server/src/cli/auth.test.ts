// @effect-diagnostics nodeBuiltinImport:off - The CLI writes its auth state under a temporary home.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import { assert, expect, it } from "@effect/vitest";
import { afterAll } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import { cli } from "../binCli.ts";
import { formatIssuedSession } from "../cliAuthFormat.ts";
import * as ServerConfig from "../config.ts";

const run = (args: ReadonlyArray<string>) =>
  Command.runWith(cli, { version: "0.0.0" })(args).pipe(
    Effect.provide(Layer.mergeAll(NodeServices.layer, NetService.layer)),
  );
const baseDirs: Array<string> = [];
const makeBaseDir = () => {
  const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-auth-cli-"));
  baseDirs.push(baseDir);
  return baseDir;
};
afterAll(() => {
  for (const baseDir of baseDirs) NodeFS.rmSync(baseDir, { recursive: true, force: true });
});
const decodeIssued = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      token: Schema.String,
      subject: Schema.String,
      runtimeModeCeiling: Schema.optional(Schema.String),
    }),
  ),
);
const decodeSessionList = Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Schema.Unknown)));

/** Issue a session through the CLI and return what it printed as JSON. */
const issue = (baseDir: string, extra: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const before = (yield* TestConsole.logLines).length;
    yield* run(["auth", "session", "issue", "--base-dir", baseDir, "--json", ...extra]);
    const printed = (yield* TestConsole.logLines).slice(before).join("");
    return yield* decodeIssued(printed);
  });

/** The access `/mcp` grants the token, read by the server's own authenticator. */
const mcpAccess = (baseDir: string, token: string) =>
  Effect.gen(function* () {
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const client = yield* auth.authenticateMcpClient({
      cookies: {},
      headers: { authorization: `Bearer ${token}` },
    } as unknown as Parameters<typeof auth.authenticateMcpClient>[0]);
    return client.access;
  }).pipe(
    Effect.provide(
      EnvironmentAuth.layerRuntime.pipe(
        Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
        Layer.provide(NodeServices.layer),
      ),
    ),
  );

it.effect("an MCP client session keeps approval-required unless it is given a ceiling", () =>
  Effect.gen(function* () {
    const baseDir = makeBaseDir();
    const capped = yield* issue(baseDir, ["--subject", "mcp-client"]);
    assert.strictEqual(capped.runtimeModeCeiling, undefined);
    assert.strictEqual(yield* mcpAccess(baseDir, capped.token), "approval-required");

    const fullAccess = yield* issue(baseDir, [
      "--subject",
      "mcp-client",
      "--runtime-mode-ceiling",
      "full-access",
    ]);
    assert.strictEqual(fullAccess.subject, "mcp-client");
    assert.strictEqual(fullAccess.runtimeModeCeiling, "full-access");
    assert.strictEqual(yield* mcpAccess(baseDir, fullAccess.token), "full-access");
  }).pipe(Effect.provide(TestConsole.layer)),
);

it.effect("a ceiling needs an MCP client that may change threads, and issues nothing else", () =>
  Effect.gen(function* () {
    const baseDir = makeBaseDir();
    const notMcp = yield* run([
      "auth",
      "session",
      "issue",
      "--base-dir",
      baseDir,
      "--runtime-mode-ceiling",
      "auto",
    ]).pipe(Effect.flip);
    assert.include(notMcp.message, "add --subject mcp-client");

    const readOnly = yield* run([
      "auth",
      "session",
      "issue",
      "--base-dir",
      baseDir,
      "--subject",
      "mcp-client",
      "--scope",
      "orchestration:read",
      "--runtime-mode-ceiling",
      "auto",
    ]).pipe(Effect.flip);
    assert.include(readOnly.message, "needs the orchestration:operate scope");

    const before = (yield* TestConsole.logLines).length;
    yield* run(["auth", "session", "list", "--base-dir", baseDir, "--json"]);
    const listed = (yield* TestConsole.logLines).slice(before).join("");
    assert.deepStrictEqual(yield* decodeSessionList(listed), []);
  }).pipe(Effect.provide(TestConsole.layer)),
);

it("names an issued MCP client session's runtime-mode ceiling, and nothing for other sessions", () => {
  const session = {
    sessionId: "session-1" as never,
    token: "secret-session-token",
    method: "bearer-access-token" as const,
    scopes: ["orchestration:read", "orchestration:operate"] as const,
    subject: "mcp-client",
    client: { deviceType: "bot" as const },
    expiresAt: DateTime.makeUnsafe("2026-04-08T10:00:00.000Z"),
  };

  const capped = { ...session, runtimeModeCeiling: "full-access" as const };
  expect(JSON.parse(formatIssuedSession(capped, { json: true })).runtimeModeCeiling).toBe(
    "full-access",
  );
  expect(formatIssuedSession(capped, { json: false })).toContain(
    "Runtime-mode ceiling: full-access",
  );
  expect(JSON.parse(formatIssuedSession(session, { json: true }))).not.toHaveProperty(
    "runtimeModeCeiling",
  );
  expect(formatIssuedSession(session, { json: false })).not.toContain("ceiling");
});
