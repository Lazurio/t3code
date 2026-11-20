import { describe, expect, it } from "vite-plus/test";

import { buddyWindowInView, startBuddyFrame } from "./buddySurfaceFrame";

const HOST = "https://launchpad.example-person.lazurio.io";

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

  it("counts its thread as seen until the host says the window is hidden, and again once shown", () => {
    const { win, receive } = frameWindow();
    const frame = startBuddyFrame(win);
    const inView = () => buddyWindowInView(frame.hostOrigin !== null, frame.shown());
    // An older Lazurio never says: the frame behaves as before.
    expect(frame.shown()).toBeNull();
    expect(inView()).toBe(true);
    // The person closes the window; an answer that comes now stays unseen.
    receive({ type: "lazurio.buddy.shown", v: 1, shown: false });
    expect(inView()).toBe(false);
    // Only the parent on the host's origin says so.
    receive({ type: "lazurio.buddy.shown", v: 1, shown: true }, "https://example.com");
    receive({ type: "lazurio.buddy.shown", v: 1, shown: true }, HOST, {});
    expect(inView()).toBe(false);
    receive({ type: "lazurio.buddy.shown", v: 1, shown: true });
    expect(inView()).toBe(true);
    expect(buddyWindowInView(false, false)).toBe(true);
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
