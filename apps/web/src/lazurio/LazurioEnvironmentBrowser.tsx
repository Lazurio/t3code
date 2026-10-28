import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ContextMenuItem, ScopedThreadRef } from "@t3tools/contracts";
import { ExternalLink, Globe2, LogIn, Plus } from "lucide-react";
import { type AnyRouter, useRouter } from "@tanstack/react-router";
import { createElement, type ReactNode, useEffect, useRef, useState } from "react";

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
import { cn } from "~/lib/utils";
import { isPreviewSupportedInRuntime } from "../previewStateStore";
import { type RightPanelSurface, useRightPanelStore } from "../rightPanelStore";
import { usePrimaryEnvironmentId } from "../state/environments";
import type { LazurioBrowserView } from "./browserView";
import {
  type ForeignEnvironmentBrowserTab,
  foreignEnvironmentBrowserTab,
  isPlainPrimaryClick,
  readEnvironmentBrowserMessage,
  viewEnvironmentId,
} from "./environmentBrowser";
import { NewTabSurface, type SurfaceAction, useNewTab, useNewTabDefined } from "./LazurioNewTab";
import {
  type ClosedTabs,
  draftBrowserNote,
  type EnvironmentBrowserSurface,
  enterDraft,
  enterThreadTabs,
  isNewTabSurface,
  leaveDraft,
  leaveThreadTabs,
  letGoOfTabs,
  openLinkInPanel,
  parseForeignTab,
  parseThreadTabsAnswer,
  prefersCzech,
  receiveForeign,
  receiveSnapshot,
  reloadSurface,
  rememberTitle,
  routeShowsThread,
  showForeignTab,
  showOwnTab,
  snapshotOf,
  syncOf,
  tabEnded,
  tabIdOfSurface,
  tabSurfaceId,
  tabTooltip,
  type ThreadTab,
  type ThreadTabsSnapshot,
  THREAD_TABS_ROUTE,
  useThreadTabsStore,
} from "./threadTabs";

// RightPanelTabs reaches the overlay through this one module: Nová karta is LazurioNewTab.tsx's.
export { NewTab, NewTabButton, openNewTab } from "./LazurioNewTab";

/**
 * The thread where the Environment browser can serve it, else null: a thread of this page's own
 * environment, in the web client. The desktop app keeps its own browser, and a thread of another
 * environment has its tabs in that environment's browser.
 */
function useEnvironmentBrowserThread(threadRef: ScopedThreadRef | null): ScopedThreadRef | null {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  return threadRef !== null &&
    threadRef.environmentId === primaryEnvironmentId &&
    !isPreviewSupportedInRuntime()
    ? threadRef
    : null;
}

/**
 * Whether the person is still on the thread when its view closes. It is read from the route the
 * router is on by then, so a view that only mounts anew keeps what the device saw (threadTabs.ts).
 */
const stillShown = (router: AnyRouter, threadRef: ScopedThreadRef) =>
  routeShowsThread(router.state.matches.at(-1)?.params ?? {}, threadRef);

/** A row of the chat's timeline: a message, or the work the agent did. */
const CHAT_ROW = "[data-timeline-root]";

const parseData = (data: unknown) => {
  try {
    return JSON.parse(String(data)) as unknown;
  } catch {
    return null;
  }
};

/**
 * A tab of this Environment that the person closed in the strip, by any close action, while the
 * list still has it or its hold is pending: the thread lets go of it. Store changes in one task
 * (upstream's Close all closes one at a time) make one batch and one toast.
 */
