import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  formatHostedDocumentTitle,
  resolveServerBackedAppDisplayName,
  resolveServerBackedAppStageLabel,
} from "./branding.logic";

const originalWindow = globalThis.window;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();

  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }

  globalThis.window = originalWindow;
});

describe("branding", () => {
  it("uses injected desktop branding when available", async () => {
    vi.stubEnv("VITE_HOSTED_APP_NAME", "Lazurio T3 Code");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        desktopBridge: {
          getAppBranding: () => ({
            baseName: "T3 Code",
            stageLabel: "Nightly",
            displayName: "T3 Code (Nightly)",
          }),
        },
      },
    });

    const branding = await import("./branding");

    expect(branding.APP_BASE_NAME).toBe("T3 Code");
    expect(branding.APP_STAGE_LABEL).toBe("Nightly");
    expect(branding.APP_DISPLAY_NAME).toBe("T3 Code (Nightly)");
    expect(branding.HOSTED_APP_NAME).toBeNull();
  });

  it("normalizes hosted app channel metadata", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "nightly");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBe("nightly");
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBe("Nightly");
    expect(branding.APP_STAGE_LABEL).toBe("Nightly");
    expect(branding.APP_DISPLAY_NAME).toBe("T3 Code (Nightly)");
  });

  it("does not label the latest hosted app channel", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "latest");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBe("latest");
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBe("Latest");
    expect(branding.APP_STAGE_LABEL).toBe("Latest");
    expect(branding.APP_DISPLAY_NAME).toBe("T3 Code");
  });

  it("ignores unknown hosted app channels", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "preview");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBeNull();
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBeNull();
  });

  it("uses the opt-in hosted browser identity without changing desktop branding", async () => {
    vi.stubEnv("VITE_HOSTED_APP_NAME", "  Lazurio T3 Code  ");
    vi.stubEnv("VITE_DISTRIBUTION_RELEASE", "lazurio-v0.0.35-r1");
    vi.stubEnv("VITE_DISTRIBUTION_UPSTREAM_TAG", "v0.0.35");
    vi.stubEnv("VITE_DISTRIBUTION_UPSTREAM_BASE", "f925d639421844f02b3166d29281905dbba6d529");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_NAME).toBe("Lazurio T3 Code");
    expect(branding.APP_BASE_NAME).toBe("Lazurio T3 Code");
    expect(branding.APP_DISPLAY_NAME).toBe("Lazurio T3 Code");
    expect(branding.DISTRIBUTION_RELEASE).toBe("lazurio-v0.0.35-r1");
    expect(branding.DISTRIBUTION_UPSTREAM_TAG).toBe("v0.0.35");
    expect(branding.DISTRIBUTION_UPSTREAM_BASE).toBe("f925d639421844f02b3166d29281905dbba6d529");
  });
});

describe("branding logic", () => {
  it("returns Nightly for nightly primary server versions", () => {
    expect(
      resolveServerBackedAppStageLabel({
        primaryServerVersion: "0.0.28-nightly.20260616.12",
        fallbackStageLabel: "Alpha",
      }),
    ).toBe("Nightly");
  });

  it("updates the display name for nightly primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "T3 Code",
        fallbackDisplayName: "T3 Code (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.28-nightly.20260616.12",
      }),
    ).toBe("T3 Code (Nightly)");
  });

  it("keeps the fallback display name for stable primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "T3 Code",
        fallbackDisplayName: "T3 Code (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.27",
      }),
    ).toBe("T3 Code (Alpha)");
  });

  it("keeps the fallback display name for malformed nightly primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "T3 Code",
        fallbackDisplayName: "T3 Code (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.28-nightly.20260616",
      }),
    ).toBe("T3 Code (Alpha)");
  });

  it("adds the runtime Workspace identity only to hosted browser titles", () => {
    expect(
      formatHostedDocumentTitle({
        appDisplayName: "Lazurio T3 Code",
        hostedAppName: "Lazurio T3 Code",
        environmentLabel: " Iotor / Management ",
      }),
    ).toBe("Lazurio T3 Code — Iotor / Management");

    expect(
      formatHostedDocumentTitle({
        appDisplayName: "T3 Code (Alpha)",
        hostedAppName: null,
        environmentLabel: "Iotor / Management",
      }),
    ).toBe("T3 Code (Alpha)");
  });
});
