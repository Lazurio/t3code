import { describe, expect, it } from "vite-plus/test";
import { managedFirstRunDecision } from "./managedFolder";

describe("managed first run", () => {
  it("waits for live server evidence of the native Folder project, even with saved onboarding", () => {
    for (const completed of [true, false]) {
      expect(
        managedFirstRunDecision({ hydrated: true, live: false, projectReady: true, completed })
          .decision,
      ).toBe("pending");
      expect(
        managedFirstRunDecision({ hydrated: true, live: true, projectReady: false, completed })
          .decision,
      ).toBe("pending");
    }
  });
  it("offers the Lazurio welcome once and then opens the app, never imports or silently completes", () => {
    expect(
      managedFirstRunDecision({ hydrated: true, live: true, projectReady: true, completed: false }),
    ).toEqual({ decision: "wizard", persistCompletion: false });
    expect(
      managedFirstRunDecision({ hydrated: true, live: true, projectReady: true, completed: true }),
    ).toEqual({ decision: "app", persistCompletion: false });
  });
});
