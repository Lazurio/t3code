// @effect-diagnostics nodeBuiltinImport:off - Buddy's layer is a temporary folder under a temporary home.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointScopeId,
  CommandId,
  GuestMessageId,
  GuestShareId,
  ProjectId,
  ProviderInstanceId,
  type RuntimeMode,
  ThreadId,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { buddyCommandRefusal, withoutBuddyCheckpoints } from "./buddySurfaceGuards.ts";
import { addProject, buddyModel, layerBuddyServer } from "./buddySurface.testkit.ts";
import { BUDDY_THREAD_ID, resolveBuddyThread } from "./buddySurfaceThread.ts";

const makeHome = () => {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "buddy-guards-home-"));
  const layer = NodePath.join(home, "Lazurio", ".agents", "buddy");
  NodeFS.mkdirSync(layer, { recursive: true });
  return { home, layer };
};

const create = (threadId: string, commandId: string, projectId = "project:buddy") =>
  ({
    type: "thread.create",
    createdBy: "user",
    creationSource: "web",
    commandId: CommandId.make(commandId),
    threadId: ThreadId.make(threadId),
    projectId: ProjectId.make(projectId),
    title: "Another",
    modelSelection: buddyModel,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
  }) satisfies OrchestrationV2ServerCommand;

const setRuntimeMode = (runtimeMode: RuntimeMode, threadId: string = BUDDY_THREAD_ID) =>
  ({
    type: "thread.runtime-mode.set",
    commandId: CommandId.make(`command:runtime-mode:${runtimeMode}`),
    threadId: ThreadId.make(threadId),
    runtimeMode,
  }) satisfies OrchestrationV2ServerCommand;

describe("Buddy's one conversation", () => {
  it("refuses forks, rollbacks, other threads and deleting Buddy's thread", () => {
    assert.isNotNull(buddyCommandRefusal(create("another", "command:another"), false));
    // Buddy's own ids are no way in: only Buddy's thread route makes Buddy's thread.
    assert.isNotNull(buddyCommandRefusal(create("buddy", "lazurio:buddy-thread:create"), false));
    assert.isNotNull(buddyCommandRefusal(create("buddy", "command:not-the-fixed-one"), true));
    assert.isNull(buddyCommandRefusal(create("buddy", "lazurio:buddy-thread:create"), true));
    assert.isNotNull(
      buddyCommandRefusal(
        {
          type: "checkpoint.rollback",
          commandId: CommandId.make("command:rollback"),
          threadId: BUDDY_THREAD_ID,
          scopeId: CheckpointScopeId.make("scope"),
          checkpointId: CheckpointId.make("checkpoint"),
        },
        false,
      ),
    );
    assert.isNotNull(
      buddyCommandRefusal(
        {
          type: "thread.delete",
          commandId: CommandId.make("command:delete"),
          threadId: BUDDY_THREAD_ID,
        },
        false,
      ),
    );
    assert.isNull(
      buddyCommandRefusal(
        {
          type: "thread.archive",
          commandId: CommandId.make("command:archive"),
          threadId: BUDDY_THREAD_ID,
        },
        false,
      ),
    );
  });

  it("never shares Buddy's conversation with a guest, and a share can still be closed", () => {
    const shareId = GuestShareId.make("share");
    const commandId = CommandId.make("command:guest");
    const threadId = BUDDY_THREAD_ID;
    assert.isNotNull(
      buddyCommandRefusal(
        {
          type: "thread.guest-share.redeem",
          commandId,
          threadId,
          shareId,
          guestName: "Guest",
        },
        false,
      ),
    );
    assert.isNotNull(
      buddyCommandRefusal(
        {
          type: "thread.guest-message.submit",
          commandId,
          threadId,
          shareId,
          guestMessageId: GuestMessageId.make("guest-message"),
          text: "Hi",
        },
        false,
      ),
    );
    assert.isNull(
      buddyCommandRefusal({ type: "thread.guest-share.close", commandId, threadId }, false),
    );
  });

  it.live("refuses a guest share of Buddy's thread through the server's orchestrator", () => {
    const { home, layer } = makeHome();
    return Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      yield* addProject(ProjectId.make("project:buddy"), layer);
      yield* resolveBuddyThread();
      const opened = yield* Effect.exit(
        orchestrator.dispatch({
          type: "thread.guest-share.open",
          commandId: CommandId.make("command:guest-share"),
          threadId: BUDDY_THREAD_ID,
          shareId: GuestShareId.make("share"),
          host: "connect.example",
          expiresAt: "2026-10-29T00:00:00.000Z",
        }),
      );
      assert.isTrue(Exit.isFailure(opened));
      assert.include(JSON.stringify(opened), "never shared with a guest");
      const { thread } = yield* orchestrator.getThreadRecords(BUDDY_THREAD_ID, []);
      assert.isNull(thread.guestShare ?? null);
    }).pipe(
      Effect.provide(layerBuddyServer),
      Effect.scoped,
      Effect.provideService(HostProcess.Environment, { HOME: home, T3CODE_LAZURIO_BUDDY: "1" }),
    );
  });

  it("keeps Buddy's thread in full access", () => {
    for (const mode of ["approval-required", "auto-accept-edits", "auto"] as const)
      assert.isNotNull(buddyCommandRefusal(setRuntimeMode(mode), false), mode);
    assert.isNull(buddyCommandRefusal(setRuntimeMode("full-access"), false));
  });

  it.live("holds through the server's orchestrator, which still makes Buddy's thread", () => {
    const { home, layer } = makeHome();
    return Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      yield* addProject(ProjectId.make("project:buddy"), layer);
      yield* addProject(ProjectId.make("project:other"), `${layer}-other`);
      // A client's create with Buddy's ids and its own project, title and model: refused, so the
      // route's fixed command stays unspent.
      const forged = yield* Effect.exit(
        orchestrator.dispatch({
          ...create("buddy", "lazurio:buddy-thread:create", "project:other"),
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
        }),
      );
      assert.isTrue(Exit.isFailure(forged));
      assert.isNull(yield* orchestrator.getThreadShell(BUDDY_THREAD_ID));
      const made = yield* resolveBuddyThread();
      assert.deepStrictEqual(made, {
        threadId: BUDDY_THREAD_ID,
        projectId: ProjectId.make("project:buddy"),
      });
      const refused = yield* Effect.exit(
        orchestrator.dispatch(create("another", "command:another")),
      );
      assert.isTrue(Exit.isFailure(refused));
      assert.include(JSON.stringify(refused), "Buddy keeps one conversation");
      assert.isNull(yield* orchestrator.getThreadShell(ThreadId.make("another")));
      // A client asking Buddy's thread for less than full access is refused; full access passes.
      const supervised = yield* Effect.exit(
        orchestrator.dispatch(setRuntimeMode("approval-required")),
      );
      assert.isTrue(Exit.isFailure(supervised));
      assert.include(JSON.stringify(supervised), "Buddy always works with full access");
      yield* orchestrator.dispatch(setRuntimeMode("full-access"));
      assert.strictEqual(
        (yield* orchestrator.getThreadShell(BUDDY_THREAD_ID))?.runtimeMode,
        "full-access",
      );
    }).pipe(
      Effect.provide(layerBuddyServer),
      Effect.scoped,
      Effect.provideService(HostProcess.Environment, { HOME: home, T3CODE_LAZURIO_BUDDY: "1" }),
    );
  });
});

