import { describe, expect, it } from "vite-plus/test";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";

import { buddyAnnouncementLevel, buddyConversationRows } from "./buddySurfaceTimeline";

describe("what a screen reader hears of a turn", () => {
  it("on Buddy's surface stops at Buddy's messages, without T3's steps", () => {
    expect(buddyAnnouncementLevel(true, "everything")).toBe("messages");
    expect(buddyAnnouncementLevel(true, "messages")).toBe("messages");
    expect(buddyAnnouncementLevel(true, "status")).toBe("status");
  });

  it("outside Buddy's T3 Code follows the person's setting", () => {
    expect(buddyAnnouncementLevel(false, "everything")).toBe("everything");
    expect(buddyAnnouncementLevel(false, "messages")).toBe("messages");
    expect(buddyAnnouncementLevel(false, "status")).toBe("status");
  });
});

describe("Buddy's conversation rows", () => {
  it("keep what Buddy sent the person with send_to_user, without T3's work", () => {
    const sent: MessagesTimelineRow = {
      kind: "sent-message",
      id: "sent-1",
      createdAt: "2026-11-17T00:00:00.000Z",
      text: "The draft you asked for.",
    };
    const t3Working: MessagesTimelineRow = { kind: "working", id: "working", createdAt: null };

    expect(buddyConversationRows([sent, t3Working], false)).toEqual([sent]);
  });
});
