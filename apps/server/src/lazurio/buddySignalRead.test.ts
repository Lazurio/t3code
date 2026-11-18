// @effect-diagnostics nodeBuiltinImport:off - Buddy's folder is a temporary folder under a temporary home.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  AuthOrchestrationReadScope,
  AuthTerminalReadScope,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpRouter } from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import { type AgentCliConnection, agentCliFailure } from "./agentCliConnection.ts";
import * as BuddySignal from "./buddySignal.ts";
import { addProject, layerBuddyServer } from "./buddySurface.testkit.ts";
import { followBuddySignal } from "./buddySurfaceCli.ts";
import { layerManagedConfig, makeFolderDirectories } from "./managedFolder.testkit.ts";
import { resolveBuddyThread } from "./buddySurfaceThread.ts";

const makeShared = () => {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "buddy-signal-home-"));
  const folder = NodePath.join(home, "Lazurio");
  const buddy = NodePath.join(home, "Buddy");
  NodeFS.mkdirSync(folder);
  NodeFS.mkdirSync(buddy);
  return { home, folder, buddy };
};
const withShared = <A, E, R>(effect: Effect.Effect<A, E, R>, folder: string, buddy: string) =>
  Effect.flatMap(ServerConfig.ServerConfig, (config) =>
    effect.pipe(
      Effect.provideService(ServerConfig.ServerConfig, {
        ...config,
        lazurioFolder: folder,
        lazurioBuddyFolder: buddy,
      }),
    ),
  );

describe("reading the sign by Buddy's avatar", () => {
  it.live("says why there is none, and is quiet only for a thread that exists", () => {
    const { home, folder, buddy } = makeShared();
    return Effect.gen(function* () {
      // No Buddy on this server, then his project without his thread: never quiet.
      assert.deepStrictEqual(yield* BuddySignal.readBuddySignal(), {
        kind: "absent",
        error: "not-buddy",
      });
      yield* addProject(ProjectId.make("project:buddy"), buddy);
      yield* (yield* ServerSettings.ServerSettingsService).updateSettings({
        projectSettingsOverrides: {
          [ProjectId.make("project:buddy")]: {
            defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "luna" },
          },
        },
      });
      assert.deepStrictEqual(yield* withShared(BuddySignal.readBuddySignal(), folder, buddy), {
        kind: "absent",
        error: "no-thread",
      });
      const { threadId } = yield* withShared(resolveBuddyThread(), folder, buddy);
      assert.deepStrictEqual(yield* withShared(BuddySignal.readBuddySignal(), folder, buddy), {
        kind: "signal",
        signal: {
          version: 1,
          state: "quiet",
          threadId,
          since: null,
          request: null,
          startedBy: null,
        },
      });
    }).pipe(
      Effect.provide(Layer.merge(layerBuddyServer, ServerSettings.layerTest())),
      Effect.scoped,
      Effect.provideService(HostProcess.Environment, { HOME: home }),
    );
  });

  it.live("on Buddy's own server, before his one thread exists, is no-thread", () => {
    const { home } = makeShared();
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* BuddySignal.readBuddySignal(), {
        kind: "absent",
        error: "no-thread",
      });
    }).pipe(
      Effect.provide(Layer.merge(layerBuddyServer, ServerSettings.layerTest())),
      Effect.scoped,
      Effect.provideService(HostProcess.Environment, { HOME: home, T3CODE_LAZURIO_BUDDY: "1" }),
    );
  });
});

