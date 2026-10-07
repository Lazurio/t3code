// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off - Playwright callbacks run outside the Effect runtime.

/**
 * Lazurio overlay (root decision 0191, plan DEV-6646): what T3's browser tools do in one page of
 * the Environment browser. Ported from upstream's apps/server/src/preview/ServerBrowserPage.ts at
 * pingdotgg/t3code 611132c1, with `navigate`, `resolveNavigationUrl` and the page diagnostics from
 * upstream's ServerBrowser.ts there. Upstream drives pages of the server's own headless
 * Chromium; these pages are windows of the Environment browser, reached over CDP, where a person
 * may work in the same tab.
 *
 * Adapted to the 0.0.45 contracts: no hover, select, drag, upload, dialog or recording
 * operations, and no agent pointer for viewers (the people's view shows the page itself). A page
 * reached over CDP reports no viewport, so the screenshot measures the page instead of trusting
 * Playwright's viewport.
 */

import type {
  PreviewAutomationClickInput,
  PreviewAutomationConsoleEntry,
  PreviewAutomationEvaluateInput,
  PreviewAutomationNavigateInput,
  PreviewAutomationNetworkEntry,
  PreviewAutomationPressInput,
  PreviewAutomationScrollInput,
  PreviewAutomationSnapshot,
  PreviewAutomationTypeInput,
  PreviewAutomationWaitForInput,
} from "@t3tools/contracts";
import { normalizePreviewUrl } from "@t3tools/shared/preview";
import { constVoid } from "effect/Function";
import type { CDPSession, Locator, Page } from "playwright-core";
import * as NodeCrypto from "node:crypto";

const MAX_EVALUATION_BYTES = 64_000;
const MAX_VISIBLE_TEXT_LENGTH = 20_000;
const MAX_SCREENSHOT_WIDTH = 1280;
const WAIT_POLL_MS = 100;
export const DIAGNOSTIC_BUFFER_LIMIT = 200;
const ACTION_TIMELINE_LIMIT = 50;

export class ServerBrowserOperationError extends Error {
  readonly tag: string;
  readonly detail: unknown;

  constructor(tag: string, message: string, detail?: unknown) {
    super(message);
    this.tag = tag;
    this.detail = detail;
  }
}

