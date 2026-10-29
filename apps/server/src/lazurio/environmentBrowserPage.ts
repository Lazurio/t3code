// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Playwright callbacks run outside the Effect runtime.

/**
 * Lazurio overlay (root decision 0191): `navigate`, `resolveNavigationUrl` and the page diagnostics
 * are private closures of upstream's ServerBrowser.ts, copied here keyed by the page, with the
 * engine's redaction of `data:` payloads. A person may work in the page: add nothing to it.
 */

import type {
  PreviewAutomationActionEvent,
  PreviewAutomationConsoleEntry,
  PreviewAutomationNavigateInput,
  PreviewAutomationNetworkEntry,
} from "@t3tools/contracts";
import { normalizePreviewUrl } from "@t3tools/shared/preview";
import { constVoid } from "effect/Function";
import type { Page } from "playwright-core";
import * as NodeCrypto from "node:crypto";

import {
  consoleText,
  DIAGNOSTIC_BUFFER_LIMIT,
  parseNetError,
  ServerBrowserOperationError,
  withoutDataPayload,
} from "../preview/ServerBrowserPage.ts";

const ACTION_TIMELINE_LIMIT = 50;

/** The URL a navigate input names. The browser runs inside the environment, so its ports are loopback. */
export const resolveNavigationUrl = (input: PreviewAutomationNavigateInput) => {
  if (input.url !== undefined) return normalizePreviewUrl(input.url);
  const target = input.target!;
  if (target.kind === "url") return normalizePreviewUrl(target.url);
  const path = target.path ?? "";
  return `${target.protocol ?? "http"}://localhost:${target.port}${path.startsWith("/") || path === "" ? path : `/${path}`}`;
};

/** `readiness` "none" returns once the navigation starts; its failure is the page's to show. */
export const navigate = async (
  page: Page,
  url: string,
  readiness: "load" | "domContentLoaded" | "none",
  timeout: number,
) => {
  const navigation = page.goto(url, {
    timeout,
    waitUntil:
      readiness === "domContentLoaded"
        ? "domcontentloaded"
        : readiness === "none"
          ? "commit"
          : "load",
  });
  if (readiness === "none") {
    void navigation.catch(constVoid);
    return;
  }
  await navigation.catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message.includes("Download is starting")) {
      throw new ServerBrowserOperationError(
        "PreviewAutomationExecutionError",
        `${url} is a file the browser cannot show, so the Environment browser downloaded it instead.`,
      );
    }
    if (/ERR_[A-Z_]+/.test(message)) {
      throw new ServerBrowserOperationError(
        "PreviewAutomationExecutionError",
        `Navigation to ${url} failed: ${parseNetError(message).description}`,
      );
    }
    throw cause;
  });
};

/** What a page logged, loaded and was asked to do since T3 first worked in it. */
export interface PageDiagnostics {
  readonly consoleEntries: Array<PreviewAutomationConsoleEntry>;
  readonly networkEntries: Array<PreviewAutomationNetworkEntry>;
  readonly actionTimeline: Array<PreviewAutomationActionEvent>;
}

const pushBounded = <A>(buffer: Array<A>, entry: A, limit = DIAGNOSTIC_BUFFER_LIMIT) => {
  buffer.push(entry);
  if (buffer.length > limit) buffer.splice(0, buffer.length - limit);
};

const pageDiagnostics = new WeakMap<Page, PageDiagnostics>();

/** The page's diagnostics, collected from the first time T3 works in the page. */
export const diagnosticsOf = (page: Page): PageDiagnostics => {
  const existing = pageDiagnostics.get(page);
  if (existing) return existing;
  const diagnostics: PageDiagnostics = {
    consoleEntries: [],
    networkEntries: [],
    actionTimeline: [],
  };
  pageDiagnostics.set(page, diagnostics);
  page.on("requestfailed", (request) => {
    pushBounded(diagnostics.networkEntries, {
      url: withoutDataPayload(request.url()),
      method: request.method(),
      status: null,
      failed: true,
      errorText: request.failure()?.errorText ?? "",
      timestamp: new Date().toISOString(),
    });
  });
  page.on("response", (response) => {
    pushBounded(diagnostics.networkEntries, {
      url: withoutDataPayload(response.url()),
      method: response.request().method(),
      status: response.status(),
      failed: false,
      timestamp: new Date().toISOString(),
    });
  });
  page.on("console", (message) => {
    pushBounded(diagnostics.consoleEntries, {
      level: message.type(),
      text: consoleText(message).slice(0, 2_000),
      timestamp: new Date().toISOString(),
    });
  });
  return diagnostics;
};

export const recordAction = <A>(
  diagnostics: PageDiagnostics,
  action: string,
  run: () => Promise<A>,
): Promise<A> => {
  const event: {
    -readonly [K in keyof PreviewAutomationActionEvent]: PreviewAutomationActionEvent[K];
  } = {
    id: NodeCrypto.randomUUID(),
    action,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  pushBounded(diagnostics.actionTimeline, event, ACTION_TIMELINE_LIMIT);
  return run().then(
    (result) => {
      event.status = "succeeded";
      event.completedAt = new Date().toISOString();
      return result;
    },
    (cause: unknown) => {
      event.status = "failed";
      event.completedAt = new Date().toISOString();
      event.error = cause instanceof Error ? cause.message.split("\n")[0] : String(cause);
      throw cause;
    },
  );
};
