// @effect-diagnostics globalFetch:off - the browser's own DevTools listing is what these tests check against.
import type { PreviewAutomationSnapshot } from "@t3tools/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import {
  connectEnvironmentBrowser,
  type EnvironmentBrowserConnection,
} from "./environmentBrowserConnection.ts";

// Real-browser tests run only when this names a DevTools endpoint, for example a disposable
// headless Chrome started with --remote-debugging-port=9333 and a profile of its own. Never point
// it at a browser someone works in: the tests open windows there and close them afterwards.
const TEST_DEVTOOLS_ENV = "LAZURIO_TEST_DEVTOOLS_ENDPOINT";
const endpoint = process.env[TEST_DEVTOOLS_ENV];

const htmlPage = (html: string) => `data:text/html,${encodeURIComponent(html)}`;

/**
 * One CDP command on its own WebSocket, as an observer outside Playwright. It enables no domain,
 * so it changes nothing it observes.
 */
const rawCommand = (url: string, method: string, params: Record<string, unknown> = {}) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("error", () => reject(new Error(`no DevTools socket at ${url}`)));
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.addEventListener("message", (message) => {
      const response = JSON.parse(String(message.data)) as {
        readonly id?: number;
        readonly result?: Record<string, unknown>;
      };
      if (response.id !== 1) return;
      socket.close();
      resolve(response.result ?? {});
    });
  });
const devtoolsSocket = (path: string) => `${endpoint!.replace(/^http/, "ws")}${path}`;
const browserSocket = async () =>
  ((await (await fetch(`${endpoint}/json/version`)).json()) as { webSocketDebuggerUrl: string })
    .webSocketDebuggerUrl;
/** What a page's own scripts can see of automation: its user agent, the webdriver flag, its globals. */
const automationFingerprint = async (targetId: string) =>
  (
    (await rawCommand(devtoolsSocket(`/devtools/page/${targetId}`), "Runtime.evaluate", {
      expression:
        "({ userAgent: navigator.userAgent, webdriver: navigator.webdriver, globals: Object.getOwnPropertyNames(window).sort() })",
      returnByValue: true,
    })) as { readonly result: { readonly value: unknown } }
  ).result.value;
const browserContextOf = async (targetId: string) =>
  (
    (await rawCommand(await browserSocket(), "Target.getTargetInfo", { targetId })) as {
      readonly targetInfo: { readonly browserContextId: string };
    }
  ).targetInfo.browserContextId;