export const toOperationError = (cause: unknown): ServerBrowserOperationError => {
  if (cause instanceof ServerBrowserOperationError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  const firstLine = message.split("\n")[0] ?? message;
  if (cause instanceof Error && cause.name === "TimeoutError") {
    return new ServerBrowserOperationError("PreviewAutomationTimeoutError", firstLine);
  }
  if (
    /while parsing selector|Unknown engine|Unexpected token|strict mode violation/i.test(message)
  ) {
    return new ServerBrowserOperationError("PreviewAutomationInvalidSelectorError", firstLine);
  }
  if (/not an <input>|not editable|not an editable/i.test(message)) {
    return new ServerBrowserOperationError("PreviewAutomationTargetNotEditableError", firstLine);
  }
  return new ServerBrowserOperationError("PreviewAutomationExecutionError", firstLine);
};

const DEFAULT_TIMEOUT_MS = 15_000;

const pageRefs = new WeakMap<Page, { generation: string; refs: Map<string, string> }>();
// A compact runtime namespace prevents old refs from aliasing after a server restart.
const refNamespace = NodeCrypto.randomUUID().slice(0, 8);
let snapshotSequence = 0;
const nextRefGeneration = () => `${refNamespace}-${(++snapshotSequence).toString(36)}`;

/** A new snapshot or navigation revokes previously issued refs. */
export const invalidateRefs = (page: Page) => {
  const state = pageRefs.get(page);
  if (state) {
    state.generation = nextRefGeneration();
    state.refs.clear();
  }
};

const refsFor = (page: Page) => {
  let state = pageRefs.get(page);
  if (!state) {
    state = { generation: nextRefGeneration(), refs: new Map<string, string>() };
    pageRefs.set(page, state);
    page.on("framenavigated", () => invalidateRefs(page));
    page.on("framedetached", () => invalidateRefs(page));
  }
  return state;
};

const targetLocator = (
  page: Page,
  input: { readonly locator?: string | undefined; readonly selector?: string | undefined },
): Locator | null => {
  const selector = input.locator ?? input.selector;
  if (selector === undefined) return null;
  // Ignore quoted/escaped CSS values when looking for a selector-engine boundary.
  const engines = selector.replace(
    /\\.|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,
    " ",
  );
  if (/(?:^|>>)\s*\*?aria-ref\s*=/.test(engines)) {
    const ref = /^\s*aria-ref\s*=\s*(\S+)\s*$/.exec(selector)?.[1];
    const nativeRef = ref === undefined ? undefined : pageRefs.get(page)?.refs.get(ref);
    if (nativeRef === undefined) {
      throw new ServerBrowserOperationError(
        "PreviewAutomationInvalidSelectorError",
        "This element ref is stale or belongs to another tab. Take a fresh snapshot and use its locator.",
        { staleRef: true },
      );
    }
    return page.locator(`aria-ref=${nativeRef}`);
  }
  // Playwright's strict locators reject ambiguous controls rather than acting on row one.
  return page.locator(selector);
};

const SNAPSHOT_SCRIPT = `(() => {
  return {
    url: location.href,
    title: document.title,
    loading: document.readyState !== "complete",
    visibleText: (document.body?.innerText || "").slice(0, ${MAX_VISIBLE_TEXT_LENGTH}),
    interactiveElements: [],
  };
})()`;

/** Width and height from a PNG's IHDR chunk, the size the agent actually receives. */
const pngSize = (base64: string) => {
  const header = Buffer.from(base64.slice(0, 32), "base64");
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
};

/**
 * The page's visible area as a PNG, at most MAX_SCREENSHOT_WIDTH pixels wide. A page reached over
 * CDP reports no viewport (Playwright's `viewportSize()` is null), so the area and its pixel
 * ratio come from the page; the person's view may have resized the window to any size.
 */
export const captureViewport = async (cdp: CDPSession) => {
  const [{ cssVisualViewport: view }, ratio] = await Promise.all([
    cdp.send("Page.getLayoutMetrics"),
    cdp.send("Runtime.evaluate", { expression: "devicePixelRatio", returnByValue: true }),
  ]);
  const pixelRatio =
    typeof ratio.result.value === "number" && ratio.result.value > 0 ? ratio.result.value : 1;
  const scale = Math.min(1, MAX_SCREENSHOT_WIDTH / (view.clientWidth * pixelRatio));
  // Clips use document offsets.
  const clip =
    scale < 1
      ? {
          x: view.pageX,
          y: view.pageY,
          width: view.clientWidth,
          height: view.clientHeight,
          scale,
        }
      : undefined;
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    ...(clip ? { clip } : {}),
  });
  return data;
};

export const snapshot = async (input: {
  readonly page: Page;
  readonly cdp: CDPSession;
  readonly consoleEntries: ReadonlyArray<PreviewAutomationConsoleEntry>;
  readonly networkEntries: ReadonlyArray<PreviewAutomationNetworkEntry>;
  readonly actionTimeline: PreviewAutomationSnapshot["actionTimeline"];
  readonly timeoutMs?: number;
}): Promise<PreviewAutomationSnapshot> => {
  const state = refsFor(input.page);
  invalidateRefs(input.page);
  const generation = state.generation;
  const [page, tree, data] = await Promise.all([
    input.page.evaluate(SNAPSHOT_SCRIPT) as Promise<
      Pick<
        PreviewAutomationSnapshot,
        "url" | "title" | "loading" | "visibleText" | "interactiveElements"
      >
    >,
    input.page.ariaSnapshot({
      mode: "ai",
      boxes: true,
      timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    }),
    captureViewport(input.cdp),
  ]);
  if (state.generation !== generation) {
    throw new ServerBrowserOperationError(
      "PreviewAutomationExecutionError",
      "The page changed while capturing its snapshot. Take another snapshot.",
    );
  }
  const accessibilityTree = tree
    .slice(0, MAX_VISIBLE_TEXT_LENGTH)
    .replace(/\[ref=((?:f\d+)?e\d+)\]/g, (_match, nativeRef: string) => {
      const ref = `t3-${generation}-${nativeRef}`;
      state.refs.set(ref, nativeRef);
      return `[ref=${ref}]`;
    });
  return {
    ...page,
    accessibilityTree,
    consoleEntries: [...input.consoleEntries],
    networkEntries: [...input.networkEntries],
    actionTimeline: [...input.actionTimeline],
    screenshot: { mimeType: "image/png", data, ...pngSize(data) },
  };
};