describe("following the sign", () => {
  const signal = (state: string, startedBy: string | null) => ({
    version: 1,
    state,
    threadId: "buddy-thread",
    since: state === "quiet" ? null : "2026-11-18T20:02:00.000Z",
    request: null,
    startedBy,
  });
  /** A connection whose route answers `answers` in turn and whose shell sends `updates`. */
  const connection = (
    answers: Array<{ status: number; body: unknown }>,
    updates: number,
  ): AgentCliConnection =>
    ({
      getRoute: () => Effect.sync(() => answers.shift() ?? { status: 500, body: undefined }),
      subscribeShell: () =>
        Stream.fromIterable(
          Array.from({ length: updates }, () => ({
            kind: "thread.updated" as const,
            thread: { id: ThreadId.make("buddy-thread") },
          })),
        ),
    }) as unknown as AgentCliConnection;

  it.effect(
    "prints each change, startedBy too, and unavailable when it cannot read, never silence",
    () =>
      Effect.gen(function* () {
        const lines: Array<unknown> = [];
        const connects = [
          // Starts quiet, an unchanged reading prints nothing, then others' and the person's answers.
          connection(
            [
              { status: 200, body: signal("quiet", null) },
              { status: 200, body: signal("quiet", null) },
              { status: 200, body: signal("answered", "other") },
              { status: 200, body: signal("answered", "person") },
            ],
            3,
          ),
          // The session expired.
          connection([{ status: 401, body: undefined }], 0),
          // Back, before his first visit.
          connection([{ status: 404, body: { error: "no-thread" } }], 0),
        ];
        const fiber = yield* followBuddySignal(
          (use) => {
            const next = connects.shift();
            return next === undefined
              ? Effect.fail(agentCliFailure("server_not_running", "T3 Code is not running."))
              : use(next);
          },
          (line) => Effect.sync(() => lines.push(JSON.parse(line))),
        ).pipe(Effect.forkChild);
        // Each reconnect waits at most half a minute.
        for (let step = 0; step < 6; step += 1) yield* TestClock.adjust("30 seconds");
        const states = lines.map((line) => {
          const { state, startedBy, reason } = line as Record<string, unknown>;
          return state === "unavailable" ? `unavailable:${reason}` : `${state}:${startedBy}`;
        });
        assert.deepStrictEqual(states.slice(0, 7), [
          "quiet:null",
          "answered:other",
          "answered:person",
          "unavailable:connection_lost",
          "unavailable:unauthorized",
          "unavailable:no_thread",
          "unavailable:connection_lost",
        ]);
        assert.include(states.slice(7), "unavailable:server_not_running");
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect("ends with a failure on a server without Buddy", () =>
    Effect.gen(function* () {
      const lines: Array<string> = [];
      const exit = yield* followBuddySignal(
        (use) => use(connection([{ status: 404, body: { error: "not-buddy" } }], 0)),
        (line) => Effect.sync(() => lines.push(line)),
      ).pipe(Effect.exit);
      assert.strictEqual(exit._tag, "Failure");
      assert.deepStrictEqual(
        lines.map((line) => JSON.parse(line).reason),
        ["not_buddy"],
      );
    }),
  );
});

const { folder: authFolder } = makeFolderDirectories();
const layerAuth = EnvironmentAuth.layer.pipe(
  Layer.provide(ManagedPolicy.layerTest()),
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerEnvironment.layerIdentity),
  Layer.provideMerge(layerManagedConfig(authFolder)),
);

it.layer(layerAuth.pipe(Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))), {
  excludeTestServices: true,
})("the sign's route", (it) => {
  it.effect("needs a session that may read threads, and names a server without Buddy", () =>
    Effect.gen(function* () {
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const config = yield* ServerConfig.ServerConfig;
      // Refused before it reads anything, and without Buddy it reads no thread.
      const handler = HttpRouter.toWebHandler(
        BuddySignal.layer.pipe(
          Layer.provideMerge(Layer.succeed(EnvironmentAuth.EnvironmentAuth, auth)),
          Layer.provideMerge(Layer.mock(OrchestratorV2)({})),
          Layer.provideMerge(Layer.mock(ProjectStoreV2)({})),
          Layer.provideMerge(ServerConfig.layer(config)),
          Layer.provideMerge(NodeHttpPlatform.layer),
          Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
        ),
        { disableLogger: true },
      );
      yield* Effect.addFinalizer(() => Effect.promise(() => handler.dispose()));
      const reader = yield* auth.issueSession({ scopes: [AuthOrchestrationReadScope], label: "t" });
      const terminal = yield* auth.issueSession({ scopes: [AuthTerminalReadScope], label: "t" });
      const get = (token?: string) =>
        handler.handler(
          new Request(`http://localhost${BuddySignal.BUDDY_SIGNAL_ROUTE}`, {
            headers: token ? { authorization: `Bearer ${token}` } : {},
          }),
        );
      yield* Effect.promise(async () => {
        assert.strictEqual((await get()).status, 401);
        assert.strictEqual((await get(terminal.token)).status, 403);
        const answer = await get(reader.token);
        assert.strictEqual(answer.status, 404);
        assert.deepStrictEqual(await answer.json(), { error: "not-buddy" });
      });
    }),
  );
});
