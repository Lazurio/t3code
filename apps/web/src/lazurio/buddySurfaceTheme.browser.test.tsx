import { describe, expect, it, vi } from "vite-plus/test";

import { useTheme } from "~/hooks/useTheme";
import {
  getStandardThemeColors,
  installCustomTheme,
  removeCustomTheme,
  THEME_APPEARANCE_MODE_STORAGE_KEY,
  type ThemeAppearance,
} from "~/themePalette";
import { render } from "../../test/render";
import { BuddySurfaceLayout } from "./BuddySurface";
import type { BuddyContext } from "./buddySurfaceProtocol";

// The surface reads the host's context from its frame; the test is the host.
const frame = vi.hoisted(() => ({ context: null as BuddyContext | null }));
vi.mock(import("./useBuddyFrame"), async (original) => ({
  ...(await original()),
  useBuddyFrame: () => ({
    framed: frame.context !== null,
    context: frame.context,
    layout: "panel" as const,
    requestLayout: () => {},
  }),
}));

const setup = () => {
  frame.context = null;
};

const hostPage = (theme: BuddyContext["theme"]): BuddyContext => ({
  lang: "en",
  theme,
  environment: { id: "example", kind: "personal", name: "Personal" },
  organization: null,
  app: "apps",
  page: { path: "/apps" },
  guide: null,
});

const dark = () => document.documentElement.classList.contains("dark");
const themeId = () => document.documentElement.dataset.themeId;

/** The key under which useTheme.ts keeps the person's saved T3 theme. */
const SAVED_THEME_STORAGE_KEY = "t3code:theme";

/** A custom T3 theme with only one appearance, saved as the person's theme. */
function savedThemeWithOnly(appearance: ThemeAppearance) {
  const id = `buddy-test-${appearance}-only`;
  removeCustomTheme(id);
  installCustomTheme({
    id,
    label: `Only ${appearance}`,
    appearance,
    colors: getStandardThemeColors(appearance),
  });
  localStorage.setItem(SAVED_THEME_STORAGE_KEY, id);
  return {
    id,
    [Symbol.dispose]: () => {
      localStorage.removeItem(SAVED_THEME_STORAGE_KEY);
      removeCustomTheme(id);
    },
  };
}

/** T3 reads its saved theme again and applies it, as after a change in another tab. */
const reloadSavedTheme = () => window.dispatchEvent(new StorageEvent("storage"));

/** T3's appearance as the test found it: no stored mode and the system's light look. */
function restoreAppearance() {
  return {
    [Symbol.dispose]: () => {
      localStorage.removeItem(THEME_APPEARANCE_MODE_STORAGE_KEY);
      document.documentElement.classList.remove("dark");
    },
  };
}

/** Buddy's thread in the surface, which reads T3's theme as ChatView does. */
function Conversation() {
  const { resolvedTheme } = useTheme();
  return <p data-theme={resolvedTheme}>Conversation</p>;
}

const layout = () => (
  <BuddySurfaceLayout>
    <Conversation />
  </BuddySurfaceLayout>
);

describe("Buddy's surface in the bubble", () => {
  it("wears the host page's theme and changes with it", async () => {
    setup();
    using _appearance = restoreAppearance();
    frame.context = hostPage("dark");
    await using screen = await render(layout());
    await vi.waitFor(() => expect(dark()).toBe(true));
    expect(localStorage.getItem(THEME_APPEARANCE_MODE_STORAGE_KEY)).toBe("dark");
    frame.context = hostPage("light");
    await screen.rerender(layout());
    await vi.waitFor(() => expect(dark()).toBe(false));
  });

  it("wears it also where the frame cannot keep T3's preference", async () => {
    setup();
    using _appearance = restoreAppearance();
    const blocked = () => {
      throw new DOMException("The frame's storage is blocked.", "SecurityError");
    };
    using _write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    using _errors = vi.spyOn(console, "error").mockImplementation(() => {});
    frame.context = hostPage("dark");
    await using screen = await render(layout());
    await vi.waitFor(() => expect(dark()).toBe(true));
    frame.context = hostPage("light");
    await screen.rerender(layout());
    await vi.waitFor(() => expect(dark()).toBe(false));
  });

  it("keeps the person's own T3 appearance outside a frame", async () => {
    setup();
    using _appearance = restoreAppearance();
    localStorage.setItem(THEME_APPEARANCE_MODE_STORAGE_KEY, "dark");
    await using _screen = await render(layout());
    await vi.waitFor(() => expect(dark()).toBe(true));
    expect(localStorage.getItem(THEME_APPEARANCE_MODE_STORAGE_KEY)).toBe("dark");
  });

  it("wears the host's light over a saved dark-only theme, and that theme on a dark host", async () => {
    setup();
    using _appearance = restoreAppearance();
    using saved = savedThemeWithOnly("dark");
    frame.context = hostPage("light");
    await using screen = await render(layout());
    reloadSavedTheme();
    await vi.waitFor(() => {
      expect(dark()).toBe(false);
      expect(themeId()).toBeUndefined();
    });
    frame.context = hostPage("dark");
    await screen.rerender(layout());
    await vi.waitFor(() => {
      expect(dark()).toBe(true);
      expect(themeId()).toBe(saved.id);
    });
  });

  it("wears the host's dark over a saved light-only theme", async () => {
    setup();
    using _appearance = restoreAppearance();
    using _saved = savedThemeWithOnly("light");
    frame.context = hostPage("dark");
    await using _screen = await render(layout());
    reloadSavedTheme();
    await vi.waitFor(() => {
      expect(dark()).toBe(true);
      expect(themeId()).toBeUndefined();
    });
  });
});
