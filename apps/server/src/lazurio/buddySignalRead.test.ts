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
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
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

/** A store that cannot be read. */
class StoreUnreadable extends Schema.TaggedError<StoreUnreadable>()("StoreUnreadable", {}) {}

describe("a reading that fails", () => {
  // The stores answer with an error: the sign is unavailable, never "no thread", which a reader
  // may take for an idle Buddy.
  const failing = Effect.fail(new StoreUnreadable()) as never;
  const shellOf = (threadId: string, projectId: string) =>
    ({
      id: ThreadId.make(threadId),
      projectId: ProjectId.make(projectId),
      lineage: { parentThreadId: null },
      createdAt: DateTime.makeUnsafe("2026-11-18T20:00:00.000Z"),
    }) as never;

  it.effect("is unavailable where a store fails, and no-thread only where none is", () =>
    Effect.gen(function* () {
      const read = (
        orchestrator: Partial<Record<string, unknown>>,
        projects: Partial<Record<string, unknown>>,
        environment: NodeJS.ProcessEnv,
        shared: boolean,
      ) =>
        BuddySignal.readBuddySignal().pipe(
          (effect) =>
            shared
              ? Effect.flatMap(ServerConfig.ServerConfig, (config) =>
                  effect.pipe(
                    Effect.provideService(ServerConfig.ServerConfig, {
                      ...config,
                      lazurioFolder: "/home/person/Lazurio",
                      lazurioBuddyFolder: "/home/person/Buddy",
                    }),
                  ),
                )
              : effect,
          Effect.provide(
            Layer.merge(
              Layer.mock(OrchestratorV2)(orchestrator),
              Layer.mock(ProjectStoreV2)(projects),
            ),
          ),
          Effect.provideService(HostProcess.Environment, environment),
        );
      const buddysOwn = { T3CODE_LAZURIO_BUDDY: "1" };
      // Buddy's own server (GEN3): his thread's shell cannot be read, or is not there.
      assert.deepStrictEqual(yield* read({ getThreadShell: () => failing }, {}, buddysOwn, false), {
        kind: "absent",
        error: "unavailable",
      });
      assert.deepStrictEqual(
        yield* read({ getThreadShell: () => Effect.succeed(null) }, {}, buddysOwn, false),
        { kind: "absent", error: "no-thread" },
      );
      // The shared server (GEN4): its projects cannot be read; Buddy's project is not there yet.
      assert.deepStrictEqual(yield* read({}, { list: () => failing }, {}, true), {
        kind: "absent",
        error: "unavailable",
      });
      assert.deepStrictEqual(yield* read({}, { list: () => Effect.succeed([]) }, {}, true), {
        kind: "absent",
        error: "no-thread",
      });
      // His thread is found, but its records cannot be read.
      const project = {
        projectId: ProjectId.make("project:buddy"),
        workspaceRoot: "/home/person/Buddy",
      };
      assert.deepStrictEqual(
        yield* read(
          {
            getShellSnapshot: () =>
              Effect.succeed({ threads: [shellOf("buddy-thread", "project:buddy")] }),
            getThreadRecords: () => failing,
          },
          { list: () => Effect.succeed([project]) },
          {},
          true,
        ),
        { kind: "absent", error: "unavailable" },
      );
      // His records read, but a later reading fails: the pending request's node, or the
      // messages of an answer not read yet.
      const at = DateTime.makeUnsafe("2026-11-18T20:01:00.000Z");
      const found = {
        getShellSnapshot: () =>
          Effect.succeed({ threads: [shellOf("buddy-thread", "project:buddy")] }),
      };
      const records = (runs: unknown[], runtimeRequests: unknown[]) =>
        Effect.succeed({
          thread: { deletedAt: null, lastVisitedAt: null },
          runs,
          runtimeRequests,
        });
      for (const later of [
        {
          getThreadRecords: (_id: string, fields: ReadonlyArray<string>) =>
            fields.includes("nodes")
              ? failing
              : records(
                  [],
                  [{ status: "pending", nodeId: "node-1", kind: "user_input", createdAt: at }],
                ),
        },
        {
          getThreadRecords: () =>
            records(
              [
                {
                  id: "run-1",
                  ordinal: 1,
                  status: "completed",
                  userMessageId: "message-1",
                  completedAt: at,
                },
              ],
              [],
            ),
          getMessagesById: () => failing,
        },
      ])
        assert.deepStrictEqual(
          yield* read({ ...found, ...later }, { list: () => Effect.succeed([project]) }, {}, true),
          { kind: "absent", error: "unavailable" },
        );
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-signal-fail-" }).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
      Effect.scoped,
    ),
  );
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

  it.effect("answers a reading that failed as unavailable, never as no thread", () =>
    Effect.gen(function* () {
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const config = yield* ServerConfig.ServerConfig;
      const handler = HttpRouter.toWebHandler(
        BuddySignal.layer.pipe(
          Layer.provideMerge(Layer.succeed(EnvironmentAuth.EnvironmentAuth, auth)),
          Layer.provideMerge(Layer.mock(OrchestratorV2)({})),
          // Buddy's projects cannot be read.
          Layer.provideMerge(
            Layer.mock(ProjectStoreV2)({
              list: () => Effect.fail(new StoreUnreadable()) as never,
            }),
          ),
          Layer.provideMerge(
            ServerConfig.layer({
              ...config,
              lazurioFolder: "/home/person/Lazurio",
              lazurioBuddyFolder: "/home/person/Buddy",
            }),
          ),
          Layer.provideMerge(NodeHttpPlatform.layer),
          Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
        ),
        { disableLogger: true },
      );
      yield* Effect.addFinalizer(() => Effect.promise(() => handler.dispose()));
      const reader = yield* auth.issueSession({ scopes: [AuthOrchestrationReadScope], label: "t" });
      yield* Effect.promise(async () => {
        const answer = await handler.handler(
          new Request(`http://localhost${BuddySignal.BUDDY_SIGNAL_ROUTE}`, {
            headers: { authorization: `Bearer ${reader.token}` },
          }),
        );
        assert.strictEqual(answer.status, 503);
        assert.deepStrictEqual(await answer.json(), { error: "unavailable" });
      });
    }),
  );
});
