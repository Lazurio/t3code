// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  type ClientOrchestrationCommand,
  CommandId,
  MessageId,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { cleanupFailedUploadedAttachments, normalizeDispatchCommand } from "./Normalizer.ts";

const testLayer = Layer.mergeAll(
  WorkspacePaths.layer,
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-normalizer-attachments-" }),
).pipe(Layer.provideMerge(NodeServices.layer));

const attachmentUuid = "00000000-0000-4000-8000-0000000000aa";

function turnStartCommand(input: {
  readonly threadId?: string;
  readonly attachments: ReadonlyArray<
    | { readonly id: string; readonly sizeBytes: number }
    | { readonly dataUrl: string; readonly sizeBytes: number }
  >;
  readonly contextFiles?: ReadonlyArray<{
    readonly id: string;
    readonly sizeBytes: number;
    readonly name?: string;
    readonly mimeType?: string;
  }>;
}): ClientOrchestrationCommand {
  return {
    type: "thread.turn.start",
    commandId: CommandId.make("command-1"),
    threadId: ThreadId.make(input.threadId ?? "thread-1"),
    message: {
      messageId: MessageId.make("message-1"),
      role: "user",
      text: "look at this",
      attachments: input.attachments.map((attachment) => ({
        type: "image" as const,
        name: "screenshot.png",
        mimeType: "image/png",
        ...attachment,
      })),
      ...(input.contextFiles
        ? {
            contextFiles: input.contextFiles.map((file) => ({
              type: "file" as const,
              name: file.name ?? "source material.pdf",
              mimeType: file.mimeType ?? "application/pdf",
              ...file,
            })),
          }
        : {}),
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("normalizeDispatchCommand attachments", () => {
  it.effect("preserves inline image attachments from existing mobile clients", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const normalized = yield* normalizeDispatchCommand(
        turnStartCommand({
          attachments: [{ dataUrl: "data:image/png;base64,cGl4ZWxz", sizeBytes: 6 }],
        }),
      );
      if (normalized.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }

      const attachment = normalized.message.attachments[0]!;
      expect(attachment.id.startsWith("thread-1-")).toBe(true);
      expect(
        NodeFS.readFileSync(NodePath.join(config.attachmentsDir, `${attachment.id}.png`)),
      ).toEqual(Buffer.from("pixels"));
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("preserves the vanilla image-only aggregate ceiling", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const attachments = Array.from({ length: 8 }, (_, index) => {
        const suffix = String(index + 1).padStart(12, "0");
        const id = `pending-00000000-0000-4000-8000-${suffix}`;
        const pendingPath = NodePath.join(config.attachmentsDir, `${id}.png`);
        NodeFS.writeFileSync(pendingPath, "");
        NodeFS.truncateSync(pendingPath, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES);
        return { id, sizeBytes: PROVIDER_SEND_TURN_MAX_IMAGE_BYTES };
      });

      const normalized = yield* normalizeDispatchCommand(turnStartCommand({ attachments }));
      if (normalized.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }

      expect(normalized.message.attachments).toHaveLength(8);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("claims uploaded attachments while retaining a retryable pending copy", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const bytes = Buffer.from("pixels");
      const pendingPath = NodePath.join(config.attachmentsDir, `pending-${attachmentUuid}.png`);
      NodeFS.writeFileSync(pendingPath, bytes);

      const normalized = yield* normalizeDispatchCommand(
        turnStartCommand({
          attachments: [{ id: `pending-${attachmentUuid}`, sizeBytes: bytes.byteLength }],
        }),
      );
      if (normalized.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }

      const attachmentId = normalized.message.attachments[0]!.id;
      expect(attachmentId.startsWith("thread-1-")).toBe(true);
      expect(attachmentId).not.toBe(`thread-1-${attachmentUuid}`);
      expect(NodeFS.existsSync(pendingPath)).toBe(true);
      expect(NodeFS.existsSync(NodePath.join(config.attachmentsDir, `${attachmentId}.png`))).toBe(
        true,
      );
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("claims opaque context files and cleans only the failed thread-owned copy", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const bytes = Buffer.from("%PDF-1.7");
      const pendingPath = NodePath.join(config.attachmentsDir, `pending-${attachmentUuid}.bin`);
      NodeFS.writeFileSync(pendingPath, bytes);
      const command = turnStartCommand({
        attachments: [],
        contextFiles: [{ id: `pending-${attachmentUuid}`, sizeBytes: bytes.byteLength }],
      });

      const normalized = yield* normalizeDispatchCommand(command);
      if (normalized.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }
      const contextFile = normalized.message.contextFiles?.[0];
      if (!contextFile) {
        throw new Error("Expected a normalized context file.");
      }
      const claimedPath = NodePath.join(config.attachmentsDir, `${contextFile.id}.bin`);

      expect(contextFile).toMatchObject({
        type: "file",
        name: "source material.pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.byteLength,
      });
      expect(contextFile.id.startsWith("thread-1-")).toBe(true);
      expect(NodeFS.readFileSync(claimedPath)).toEqual(bytes);
      expect(NodeFS.existsSync(pendingPath)).toBe(true);

      yield* cleanupFailedUploadedAttachments(command, normalized);
      expect(NodeFS.existsSync(claimedPath)).toBe(false);
      expect(NodeFS.existsSync(pendingPath)).toBe(true);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("keeps the claimed file when pending removal races turn normalization", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const bytes = Buffer.from("%PDF-1.7");
      const pendingId = `pending-${attachmentUuid}`;
      const pendingPath = NodePath.join(config.attachmentsDir, `${pendingId}.bin`);
      NodeFS.writeFileSync(pendingPath, bytes);

      const removeImmediatelyAfterClaimFileSystem = FileSystem.FileSystem.of({
        ...fileSystem,
        link: (currentPath, finalPath) =>
          fileSystem
            .link(currentPath, finalPath)
            .pipe(Effect.andThen(fileSystem.remove(currentPath, { force: true }))),
      });
      const normalized = yield* normalizeDispatchCommand(
        turnStartCommand({
          attachments: [],
          contextFiles: [{ id: pendingId, sizeBytes: bytes.byteLength }],
        }),
      ).pipe(Effect.provideService(FileSystem.FileSystem, removeImmediatelyAfterClaimFileSystem));
      if (normalized.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }
      const contextFile = normalized.message.contextFiles?.[0];
      if (!contextFile) {
        throw new Error("Expected a normalized context file.");
      }

      expect(NodeFS.existsSync(pendingPath)).toBe(false);
      expect(
        NodeFS.readFileSync(NodePath.join(config.attachmentsDir, `${contextFile.id}.bin`)),
      ).toEqual(bytes);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("normalizes inline and uploaded attachments in the same turn", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      NodeFS.writeFileSync(
        NodePath.join(config.attachmentsDir, `pending-${attachmentUuid}.png`),
        Buffer.from("pixels"),
      );

      const normalized = yield* normalizeDispatchCommand(
        turnStartCommand({
          attachments: [
            { dataUrl: "data:image/png;base64,cGl4ZWxz", sizeBytes: 6 },
            { id: `pending-${attachmentUuid}`, sizeBytes: 6 },
          ],
        }),
      );
      if (normalized.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }

      expect(normalized.message.attachments).toHaveLength(2);
      expect(normalized.message.attachments[1]?.id.startsWith("thread-1-")).toBe(true);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("retries a failed bootstrap with a fresh thread id", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const bytes = Buffer.from("pixels");
      NodeFS.writeFileSync(
        NodePath.join(config.attachmentsDir, `pending-${attachmentUuid}.png`),
        bytes,
      );

      const first = yield* normalizeDispatchCommand(
        turnStartCommand({
          attachments: [{ id: `pending-${attachmentUuid}`, sizeBytes: bytes.byteLength }],
        }),
      );
      if (first.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }
      NodeFS.rmSync(
        NodePath.join(config.attachmentsDir, `${first.message.attachments[0]!.id}.png`),
      );

      const retried = yield* normalizeDispatchCommand(
        turnStartCommand({
          threadId: "thread-retry",
          attachments: [{ id: `pending-${attachmentUuid}`, sizeBytes: bytes.byteLength }],
        }),
      );
      if (retried.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }
      expect(retried.message.attachments[0]?.id.startsWith("thread-retry-")).toBe(true);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("removes failed attachment claims without deleting their pending uploads", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const pendingPath = NodePath.join(config.attachmentsDir, `pending-${attachmentUuid}.png`);
      NodeFS.writeFileSync(pendingPath, Buffer.from("pixels"));
      const command = turnStartCommand({
        attachments: [
          { dataUrl: "data:image/png;base64,cGl4ZWxz", sizeBytes: 6 },
          { id: `pending-${attachmentUuid}`, sizeBytes: 6 },
        ],
      });
      const normalized = yield* normalizeDispatchCommand(command);
      if (normalized.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }

      const inlinePath = NodePath.join(
        config.attachmentsDir,
        `${normalized.message.attachments[0]!.id}.png`,
      );
      const claimedPath = NodePath.join(
        config.attachmentsDir,
        `${normalized.message.attachments[1]!.id}.png`,
      );
      yield* cleanupFailedUploadedAttachments(command, normalized);

      expect(NodeFS.existsSync(pendingPath)).toBe(true);
      expect(NodeFS.existsSync(claimedPath)).toBe(false);
      expect(NodeFS.existsSync(inlinePath)).toBe(true);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("removes a failed claimed copy after its pending original was removed", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const pendingPath = NodePath.join(config.attachmentsDir, `pending-${attachmentUuid}.png`);
      NodeFS.writeFileSync(pendingPath, Buffer.from("pixels"));
      const command = turnStartCommand({
        attachments: [{ id: `pending-${attachmentUuid}`, sizeBytes: 6 }],
      });
      const normalized = yield* normalizeDispatchCommand(command);
      if (normalized.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }

      const claimedPath = NodePath.join(
        config.attachmentsDir,
        `${normalized.message.attachments[0]!.id}.png`,
      );
      NodeFS.rmSync(pendingPath);

      yield* cleanupFailedUploadedAttachments(command, normalized);

      expect(NodeFS.existsSync(claimedPath)).toBe(false);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("keeps concurrent claims independent when one dispatch fails", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const pendingPath = NodePath.join(config.attachmentsDir, `pending-${attachmentUuid}.png`);
      NodeFS.writeFileSync(pendingPath, Buffer.from("pixels"));
      const command = turnStartCommand({
        attachments: [{ id: `pending-${attachmentUuid}`, sizeBytes: 6 }],
      });

      const [failed, succeeded] = yield* Effect.all(
        [normalizeDispatchCommand(command), normalizeDispatchCommand(command)],
        { concurrency: 2 },
      );
      if (failed.type !== "thread.turn.start" || succeeded.type !== "thread.turn.start") {
        throw new Error("Expected thread.turn.start commands.");
      }

      const failedPath = NodePath.join(
        config.attachmentsDir,
        `${failed.message.attachments[0]!.id}.png`,
      );
      const succeededPath = NodePath.join(
        config.attachmentsDir,
        `${succeeded.message.attachments[0]!.id}.png`,
      );
      expect(failedPath).not.toBe(succeededPath);

      yield* cleanupFailedUploadedAttachments(command, failed);

      expect(NodeFS.existsSync(pendingPath)).toBe(true);
      expect(NodeFS.existsSync(failedPath)).toBe(false);
      expect(NodeFS.existsSync(succeededPath)).toBe(true);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("removes earlier claimed copies when a later attachment cannot be normalized", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const pendingId = `pending-${attachmentUuid}`;
      const pendingPath = NodePath.join(config.attachmentsDir, `${pendingId}.png`);
      NodeFS.writeFileSync(pendingPath, Buffer.from("pixels"));

      const failure = yield* normalizeDispatchCommand(
        turnStartCommand({
          attachments: [
            { id: pendingId, sizeBytes: 6 },
            {
              id: "pending-00000000-0000-4000-8000-0000000000ff",
              sizeBytes: 6,
            },
          ],
        }),
      ).pipe(Effect.flip);

      expect(failure.message).toContain("not found");
      expect(NodeFS.readdirSync(config.attachmentsDir)).toEqual([`${pendingId}.png`]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects uploaded attachments with the wrong size or thread", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      NodeFS.writeFileSync(
        NodePath.join(config.attachmentsDir, `pending-${attachmentUuid}.png`),
        Buffer.from("pixels"),
      );

      const wrongSize = yield* normalizeDispatchCommand(
        turnStartCommand({
          attachments: [{ id: `pending-${attachmentUuid}`, sizeBytes: 999 }],
        }),
      ).pipe(Effect.flip);
      expect(wrongSize.message).toContain("size");

      const wrongThread = yield* normalizeDispatchCommand(
        turnStartCommand({
          attachments: [{ id: `another-thread-${attachmentUuid}`, sizeBytes: 6 }],
        }),
      ).pipe(Effect.flip);
      expect(wrongThread.message).toContain("pending upload");

      const mismatchedTypeCommand = turnStartCommand({
        attachments: [{ id: `pending-${attachmentUuid}`, sizeBytes: 6 }],
      });
      if (mismatchedTypeCommand.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }
      const mismatchedType = yield* normalizeDispatchCommand({
        ...mismatchedTypeCommand,
        message: {
          ...mismatchedTypeCommand.message,
          attachments: mismatchedTypeCommand.message.attachments.map((attachment) => ({
            ...attachment,
            mimeType: "image/jpeg",
          })),
        },
      }).pipe(Effect.flip);
      expect(mismatchedType.message).toContain("image type");
    }).pipe(Effect.provide(testLayer)),
  );
});
