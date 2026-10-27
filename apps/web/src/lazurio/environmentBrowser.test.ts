import { describe, expect, it } from "vite-plus/test";

import {
  environmentBrowserLink,
  environmentBrowserTab,
  foreignEnvironmentBrowserTab,
  isPlainPrimaryClick,
  readEnvironmentBrowserMessage,
  viewEnvironmentId,
} from "./environmentBrowser";

const origin = "https://t3code.vm-01.example.lazurio.io";
const viewOrigin = "https://browser.vm-01.example.lazurio.io";
// A remote tab of this Environment (a DevTools target id: 32 hex digits).
const view = `${viewOrigin}/t/8A3F0C2D4E5B6A7980C1D2E3F4A5B6C7`;
// Another remote tab, one a page opened.
const targetId = "0123456789abcdef".repeat(2);
const tabView = `${viewOrigin}/t/${targetId}`;

describe("a tab of the panel", () => {
  it("is the view of exactly one remote tab, named by its target id", () => {
    expect(environmentBrowserTab(tabView)).toEqual({
      id: `environment-browser:${targetId}`,
      view: tabView,
    });
    expect(environmentBrowserTab(view, origin)).toEqual({
      id: "environment-browser:8A3F0C2D4E5B6A7980C1D2E3F4A5B6C7",
      view,
    });
  });

  it("is no tab at any other address", () => {
    for (const address of [
      tabView.replace("https:", "http:"),
      `${viewOrigin}/`,
      `${viewOrigin}/t/`,
      `${tabView}/`,
      `${tabView}/live`,
      `${viewOrigin}/t/${targetId.slice(1)}`,
      `${tabView}0`,
      `${viewOrigin}/t/${"g".repeat(32)}`,
      `${viewOrigin}/x/${targetId}`,
      `${tabView}?session=t3-other`,
      `${tabView}?`,
      `${tabView}#token`,
      `${tabView}#`,
      tabView.replace("https://", "https://person@"),
      tabView.replace("https://", "https://person:secret@"),
      `/t/${targetId}`,
      `javascript:alert(1)//t/${targetId}`,
      "not an address",
    ]) {
      expect([address, environmentBrowserTab(address)]).toEqual([address, null]);
    }
    for (const value of [42, null, undefined, { view: tabView }]) {
      expect(environmentBrowserTab(value)).toBeNull();
    }
    // Framed with allow-same-origin on this page's own origin, the view would not be confined.
    expect(environmentBrowserTab(`${origin}/t/${targetId}`, origin)).toBeNull();
  });
});

describe("a link in the chat", () => {
  it("opens in the panel when it is one remote tab of the view the Environment named", () => {
    expect(environmentBrowserLink(tabView, origin, viewOrigin)).toEqual({
      id: `environment-browser:${targetId}`,
      view: tabView,
    });
  });

  it("is left to the browser at any other address, and before the Environment named its view", () => {
    for (const href of [
      `${tabView}?q=1`,
      `${tabView}#top`,
      tabView.replace("https:", "http:"),
      tabView.replace("https://", "https://person@"),
      `${viewOrigin}/`,
      `${tabView}/live`,
      `https://elsewhere.example.test/t/${targetId}`,
      `${origin}/t/${targetId}`,
      "not an address",
    ]) {
      expect([href, environmentBrowserLink(href, origin, viewOrigin)]).toEqual([href, null]);
    }
    expect(environmentBrowserLink(tabView, origin, null)).toBeNull();
  });

  it("opens there on a plain primary click only, never on a new-tab gesture", () => {
    const click = {
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
    };
    expect(isPlainPrimaryClick(click)).toBe(true);
    for (const gesture of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
      { button: 2 },
      { defaultPrevented: true },
    ]) {
      expect([gesture, isPlainPrimaryClick({ ...click, ...gesture })]).toEqual([gesture, false]);
    }
  });
});