/**
 * A click whose handler opens a dialog does not finish until the dialog is
 * resolved, so it returns as soon as the dialog opens. The dialog stays for
 * whoever works in the page.
 */
export const click = async (page: Page, input: PreviewAutomationClickInput) => {
  const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const locator = targetLocator(page, input);
  const clicked =
    locator === null ? page.mouse.click(input.x ?? 0, input.y ?? 0) : locator.click({ timeout });
  let onDialog = constVoid;
  const dialogOpened = new Promise<"dialog">((resolve) => {
    onDialog = () => resolve("dialog");
    page.once("dialog", onDialog);
  });
  try {
    if ((await Promise.race([clicked, dialogOpened])) === "dialog") void clicked.catch(constVoid);
  } finally {
    page.off("dialog", onDialog);
  }
};

export const type = async (page: Page, input: PreviewAutomationTypeInput) => {
  const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const locator = targetLocator(page, input);
  if (locator !== null && input.clear) {
    await locator.fill(input.text, { timeout });
    return;
  }
  // A shadow host also matches :focus; use its innermost focused descendant.
  const target = locator ?? page.locator("*:focus").last();
  const focused =
    (locator !== null || (await target.count()) > 0) &&
    (await target.evaluate(
      (element) => {
        // Like the desktop host: an enabled text control or contenteditable
        // that actually takes focus. Anything else would swallow the text or
        // send it to whichever field had focus before.
        const control = element as unknown as {
          readonly type?: string;
          readonly disabled?: boolean;
          readonly readOnly?: boolean;
          readonly isContentEditable?: boolean;
          readonly focus?: () => void;
        };
        const nonText = [
          "button",
          "checkbox",
          "color",
          "file",
          "hidden",
          "image",
          "radio",
          "range",
          "reset",
          "submit",
        ];
        const textControl =
          element.tagName === "TEXTAREA" ||
          (element.tagName === "INPUT" && !nonText.includes(control.type ?? "text"));
        if (!(textControl || control.isContentEditable) || control.disabled || control.readOnly) {
          return false;
        }
        control.focus?.();
        const root = element.getRootNode() as { readonly activeElement?: typeof element | null };
        const active = root.activeElement;
        return active != null && (active === element || element.contains(active));
      },
      undefined,
      { timeout },
    ));
  if (focused !== true) {
    throw new ServerBrowserOperationError(
      "PreviewAutomationTargetNotEditableError",
      "The target is not an enabled text field, so no text was typed.",
    );
  }
  if (input.clear) {
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Delete");
  }
  await page.keyboard.insertText(input.text);
};

export const press = async (page: Page, input: PreviewAutomationPressInput) => {
  await page.keyboard.press([...(input.modifiers ?? []), input.key].join("+"));
};

export const scroll = async (page: Page, input: PreviewAutomationScrollInput) => {
  const delta = [input.deltaX ?? 0, input.deltaY ?? 0] as const;
  const locator = targetLocator(page, input);
  if (locator === null) {
    // Page-side code is passed as source: the server compiles without DOM types.
    await page.evaluate(`scrollBy(${delta[0]}, ${delta[1]})`);
    return;
  }
  await locator.evaluate((element, [x, y]) => element.scrollBy(x, y), delta);
};

