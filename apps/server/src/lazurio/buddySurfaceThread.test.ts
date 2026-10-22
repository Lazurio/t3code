// @effect-diagnostics nodeBuiltinImport:off - Buddy's layer is a temporary folder under a temporary home.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { CommandId, ProjectId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { BUDDY, addProject, layerBuddyServer } from "./buddySurface.testkit.ts";
import { BUDDY_THREAD_ID, resolveBuddyThread } from "./buddySurfaceThread.ts";

/** A home with Buddy's layer, `~/Lazurio/.agents/buddy`, in it. */
const makeHome = () => {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "buddy-thread-home-"));
  const layer = NodePath.join(home, "Lazurio", ".agents", "buddy");
  NodeFS.mkdirSync(layer, { recursive: true });
  return { home, layer };
};

const refusal = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit) ? JSON.stringify(exit.cause) : "succeeded";

describe("Buddy's thread", () => {
  it.live("is made once in Buddy's project and found again, also by two at once", () => {
    const { home, layer } = makeHome();
    return Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      // Another project, older than Buddy's, is never Buddy's.
      yield* addProject(ProjectId.make("project:home"), home);
      yield* addProject(ProjectId.make("project:buddy"), layer);

      const [first, second] = yield* Effect.all([resolveBuddyThread(), resolveBuddyThread()], {
        concurrency: 2,
      });
      assert.deepStrictEqual(first, { threadId: BUDDY_THREAD_ID, projectId: "project:buddy" });
      assert.deepStrictEqual(second, first);
      assert.deepStrictEqual(yield* resolveBuddyThread(), first);

      const shell = yield* orchestrator.getThreadShell(BUDDY_THREAD_ID);
      assert.strictEqual(shell?.projectId, "project:buddy");
      assert.strictEqual(shell?.providerInstanceId, BUDDY);
      assert.deepStrictEqual(shell?.modelSelection, { instanceId: BUDDY, model: "default" });
      assert.strictEqual(shell?.runtimeMode, "full-access");
      const snapshot = yield* orchestrator.getShellSnapshot({
        projectId: ProjectId.make("project:buddy"),
        location: "active",
      });
      assert.deepStrictEqual(
        snapshot.threads.map((thread) => thread.id),
        [BUDDY_THREAD_ID],
      );
    }).pipe(
      Effect.provide(layerBuddyServer),
      Effect.scoped,
      Effect.provideService(HostProcess.Environment, { HOME: home, T3CODE_LAZURIO_BUDDY: "1" }),
    );
  });

  it.live("comes back when it was archived, every time, instead of a new one", () => {
    const { home, layer } = makeHome();
    return Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      yield* addProject(ProjectId.make("project:buddy"), layer);
      const thread = yield* resolveBuddyThread();
      for (const round of [1, 2]) {
        yield* orchestrator.dispatch({
          type: "thread.archive",
          commandId: CommandId.make(`test:archive:${round}`),
          threadId: thread.threadId,
        });
        assert.isNotNull((yield* orchestrator.getThreadShell(thread.threadId))?.archivedAt);
        assert.deepStrictEqual(yield* resolveBuddyThread(), thread);
        assert.isNull((yield* orchestrator.getThreadShell(thread.threadId))?.archivedAt);
      }
    }).pipe(
      Effect.provide(layerBuddyServer),
      Effect.scoped,
      Effect.provideService(HostProcess.Environment, { HOME: home, T3CODE_LAZURIO_BUDDY: "1" }),
    );
  });

  it.live(
    "is refused while Buddy's project is not added, and on a server that is not Buddy's",
    () => {
      const { home } = makeHome();
      return Effect.gen(function* () {
        const missing = yield* Effect.exit(resolveBuddyThread());
        assert.include(refusal(missing), "no-project");
        const notBuddy = yield* Effect.exit(
          resolveBuddyThread().pipe(Effect.provideService(HostProcess.Environment, { HOME: home })),
        );
        assert.include(refusal(notBuddy), "not-buddy");
        assert.isNull(yield* (yield* Orchestrator.OrchestratorV2).getThreadShell(BUDDY_THREAD_ID));
      }).pipe(
        Effect.provide(layerBuddyServer),
        Effect.scoped,
        Effect.provideService(HostProcess.Environment, { HOME: home, T3CODE_LAZURIO_BUDDY: "1" }),
      );
    },
  );
});
