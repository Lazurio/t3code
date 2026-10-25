import { describe, expect, it, vi } from "vite-plus/test";

import { useTheme } from "~/hooks/useTheme";
import { THEME_APPEARANCE_MODE_STORAGE_KEY } from "~/themePalette";
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
});