export const evaluate = async (cdp: CDPSession, input: PreviewAutomationEvaluateInput) => {
  const result = await cdp.send("Runtime.evaluate", {
    expression: input.expression,
    awaitPromise: input.awaitPromise ?? true,
    returnByValue: input.returnByValue ?? true,
  });
  if (result.exceptionDetails) {
    throw new ServerBrowserOperationError(
      "PreviewAutomationExecutionError",
      result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
    );
  }
  const value =
    "value" in result.result ? result.result.value : (result.result.description ?? null);
  const actualBytes = Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  if (actualBytes > MAX_EVALUATION_BYTES) {
    throw new ServerBrowserOperationError(
      "PreviewAutomationResultTooLargeError",
      `Evaluation result is ${actualBytes} bytes; the limit is ${MAX_EVALUATION_BYTES}.`,
      { maximumBytes: MAX_EVALUATION_BYTES },
    );
  }
  return value;
};

export const waitFor = async (page: Page, input: PreviewAutomationWaitForInput) => {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const locator = targetLocator(page, input);
  const { text, urlIncludes } = input;
  const checks: Array<() => Promise<boolean>> = [];
  // Like the desktop host: the selector must match an element, visible or not.
  if (locator !== null) checks.push(async () => (await locator.count()) > 0);
  if (text !== undefined) {
    // A navigation can destroy the context mid-check; that counts as not yet.
    checks.push(() =>
      page
        .evaluate(`(document.body?.innerText ?? "").includes(${JSON.stringify(text)})`)
        .then((found) => found === true)
        .catch(() => false),
    );
  }
  if (urlIncludes !== undefined) checks.push(async () => page.url().includes(urlIncludes));
  for (;;) {
    const results = await Promise.all(checks.map((check) => check()));
    if (results.every(Boolean)) return;
    if (Date.now() >= deadline) {
      throw new ServerBrowserOperationError(
        "PreviewAutomationTimeoutError",
        `Waited ${timeoutMs}ms without every condition holding.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
  }
};

const NET_ERROR_CODES: Readonly<Record<string, number>> = {
  ERR_FAILED: -2,
  ERR_TIMED_OUT: -7,
  ERR_CONNECTION_CLOSED: -100,
  ERR_CONNECTION_RESET: -101,
  ERR_CONNECTION_REFUSED: -102,
  ERR_NAME_NOT_RESOLVED: -105,
  ERR_INTERNET_DISCONNECTED: -106,
  ERR_ADDRESS_UNREACHABLE: -109,
  ERR_CERT_AUTHORITY_INVALID: -202,
  ERR_EMPTY_RESPONSE: -324,
};

export const parseNetError = (errorText: string) => {
  const description = /ERR_[A-Z_]+/.exec(errorText)?.[0] ?? errorText;
  return { description, code: NET_ERROR_CODES[description] ?? -2 };
};

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
  readonly actionTimeline: Array<PreviewAutomationSnapshot["actionTimeline"][number]>;
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
      url: request.url(),
      method: request.method(),
      status: null,
      failed: true,
      errorText: request.failure()?.errorText ?? "",
      timestamp: new Date().toISOString(),
    });
  });
  page.on("response", (response) => {
    pushBounded(diagnostics.networkEntries, {
      url: response.url(),
      method: response.request().method(),
      status: response.status(),
      failed: false,
      timestamp: new Date().toISOString(),
    });
  });
  page.on("console", (message) => {
    pushBounded(diagnostics.consoleEntries, {
      level: message.type(),
      text: message.text().slice(0, 2_000),
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
    -readonly [
      K in keyof PageDiagnostics["actionTimeline"][number]
    ]: PageDiagnostics["actionTimeline"][number][K];
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
