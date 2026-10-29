// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off - Owns Playwright resources outside the Effect runtime.

/**
 * Lazurio overlay (root decision 0191): one Playwright CDP connection to the Environment's shared
 * Chromium. Sites must keep seeing the Environment's own browser, so it attaches with `noDefaults`
 * and adds no script, binding or context; dialogs stay open for the person, and letting go only ends
 * the connection. Attaching does enable CDP domains in every page until the server stops.
 */

import type {
  PreviewAutomationClickInput,
  PreviewAutomationDragInput,
  PreviewAutomationEvaluateInput,
  PreviewAutomationHoverInput,
  PreviewAutomationPressInput,
  PreviewAutomationScrollInput,
  PreviewAutomationSelectInput,
  PreviewAutomationTypeInput,
  PreviewAutomationUploadInput,
  PreviewAutomationWaitForInput,
} from "@t3tools/contracts";
import { constVoid } from "effect/Function";
import * as NodeModule from "node:module";
import type { CDPSession, Page } from "playwright-core";

import * as ServerBrowserPage from "../preview/ServerBrowserPage.ts";
import * as EnvironmentBrowserPage from "./environmentBrowserPage.ts";

// Playwright needs its files on disk. createRequire also resolves it from a Node SEA executable.
const requirePlaywright = NodeModule.createRequire(import.meta.url);
const loadPlaywright = () =>
  requirePlaywright("playwright-core") as typeof import("playwright-core");

/** The Environment browser's DevTools, on loopback only (the Platform's `browserCdpPort`). */
const ENVIRONMENT_BROWSER_ENDPOINT = "http://127.0.0.1:9222";

/** A new window as the Platform opens a thread's: 1280×800 of page in its window frame. */
const WINDOW_SIZE = { width: 1280, height: 900 } as const;

/** How long a new target may take to become a page Playwright drives. */
const PAGE_ATTACH_TIMEOUT_MS = 10_000;
const PAGE_ATTACH_POLL_MS = 50;

/** The operations a tab runs as they are; status, open and navigate are the host's. */
export type TabOperation =
  | "snapshot"
  | "click"
  | "type"
  | "hover"
  | "select"
  | "drag"
  | "upload"
  | "press"
  | "scroll"
  | "evaluate"
  | "waitFor";

export interface TabState {
  readonly url: string | null;
  readonly title: string | null;
  readonly loading: boolean;
}

/** One page target of the Environment browser. */
export interface EnvironmentBrowserTab {
  readonly state: () => Promise<TabState>;
  readonly navigate: (
    url: string,
    readiness: "load" | "domContentLoaded" | "none",
    timeoutMs: number,
  ) => Promise<void>;
  /** Waits for a window opened at a URL to load; one that never loads is left as it is. */
  readonly settle: (timeoutMs: number) => Promise<void>;
  readonly act: (operation: TabOperation, input: unknown, timeoutMs: number) => Promise<unknown>;
}

export interface EnvironmentBrowserConnection {
  /** The page target with this target id, or undefined when the browser has no such page. */
  readonly tab: (targetId: string) => Promise<EnvironmentBrowserTab | undefined>;
  /** Opens a window in the default context and returns its target id. */
  readonly openWindow: (url: string | undefined) => Promise<string>;
  /** Closes the window with this target id. */
  readonly closeWindow: (targetId: string) => Promise<void>;
  /** Settles when the connection ends, for example when the Environment browser restarts. */
  readonly closed: Promise<void>;
  /** Ends this connection. The browser and its windows stay. */
  readonly disconnect: () => Promise<void>;
}

