import { describe, expect, it } from "vite-plus/test";
import { everyEnvironmentManaged, managedFirstRunDecision } from "./managedFolder";

const unmanaged = { serverConfig: {} };
const managed = { serverConfig: { lazurioFolder: "/home/person/Lazurio" } };
const loading = { serverConfig: null };

describe("Add project in a managed Environment", () => {
  // The command palette and the sidebar show "Add project" exactly when this is false.
  it("stays as upstream without T3CODE_LAZURIO_FOLDER, also with no Environment at all", () => {
    expect(everyEnvironmentManaged([])).toBe(false);
    expect(everyEnvironmentManaged([unmanaged])).toBe(false);
    expect(everyEnvironmentManaged([unmanaged, unmanaged])).toBe(false);
    expect(everyEnvironmentManaged([loading])).toBe(false);
  });

  it("leaves only when every known Environment is managed", () => {
    expect(everyEnvironmentManaged([managed])).toBe(true);
    expect(everyEnvironmentManaged([managed, managed])).toBe(true);
    expect(everyEnvironmentManaged([managed, unmanaged])).toBe(false);
    expect(everyEnvironmentManaged([unmanaged, managed])).toBe(false);
    // Until its config arrives, an Environment is not known to be managed.
    expect(everyEnvironmentManaged([managed, loading])).toBe(false);
  });
});

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