function watchClosedTabs(threadRef: ScopedThreadRef): () => void {
  const key = scopedThreadKey(threadRef);
  let batch: {
    original: readonly RightPanelSurface[];
    closed: EnvironmentBrowserSurface[];
    activeBefore: string | null;
    openBefore: boolean;
  } | null = null;
  return useRightPanelStore.subscribe((state, previous) => {
    const before = previous.byThreadKey[key];
    const after = state.byThreadKey[key];
    if (before === undefined || before === after) return;
    const sync = syncOf(threadRef);
    const snapshot = snapshotOf(threadRef);
    const listed = new Set(snapshot?.tabs.map((tab) => tab.tabId) ?? []);
    const remaining = new Set((after?.surfaces ?? []).map((surface) => surface.id));
    const closed = before.surfaces.filter((surface): surface is EnvironmentBrowserSurface => {
      if (remaining.has(surface.id)) return false;
      const tab = tabIdOfSurface(surface);
      if (tab === null || sync.ended.has(tab) || sync.released.has(tab)) return false;
      return listed.has(tab) || sync.pending.has(tab);
    });
    if (closed.length === 0) return;
    if (batch === null) {
      const started = {
        original: before.surfaces,
        closed: [] as EnvironmentBrowserSurface[],
        activeBefore: before.activeSurfaceId,
        openBefore: before.isOpen,
      };
      batch = started;
      queueMicrotask(() => {
        batch = null;
        const tabs: ClosedTabs = {
          surfaces: started.closed.map((surface) => ({
            surface,
            index: started.original.findIndex((entry) => entry.id === surface.id),
          })),
          activeBefore: started.activeBefore,
          openBefore: started.openBefore,
        };
        letGoOfTabs(threadRef, tabs);
      });
    }
    batch.closed.push(...closed);
  });
}

/**
 * Lazurio overlay: ChatView's one hook. The strip follows the server's list of the thread's tabs,
 * a new reveal opens the inline panel (never the sheet), and a plain click on a remote-tab link in
 * the chat opens it in the panel. A draft opens no stream: the server would answer 404, which an
 * EventSource never retries, so the stream starts once the draft is a thread (Lazurio/t3code#53).
 */
export function useLazurioThreadTabs(
  input: ScopedThreadRef | null,
  options: { readonly inlinePanel: boolean; readonly draft: boolean },
): void {
  const threadRef = useEnvironmentBrowserThread(input);
  const { inlinePanel, draft } = options;
  const router = useRouter();

  // Before the stream's effect, so a thread that comes into view has its panel's kind already.
  // oxlint-disable-next-line t3code/react-effect-budget -- mirrors the panel kind into the module state the stream reads
  useEffect(() => {
    if (threadRef !== null) syncOf(threadRef).inlinePanel = inlinePanel;
  }, [threadRef, inlinePanel]);

  // oxlint-disable-next-line t3code/react-effect-budget -- a draft's presence in view is a mount lifecycle the module tracks
  useEffect(() => {
    if (threadRef === null || !draft) return;
    enterDraft(threadRef);
    return () => leaveDraft(threadRef, stillShown(router, threadRef));
  }, [threadRef, draft, router]);

  // oxlint-disable-next-line t3code/react-effect-budget -- subscribes to the server's EventSource of the thread's tabs
  useEffect(() => {
    if (threadRef === null || draft) return;
    enterThreadTabs(threadRef);
    const events = new EventSource(
      `${THREAD_TABS_ROUTE}/events?threadId=${encodeURIComponent(threadRef.threadId)}`,
    );
    events.addEventListener("snapshot", (event) => {
      const answer = parseThreadTabsAnswer(parseData(event.data));
      if (answer !== null) receiveSnapshot(threadRef, answer);
    });
    events.addEventListener("foreign", (event) => {
      const tab = parseForeignTab(parseData(event.data));
      if (tab !== null) receiveForeign(threadRef, tab);
    });
    const stopWatching = watchClosedTabs(threadRef);
    return () => {
      events.close();
      stopWatching();
      leaveThreadTabs(threadRef, stillShown(router, threadRef));
    };
  }, [threadRef, draft, router]);

  // oxlint-disable-next-line t3code/react-effect-budget -- a capturing document listener for chat link clicks
  useEffect(() => {
    if (threadRef === null) return;
    const openInPanel = (event: MouseEvent) => {
      if (!isPlainPrimaryClick(event) || !(event.target instanceof Element)) return;
      const link = event.target.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.closest(CHAT_ROW) === null) return;
      if (!openLinkInPanel(threadRef, link.href)) return;
      // The panel took this click: no new browser tab, and no link handling of the chat's own.
      event.preventDefault();
      event.stopPropagation();
    };
    // Capturing on the document runs before the chat's own handlers of the link.
    document.addEventListener("click", openInPanel, true);
    return () => document.removeEventListener("click", openInPanel, true);
  }, [threadRef]);
}

/**
 * How long another Environment's view has to tell its tab: after its page loaded, and in all. A
 * gateway that sends a frame to its sign-in, which refuses to render in a frame, loads an error
 * page within a second; a view that comes up tells its tab right after it connects.
 */
