import { describe, expect, it } from "vite-plus/test";

import {
  buddyHostOfWindow,
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
function frameWindow(options: { readonly host?: string; readonly openMenu?: boolean } = {}) {
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
      querySelector: () => (options.openMenu === true ? {} : null),
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

  it("leaves Escape to an open menu, a modifier or an input method", () => {
    const menu = frameWindow({ openMenu: true });
    startBuddyFrame(menu.win);
    menu.key();
    expect(layouts(menu.posted)).toEqual([]);

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

  it("offers the right panel and the terminal in the full window and in neither in the small one", () => {
    const { win } = frameWindow();
    const framed = buddyHostOfWindow(win) !== null;
    // The small window the person moves about: too narrow, so neither panel.
    expect(buddyPanelsOffered(framed, true)).toBe(false);
    // Full screen on a computer: both.
    expect(buddyPanelsOffered(framed, false)).toBe(true);
    // Chat on its own page, also a narrow one, keeps T3's own layout.
    expect(buddyPanelsOffered(false, true)).toBe(true);
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
