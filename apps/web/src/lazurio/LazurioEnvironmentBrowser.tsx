import type { ScopedThreadRef } from "@t3tools/contracts";
import { ExternalLink, Globe2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { isPreviewSupportedInRuntime } from "../previewStateStore";
import { useRightPanelStore } from "../rightPanelStore";
import { usePrimaryEnvironmentId } from "../state/environments";
import { agentBrowserSessionName } from "./agentBrowserSession";
import { type EnvironmentBrowserView, fetchEnvironmentBrowser } from "./environmentBrowser";

const askEnvironment = (threadId: string) =>
  fetchEnvironmentBrowser(agentBrowserSessionName(threadId), window.location.origin, (url, init) =>
    window.fetch(url, init),
  );

/**
 * Lazurio overlay (root decision 0191, plan DEV-6646): whether the right panel's Browser opens
 * the Environment browser for this thread, and how. The desktop app keeps its own browser, and
 * only threads of this page's own environment have their window in its browser, so anywhere
 * else this is never available and the Browser stays upstream's. The Environment is asked again
 * whenever the panel opens or the thread changes; until it answers, the Browser stays disabled.
 */
export function useLazurioEnvironmentBrowser(
  threadRef: ScopedThreadRef | null,
  panelOpen: boolean,
): { readonly available: boolean; readonly open: () => void } {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const threadId =
    threadRef !== null &&
    threadRef.environmentId === primaryEnvironmentId &&
    !isPreviewSupportedInRuntime()
      ? threadRef.threadId
      : null;
  const [answer, setAnswer] = useState<{
    readonly threadId: string;
    readonly available: boolean;
  } | null>(null);
  useEffect(() => {
    if (threadId === null || !panelOpen) return;
    let current = true;
    void askEnvironment(threadId).then((view) => {
      if (current) setAnswer({ threadId, available: view !== null });
    });
    return () => {
      current = false;
    };
  }, [panelOpen, threadId]);
  const open = useCallback(() => {
    if (threadRef !== null) useRightPanelStore.getState().open(threadRef, "environment-browser");
  }, [threadRef]);
  return {
    available: threadId !== null && answer?.threadId === threadId && answer.available,
    open,
  };
}

/**
 * The Environment browser in the right panel: the view of this thread's window in a frame. The
 * view is asked for each time the surface opens, and again on Reload, because its URL carries a
 * short-lived access token; it lives only in this component's state. The gateway's sign-in page
 * cannot render in a frame once the sign-in has expired, so the view also opens in a new tab.
 */
export function LazurioEnvironmentBrowser(props: { readonly threadId: string }) {
  const [request, setRequest] = useState(0);
  const [answer, setAnswer] = useState<{
    readonly threadId: string;
    readonly request: number;
    readonly view: EnvironmentBrowserView | null;
  } | null>(null);
  useEffect(() => {
    let current = true;
    void askEnvironment(props.threadId).then((view) => {
      if (current) setAnswer({ threadId: props.threadId, request, view });
    });
    return () => {
      current = false;
    };
  }, [props.threadId, request]);
  // Undefined while the Environment is being asked.
  const view =
    answer?.threadId === props.threadId && answer.request === request ? answer.view : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 min-h-10 shrink-0 items-center gap-1 border-b border-border/60 bg-background px-2">
        <Globe2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
          Environment browser
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Reload"
                disabled={view === undefined}
                onClick={() => setRequest((value) => value + 1)}
              />
            }
          >
            <RefreshIcon refreshing={view === undefined} />
          </TooltipTrigger>
          <TooltipPopup>Reload</TooltipPopup>
        </Tooltip>
        {view ? (
          <Button
            variant="ghost"
            size="xs"
            render={<a href={view.view} target="_blank" rel="noopener" />}
          >
            <ExternalLink aria-hidden />
            Open in new tab
          </Button>
        ) : null}
      </div>
      {view ? (
        <iframe
          src={view.view}
          title="Environment browser"
          className="min-h-0 w-full flex-1 border-0"
          allow="clipboard-read; clipboard-write; fullscreen"
          // oxlint-disable-next-line react/iframe-missing-sandbox -- the view is never on this page's origin (environmentBrowser.ts), so allow-same-origin keeps it to its own.
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
        />
      ) : view === null ? (
        <Empty className="min-h-0">
          <EmptyMedia variant="icon">
            <Globe2 />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>Browser unavailable</EmptyTitle>
            <EmptyDescription>
              This environment did not offer its browser. Reload to ask again.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
    </div>
  );
}