describe.skipIf(endpoint === undefined)("the Environment browser over CDP", () => {
  let connection: EnvironmentBrowserConnection;
  const opened: Array<string> = [];

  /** The page targets the browser has, from its own DevTools listing. */
  const pageTargets = async () => {
    const targets = (await (await fetch(`${endpoint}/json/list`)).json()) as ReadonlyArray<{
      readonly id: string;
      readonly type: string;
    }>;
    return targets.filter((target) => target.type === "page").map((target) => target.id);
  };
  const openWindow = async (url?: string) => {
    const targetId = await connection.openWindow(url);
    opened.push(targetId);
    return targetId;
  };

  beforeAll(async () => {
    connection = await connectEnvironmentBrowser(endpoint);
  });
  afterAll(async () => {
    await connection?.disconnect();
    for (const targetId of opened) {
      await fetch(`${endpoint}/json/close/${targetId}`).catch(() => undefined);
    }
  });

  it("opens a window in the default context and finds its tab by the target id", async () => {
    const targetId = await openWindow();

    expect(targetId).toMatch(/^[0-9A-F]{32}$/);
    expect(await pageTargets()).toContain(targetId);
    // The default context holds the Environment's sign-ins; the host never makes another.
    const [first] = await pageTargets();
    expect(await browserContextOf(targetId)).toBe(await browserContextOf(first!));
    const tab = await connection.tab(targetId);
    expect(tab).toBeDefined();
    expect(await tab!.state()).toEqual({ url: null, title: null, loading: false });
  });

  it("has no tab for an id that names no page", async () => {
    expect(await connection.tab("0123456789ABCDEF0123456789ABCDEF")).toBeUndefined();
    expect(await connection.tab("not a target")).toBeUndefined();
  });

  it("drives a window: snapshot with refs and a screenshot, click by ref, and its diagnostics", async () => {
    const targetId = await openWindow(
      htmlPage(
        `<title>Fixture</title><button onclick="document.body.dataset.clicked = 'yes'; console.log('clicked')">Go</button>`,
      ),
    );
    const tab = (await connection.tab(targetId))!;
    await tab.settle(5_000);

    const first = (await tab.act("snapshot", {}, 5_000)) as PreviewAutomationSnapshot;
    const ref = /button "Go" \[ref=([^\]]+)\]/.exec(String(first.accessibilityTree))?.[1];
    expect(ref).toMatch(/^t3-/);
    expect(first.screenshot.width).toBeGreaterThan(0);
    await tab.act("click", { locator: `aria-ref=${ref}` }, 5_000);

    expect(await tab.act("evaluate", { expression: "document.body.dataset.clicked" }, 5_000)).toBe(
      "yes",
    );
    expect(await tab.state()).toMatchObject({ title: "Fixture", loading: false });
    const second = (await tab.act("snapshot", {}, 5_000)) as PreviewAutomationSnapshot;
    expect(second.actionTimeline).toMatchObject([{ action: "click", status: "succeeded" }]);
    expect(second.consoleEntries).toMatchObject([{ level: "log", text: "clicked" }]);
  });

  it("navigates a window and reports where it went", async () => {
    const tab = (await connection.tab(await openWindow()))!;

    await tab.navigate(htmlPage("<title>Second</title><p>second page</p>"), "load", 5_000);

    expect(await tab.state()).toMatchObject({ title: "Second", loading: false });
    expect((await tab.state()).url).toMatch(/^data:text\/html,/);
  });

  it("lets go of the browser without closing it or its windows", async () => {
    const targetId = await openWindow();

    await connection.disconnect();
    await connection.closed;

    expect(await pageTargets()).toContain(targetId);
    // A new connection, as after the Environment browser's restart, finds the same window.
    connection = await connectEnvironmentBrowser(endpoint);
    expect(await connection.tab(targetId)).toBeDefined();
  });
});

describe.skipIf(endpoint === undefined)("the Environment browser host's footprint", () => {
  it("leaves no user agent, webdriver flag or script of its own in pages", async () => {
    const page = htmlPage(
      "<label>Name <input></label><button onclick=\"this.textContent = 'done'\">Go</button>",
    );
    const created = (await (
      await fetch(`${endpoint}/json/new?${page}`, { method: "PUT" })
    ).json()) as {
      readonly id: string;
    };
    const opened = [created.id];
    try {
      await expect
        .poll(async () => (await automationFingerprint(created.id)) !== undefined)
        .toBe(true);
      const before = await automationFingerprint(created.id);

      const connection = await connectEnvironmentBrowser(endpoint);
      try {
        const tab = (await connection.tab(created.id))!;
        const tree = String(
          ((await tab.act("snapshot", {}, 5_000)) as PreviewAutomationSnapshot).accessibilityTree,
        );
        const ref = (role: string) =>
          `aria-ref=${new RegExp(`${role} \\[ref=([^\\]]+)\\]`).exec(tree)?.[1]}`;
        await tab.act("type", { locator: ref('textbox "Name"'), text: "Ada" }, 5_000);
        await tab.act("click", { locator: ref('button "Go"') }, 5_000);
        await tab.act("evaluate", { expression: "document.title" }, 5_000);
        expect(await automationFingerprint(created.id)).toEqual(before);

        // A window the host opens gets nothing injected either.
        const fresh = await connection.openWindow(page);
        opened.push(fresh);
        await (await connection.tab(fresh))!.settle(5_000);
        expect(await automationFingerprint(fresh)).toEqual(before);
      } finally {
        await connection.disconnect();
      }
    } finally {
      for (const targetId of opened) {
        await fetch(`${endpoint}/json/close/${targetId}`).catch(() => undefined);
      }
    }
  });
});
