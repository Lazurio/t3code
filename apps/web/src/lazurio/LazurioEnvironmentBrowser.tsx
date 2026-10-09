import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { ExternalLink, Globe2, LogIn } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { create } from "zustand";

import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { isPreviewSupportedInRuntime } from "../previewStateStore";
import {
  type RightPanelSurface,
  selectActiveRightPanel,
  useRightPanelStore,
} from "../rightPanelStore";
import { usePrimaryEnvironmentId } from "../state/environments";
import { agentBrowserSessionName } from "./agentBrowserSession";
import {
  type BrowserUseTracker,
  type OpenedTab,
  type ThreadActivity,
  trackBrowserUse,
} from "./browserUse";
import type { LazurioBrowserView } from "./browserView";
import {
  type EnvironmentBrowserTab,
  environmentBrowserLink,
  environmentBrowserTab,
  fetchEnvironmentBrowser,
  foreignEnvironmentBrowserTab,
  foreignEnvironmentIcon,
  foreignEnvironmentLabel,
  isPlainPrimaryClick,
  readEnvironmentBrowserMessage,
} from "./environmentBrowser";

/**
 * The origin of this Environment's view, from the last answer that named a view: where the links
 * to its tabs lead. Page memory only, like the answers themselves.
 */
let viewOrigin: string | null = null;

const askEnvironment = (threadId: string) =>
  fetchEnvironmentBrowser(agentBrowserSessionName(threadId), window.location.origin, (url, init) =>
    window.fetch(url, init),
  ).then((view) => {
    if (view !== null) viewOrigin = new URL(view.view).origin;
    return view;
  });

/** Another Lazurio Environment's tab at `address`, seen from this page (environmentBrowser.ts). */
const foreignTabAt = (address: unknown) =>
  foreignEnvironmentBrowserTab(address, window.location.origin, viewOrigin);

/** The overlay's words are Czech where the person's browser is, as in the Environment's view. */
const prefersCzech = () => navigator.language.toLowerCase().startsWith("cs");

/**
 * The thread where the Environment browser can serve it, else null: a thread of this page's own
 * environment, in the web client. The desktop app keeps its own browser, and a thread of another
 * environment has its window in that environment's browser.
 */
function useEnvironmentBrowserThread(threadRef: ScopedThreadRef | null): ScopedThreadRef | null {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  return threadRef !== null &&
    threadRef.environmentId === primaryEnvironmentId &&
    !isPreviewSupportedInRuntime()
    ? threadRef
    : null;
}

type TabTitles = Readonly<Record<string, string>>;
const NO_TITLES: TabTitles = {};

/**
 * The titles the panel's Environment browser tabs last reported, by thread key and surface id.
 * Session only: a frame reports its tab's title again whenever it connects.
 */
const useTabTitles = create<{ readonly byThreadKey: Readonly<Record<string, TabTitles>> }>(() => ({
  byThreadKey: {},
}));

function rememberTitle(threadKey: string, surfaceId: string, title: string | null): void {
  useTabTitles.setState((state) => {
    const titles = state.byThreadKey[threadKey] ?? NO_TITLES;
    if ((titles[surfaceId] ?? null) === title) return state;
    const { [surfaceId]: _previous, ...others } = titles;
    return {
      byThreadKey: {
        ...state.byThreadKey,
        [threadKey]: title === null ? others : { ...others, [surfaceId]: title },
      },
    };
  });
}

/**
 * Lazurio overlay (root decision 0191, plan DEV-6646): whether the right panel's Browser opens
 * the Environment browser for this thread, and how. The desktop app keeps its own browser, and
 * only threads of this page's own environment have their window in its browser, so anywhere
 * else this is never available and the Browser stays upstream's. The Environment is asked again
 * whenever the panel opens or the thread changes; until it answers, the Browser stays disabled.
 * `titles` are what the thread's Environment browser tabs report, by surface id.
 */
export function useLazurioEnvironmentBrowser(
  threadRef: ScopedThreadRef | null,
  panelOpen: boolean,
): { readonly available: boolean; readonly open: () => void; readonly titles: TabTitles } {
  const threadId = useEnvironmentBrowserThread(threadRef)?.threadId ?? null;
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
  const threadKey = threadRef === null ? null : scopedThreadKey(threadRef);
  const titles = useTabTitles((state) =>
    threadKey === null ? NO_TITLES : (state.byThreadKey[threadKey] ?? NO_TITLES),
  );
  return {
    available: threadId !== null && answer?.threadId === threadId && answer.available,
    open,
    titles,
  };
}

/** The thread's own tab, the surface a person picks as Browser. */
const OWN_TAB = { id: "environment-browser", kind: "environment-browser" } as const;
/** A row of the chat's timeline: a message, or the work the agent did. */
const CHAT_ROW = "[data-timeline-root]";

