import { describe, expect, it, vi } from "vite-plus/test";

import { knowBuddysThread, knownBuddysThread, subscribeBuddysThread } from "./buddysThread";

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Buddy's thread, as the window knows it", () => {
  it("is learned from the server when the window opened directly on it, once at a time", async () => {
    const replies = [
      answer(409, { error: "no-project" }),
      answer(200, { threadId: "thread-buddy", projectId: "project-buddy" }),
    ];
    const fetcher = vi.fn(async () => replies.shift() ?? answer(500, {}));
    vi.stubGlobal("fetch", fetcher);
    try {
      const heard = vi.fn();
      const stop = subscribeBuddysThread(heard);
      // Buddy's project is not there yet: still unknown, and the next open asks again.
      await knowBuddysThread();
      expect(knownBuddysThread()).toBeNull();
      // Two controls asking at once make one request.
      await Promise.all([knowBuddysThread(), knowBuddysThread()]);
      expect(knownBuddysThread()).toBe("thread-buddy");
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(heard).toHaveBeenCalledTimes(1);
      // Known: no more requests.
      await knowBuddysThread();
      expect(fetcher).toHaveBeenCalledTimes(2);
      stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
