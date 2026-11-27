// @effect-diagnostics nodeBuiltinImport:off -- the revision is a synchronous SHA-256 of the page.
/**
 * Lazurio overlay (plan LZD-0051, C1): the Control Plane, one place per Buddy thread whose page
 * each publish replaces. Every revision is an immutable page under its own `-html` attachment id,
 * isolated like an `html_render` page but never in the timeline; the thread's one record names the
 * current revision and is the commit. A client learns of a new revision from `follow`.
 */

import { ThreadId } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  HTML_RENDER_MAX_TITLE_LENGTH,
  injectHtmlRenderBootstrap,
} from "@t3tools/shared/htmlRender";
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
import { createDeterministicAttachmentId } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { isBuddySurfaceEnvironment } from "./buddySurface.ts";
import { BUDDY_THREAD_ID, findSharedBuddyThread, sharedBuddyFolder } from "./buddySurfaceThread.ts";
import * as ThreadLifecycle from "./threadLifecycle.ts";

export const CONTROL_PLANE_MAX_HTML_BYTES = 512_000;
const STABLE_KEY = "lazurio-control-plane";

export const CONTROL_PLANE_MAX_ANSWERS = 12;
const CONTROL_PLANE_MAX_ANSWER_LABEL = 80;
const CONTROL_PLANE_MAX_ANSWER_BYTES = 2048;

/** An answer the app shows as its own button; a click puts `sentence` into the composer. */
export const ControlPlaneAnswer = Schema.Struct({
  label: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(CONTROL_PLANE_MAX_ANSWER_LABEL),
  ),
  sentence: Schema.String.check(Schema.isMinLength(1)),
});
export type ControlPlaneAnswer = typeof ControlPlaneAnswer.Type;

export const ControlPlaneSnapshot = Schema.Struct({
  threadId: ThreadId,
  attachmentId: Schema.String,
  title: Schema.String,
  revision: Schema.String,
  publishedAt: Schema.String,
  answers: Schema.optional(Schema.Array(ControlPlaneAnswer)),
});
export type ControlPlaneSnapshot = typeof ControlPlaneSnapshot.Type;

