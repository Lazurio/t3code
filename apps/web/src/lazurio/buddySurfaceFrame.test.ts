import { describe, expect, it } from "vite-plus/test";

import {
  buddyHostOfWindow,
  buddyPanelOpensItself,
  buddyPanelOverWholeWindow,
  buddyFrameAllowsNativePdf,
  buddyPanelOverWindow,
  buddyPanelsOffered,
  buddyWindowInView,
  startBuddyFrame,
} from "./buddySurfaceFrame";

const HOST = "https://launchpad.example-person.lazurio.io";
// What the host sends after the frame's ready, about its own Environment.
const personalContext = {
  type: "lazurio.buddy.context",
  v: 1,
  lang: "cs",
  theme: "light",
  environment: { id: "example-person", kind: "personal", name: "Osobní" },
  organization: null,
  app: null,
  page: { path: "/" },
  guide: null,
};

/** A frame's window as far as the frame uses it: its parent, its ancestors and its listeners. */
function frameWindow(
  options: {
    readonly host?: string;
    readonly openMenu?: boolean;
    readonly panelOverWindow?: boolean;
  } = {},
) {
  const posted: Array<{ readonly message: unknown; readonly origin: string }> = [];
  const listeners = new Map<string, (event: unknown) => void>();
  const parent = {
    postMessage: (message: unknown, origin: string) => posted.push({ message, origin }),
  };
  const win = {
    parent,
    location: { ancestorOrigins: [options.host ?? HOST] },
    document: {
      referrer: "",
      // As the DOM does, it also finds the hidden dialog below.
      querySelector: (selector: string) =>
        selector.includes("maximized-away") ? (options.panelOverWindow === true ? {} : null) : {},
      // A narrow window keeps a closed sheet mounted as a hidden dialog.
      querySelectorAll: () => [
        { checkVisibility: () => false },
        ...(options.openMenu === true ? [{ checkVisibility: () => true }] : []),
      ],
    },
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  const key = (overrides: Partial<KeyboardEvent> = {}) =>
    listeners.get("keydown")?.({
      key: "Escape",
      defaultPrevented: false,
      isComposing: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...overrides,
    });
  const receive = (data: unknown, origin = options.host ?? HOST, source: unknown = parent) =>
    listeners.get("message")?.({ data, origin, source });
  return { win: win as unknown as Window, posted, key, receive };
}

const layouts = (posted: ReadonlyArray<{ readonly message: unknown }>) =>
  posted.flatMap(({ message }) =>
    (message as { type?: string }).type === "lazurio.buddy.layout"
      ? [(message as { mode: string }).mode]
      : [],
  );

describe("Buddy's frame", () => {
  it("tells the host it is ready, and Escape asks for the panel also from the composer", () => {
    const { win, posted, key } = frameWindow();
    const frame = startBuddyFrame(win);
    expect(posted[0]).toEqual({ message: { type: "lazurio.buddy.ready", v: 1 }, origin: HOST });
    frame.requestLayout("fullscreen");
    // The composer's editor marks Escape as handled; it still asks for the panel.
    key({ defaultPrevented: true });
    expect(layouts(posted)).toEqual(["fullscreen", "panel"]);
    expect(frame.layout()).toBe("panel");
  });

  it("leaves Escape to an open menu, a panel over the window, a modifier or an input method", () => {
    const menu = frameWindow({ openMenu: true });
    startBuddyFrame(menu.win);
    menu.key();
    expect(layouts(menu.posted)).toEqual([]);

    // Escape over the panel goes back to the conversation first (BuddySurface.tsx).
    const panel = frameWindow({ panelOverWindow: true });
    startBuddyFrame(panel.win).requestLayout("fullscreen");
    panel.key();
    expect(layouts(panel.posted)).toEqual(["fullscreen"]);

    const { win, posted, key } = frameWindow();
    startBuddyFrame(win);
    key({ shiftKey: true });
    key({ isComposing: true });
    key({ key: "Enter" });
    expect(layouts(posted)).toEqual([]);
  });

  it("counts its thread as seen only once the host shows the window, also when loaded anew while hidden", () => {
    const { win, receive } = frameWindow();
    const frame = startBuddyFrame(win);
    const inView = () =>
      buddyWindowInView(frame.hostOrigin !== null, frame.shown(), frame.context() !== null);
    // A frame loaded anew behind a closed window: until the host answers, an unread answer stays
    // unread.
    expect(frame.shown()).toBeNull();
    expect(inView()).toBe(false);
    // The host answers its ready: hidden first, then the context.
    receive({ type: "lazurio.buddy.shown", v: 1, shown: false });
    receive(personalContext);
    expect(inView()).toBe(false);
    // Only the parent on the host's origin says it is shown.
    receive({ type: "lazurio.buddy.shown", v: 1, shown: true }, "https://example.com");
    receive({ type: "lazurio.buddy.shown", v: 1, shown: true }, HOST, {});
    expect(inView()).toBe(false);
    receive({ type: "lazurio.buddy.shown", v: 1, shown: true });
    expect(inView()).toBe(true);
    // Outside a host's frame the thread counts as seen, as before.
    expect(buddyWindowInView(false, null, false)).toBe(true);
  });

  it("counts nothing in a host's frame before the config is known, then only once the host shows it", () => {
    // Loaded anew at Buddy's thread behind a closed window; the config is still loading, so no
    // frame has started yet. The window alone says a host frames it.
    const { win, receive, posted } = frameWindow();
    const framed = buddyHostOfWindow(win) !== null;
    expect(framed).toBe(true);
    expect(posted).toEqual([]);
    expect(buddyWindowInView(framed, null, false)).toBe(false);
    // The config arrives and the frame starts; the host answers its ready, hidden.
    const frame = startBuddyFrame(win);
    const inView = () => buddyWindowInView(framed, frame.shown(), frame.context() !== null);
    receive({ type: "lazurio.buddy.shown", v: 1, shown: false });
    receive(personalContext);
    expect(inView()).toBe(false);
    receive({ type: "lazurio.buddy.shown", v: 1, shown: true });
    expect(inView()).toBe(true);
    // A page no host frames counts as before.
    expect(buddyHostOfWindow(frameWindow({ host: "https://example.com" }).win)).toBeNull();
  });

  it("behaves as before with an older host, which sends its context and never says shown", () => {
    const { win, receive } = frameWindow();
    const frame = startBuddyFrame(win);
    receive(personalContext);
    expect(frame.shown()).toBeNull();
    expect(
      buddyWindowInView(frame.hostOrigin !== null, frame.shown(), frame.context() !== null),
    ).toBe(true);
  });

  it("takes the size the host's window shows, also one the host chose itself, and drops a defect", () => {
    const { win, posted, key, receive } = frameWindow();
    const frame = startBuddyFrame(win);
    expect(frame.mode()).toBeNull();
    // The launcher opened the remembered full screen: one Escape leaves it.
    receive({ type: "lazurio.buddy.layout", v: 1, mode: "fullscreen" });
    expect(frame.mode()).toBe("fullscreen");
    key();
    expect(layouts(posted)).toEqual(["panel"]);
    for (const defect of [
      { type: "lazurio.buddy.layout", v: 2, mode: "panel" },
      { type: "lazurio.buddy.layout", v: 1, mode: "huge" },
      { type: "lazurio.buddy.layout", v: 1, mode: "panel", extra: true },
    ])
      receive(defect);
    receive({ type: "lazurio.buddy.layout", v: 1, mode: "panel" }, "https://example.com");
    receive({ type: "lazurio.buddy.layout", v: 1, mode: "panel" }, HOST, {});
    expect(frame.mode()).toBe("fullscreen");
    receive({ type: "lazurio.buddy.layout", v: 1, mode: "closed" });
    expect(frame.mode()).toBe("closed");
    expect(frame.layout()).toBe("panel");
  });

  it("covers the whole window with the right panel on a narrow screen only", () => {
    // Buddy's full-screen window on a phone or a narrow window: the panel over the whole window.
    expect(buddyPanelOverWindow(true, true, true)).toBe(true);
    // A wide full-screen window: T3's own column beside the conversation.
    expect(buddyPanelOverWindow(true, true, false)).toBe(false);
    // Not offered (his small window), or Chat on its own page: never.
    expect(buddyPanelOverWindow(true, false, true)).toBe(false);
    expect(buddyPanelOverWindow(false, true, true)).toBe(false);
  });

  it("leaves a PDF to PDF.js where a host frames the window, and to the browser elsewhere", () => {
    // In Buddy's window the host's sandbox reaches a nested frame, and Chromium blocks its viewer.
    expect(buddyFrameAllowsNativePdf(frameWindow().win)).toBe(false);
    // Chat on its own page: the browser's viewer.
    const top = { parent: undefined as unknown, location: {}, document: { referrer: "" } };
    top.parent = top;
    expect(buddyFrameAllowsNativePdf(top as unknown as Window)).toBe(true);
  });

  it("offers the panels in the full-screen window, also a phone's, and never in the small one", () => {
    const { win } = frameWindow();
    const framed = buddyHostOfWindow(win) !== null;
    // As the host says: full screen on a phone or a computer offers both, the small window neither.
    expect(buddyPanelsOffered(framed, "fullscreen", true)).toBe(true);
    expect(buddyPanelsOffered(framed, "fullscreen", false)).toBe(true);
    expect(buddyPanelsOffered(framed, "panel", true)).toBe(false);
    expect(buddyPanelsOffered(framed, "closed", false)).toBe(false);
    // An older host never says: a frame too narrow for the panels reads as the small window.
    expect(buddyPanelsOffered(framed, null, true)).toBe(false);
    expect(buddyPanelsOffered(framed, null, false)).toBe(true);
    // Chat on its own page, also a narrow one, keeps T3's own layout.
    expect(buddyPanelsOffered(false, null, true)).toBe(true);
  });

  it("reads the right panel over the whole window as maximized, the same object for the same state", () => {
    const stored: { isOpen: boolean; surfaces: string[]; maximized?: true } = {
      isOpen: true,
      surfaces: [],
    };
    const whole = buddyPanelOverWholeWindow(stored);
    expect(whole).toEqual({ isOpen: true, surfaces: [], maximized: true });
    expect(buddyPanelOverWholeWindow(stored)).toBe(whole);
    expect(stored).toEqual({ isOpen: true, surfaces: [] });
    const maximized = { isOpen: true, maximized: true as const };
    expect(buddyPanelOverWholeWindow(maximized)).toBe(maximized);
    // A page an agent reveals never opens the panel by itself in Buddy's window.
    expect(buddyPanelOpensItself(true, false)).toBe(true);
    expect(buddyPanelOpensItself(true, true)).toBe(false);
    expect(buddyPanelOpensItself(false, false)).toBe(false);
  });

  it("talks to nobody outside a host's frame", () => {
    const { win, posted, key } = frameWindow({ host: "https://example.com" });
    const frame = startBuddyFrame(win);
    expect(frame.hostOrigin).toBeNull();
    frame.requestLayout("fullscreen");
    key();
    expect(posted).toEqual([]);
  });
});
