/**
 * Lazurio overlay (Lazurio/t3code#200): t3_preview_list and t3_preview_close see the thread's tabs
 * of the Environment browser, which live in its strip (threadTabs.ts), not in upstream's
 * PreviewManager. The host provides this to /mcp; by default there is no strip and upstream's
 * preview list answers.
 */

import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { ThreadTabsError } from "./threadTabs.ts";

/** A tab in the thread's strip: its page as the browser shows it, and where a person views it. */
export interface EnvironmentBrowserStripTab {
  readonly tabId: string;
  readonly url: string | null;
  readonly title: string | null;
  /** `<view origin>/t/<tabId>`, as preview_open answers. */
  readonly view: string;
}

export const EnvironmentBrowserTabs = Context.Reference<{
  /** The thread's strip, or none while the Environment declares no browser. */
  readonly list: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<ReadonlyArray<EnvironmentBrowserStripTab>>, ThreadTabsError>;
}>("t3/lazurio/EnvironmentBrowserTabs", {
  defaultValue: () => ({ list: () => Effect.succeedNone }),
});
