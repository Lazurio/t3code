import { describe, expect, it } from "vite-plus/test";

import { buddyAnnouncementLevel } from "./buddySurfaceTimeline";

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