describe("checkpoints in Buddy's T3 Code", () => {
  const layerConfig = ServerConfig.layerTest(process.cwd(), {
    prefix: "t3-lazurio-buddy-guards-",
  }).pipe(Layer.provideMerge(NodeServices.layer));
  const store = (calls: Array<string>) =>
    Layer.succeed(CheckpointStore.CheckpointStore, {
      isGitRepository: (cwd: string) => Effect.sync(() => calls.push(cwd)).pipe(Effect.as(true)),
    } as unknown as CheckpointStore.CheckpointStore["Service"]);
  const isGit = Effect.fn("test.isGit")(function* (cwd: string) {
    const checkpoints = yield* CheckpointStore.CheckpointStore;
    return yield* checkpoints.isGitRepository(cwd);
  });

  it.effect("are none in Buddy's project, also inside a Git repository", () => {
    const { home, layer } = makeHome();
    const calls: Array<string> = [];
    return Effect.gen(function* () {
      assert.isFalse(yield* isGit(layer));
      assert.isFalse(yield* isGit(NodePath.join(layer, "memories")));
      assert.isTrue(yield* isGit(NodePath.join(home, "Lazurio")));
      assert.isTrue(yield* isGit(`${layer}-other`));
      assert.deepStrictEqual(calls, [NodePath.join(home, "Lazurio"), `${layer}-other`]);
    }).pipe(
      Effect.provide(withoutBuddyCheckpoints(store(calls)).pipe(Layer.provide(layerConfig))),
      Effect.provideService(HostProcess.Environment, { HOME: home, T3CODE_LAZURIO_BUDDY: "1" }),
    );
  });

  it.effect("are upstream's outside Buddy's T3 Code", () => {
    const { home, layer } = makeHome();
    return Effect.gen(function* () {
      assert.isTrue(yield* isGit(layer));
    }).pipe(
      Effect.provide(withoutBuddyCheckpoints(store([])).pipe(Layer.provide(layerConfig))),
      Effect.provideService(HostProcess.Environment, { HOME: home }),
    );
  });
});
