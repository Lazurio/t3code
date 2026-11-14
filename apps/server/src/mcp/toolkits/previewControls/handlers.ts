import {
  OrchestratorMcpFailure,
  PREVIEW_URL_MAX_LENGTH,
  type PreviewTabId,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Preview from "../../../preview/Manager.ts";
import {
  EnvironmentBrowserTabs,
  type EnvironmentBrowserStripTab,
} from "../../../lazurio/environmentBrowserTabs.ts";
import { requireThreadMcpCapability } from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { unavailable } from "../../threadAccess.ts";
import { PreviewControlsToolkit } from "./tools.ts";
import * as PreviewAutomationBroker from "../../PreviewAutomationBroker.ts";

const access = Effect.gen(function* () {
  const scope = yield* requireThreadMcpCapability("preview");
  return { scope, manager: yield* Preview.PreviewManager };
});

// Lazurio overlay (Lazurio/t3code#200): where the Environment declares its browser, the thread's
// server tabs are its strip of that browser, which upstream's PreviewManager never sees.
const stripOf = Effect.fn("PreviewControls.stripOf")(
  function* (threadId: ThreadId) {
    const tabs = yield* EnvironmentBrowserTabs;
    return yield* tabs.list(threadId);
  },
  Effect.mapError(
    (error) => new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message }),
  ),
);
const stripSession = (
  threadId: string,
  updatedAt: string,
  { tabId, url, title, view }: EnvironmentBrowserStripTab,
) => ({
  threadId,
  tabId: tabId as PreviewTabId,
  navStatus:
    url === null || url.length > PREVIEW_URL_MAX_LENGTH
      ? { _tag: "Idle" as const }
      : { _tag: "Success" as const, url, title: (title ?? "").slice(0, 512) },
  canGoBack: false,
  canGoForward: false,
  runtime: "server" as const,
  view,
  updatedAt,
});

export const layer = McpToolAccess.toLayer(PreviewControlsToolkit, {
  t3_preview_list: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const { scope, manager } = yield* access;
      const threadId = scope.thread.threadId;
      const result = yield* manager.list({ threadId });
      const strip = yield* stripOf(threadId);
      const now = DateTime.formatIso(yield* DateTime.now);
      const sessions = Option.match(strip, {
        onNone: () => result.sessions,
        onSome: (tabs) => [
          ...tabs.map((tab) => stripSession(threadId, now, tab)),
          ...result.sessions,
        ],
      });
      const start = input.cursor ?? 0;
      const end = start + (input.limit ?? 20);
      return {
        ...result,
        sessions: sessions.slice(start, end),
        nextCursor: end < sessions.length ? end : null,
      };
    }),
  ),
  t3_preview_close: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { scope, manager } = yield* access;
      const { sessions } = yield* manager.list({ threadId: scope.thread.threadId });
      const strip = yield* stripOf(scope.thread.threadId);
      const held = Option.flatMap(strip, (tabs) =>
        Option.fromNullishOr(
          tabs.find((tab) => tab.tabId.toUpperCase() === input.tabId.toUpperCase()),
        ),
      );
      if (
        Option.isSome(held) ||
        sessions.some((session) => session.tabId === input.tabId && session.runtime === "server")
      ) {
        const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
        const tabId = Option.match(held, {
          onNone: () => input.tabId,
          onSome: (tab) => tab.tabId as PreviewTabId,
        });
        yield* broker.invoke({ scope, operation: "close", input: {}, tabId });
        return {};
      }
      // Upstream's close of an unknown tab does nothing; a strip's thread is told it holds none.
      if (Option.isSome(strip) && !sessions.some((session) => session.tabId === input.tabId)) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: `This thread holds no tab ${input.tabId}. Call t3_preview_list for the tabs it holds.`,
        });
      }
      yield* manager
        .close({ threadId: scope.thread.threadId, tabId: input.tabId })
        .pipe(Effect.mapError(unavailable));
      return {};
    }),
  ),
});
