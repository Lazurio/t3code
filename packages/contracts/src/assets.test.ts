import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { AttachmentCreateUploadUrlInput } from "./assets.ts";
import {
  PROVIDER_SEND_TURN_MAX_CONTEXT_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "./orchestration.ts";

const isUploadInput = Schema.is(AttachmentCreateUploadUrlInput);

const uploadInput = {
  name: "screenshot.png",
  mimeType: "image/png",
  sizeBytes: 3,
} as const;

describe("AttachmentCreateUploadUrlInput", () => {
  it("accepts supported image attachments", () => {
    expect(isUploadInput(uploadInput)).toBe(true);
  });

  it("rejects image types that providers do not support", () => {
    expect(isUploadInput({ ...uploadInput, mimeType: "image/svg+xml" })).toBe(false);
  });

  it("rejects empty and oversized uploads", () => {
    expect(isUploadInput({ ...uploadInput, sizeBytes: 0 })).toBe(false);
    expect(
      isUploadInput({ ...uploadInput, sizeBytes: PROVIDER_SEND_TURN_MAX_IMAGE_BYTES + 1 }),
    ).toBe(false);
  });

  it("accepts arbitrary context files only with the explicit file discriminator", () => {
    expect(
      isUploadInput({
        type: "file",
        name: "requirements.pdf",
        mimeType: "application/pdf",
        sizeBytes: 42,
      }),
    ).toBe(true);
    expect(
      isUploadInput({
        name: "requirements.pdf",
        mimeType: "application/pdf",
        sizeBytes: 42,
      }),
    ).toBe(false);
  });

  it("bounds context files independently from images", () => {
    expect(
      isUploadInput({
        type: "file",
        name: "archive.bin",
        mimeType: "application/octet-stream",
        sizeBytes: PROVIDER_SEND_TURN_MAX_CONTEXT_FILE_BYTES,
      }),
    ).toBe(true);
    expect(
      isUploadInput({
        type: "file",
        name: "archive.bin",
        mimeType: "application/octet-stream",
        sizeBytes: PROVIDER_SEND_TURN_MAX_CONTEXT_FILE_BYTES + 1,
      }),
    ).toBe(false);
  });
});