describe("another Lazurio Environment's tab", () => {
  // This page is the T3 of `vm-01.example.lazurio.io`; its own view is `browser.` beside it.
  const foreignId = "fedcba9876543210".repeat(2);
  const organization = `https://browser.vm-02.acme.lazurio.io/t/${foreignId}`;
  const personal = `https://browser.jana.lazurio.io/t/${foreignId}`;
  const tabOf = (address: string, named: string | null = viewOrigin) =>
    foreignEnvironmentBrowserTab(address, origin, named);

  it("is the view of one remote tab of another Organization's or person's Environment", () => {
    expect(tabOf(organization)).toEqual({
      id: `environment-browser:${foreignId}`,
      view: organization,
      environment: {
        view: organization,
        origin: "https://browser.vm-02.acme.lazurio.io",
        targetId: foreignId,
        owner: "acme",
        environment: "vm-02",
        personal: false,
      },
    });
    expect(tabOf(personal)?.environment).toMatchObject({
      owner: "jana",
      environment: "jana",
      personal: true,
    });
    // Another Machine of the same Organization is another Environment as well.
    expect(tabOf(`https://browser.vm-03.example.lazurio.io/t/${foreignId}`)).not.toBeNull();
    // Upper-case hosts are the same hosts.
    expect(tabOf(organization.replace("browser.vm-02.acme", "BROWSER.VM-02.Acme"))?.view).toBe(
      organization,
    );
  });

  it("is never this Environment's own view, named or not", () => {
    expect(tabOf(tabView)).toBeNull();
    // Before the Environment named its view: the view beside this page is its own.
    expect(tabOf(tabView, null)).toBeNull();
    // A page off Lazurio (a local server) has no view beside it, only the one it was told of.
    expect(foreignEnvironmentBrowserTab(tabView, "http://localhost:5733", viewOrigin)).toBeNull();
    expect(foreignEnvironmentBrowserTab(tabView, "http://localhost:5733", null)).not.toBeNull();
  });

  it("is nothing at any other address", () => {
    for (const address of [
      `https://browser.example.com/t/${foreignId}`,
      `https://browser.lazurio.io/t/${foreignId}`,
      `https://t3code.vm-02.acme.lazurio.io/t/${foreignId}`,
      `https://browser.vm-02.acme.lazurio.io.example.com/t/${foreignId}`,
      organization.replace("https:", "http:"),
      organization.replace(".io/", ".io:8443/"),
      `${organization}?session=t3-other`,
      `${organization}?`,
      `${organization}#x`,
      organization.replace("https://", "https://person:secret@"),
      `${organization}/`,
      organization.replace(foreignId, foreignId.slice(1)),
      "https://browser.vm-02.acme.lazurio.io/",
      "not an address",
    ]) {
      expect([address, tabOf(address)]).toEqual([address, null]);
    }
    for (const value of [42, null, undefined, { view: organization }]) {
      expect(foreignEnvironmentBrowserTab(value, origin, viewOrigin)).toBeNull();
    }
  });

  it("hands the shell the id of its Environment, the view's host between browser. and lazurio.io", () => {
    const idOf = (address: string) => {
      const tab = tabOf(address);
      if (tab === null) throw new Error(`${address} is no other Environment's tab`);
      return viewEnvironmentId(tab.environment);
    };
    expect(idOf(organization)).toBe("vm-02.acme");
    expect(idOf(personal)).toBe("jana");
    // The shell decides what an id names; the fork reads no Organization or Machine out of it.
    expect(idOf(`https://browser.a.b.c.lazurio.io/t/${foreignId}`)).toBe("a.b.c");
  });
});