const showsEnvironmentBrowser = (threadRef: ScopedThreadRef) =>
  selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, threadRef) ===
  "environment-browser";

/**
 * Lazurio/t3code#48: the tab a completed preview_open answered with joins the panel, in front
 * when preview_open showed it to the person (`front`), else behind the surface in view. Another
 * Environment's view is that Environment's tab. Any other tab is one of this Environment's view,
 * which the Environment is asked for; the thread's own window is the thread's own tab. Bringing a
 * tab to the front is automatic: a choice the person made since the call completed wins.
 */
function showOpenedTab(
  threadRef: ScopedThreadRef,
  opened: OpenedTab,
  front: boolean,
  inView: { readonly current: string | null },
): void {
  const revision = useRightPanelStore.getState().getUserActionRevision(threadRef);
  const show = (tab: EnvironmentBrowserTab) => {
    const store = useRightPanelStore.getState();
    if (!front) store.openEnvironmentBrowserTab(threadRef, tab.view, true);
    else
      store.openProactive(
        threadRef,
        { id: tab.id, kind: "environment-browser", view: tab.view },
        revision,
      );
  };
  const foreign = foreignTabAt(opened.view);
  if (foreign !== null) {
    if (foreign.environment.targetId === opened.tabId) show(foreign);
    return;
  }
  const threadKey = scopedThreadKey(threadRef);
  void askEnvironment(threadRef.threadId).then((own) => {
    if (own === null || viewOrigin === null || inView.current !== threadKey) return;
    const tab = environmentBrowserTab(`${viewOrigin}/t/${opened.tabId}`, window.location.origin);
    if (tab === null) return;
    if (environmentBrowserTab(own.view)?.id !== tab.id) show(tab);
    else if (front) useRightPanelStore.getState().openProactive(threadRef, OWN_TAB, revision);
  });
}

/**
 * Lazurio overlay (root decision 0191, plan DEV-6646): the chat brings the Environment browser
 * into the right panel. When the agent of the thread in view starts to use the browser
 * (browserUse.ts) and the Environment offers it, the panel opens on the thread's own tab, the
 * surface a person picks by hand, unless it shows the Environment browser already. Only activities
 * that arrive while the thread is in view and `live` count, never its history. A person who closes
 * the panel or picks another surface sees it open again at the agent's next browser call, so the
 * person sees where the agent works; a choice the person makes while the Environment is asked wins
 * over the opening. Where the panel is a sheet over the chat (`inlinePanel` false), it does not
 * open by itself: it would cover the chat and take the composer's focus. The tab a completed
 * preview_open answered with joins the panel as well (showOpenedTab), and a call that opens
 * another Environment's view leaves this Environment's browser alone. A plain click on a link in
 * the chat to one remote tab of this Environment's view, or of another Lazurio Environment's,
 * opens that tab in the panel instead of a new browser tab.
 */
export function useLazurioEnvironmentBrowserFromChat(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly activities: ReadonlyArray<ThreadActivity>;
  /** False while the thread's history loads or catches up. */
  readonly live: boolean;
  /** False where the right panel is a sheet over the chat. */
  readonly inlinePanel: boolean;
}): void {
  const { activities, live, inlinePanel } = input;
  const threadRef = useEnvironmentBrowserThread(input.threadRef);
  const tracker = useRef<BrowserUseTracker | null>(null);
  // The key of the thread in view, and of the thread whose Environment is being asked.
  const inView = useRef<string | null>(null);
  const asking = useRef<string | null>(null);

  useEffect(() => {
    if (threadRef === null) {
      tracker.current = null;
      return;
    }
    const threadKey = scopedThreadKey(threadRef);
    const look = trackBrowserUse(
      tracker.current,
      threadKey,
      activities,
      live,
      (url) => foreignTabAt(url) !== null,
    );
    tracker.current = look.tracker;
    for (const opened of look.opened) {
      showOpenedTab(threadRef, opened, opened.visible && inlinePanel, inView);
    }
    if (!look.used || !inlinePanel || asking.current === threadKey) return;
    if (showsEnvironmentBrowser(threadRef)) return;
    const revision = useRightPanelStore.getState().getUserActionRevision(threadRef);
    asking.current = threadKey;
    void askEnvironment(threadRef.threadId).then((view) => {
      if (asking.current === threadKey) asking.current = null;
      if (view === null || inView.current !== threadKey || showsEnvironmentBrowser(threadRef)) {
        return;
      }
      useRightPanelStore.getState().openProactive(threadRef, OWN_TAB, revision);
    });
  }, [activities, inlinePanel, live, threadRef]);

  useEffect(() => {
    if (threadRef === null) return;
    inView.current = scopedThreadKey(threadRef);
    const openInPanel = (event: MouseEvent) => {
      if (!isPlainPrimaryClick(event) || !(event.target instanceof Element)) return;
      const link = event.target.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.closest(CHAT_ROW) === null) return;
      const tab =
        environmentBrowserLink(link.href, window.location.origin, viewOrigin) ??
        foreignTabAt(link.href);
      if (tab === null) return;
      // The panel takes this click: no new browser tab, and no link handling of the chat's own.
      event.preventDefault();
      event.stopPropagation();
      useRightPanelStore.getState().openEnvironmentBrowserTab(threadRef, tab.view);
    };
    // Capturing on the document runs before the chat's own handlers of the link.
    document.addEventListener("click", openInPanel, true);
    return () => {
      inView.current = null;
      document.removeEventListener("click", openInPanel, true);
    };
  }, [threadRef]);
}

