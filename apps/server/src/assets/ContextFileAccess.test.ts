import { describe, expect, it } from "@effect/vitest";
import { MessageId, ThreadId } from "@t3tools/contracts";

import { findProjectedContextFile } from "./ContextFileAccess.ts";

const file = {
  type: "file" as const,
  id: "thread-owner-00000000-0000-4000-8000-000000000001",
  name: "requirements.pdf",
  mimeType: "application/pdf",
  sizeBytes: 42,
};
const messages = [
  {
    id: MessageId.make("message-owner"),
    contextFiles: [file],
  },
  {
    id: MessageId.make("message-other"),
    contextFiles: [],
  },
];

describe("findProjectedContextFile", () => {
  it("returns metadata only for the exact projected message and attachment", () => {
    expect(
      findProjectedContextFile(messages, {
        _tag: "context-file",
        threadId: ThreadId.make("thread-owner"),
        messageId: MessageId.make("message-owner"),
        attachmentId: file.id,
      }),
    ).toEqual(file);

    expect(
      findProjectedContextFile(messages, {
        _tag: "context-file",
        threadId: ThreadId.make("thread-owner"),
        messageId: MessageId.make("message-other"),
        attachmentId: file.id,
      }),
    ).toBeUndefined();
    expect(
      findProjectedContextFile(messages, {
        _tag: "context-file",
        threadId: ThreadId.make("thread-owner"),
        messageId: MessageId.make("message-owner"),
        attachmentId: "thread-owner-00000000-0000-4000-8000-000000000099",
      }),
    ).toBeUndefined();
  });
});