describe("a message of the framed view", () => {
  const frame = {};
  const newTab = { type: "lazurio-browser:new-tab", view: tabView, url: "https://example.com/" };
  const info = {
    type: "lazurio-browser:info",
    url: "https://example.com/docs",
    title: "Docs",
    view,
  };
  const message = (data: unknown, from: { source?: unknown; origin?: string } = {}) => ({
    data,
    source: frame,
    origin: viewOrigin,
    ...from,
  });

  it("tells its tab's title, or else the page's host", () => {
    expect(readEnvironmentBrowserMessage(message(info), frame, view)).toEqual({
      type: "info",
      title: "Docs",
    });
    expect(readEnvironmentBrowserMessage(message({ ...info, title: " " }), frame, view)).toEqual({
      type: "info",
      title: "example.com",
    });
    expect(
      readEnvironmentBrowserMessage(
        message({ ...info, url: "about:blank", title: "" }),
        frame,
        view,
      ),
    ).toEqual({ type: "info", title: null });
  });

  it("opens a page's new tab on the view's own origin", () => {
    expect(readEnvironmentBrowserMessage(message(newTab), frame, view)).toEqual({
      type: "new-tab",
      tab: { id: `environment-browser:${targetId}`, view: tabView },
    });
    // A tab that a page opened tells of its own new tabs as well.
    expect(readEnvironmentBrowserMessage(message(newTab), frame, tabView)).toMatchObject({
      type: "new-tab",
    });
  });

  it("says that its tab ended, only from its own frame and the view's origin", () => {
    const closed = { type: "lazurio-browser:closed", view };
    expect(readEnvironmentBrowserMessage(message(closed), frame, view)).toEqual({ type: "closed" });
    // The view it names is only a hint: the frame that says it ended is the tab.
    expect(
      readEnvironmentBrowserMessage(message({ ...closed, view: "about:blank" }), frame, view),
    ).toEqual({ type: "closed" });
    expect(readEnvironmentBrowserMessage(message(closed, { source: {} }), frame, view)).toBeNull();
    expect(
      readEnvironmentBrowserMessage(
        message(closed, { origin: "https://evil.example" }),
        frame,
        view,
      ),
    ).toBeNull();
  });

  it("is ignored from another window or origin, of another type, or malformed", () => {
    const cases: Array<[string, ReturnType<typeof message>, object | null]> = [
      ["another window", message(newTab, { source: {} }), frame],
      ["no window", message(newTab, { source: null }), frame],
      ["no frame yet", message(newTab, { source: null }), null],
      ["another origin", message(newTab, { origin: "https://evil.example" }), frame],
      ["this page's origin", message(newTab, { origin }), frame],
      [
        "another Environment",
        message(newTab, { origin: viewOrigin.replace("vm-01", "vm-02") }),
        frame,
      ],
      ["another type", message({ ...newTab, type: "lazurio-browser:close" }), frame],
      ["no type", message({ view: tabView }), frame],
      ["text", message(JSON.stringify(newTab)), frame],
      ["nothing", message(null), frame],
      ["view type", message({ ...newTab, view: 42 }), frame],
      ["http view", message({ ...newTab, view: tabView.replace("https:", "http:") }), frame],
      ["view with a query", message({ ...newTab, view: `${tabView}?token=x` }), frame],
      ["view with a fragment", message({ ...newTab, view: `${tabView}#x` }), frame],
      [
        "view with credentials",
        message({ ...newTab, view: tabView.replace("https://", "https://a:b@") }),
        frame,
      ],
      ["view of a new tab", message({ ...newTab, view: `${viewOrigin}/` }), frame],
      [
        "view on another origin",
        message({ ...newTab, view: tabView.replace("vm-01", "vm-02") }),
        frame,
      ],
      [
        "info without a title",
        message({ type: "lazurio-browser:info", url: "https://a.example/" }),
        frame,
      ],
      ["info without an address", message({ ...info, url: null }), frame],
    ];
    for (const [name, event, window] of cases) {
      expect([name, readEnvironmentBrowserMessage(event, window, view)]).toEqual([name, null]);
    }
    expect(readEnvironmentBrowserMessage(message(newTab), frame, "not an address")).toBeNull();
  });
});