const FOREIGN_VIEW_AFTER_LOAD_MS = 4_000;
const FOREIGN_VIEW_MS = 15_000;

/** The shell's element that names an Environment as its switcher does (LazurioPlatform F39,
 * addendum of 2026-10-12). */
export const ENVIRONMENT_ELEMENT = "lazurio-environment";

/** Another Environment's view, said without naming it: its frame's title, and its name until the
 * shell knows that Environment, or where the Environment's Platform predates the element. */
const anotherEnvironment = (czech: boolean) =>
  czech ? "Prohlížeč jiného Prostředí" : "Another Environment's browser";

/** Another Environment's name over the notice to sign in there, where its view, whose own bar names
 * it, did not come up: the shell's `<lazurio-environment>`, which shows its children until the
 * page's shell knows that Environment. */
function ForeignEnvironmentName(props: {
  readonly environment: LazurioBrowserView;
  readonly czech: boolean;
}) {
  return createElement(
    ENVIRONMENT_ELEMENT,
    {
      environment: viewEnvironmentId(props.environment),
      lang: props.czech ? "cs" : "en",
      className: "max-w-full truncate rounded-md border px-2 py-1 font-medium text-sm",
    },
    anotherEnvironment(props.czech),
  );
}

const isEnvironmentBrowserSurface = (
  surface: RightPanelSurface,
): surface is EnvironmentBrowserSurface => surface.kind === "environment-browser";

/**
 * Every Environment browser tab of the thread keeps a mounted frame beside the surface in view, in
 * one grid cell, for instant switching. A hidden frame keeps its size (visibility, not display):
 * the view sizes its remote window to its page area, so a frame without one would shrink the
 * agent's window too. The desktop app has its own browser and keeps upstream's panel.
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
        if (isNewTabSurface(surface)) {
          return shown ? (
            <div
              key={`${threadKey}:${surface.id}`}
              className="col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col"
            >
              <NewTabSurface threadRef={props.threadRef} surface={surface} />
            </div>
          ) : null;
        }
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

/** The server's last answer for the thread the chat shows, whose strip RightPanelTabs draws. */
const snapshotInView = (state: ReturnType<typeof useThreadTabsStore.getState>) =>
  state.inView === null ? undefined : state.snapshots[scopedThreadKey(state.inView)];

/** The titles the frames report, by surface id. */
export type FrameTitles = ReturnType<typeof useThreadTabsStore.getState>["titles"];

/**
 * RightPanelTabs's one hook: whether "+" and the empty panel open Nová karta (`newTab`,
 * LazurioNewTab.tsx), the empty panel's line on a draft, and the titles the frames report. The
 * strip is compiled and memoizes its tabs by their inputs, so a tab's title follows its frame only
 * because the titles reach `surfaceTitle` through here, never read from the store while it renders.
 */
export function useRightPanel(actions: ReadonlyArray<SurfaceAction>) {
  const newTab = useNewTab(actions);
  const titles = useThreadTabsStore((state) => state.titles);
  // A draft on an Environment whose shell offers Nová karta, unless the server already said that
  // this Environment has no browser for another thread.
  const draftNote = useThreadTabsStore(
    (state) =>
      state.draftInView !== null &&
      !Object.values(state.snapshots).some((answer) => answer === null),
  );
  const defined = useNewTabDefined();
  return {
    newTab,
    /** The empty panel's line about the Environment browser, or null for upstream's. */
    browserNote: draftNote && defined ? draftBrowserNote(prefersCzech()) : null,
    titles,
  };
}

/** The strip's title of an Environment browser tab: what its frame reported, or Nová karta. */
export function surfaceTitle(surface: EnvironmentBrowserSurface, titles: FrameTitles): string {
  if (isNewTabSurface(surface)) return prefersCzech() ? "Nová karta" : "New tab";
  return titles[surface.id] ?? "Browser";
}

const tabOfInView =
  (surfaceId: string) => (state: ReturnType<typeof useThreadTabsStore.getState>) =>
    snapshotInView(state)?.tabs.find((tab) => tabSurfaceId(tab.tabId) === surfaceId);

