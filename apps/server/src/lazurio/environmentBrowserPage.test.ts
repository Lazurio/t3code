// @effect-diagnostics nodeBuiltinImport:off - a plain loopback server stands in for a stopped dev server.
import * as NodeNet from "node:net";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import * as EnvironmentBrowserPage from "./environmentBrowserPage.ts";

// Real-browser tests run only when this names a DevTools endpoint, for example a disposable
// headless Chrome started with --remote-debugging-port=9333 and a profile of its own. Never point
// it at a browser someone works in: the tests open and close windows there.
const TEST_DEVTOOLS_ENV = "LAZURIO_TEST_DEVTOOLS_ENDPOINT";
const endpoint = process.env[TEST_DEVTOOLS_ENV];

const htmlPage = (html: string) => `data:text/html,${encodeURIComponent(html)}`;

describe.skipIf(endpoint === undefined)("the Environment browser page engine", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let cdp: CDPSession;

  beforeAll(async () => {
    // As the host reaches the Environment browser: over CDP, its default context untouched.
    browser = await chromium.connectOverCDP(endpoint!, { noDefaults: true });
    context = browser.contexts()[0]!;
  });
  afterAll(async () => {
    // A browser reached over CDP stays open; this only ends the connection.
    await browser?.close();
  });
  beforeEach(async () => {
    const session = await browser.newBrowserCDPSession();
    const [opened] = await Promise.all([
      context.waitForEvent("page"),
      session.send("Target.createTarget", { url: "about:blank", newWindow: true }),
    ]);
    await session.detach();
    page = opened;
    cdp = await context.newCDPSession(page);
  });
  afterEach(async () => {
    await page.close();
  });

  const takeSnapshot = () =>
    EnvironmentBrowserPage.snapshot({
      page,
      cdp,
      consoleEntries: [],
      networkEntries: [],
      actionTimeline: [],
    });
  /** The `aria-ref` locator of the first element in `tree` whose line has `text`. */
  const refLocator = (tree: unknown, text: string) => {
    expect(typeof tree).toBe("string");
    const line = String(tree)
      .split("\n")
      .find((candidate) => candidate.includes(text));
    const ref = /\[ref=([^\]]+)\]/.exec(line ?? "")?.[1];
    expect(ref, `no ref for ${text}`).toBeDefined();
    return `aria-ref=${ref}`;
  };

  it("snapshots a page reached over CDP: refs in the t3 namespace, its text and a PNG", async () => {
    await EnvironmentBrowserPage.navigate(
      page,
      htmlPage("<title>Fixture</title><h1>Hello</h1><button>Send</button>"),
      "load",
      5_000,
    );
    // The premise of the measured screenshot: Playwright knows no viewport for such a page.
    expect(page.viewportSize()).toBeNull();

    const result = await takeSnapshot();

    expect(result).toMatchObject({ title: "Fixture", loading: false, interactiveElements: [] });
    expect(result.visibleText).toContain("Hello");
    expect(String(result.accessibilityTree)).toMatch(
      /button "Send" \[ref=t3-[0-9a-f]{8}-[0-9a-z]+-e\d+\]/,
    );
    const png = Buffer.from(result.screenshot.data, "base64");
    expect(result.screenshot.mimeType).toBe("image/png");
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
      result.screenshot.width,
      result.screenshot.height,
    ]);
    expect(result.screenshot.width).toBeGreaterThan(0);
    expect(result.screenshot.width).toBeLessThanOrEqual(1280);
  });

  it("types and clicks by ref, presses Enter, and waits for the text that caused", async () => {
    await page.setContent(`
      <form onsubmit="event.preventDefault(); document.getElementById('log').textContent += 'submitted ' + this.name.value + ';'">
        <label>Name <input name="name"></label>
        <button type="button" onclick="document.getElementById('log').textContent += 'clicked;'">Count</button>
      </form>
      <p id="log"></p>`);
    const tree = (await takeSnapshot()).accessibilityTree;

    await EnvironmentBrowserPage.type(page, {
      locator: refLocator(tree, 'textbox "Name"'),
      text: "Ada",
    });
    await EnvironmentBrowserPage.press(page, { key: "Enter" });
    await EnvironmentBrowserPage.click(page, { locator: refLocator(tree, 'button "Count"') });
    await EnvironmentBrowserPage.waitFor(page, { text: "clicked;", timeoutMs: 5_000 });

    expect(await page.textContent("#log")).toBe("submitted Ada;clicked;");
  });

  it("scrolls the page and evaluates expressions in it", async () => {
    await page.setContent('<div style="height: 5000px">tall</div>');

    await EnvironmentBrowserPage.scroll(page, { deltaY: 600 });

    await expect
      .poll(() => EnvironmentBrowserPage.evaluate(cdp, { expression: "scrollY" }))
      .toBe(600);
    expect(
      await EnvironmentBrowserPage.evaluate(cdp, {
        expression: "Promise.resolve({ title: document.title, items: [1, 2] })",
      }),
    ).toEqual({ title: "", items: [1, 2] });
    await expect(
      EnvironmentBrowserPage.evaluate(cdp, { expression: "missingName.property" }),
    ).rejects.toMatchObject({ tag: "PreviewAutomationExecutionError" });
  });

  it("makes refs from before a navigation or an older snapshot stale", async () => {
    await EnvironmentBrowserPage.navigate(
      page,
      htmlPage("<button>continue</button>"),
      "load",
      5_000,
    );
    const beforeNavigation = refLocator((await takeSnapshot()).accessibilityTree, "continue");
    await EnvironmentBrowserPage.navigate(
      page,
      htmlPage("<button>continue</button><p>new document</p>"),
      "load",
      5_000,
    );

    await expect(
      EnvironmentBrowserPage.click(page, { locator: beforeNavigation, timeoutMs: 1_000 }),
    ).rejects.toMatchObject({
      tag: "PreviewAutomationInvalidSelectorError",
      detail: { staleRef: true },
    });

    const older = refLocator((await takeSnapshot()).accessibilityTree, "continue");
    const latest = refLocator((await takeSnapshot()).accessibilityTree, "continue");
    await expect(
      EnvironmentBrowserPage.click(page, { locator: older, timeoutMs: 1_000 }),
    ).rejects.toMatchObject({ detail: { staleRef: true } });
    await EnvironmentBrowserPage.click(page, { locator: latest, timeoutMs: 1_000 });
  });

  it("names the network error of a navigation that fails", async () => {
    // A loopback port that was just free and is closed again: nothing answers there.
    const server = NodeNet.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as NodeNet.AddressInfo;
    await new Promise((resolve) => server.close(resolve));
    const url = `http://127.0.0.1:${port}/`;

    const navigation = EnvironmentBrowserPage.navigate(page, url, "load", 5_000);

    await expect(navigation).rejects.toThrow(`Navigation to ${url} failed: ERR_CONNECTION_REFUSED`);
    await expect(navigation).rejects.toMatchObject({ tag: "PreviewAutomationExecutionError" });
  });

  it("reports a wait that never holds as a timeout", async () => {
    await page.setContent("<p>present</p>");
    await expect(
      EnvironmentBrowserPage.waitFor(page, { text: "absent", timeoutMs: 200 }),
    ).rejects.toMatchObject({ tag: "PreviewAutomationTimeoutError" });
  });
});
