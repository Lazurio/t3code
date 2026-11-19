/**
 * Lazurio overlay (plan LZD-0033): when each task last failed, for the sign by Buddy's avatar.
 * A task keeps only its run's start and an `updatedAt` that edits move, so a failed run is
 * recorded when the list reports a new `runCount`, which only a finished run changes.
 */

import type { ScheduledTask, ThreadId } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ServerConfig from "../config.ts";
import { ScheduledTaskService } from "../scheduledTasks/ScheduledTaskService.ts";
import { isBuddySurfaceEnvironment } from "./buddySurface.ts";
import { sharedBuddyFolder } from "./buddySurfaceThread.ts";

const TaskFailure = Schema.Struct({
  threadId: Schema.NullOr(Schema.String),
  runCount: Schema.Number,
  failedAt: Schema.String,
});
const TaskFailuresFile = Schema.Record(Schema.String, TaskFailure);
export type TaskFailures = typeof TaskFailuresFile.Type;

type TaskRow = Pick<ScheduledTask, "id" | "threadId" | "lastRunStatus" | "lastRunAt" | "runCount">;

/**
 * The failures after one reading of the task list at `now`: a failed run not seen before is dated
 * `now`, one already recorded keeps its time, any other task has none. On the first reading after
 * a start (`firstSight`), a failure the file does not know predates this record and is dated by
 * the run's start, the best the task keeps.
 */
export function recordTaskFailures(
  recorded: TaskFailures,
  tasks: ReadonlyArray<TaskRow>,
  now: string,
  firstSight = false,
): TaskFailures {
  const next: Record<string, typeof TaskFailure.Type> = {};
  for (const task of tasks) {
    if (task.lastRunStatus !== "failed") continue;
    const known = recorded[task.id];
    next[task.id] =
      known !== undefined && known.runCount === task.runCount
        ? { ...known, threadId: task.threadId }
        : {
            threadId: task.threadId,
            runCount: task.runCount,
            failedAt: firstSight && known === undefined ? (task.lastRunAt ?? now) : now,
          };
  }
  return next;
}

const sameFailures = (left: TaskFailures, right: TaskFailures) =>
  Object.keys(left).length === Object.keys(right).length &&
  Object.entries(left).every(([id, failure]) => {
    const other = right[id];
    return (
      other !== undefined &&
      other.threadId === failure.threadId &&
      other.runCount === failure.runCount &&
      other.failedAt === failure.failedAt
    );
  });

/** When each task bound to `threadId` last failed. */
export const failuresOf = (
  recorded: TaskFailures,
  threadId: ThreadId,
): ReadonlyArray<DateTime.Utc> =>
  Object.values(recorded).flatMap((failure) =>
    failure.threadId === threadId ? [DateTime.makeUnsafe(failure.failedAt)] : [],
  );

export class BuddyTaskFailures extends Context.Service<
  BuddyTaskFailures,
  { readonly failedAt: (threadId: ThreadId) => Effect.Effect<ReadonlyArray<DateTime.Utc>> }
>()("t3/lazurio/buddyTaskFailures") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const filePath = path.join(stateDir, "lazurio", "buddy-task-failures.json");
  const decode = Schema.decodeUnknownOption(Schema.fromJsonString(TaskFailuresFile));
  const encode = Schema.encodeEffect(Schema.fromJsonString(TaskFailuresFile));
  const stored = yield* fs.readFileString(filePath).pipe(
    Effect.map((text) => Option.getOrElse(decode(text), () => ({}))),
    Effect.orElseSucceed(() => ({})),
  );
  const state = yield* Ref.make<TaskFailures>(stored);
  const tasks = yield* Effect.serviceOption(ScheduledTaskService);
  // Only a server with Buddy's thread watches its tasks.
  const buddy =
    isBuddySurfaceEnvironment(yield* HostProcess.Environment) ||
    (yield* sharedBuddyFolder) !== undefined;
  if (Option.isSome(tasks) && buddy) {
    const record = Effect.fn("BuddyTaskFailures.record")(
      function* (list: { readonly tasks: ReadonlyArray<TaskRow> }, firstSight: boolean) {
        const now = DateTime.formatIso(yield* DateTime.now);
        const before = yield* Ref.get(state);
        const after = recordTaskFailures(before, list.tasks, now, firstSight);
        yield* Ref.set(state, after);
        if (sameFailures(before, after)) return;
        yield* fs.makeDirectory(path.dirname(filePath), { recursive: true, mode: 0o700 });
        yield* writeFileStringAtomically({ filePath, contents: `${yield* encode(after)}\n` });
      },
      Effect.ignoreCause({ log: true }),
    );
    // The first reading is the start's, before any change is reported.
    yield* tasks.value.list().pipe(
      Effect.flatMap((list) => record(list, true)),
      Effect.ignoreCause({ log: true }),
    );
    yield* tasks.value.subscribeList().pipe(
      Stream.runForEach((list) => record(list, false)),
      Effect.ignoreCause({ log: true }),
      Effect.forkScoped,
    );
  }
  return BuddyTaskFailures.of({
    failedAt: Effect.fn("BuddyTaskFailures.failedAt")(function* (threadId) {
      return failuresOf(yield* Ref.get(state), threadId);
    }),
  });
});

export const layer = Layer.effect(BuddyTaskFailures, make);