export const connectEnvironmentBrowser = async (
  endpoint = ENVIRONMENT_BROWSER_ENDPOINT,
): Promise<EnvironmentBrowserConnection> => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.connectOverCDP(endpoint, { noDefaults: true, timeout: 15_000 });
  const closed = new Promise<void>((resolve) => browser.once("disconnected", () => resolve()));
  // On a browser reached over CDP, close() only ends the connection.
  const disconnect = () => browser.close().catch(constVoid);
  const context = browser.contexts()[0];
  if (context === undefined) {
    await disconnect();
    throw new Error("The Environment browser has no default context.");
  }
  // Playwright dismisses every dialog no one listens to, in every page it is attached to, so the
  // person's own confirm() would answer itself. Listening leaves each dialog to the page's people.
  context.on("dialog", constVoid);
  const browserSession = await browser.newBrowserCDPSession();

  const targetIds = new WeakMap<Page, Promise<string | undefined>>();
  const targetIdOf = (page: Page) => {
    let targetId = targetIds.get(page);
    if (targetId === undefined) {
      targetId = context
        .newCDPSession(page)
        .then(async (session) => {
          try {
            return (await session.send("Target.getTargetInfo")).targetInfo.targetId;
          } finally {
            await session.detach().catch(constVoid);
          }
        })
        .catch(() => undefined);
      targetIds.set(page, targetId);
    }
    return targetId;
  };

  /** A target that is no page (a worker, a frame) or no target at all is no tab. */
  const findPage = async (targetId: string) => {
    const info = await browserSession
      .send("Target.getTargetInfo", { targetId })
      .catch(() => undefined);
    if (info?.targetInfo.type !== "page") return undefined;
    // A target the browser just opened becomes a page once Playwright has attached to it.
    const deadline = Date.now() + PAGE_ATTACH_TIMEOUT_MS;
    for (;;) {
      for (const page of context.pages()) {
        if ((await targetIdOf(page)) === targetId) return page;
      }
      if (Date.now() >= deadline) return undefined;
      await new Promise((resolve) => setTimeout(resolve, PAGE_ATTACH_POLL_MS));
    }
  };

  const sessions = new WeakMap<Page, Promise<CDPSession>>();
  const sessionOf = (page: Page) => {
    let session = sessions.get(page);
    if (session === undefined) {
      session = context.newCDPSession(page);
      sessions.set(page, session);
      void session.catch(() => sessions.delete(page));
    }
    return session;
  };

  const tabOf = (page: Page): EnvironmentBrowserTab => {
    const diagnostics = EnvironmentBrowserPage.diagnosticsOf(page);
    const recorded = <A>(action: string, run: () => Promise<A>) =>
      EnvironmentBrowserPage.recordAction(diagnostics, action, run);
    return {
      state: async () => {
        const url = page.url();
        const document = (await page
          .evaluate(`({ title: document.title, loading: document.readyState !== "complete" })`)
          .catch(() => null)) as { readonly title: string; readonly loading: boolean } | null;
        return {
          url: url === "about:blank" ? null : url,
          title: document?.title || null,
          // A page between documents has none to ask.
          loading: document?.loading ?? true,
        };
      },
      navigate: (url, readiness, timeoutMs) =>
        recorded("navigate", () =>
          EnvironmentBrowserPage.navigate(page, url, readiness, timeoutMs),
        ),
      settle: (timeoutMs) => page.waitForLoadState("load", { timeout: timeoutMs }).catch(constVoid),
      act: async (operation, input, timeoutMs) => {
        switch (operation) {
          case "snapshot":
            return ServerBrowserPage.snapshot({
              page,
              cdp: await sessionOf(page),
              // A page reached over CDP has no Playwright viewport: the engine measures the window
              // a person's view sized, as upstream does for its desktop-drawn tabs.
              renderScale: "display",
              ...diagnostics,
            });
          case "click":
            await recorded("click", () =>
              ServerBrowserPage.click(page, {
                ...(input as PreviewAutomationClickInput),
                timeoutMs,
              }),
            );
            return undefined;
          case "type":
            return recorded("type", () =>
              ServerBrowserPage.type(page, {
                ...(input as PreviewAutomationTypeInput),
                timeoutMs,
              }),
            );
          case "hover":
            return recorded("hover", () =>
              ServerBrowserPage.hover(page, {
                ...(input as PreviewAutomationHoverInput),
                timeoutMs,
              }),
            );
          case "select":
            return recorded("select", () =>
              ServerBrowserPage.select(page, {
                ...(input as PreviewAutomationSelectInput),
                timeoutMs,
              }),
            );
          case "drag":
            return recorded("drag", () =>
              ServerBrowserPage.drag(page, {
                ...(input as PreviewAutomationDragInput),
                timeoutMs,
              }),
            );
          case "upload":
            return recorded("upload", async () => {
              // The files are the Environment's, as the browser is. A page's file picker is the
              // person's dialog, so only a named file input gets them.
              const set = await ServerBrowserPage.setInputFiles(page, {
                ...(input as PreviewAutomationUploadInput),
                timeoutMs,
              });
              if (!set) {
                throw new ServerBrowserPage.ServerBrowserOperationError(
                  "PreviewAutomationExecutionError",
                  "The Environment browser leaves a page's file picker to the person. Pass the locator of the page's <input type=file> to set its files.",
                );
              }
              return undefined;
            });
          case "press":
            return recorded("press", () =>
              ServerBrowserPage.press(page, input as PreviewAutomationPressInput),
            );
          case "scroll":
            return recorded("scroll", () =>
              ServerBrowserPage.scroll(page, input as PreviewAutomationScrollInput),
            );
          case "evaluate":
            return ServerBrowserPage.evaluate(
              await sessionOf(page),
              input as PreviewAutomationEvaluateInput,
              timeoutMs,
            );
          case "waitFor":
            return ServerBrowserPage.waitFor(page, {
              ...(input as PreviewAutomationWaitForInput),
              timeoutMs,
            });
        }
      },
    };
  };

  return {
    tab: async (targetId) => {
      const page = await findPage(targetId);
      return page === undefined ? undefined : tabOf(page);
    },
    openWindow: async (url) =>
      (
        await browserSession.send("Target.createTarget", {
          url: url ?? "about:blank",
          newWindow: true,
          ...WINDOW_SIZE,
        })
      ).targetId,
    closeWindow: async (targetId) => {
      await browserSession.send("Target.closeTarget", { targetId });
    },
    closed,
    disconnect,
  };
};
