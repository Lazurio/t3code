import { afterEach, expect, it, vi } from "vite-plus/test";

import {
  resolveServerBackedAppDisplayName,
  resolveServerBackedAppStageLabel,
} from "../branding.logic";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

it("names a Lazurio T3 Code build T3 Code (Lazurio) and keeps Dev for development", async () => {
  vi.stubEnv("DEV", false);
  const build = await import("../branding");

  expect(build.APP_BASE_NAME).toBe("T3 Code");
  expect(build.APP_STAGE_LABEL).toBe("Lazurio");
  expect(build.APP_DISPLAY_NAME).toBe("T3 Code (Lazurio)");

  vi.resetModules();
  vi.stubEnv("DEV", true);
  const development = await import("../branding");

  expect(development.APP_DISPLAY_NAME).toBe("T3 Code (Dev)");
});

it("keeps the fallback stage label for preview primary server versions", () => {
  expect(
    resolveServerBackedAppStageLabel({
      primaryServerVersion: "0.0.45-preview.20261013.1",
      fallbackStageLabel: "Lazurio",
    }),
  ).toBe("Lazurio");
  expect(
    resolveServerBackedAppDisplayName({
      baseName: "T3 Code",
      fallbackDisplayName: "T3 Code (Lazurio)",
      fallbackStageLabel: "Lazurio",
      primaryServerVersion: "0.0.45-preview.20261013.1",
    }),
  ).toBe("T3 Code (Lazurio)");
});
