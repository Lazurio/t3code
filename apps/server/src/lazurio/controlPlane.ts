// @effect-diagnostics nodeBuiltinImport:off -- the revision is a synchronous SHA-256 of the page.
/**
 * Lazurio overlay (plan LZD-0051, C1): the Control Plane, one HTML page per Buddy thread at one
 * stable attachment id that each publish overwrites. It is isolated like an `html_render` page
 * (the `-html` id makes the asset route serve it sandboxed) but never enters the timeline; a
 * client learns of a new revision from `follow` and loads it as `?v=<revision>`.
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
import * as Stream from "effect/Stream";

import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
import { createDeterministicAttachmentId } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { isBuddySurfaceEnvironment } from "./buddySurface.ts";
import { BUDDY_THREAD_ID, findSharedBuddyThread, sharedBuddyFolder } from "./buddySurfaceThread.ts";
import { ThreadLifecycle } from "./threadLifecycle.ts";

export const CONTROL_PLANE_MAX_HTML_BYTES = 512_000;
const STABLE_KEY = "lazurio-control-plane";

export const ControlPlaneSnapshot = Schema.Struct({
  threadId: ThreadId,
  attachmentId: Schema.String,
  title: Schema.String,
  revision: Schema.String,
  publishedAt: Schema.String,
});
export type ControlPlaneSnapshot = typeof ControlPlaneSnapshot.Type;

export type ControlPlaneErrorReason =
  | "not-buddys-thread"
  | "invalid-page"
  | "invalid-thread"
  | "store-failed";

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
    }) => Effect.Effect<ControlPlaneSnapshot, ControlPlaneError>;
    /** The thread's page as last published, or null. */
    readonly read: (threadId: ThreadId) => Effect.Effect<ControlPlaneSnapshot | null>;
    /** Removes the thread's page; a retired thread's goes this way. */
    readonly forget: (threadId: string) => Effect.Effect<void>;
    /** The page as published now, if any, then each later publish; nothing between is lost. */
    readonly follow: (threadId: ThreadId) => Stream.Stream<ControlPlaneSnapshot>;
  }
>()("t3/lazurio/controlPlane") {}

/** The page's one attachment id; the `-html` suffix makes the asset route serve it as HTML. */
const controlPlaneAttachmentId = (threadId: string): string | null => {
  const id = createDeterministicAttachmentId(threadId, STABLE_KEY);
  return id === null ? null : `${id}-html`;
};

/** Changes with every different page, so a reload is never served from the browser's cache. */
const controlPlaneRevision = (html: string): string =>
  NodeCrypto.createHash("sha256").update(html).digest("hex").slice(0, 16);

const refusal = (reason: ControlPlaneErrorReason, detail: string) =>
  new ControlPlaneError({ reason, detail });

/** Buddy's thread without making it: the fixed one of Buddy's T3 Code, or the shared server's. */
const buddysThreadId = Effect.gen(function* () {
  if (isBuddySurfaceEnvironment(yield* HostProcess.Environment)) return BUDDY_THREAD_ID;
  const folder = yield* sharedBuddyFolder;
  if (folder === undefined) return null;
  const found = yield* findSharedBuddyThread(folder).pipe(Effect.orElseSucceed(() => null));
  return found?.thread?.id ?? null;
});