/**
 * The strip tab's tooltip, in place of upstream's title (RightPanelTab): an Environment browser
 * tab of the thread in view adds an agent at work and the other places that hold it, any other
 * surface keeps its title. It follows the server's facts itself, so the tab's props stay upstream's.
 */
export function TabTooltip(props: { readonly surface: RightPanelSurface; readonly title: string }) {
  const tab = useThreadTabsStore(tabOfInView(props.surface.id));
  return tabTooltip(props.title, tab, prefersCzech());
}

/** The strip's icon of an Environment browser tab, marked while an agent works in it or another
 * place holds it too. */
export function SurfaceIcon({ surface }: { readonly surface: EnvironmentBrowserSurface }) {
  const tab: ThreadTab | undefined = useThreadTabsStore(tabOfInView(surface.id));
  if (isNewTabSurface(surface)) return <Plus className="size-3 shrink-0" />;
  const shared = tab !== undefined && tab.alsoHeldBy.length > 0;
  return (
    <span className="relative inline-flex shrink-0">
      <Globe2 className="size-3 shrink-0" />
      {tab?.agent || shared ? (
        <span
          aria-hidden
          className={cn(
            "absolute -top-0.5 -right-0.5 size-1.5 rounded-full",
            tab?.agent ? "bg-info" : "bg-muted-foreground",
          )}
        />
      ) : null}
    </span>
  );
}

/**
 * A foreign tab frames its own view; this Environment's tab frames `<view origin>/t/<id>` from the
 * server's answer, so no address is stored. `view` is undefined until that answer and null where
 * this Environment offers no browser.
 */
function viewOfTab(
  surface: EnvironmentBrowserSurface,
  snapshot: ThreadTabsSnapshot | null | undefined,
): {
  readonly foreign: ForeignEnvironmentBrowserTab | null;
  readonly view: string | null | undefined;
} {
  const foreign =
    surface.view === undefined
      ? null
      : foreignEnvironmentBrowserTab(
          surface.view,
          window.location.origin,
          snapshot?.viewOrigin ?? null,
        );
  const tabId = tabIdOfSurface(surface);
  const view =
    foreign !== null
      ? foreign.view
      : tabId !== null && snapshot !== undefined && snapshot !== null
        ? `${snapshot.viewOrigin}/t/${tabId}`
        : snapshot === null
          ? null
          : undefined;
  return { foreign, view };
}

/** The overlay's items of the strip tab's menu (RightPanelTabs `TabContextMenuAction`). */
export type TabMenuAction = "lazurio-open-in-new-tab" | "lazurio-reload";

/**
 * "Open in new tab" and "Reload" before upstream's close items, for Environment browser tabs other
 * than Nová karta; in English like the rest of that menu. Read from the thread in view when the
 * menu opens, and disabled until the tab's view address is known.
 */
export function tabMenuItems(surface: RightPanelSurface): ContextMenuItem<TabMenuAction>[] {
  if (!isEnvironmentBrowserSurface(surface) || isNewTabSurface(surface)) return [];
  const disabled = !viewOfTab(surface, snapshotInView(useThreadTabsStore.getState())).view;
  return [
    { id: "lazurio-open-in-new-tab", label: "Open in new tab", disabled },
    { id: "lazurio-reload", label: "Reload", disabled },
  ];
}

/**
 * Runs an item of `tabMenuItems`: the tab's view in a new tab of the person's browser, or a fresh
 * frame of it, also while another tab is in front.
 */
export function runTabMenuAction(action: TabMenuAction, surface: RightPanelSurface): void {
  if (!isEnvironmentBrowserSurface(surface)) return;
  if (action === "lazurio-reload") {
    reloadSurface(surface.id);
    return;
  }
  const { view } = viewOfTab(surface, snapshotInView(useThreadTabsStore.getState()));
  if (view) window.open(view, "_blank", "noopener");
}

/**
 * The view of one remote tab in a frame, with the view's own bar as the only toolbar. Tabs its
 * page opens join the panel and the thread holds them; an ended tab leaves (root decision 0191
 * point 12, F47 point 6). Another Environment's tab gets a coloured border, and where its view does
 * not come up the panel asks the person to sign in at that Environment.
 */