type EnvironmentBrowserSurface = Extract<RightPanelSurface, { kind: "environment-browser" }>;

/**
 * How long another Environment's view has to tell its tab: after its page loaded, and in all. A
 * gateway that sends a frame to its sign-in, which refuses to render in a frame, loads an error
 * page within a second; a view that comes up tells its tab right after it connects.
 */
const FOREIGN_VIEW_AFTER_LOAD_MS = 4_000;
const FOREIGN_VIEW_MS = 15_000;

/** The GitHub picture of the Organization or person whose Environment it is, else its initial. */
function EnvironmentOwnerPicture(props: { readonly environment: LazurioBrowserView }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-warning font-semibold text-3xs text-white">
      {props.environment.owner.charAt(0).toUpperCase()}
    </span>
  ) : (
    <img
      src={foreignEnvironmentIcon(props.environment)}
      alt=""
      referrerPolicy="no-referrer"
      className="size-4 shrink-0 rounded-sm"
      onError={() => setFailed(true)}
    />
  );
}

const isEnvironmentBrowserSurface = (
  surface: RightPanelSurface,
): surface is EnvironmentBrowserSurface => surface.kind === "environment-browser";

/**
 * The right panel's content on the web: the surface in view (`children`) and every Environment
 * browser tab of the thread, each in a frame of its own that stays mounted while the panel
 * shows the thread. A frame that unmounts drops its tab's viewer, and the Environment closes a
 * tab a page opened 30 s after its last viewer leaves (LazurioPlatform F39 point 9), so only
 * closing the panel, closing the tab or leaving the thread may end it. The frames share one
 * grid cell with the surface in view, and only the active tab's frame is visible. A hidden
 * frame keeps its size (visibility, not display): the view sizes its remote window to its own
 * page area, so a frame without one would shrink the window, the agent's tab included. The
 * desktop app has its own browser and keeps upstream's panel.
 */