const SnapshotJson = Schema.fromJsonString(ControlPlaneSnapshot);
const decodeSnapshot = Schema.decodeUnknownEffect(SnapshotJson);
const encodeSnapshot = Schema.encodeEffect(SnapshotJson);

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lifecycle = yield* ThreadLifecycle;
  const services = yield* Effect.context<
    ServerConfig.ServerConfig | FileSystem.FileSystem | Path.Path | OrchestratorV2 | ProjectStoreV2
  >();
  const published = yield* PubSub.unbounded<ControlPlaneSnapshot>();
  const recordsDirectory = path.join(config.stateDir, "lazurio", "control-plane");

  const filesOf = (threadId: string) => {
    const attachmentId = controlPlaneAttachmentId(threadId);
    const page =
      attachmentId === null
        ? null
        : resolveAttachmentRelativePath({
            attachmentsDir: config.attachmentsDir,
            relativePath: `${attachmentId}.html`,
          });
    return attachmentId === null || page === null
      ? null
      : { attachmentId, page, record: path.join(recordsDirectory, `${attachmentId}.json`) };
  };

  const publish = Effect.fn("ControlPlane.publish")(function* (input: {
    readonly threadId: ThreadId;
    readonly html: string;
    readonly title: string;
  }) {
    if (Buffer.byteLength(input.html, "utf8") > CONTROL_PLANE_MAX_HTML_BYTES)
      return yield* refusal(
        "invalid-page",
        `The page is larger than ${CONTROL_PLANE_MAX_HTML_BYTES} bytes.`,
      );
    if (input.html.trim().length === 0) return yield* refusal("invalid-page", "The page is empty.");
    const buddys = yield* buddysThreadId;
    if (buddys === null || buddys !== input.threadId)
      return yield* refusal("not-buddys-thread", "Only Buddy's thread has a Control Plane.");
    const files = filesOf(input.threadId);
    if (files === null) return yield* refusal("invalid-thread", "Invalid thread id.");
    const html = injectHtmlRenderBootstrap(input.html);
    const snapshot: ControlPlaneSnapshot = {
      threadId: input.threadId,
      attachmentId: files.attachmentId,
      title: input.title.trim().slice(0, HTML_RENDER_MAX_TITLE_LENGTH) || "Control Plane",
      revision: controlPlaneRevision(html),
      publishedAt: DateTime.formatIso(yield* DateTime.now),
    };
    // The page first, then its record: a reader never gets a revision whose page is not there yet.
    yield* writeFileStringAtomically({ filePath: files.page, contents: html }).pipe(
      Effect.andThen(encodeSnapshot(snapshot)),
      Effect.flatMap((record) =>
        writeFileStringAtomically({ filePath: files.record, contents: record }),
      ),
      Effect.mapError((cause) =>
        refusal("store-failed", `The page could not be stored: ${String(cause)}`),
      ),
      Effect.uninterruptible,
    );
    yield* PubSub.publish(published, snapshot);
    return snapshot;
  }, Effect.provideContext(services));

  const read = Effect.fn("ControlPlane.read")(function* (threadId: ThreadId) {
    const files = filesOf(threadId);
    if (files === null) return null;
    const text = yield* fileSystem
      .readFileString(files.record)
      .pipe(Effect.orElseSucceed(() => null));
    if (
      text === null ||
      !(yield* fileSystem.exists(files.page).pipe(Effect.orElseSucceed(() => false)))
    )
      return null;
    return yield* decodeSnapshot(text).pipe(Effect.orElseSucceed(() => null));
  });

  const remove = (threadId: string) => {
    const files = filesOf(threadId);
    return files === null
      ? Effect.void
      : Effect.forEach(
          [files.record, files.page],
          (file) => fileSystem.remove(file, { force: true }),
          {
            discard: true,
          },
        ).pipe(Effect.ignore({ log: true }));
  };

  // A retired thread's page goes with it; nothing else knows its deterministic id.
  yield* lifecycle.events.pipe(
    Stream.filter((event) => event.type === "retired"),
    Stream.runForEach((event) => remove(event.threadId)),
    Effect.forkScoped,
  );

  return ControlPlane.of({
    publish,
    read,
    forget: remove,
    follow: (threadId) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const later = yield* PubSub.subscribe(published);
          const now = yield* read(threadId);
          return Stream.concat(
            Stream.fromIterable(now === null ? [] : [now]),
            Stream.fromSubscription(later).pipe(
              Stream.filter((snapshot) => snapshot.threadId === threadId),
            ),
          );
        }),
      ),
  });
});

export const layer = Layer.effect(ControlPlane, make);