function LazurioEnvironmentBrowser(props: {
  readonly threadRef: ScopedThreadRef;
  readonly surface: EnvironmentBrowserSurface;
  readonly shown: boolean;
}) {
  const { threadRef, surface, shown } = props;
  const snapshot = useThreadTabsStore((state) => state.snapshots[scopedThreadKey(threadRef)]);
  // The frame's address; undefined until the server's first answer, null without a browser.
  const { foreign, view } = viewOfTab(surface, snapshot);
  // Each reload is a fresh frame (its key).
  const request = useThreadTabsStore((state) => state.reloads[surface.id] ?? 0);

  // The requests whose frame told its tab (its view came up), fired load, or ran out of time.
  const [cameUp, setCameUp] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<number | null>(null);
  const [late, setLate] = useState<number | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const isForeign = foreign !== null;
  // oxlint-disable-next-line t3code/react-effect-budget -- listens for postMessage from the framed view
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
        rememberTitle(surface.id, message.title);
      } else if (message?.type === "new-tab") {
        const target = /\/t\/([0-9A-Fa-f]{32})$/.exec(message.tab.view)?.[1];
        if (isForeign) showForeignTab(threadRef, message.tab.view, shown);
        else if (target !== undefined) showOwnTab(threadRef, target, shown);
      } else if (message?.type === "closed") {
        tabEnded(threadRef, surface.id);
      }
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [view, threadRef, surface.id, shown, request, isForeign, frame]);

  // Another Environment's view tells its tab soon after its page loads, or it never came up.
  // oxlint-disable-next-line t3code/react-effect-budget -- a timer that gives the foreign view a deadline
  useEffect(() => {
    if (!isForeign || !view || cameUp === request) return;
    const wait = loaded === request ? FOREIGN_VIEW_AFTER_LOAD_MS : FOREIGN_VIEW_MS;
    const timer = window.setTimeout(() => setLate(request), wait);
    return () => window.clearTimeout(timer);
  }, [isForeign, view, request, loaded, cameUp]);
  const signIn = isForeign && Boolean(view) && late === request && cameUp !== request;
  const czech = prefersCzech();
  // The frame's name for assistive technology, in the overlay's language.
  const title =
    foreign === null
      ? czech
        ? "Prohlížeč Prostředí"
        : "Environment browser"
      : anotherEnvironment(czech);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", isForeign && "border-2 border-warning")}>
      {view ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <iframe
            key={request}
            ref={frame}
            src={view}
            title={title}
            className="min-h-0 w-full flex-1 border-0"
            allow="clipboard-read; clipboard-write; fullscreen"
            // A tab the view opens itself, such as its own "Otevřít samostatně", is a normal tab of
            // the person's browser, not a sandboxed one (allow-popups-to-escape-sandbox), as from
            // the Platform's Nová karta frame (`newTabFrameSandbox`).
            // oxlint-disable-next-line react/iframe-missing-sandbox -- the view is never on this page's origin (environmentBrowser.ts), so allow-same-origin keeps it to its own.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
            // Another Environment's view lets T3 frame it by the origin this names (LazurioPlatform).
            referrerPolicy="origin"
            onLoad={() => setLoaded(request)}
          />
          {signIn && foreign !== null ? (
            <div className="absolute inset-0 flex bg-background">
              <Empty size="compact">
                <ForeignEnvironmentName environment={foreign.environment} czech={czech} />
                <EmptyMedia variant="icon">
                  <LogIn />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>
                    {czech
                      ? "Přihlaste se do prohlížeče tohoto Prostředí"
                      : "Sign in to this Environment's browser"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {czech
                      ? "Přihlášení se otevře jen v samostatné záložce. Přihlaste se tam a pak načtěte znovu."
                      : "Its sign-in opens only in a tab of its own. Sign in there, then reload."}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button size="sm" render={<a href={view} target="_blank" rel="noopener" />}>
                      <ExternalLink aria-hidden />
                      {czech ? "Otevřít v nové záložce" : "Open in new tab"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => reloadSurface(surface.id)}>
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
            <EmptyTitle>{czech ? "Prohlížeč není k dispozici" : "Browser unavailable"}</EmptyTitle>
            <EmptyDescription>
              {czech
                ? "Toto Prostředí teď prohlížeč nenabízí. Jeho záložky se vrátí, až ho zase nabídne."
                : "This Environment does not offer its browser now. Its tabs come back when it does."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
    </div>
  );
}