export function LazurioRightPanelSurfaces(props: {
  readonly threadRef: ScopedThreadRef;
  readonly surfaces: readonly RightPanelSurface[];
  readonly activeSurfaceId: string | null;
  readonly children: ReactNode;
}) {
  if (isPreviewSupportedInRuntime()) return props.children;
  const threadKey = scopedThreadKey(props.threadRef);
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-1">
      <div className="col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col">{props.children}</div>
      {props.surfaces.filter(isEnvironmentBrowserSurface).map((surface) => {
        const shown = surface.id === props.activeSurfaceId;
        return (
          <div
            key={`${threadKey}:${surface.id}`}
            className={cn(
              "col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col",
              !shown && "invisible",
            )}
            inert={!shown}
          >
            <LazurioEnvironmentBrowser
              threadRef={props.threadRef}
              surface={surface}
              shown={shown}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * An Environment browser tab of the right panel: the view of one remote tab in a frame. The
 * thread's own tab is asked of the Environment each time its frame mounts and again on Reload;
 * a tab that a page opened frames its own view, and Reload loads it again. The frame tells the
 * panel its tab's title, and a tab its page opens becomes a new tab of the panel, as in the
 * person's own browser (root decision 0191 point 12): in front when the page is the one in view,
 * and behind it when the page is in a hidden tab, so that a tab an agent opens there does not
 * take the person's place. The gateway's sign-in page cannot render in a frame once the sign-in
 * has expired, so the view also opens in a new tab. Another Lazurio Environment's tab is marked
 * as that Environment's: a coloured border, and its Organization's picture and name in the head.
 * Where its view does not come up (no session at that Environment's gateway, whose sign-in cannot
 * render in a frame), the panel asks the person to sign in there.
 */
function LazurioEnvironmentBrowser(props: {
  readonly threadRef: ScopedThreadRef;
  readonly surface: EnvironmentBrowserSurface;
  readonly shown: boolean;
}) {
  const { threadRef, surface, shown } = props;
  const threadId = threadRef.threadId;
  const tabView = "view" in surface ? surface.view : null;
  const foreign = tabView === null ? null : foreignTabAt(tabView);
  const [request, setRequest] = useState(0);
  const [answer, setAnswer] = useState<{
    readonly threadId: string;
    readonly request: number;
    readonly view: string | null;
  } | null>(null);
  useEffect(() => {
    if (tabView !== null) return;
    let current = true;
    void askEnvironment(threadId).then((view) => {
      if (current) setAnswer({ threadId, request, view: view?.view ?? null });
    });
    return () => {
      current = false;
    };
  }, [tabView, threadId, request]);
  // The frame's address; undefined while the Environment is being asked.
  const view =
    tabView !== null
      ? (environmentBrowserTab(tabView, window.location.origin)?.view ?? null)
      : answer?.threadId === threadId && answer.request === request
        ? answer.view
        : undefined;

  // The requests whose frame told its tab (its view came up), fired load, or ran out of time.
  const [cameUp, setCameUp] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<number | null>(null);
  const [late, setLate] = useState<number | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!view) return;
    const listen = (event: MessageEvent) => {
      const message = readEnvironmentBrowserMessage(
        event,
        frame.current?.contentWindow ?? null,
        view,
      );
      if (message?.type === "info") {
        setCameUp(request);
        rememberTitle(scopedThreadKey(threadRef), surface.id, message.title);
      } else if (message?.type === "new-tab") {
        useRightPanelStore
          .getState()
          .openEnvironmentBrowserTab(threadRef, message.tab.view, !shown);
      }
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [view, threadRef, surface.id, shown, request]);

  // Another Environment's view tells its tab soon after its page loads, or it never came up.
  const isForeign = foreign !== null;
  useEffect(() => {
    if (!isForeign || !view || cameUp === request) return;
    const wait = loaded === request ? FOREIGN_VIEW_AFTER_LOAD_MS : FOREIGN_VIEW_MS;
    const timer = window.setTimeout(() => setLate(request), wait);
    return () => window.clearTimeout(timer);
  }, [isForeign, view, request, loaded, cameUp]);
  const signIn = isForeign && Boolean(view) && late === request && cameUp !== request;
  const czech = prefersCzech();
  const label = foreign === null ? null : foreignEnvironmentLabel(foreign.environment, czech);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", isForeign && "border-2 border-warning")}>
      <div
        className={cn(
          "flex h-10 min-h-10 shrink-0 items-center gap-1 border-b border-border/60 px-2",
          isForeign ? "bg-warning-surface" : "bg-background",
        )}
      >
        {foreign === null ? (
          <Globe2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <EnvironmentOwnerPicture
            key={foreign.environment.owner}
            environment={foreign.environment}
          />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs",
            isForeign ? "font-medium text-warning-foreground" : "text-muted-foreground",
          )}
        >
          {label ?? "Environment browser"}
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
            render={<a href={view} target="_blank" rel="noopener" />}
          >
            <ExternalLink aria-hidden />
            Open in new tab
          </Button>
        ) : null}
      </div>
      {view ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <iframe
            key={request}
            ref={frame}
            src={view}
            title={label ?? "Environment browser"}
            className="min-h-0 w-full flex-1 border-0"
            allow="clipboard-read; clipboard-write; fullscreen"
            // oxlint-disable-next-line react/iframe-missing-sandbox -- the view is never on this page's origin (environmentBrowser.ts), so allow-same-origin keeps it to its own.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
            // Another Environment's view lets T3 frame it by the origin this names (LazurioPlatform).
            referrerPolicy="origin"
            onLoad={() => setLoaded(request)}
          />
          {signIn && label !== null ? (
            <div className="absolute inset-0 flex bg-background">
              <Empty size="compact">
                <EmptyMedia variant="icon">
                  <LogIn />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>
                    {czech
                      ? `Přihlas se do prohlížeče Environmentu ${label}`
                      : `Sign in to the Environment browser of ${label}`}
                  </EmptyTitle>
                  <EmptyDescription>
                    {czech
                      ? "Přihlášení se otevře jen v samostatné záložce. Přihlas se tam a pak načti znovu."
                      : "Its sign-in opens only in a tab of its own. Sign in there, then reload."}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button size="sm" render={<a href={view} target="_blank" rel="noopener" />}>
                      <ExternalLink aria-hidden />
                      {czech ? "Otevřít v nové záložce" : "Open in new tab"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRequest((value) => value + 1)}
                    >
                      <RefreshIcon refreshing={false} />
                      {czech ? "Načíst znovu" : "Reload"}
                    </Button>
                  </div>
                </EmptyContent>
              </Empty>
            </div>
          ) : null}
        </div>
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
