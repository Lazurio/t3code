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
