/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): Buddy's one conversation, one thread on the
 * instance `buddy` in Buddy's layer of the Lazurio Folder. Its id and the command that makes it are
 * fixed, so two first visits make one thread; an archived one comes back instead of being replaced,
 * because a new thread would start Hermes on a new session and fork Buddy's memory.
 */
import { CommandId, type ModelSelection, ProjectId, ThreadId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { BUDDY_PROVIDER_INSTANCE_ID, isBuddySurfaceEnvironment } from "./buddySurface.ts";

export const BUDDY_THREAD_ROUTE = "/api/lazurio/buddy/thread";

/** Buddy's thread: the one thread of Buddy's T3 Code. */
export const BUDDY_THREAD_ID = ThreadId.make("buddy");

/** Buddy's layer of the Lazurio Folder, under the home of the person the server runs as. */
export const BUDDY_PROJECT_PATH = ["Lazurio", ".agents", "buddy"] as const;

export const BuddyThread = Schema.Struct({ threadId: ThreadId, projectId: ProjectId });
export type BuddyThread = typeof BuddyThread.Type;

export class BuddyThreadUnavailable extends Schema.TaggedError<BuddyThreadUnavailable>()(
  "BuddyThreadUnavailable",
  {
    reason: Schema.Literals(["not-buddy", "no-project", "thread-conflict", "unavailable"]),
    detail: Schema.String,
  },
) {
  override get message() {
    return this.detail;
  }
}

const unavailable = (cause: unknown) =>
  new BuddyThreadUnavailable({
    reason: "unavailable",
    detail: `Buddy's thread could not be read or made: ${String(cause)}`,
  });

/** A new Buddy thread's model: the instance's own default, which Hermes' config chooses. */
const buddyModel = { instanceId: BUDDY_PROVIDER_INSTANCE_ID, model: "default" } as const;

/** Buddy's project: the active project at Buddy's layer. */
const buddyProject = Effect.fn("LazurioBuddySurface.buddyProject")(function* () {
  const environment = yield* HostProcess.Environment;
  const path = yield* Path.Path;
  const home = environment.HOME ?? "";
  const expected = path.resolve(home, ...BUDDY_PROJECT_PATH);
  const projects = yield* (yield* ProjectStoreV2).list().pipe(Effect.mapError(unavailable));
  const project = projects.find(
    (candidate) => home !== "" && path.resolve(candidate.workspaceRoot) === expected,
  );
  if (project === undefined)
    return yield* new BuddyThreadUnavailable({
      reason: "no-project",
      detail: `Buddy's project ${expected} is not in this T3 Code.`,
    });
  return project;
});

/**
 * A thread with Buddy's id is Buddy's only in Buddy's project on Buddy's instance. Any other one is
 * left alone, archived or not, and Buddy has no thread until it is gone: a wake must never land in
 * someone else's conversation.
 */
const isBuddysThread = (
  shell: { readonly projectId: ProjectId; readonly providerInstanceId: string },
  project: { readonly projectId: ProjectId },
) =>
  shell.projectId === project.projectId && shell.providerInstanceId === BUDDY_PROVIDER_INSTANCE_ID;

const conflict = () =>
  new BuddyThreadUnavailable({
    reason: "thread-conflict",
    detail: `A thread with Buddy's id "${BUDDY_THREAD_ID}" is not in Buddy's project on the instance "${BUDDY_PROVIDER_INSTANCE_ID}".`,
  });

/** Buddy's thread, made in Buddy's project the first time anyone asks. */
export const resolveBuddyThread = Effect.fn("LazurioBuddySurface.resolveThread")(function* () {
  if (!isBuddySurfaceEnvironment(yield* HostProcess.Environment))
    return yield* new BuddyThreadUnavailable({
      reason: "not-buddy",
      detail: "This T3 Code is not Buddy's.",
    });
  const orchestrator = yield* OrchestratorV2;
  const project = yield* buddyProject();
  const existing = yield* orchestrator
    .getThreadShell(BUDDY_THREAD_ID)
    .pipe(Effect.mapError(unavailable));
  if (existing !== null) {
    if (!isBuddysThread(existing, project)) return yield* conflict();
    if (existing.archivedAt !== null)
      yield* orchestrator
        .dispatch({
          type: "thread.unarchive",
          // One command per archiving, so a thread archived again comes back again.
          commandId: CommandId.make(
            `lazurio:buddy-thread:unarchive:${DateTime.formatIso(existing.archivedAt)}`,
          ),
          threadId: BUDDY_THREAD_ID,
        })
        .pipe(Effect.mapError(unavailable));
    return { threadId: BUDDY_THREAD_ID, projectId: existing.projectId } satisfies BuddyThread;
  }
  yield* orchestrator
    .dispatch({
      type: "thread.create",
      createdBy: "user",
      creationSource: "server",
      commandId: CommandId.make("lazurio:buddy-thread:create"),
      threadId: BUDDY_THREAD_ID,
      projectId: project.projectId,
      title: "Buddy",
      modelSelection: buddyModel satisfies ModelSelection,
      // Buddy works with the Osobní Prostředí's full rights (root decision 0210).
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
    })
    .pipe(Effect.mapError(unavailable));
  // The fixed command replays once it ran, so a Buddy thread that was deleted stays deleted.
  const created = yield* orchestrator
    .getThreadShell(BUDDY_THREAD_ID)
    .pipe(Effect.mapError(unavailable));
  if (created === null)
    return yield* new BuddyThreadUnavailable({
      reason: "unavailable",
      detail: "Buddy's thread was deleted.",
    });
  if (!isBuddysThread(created, project)) return yield* conflict();
  return { threadId: BUDDY_THREAD_ID, projectId: created.projectId } satisfies BuddyThread;
});