export class ControlPlaneError extends Schema.TaggedError<ControlPlaneError>()(
  "ControlPlaneError",
  {
    reason: Schema.Literals([
      "not-buddys-thread",
      "invalid-page",
      "invalid-thread",
      "store-failed",
    ]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export class ControlPlane extends Context.Service<
  ControlPlane,
  {
    /** Overwrites the thread's page; only Buddy's thread has one. */
    readonly publish: (input: {
      readonly threadId: ThreadId;
      readonly html: string;
      readonly title: string;
      readonly answers?: ReadonlyArray<ControlPlaneAnswer> | undefined;
    }) => Effect.Effect<ControlPlaneSnapshot, ControlPlaneError>;
    /** The thread's page as last published, or null. */
    readonly read: (threadId: ThreadId) => Effect.Effect<ControlPlaneSnapshot | null>;
    /** Removes the thread's page; a retired thread's goes this way. */
    readonly forget: (threadId: string) => Effect.Effect<void>;
    /** The page as published now, if any, then each newer one; never an older after a newer. */
    readonly follow: (threadId: ThreadId) => Stream.Stream<ControlPlaneSnapshot>;
  }
>()("t3/lazurio/controlPlane") {}

/**
 * A revision's page: its own attachment id, derived from the thread and the revision, so the asset
 * route never serves one revision's URL with another revision's content. The `-html` suffix makes
 * the route serve it as a sandboxed HTML document.
 */
const pageAttachmentId = (threadId: string, revision: string): string | null => {
  const id = createDeterministicAttachmentId(threadId, `${STABLE_KEY}:${revision}`);
  return id === null ? null : `${id}-html`;
};

/** Changes with every different page. */
const controlPlaneRevision = (html: string, answers: ReadonlyArray<ControlPlaneAnswer>): string =>
  NodeCrypto.createHash("sha256")
    .update(html)
    .update("\u0000")
    .update(JSON.stringify(answers))
    .digest("hex")
    .slice(0, 16);

/** Buddy's thread without making it: the fixed one of Buddy's T3 Code, or the shared server's. */
const buddysThreadId = Effect.gen(function* () {
  if (isBuddySurfaceEnvironment(yield* HostProcess.Environment)) return BUDDY_THREAD_ID;
  const folder = yield* sharedBuddyFolder;
  if (folder === undefined) return null;
  const found = yield* findSharedBuddyThread(folder).pipe(Effect.orElseSucceed(() => null));
  return found?.thread?.id ?? null;
});

/** The thread's one record: the page as published now, and the one before it. */
const ControlPlaneRecord = Schema.Struct({
  ...ControlPlaneSnapshot.fields,
  previousAttachmentId: Schema.optional(Schema.String),
});
type ControlPlaneRecord = typeof ControlPlaneRecord.Type;
const RecordJson = Schema.fromJsonString(ControlPlaneRecord);
const decodeRecord = Schema.decodeUnknownEffect(RecordJson);
const encodeRecord = Schema.encodeEffect(RecordJson);

const snapshotOf = ({ previousAttachmentId: _, ...snapshot }: ControlPlaneRecord) => snapshot;

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lifecycle = yield* ThreadLifecycle.ThreadLifecycle;
  const services = yield* Effect.context<
    | ServerConfig.ServerConfig
    | FileSystem.FileSystem
    | Path.Path
    | Orchestrator.OrchestratorV2
    | ProjectStore.ProjectStoreV2
  >();
  const published = yield* PubSub.unbounded<ControlPlaneSnapshot>();
  // One publish or removal at a time per server, so the record moves from one whole version to the next.
  const writing = yield* Semaphore.make(1);
  const recordsDirectory = path.join(config.stateDir, "lazurio", "control-plane");

  const recordOf = (threadId: string) => {
    const name = createDeterministicAttachmentId(threadId, STABLE_KEY);
    return name === null ? null : path.join(recordsDirectory, `${name}.json`);
  };
  const pageOf = (attachmentId: string) =>
    resolveAttachmentRelativePath({
      attachmentsDir: config.attachmentsDir,
      relativePath: `${attachmentId}.html`,
    });
  const removePage = (attachmentId: string | undefined) => {
    const page = attachmentId === undefined ? null : pageOf(attachmentId);
    return page === null
      ? Effect.void
      : fileSystem.remove(page, { force: true }).pipe(Effect.ignore({ log: true }));
  };

  const readRecord = Effect.fn("ControlPlane.readRecord")(function* (threadId: string) {
    const record = recordOf(threadId);
    if (record === null) return null;
    const text = yield* fileSystem.readFileString(record).pipe(Effect.orElseSucceed(() => null));
    return text === null ? null : yield* decodeRecord(text).pipe(Effect.orElseSucceed(() => null));
  });

  const publish = Effect.fn("ControlPlane.publish")(function* (input: {
    readonly threadId: ThreadId;
    readonly html: string;
    readonly title: string;
    readonly answers?: ReadonlyArray<ControlPlaneAnswer> | undefined;
  }) {
    if (Buffer.byteLength(input.html, "utf8") > CONTROL_PLANE_MAX_HTML_BYTES)
      return yield* new ControlPlaneError({
        reason: "invalid-page",
        detail: `The page is larger than ${CONTROL_PLANE_MAX_HTML_BYTES} bytes.`,
      });
    if (input.html.trim().length === 0)
      return yield* new ControlPlaneError({ reason: "invalid-page", detail: "The page is empty." });
    const answers = (input.answers ?? []).map((answer) => ({
      label: answer.label.trim(),
      sentence: answer.sentence.trim(),
    }));
    if (
      answers.length > CONTROL_PLANE_MAX_ANSWERS ||
      answers.some(
        (answer) =>
          answer.label.length === 0 ||
          answer.label.length > CONTROL_PLANE_MAX_ANSWER_LABEL ||
          answer.sentence.length === 0 ||
          Buffer.byteLength(answer.sentence, "utf8") > CONTROL_PLANE_MAX_ANSWER_BYTES,
      )
    )
      return yield* new ControlPlaneError({
        reason: "invalid-page",
        detail: `At most ${CONTROL_PLANE_MAX_ANSWERS} answers, each with a label of 1 to ${CONTROL_PLANE_MAX_ANSWER_LABEL} characters and a sentence of 1 to ${CONTROL_PLANE_MAX_ANSWER_BYTES} bytes.`,
      });
    const buddys = yield* buddysThreadId;
    if (buddys === null || buddys !== input.threadId)
      return yield* new ControlPlaneError({
        reason: "not-buddys-thread",
        detail: "Only Buddy's thread has a Control Plane.",
      });
    const html = injectHtmlRenderBootstrap(input.html);
    const revision = controlPlaneRevision(html, answers);
    const attachmentId = pageAttachmentId(input.threadId, revision);
    const page = attachmentId === null ? null : pageOf(attachmentId);
    const record = recordOf(input.threadId);
    if (attachmentId === null || page === null || record === null)
      return yield* new ControlPlaneError({
        reason: "invalid-thread",
        detail: "Invalid thread id.",
      });
    const title = input.title.trim().slice(0, HTML_RENDER_MAX_TITLE_LENGTH) || "Control Plane";
    const stored = (cause: unknown) =>
      new ControlPlaneError({
        reason: "store-failed",
        detail: "The page could not be stored.",
        cause,
      });

    return yield* Effect.gen(function* () {
      const before = yield* readRecord(input.threadId);
      const snapshot: ControlPlaneSnapshot = {
        threadId: input.threadId,
        attachmentId,
        title,
        revision,
        publishedAt: DateTime.formatIso(yield* DateTime.now),
        ...(answers.length === 0 ? {} : { answers }),
      };
      const previousAttachmentId =
        before === null || before.attachmentId === attachmentId
          ? before?.previousAttachmentId
          : before.attachmentId;
      // The new revision's page first, under its own id: it replaces nothing a reader relies on.
      // The record is the commit; until it is replaced, the old record and its page stay a pair.
      yield* writeFileStringAtomically({ filePath: page, contents: html }).pipe(
        Effect.andThen(
          encodeRecord({
            ...snapshot,
            ...(previousAttachmentId === undefined || previousAttachmentId === attachmentId
              ? {}
              : { previousAttachmentId }),
          }),
        ),
        Effect.flatMap((text) => writeFileStringAtomically({ filePath: record, contents: text })),
        Effect.mapError(stored),
        Effect.onError(() =>
          before !== null &&
          (before.attachmentId === attachmentId || before.previousAttachmentId === attachmentId)
            ? Effect.void
            : removePage(attachmentId),
        ),
      );
      // A page two revisions back is no longer named by the record; a client may still be loading
      // the previous one, so that one stays until the next publish.
      const dropped = before?.previousAttachmentId;
      if (dropped !== undefined && dropped !== attachmentId && dropped !== previousAttachmentId)
        yield* removePage(dropped);
      yield* PubSub.publish(published, snapshot);
      return snapshot;
    }).pipe(Effect.uninterruptible, writing.withPermits(1));
  }, Effect.provideContext(services));

  const read = Effect.fn("ControlPlane.read")(function* (threadId: ThreadId) {
    const record = yield* readRecord(threadId);
    if (record === null) return null;
    const page = pageOf(record.attachmentId);
    const there =
      page !== null && (yield* fileSystem.exists(page).pipe(Effect.orElseSucceed(() => false)));
    return there ? snapshotOf(record) : null;
  });

  const forget = Effect.fn("ControlPlane.forget")(function* (threadId: string) {
    const record = recordOf(threadId);
    if (record === null) return;
    yield* Effect.gen(function* () {
      const current = yield* readRecord(threadId);
      yield* fileSystem.remove(record, { force: true }).pipe(Effect.ignore({ log: true }));
      yield* removePage(current?.attachmentId);
      yield* removePage(current?.previousAttachmentId);
    }).pipe(writing.withPermits(1));
  });

  // A retired thread's pages go with it; nothing else knows their deterministic ids.
  yield* lifecycle.events.pipe(
    Stream.filter((event) => event.type === "retired"),
    Stream.runForEach((event) => forget(event.threadId)),
    Effect.forkScoped,
  );

  return ControlPlane.of({
    publish,
    read,
    forget,
    // Each notice only says that the page changed: what is sent is read from the record after
    // it, so a follower never gets an older page after a newer one, and the same page and title once.
    follow: (threadId) =>
      Stream.unwrap(
        Effect.map(PubSub.subscribe(published), (later) =>
          Stream.concat(
            Stream.make(undefined),
            Stream.fromSubscription(later).pipe(
              Stream.filter((snapshot) => snapshot.threadId === threadId),
            ),
          ),
        ),
      ).pipe(
        Stream.mapEffect(() => read(threadId)),
        Stream.filter((snapshot): snapshot is ControlPlaneSnapshot => snapshot !== null),
        Stream.changesWith(
          (left, right) => left.revision === right.revision && left.title === right.title,
        ),
      ),
  });
});

export const layer = Layer.effect(ControlPlane, make);
