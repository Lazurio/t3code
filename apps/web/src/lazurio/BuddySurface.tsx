/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): Buddy's surface. In Buddy's T3 Code (the
 * server's config says `lazurioBuddy`), the web client is Buddy's one conversation: no thread list,
 * no new thread, fork or rollback; a header with Buddy's character and the bubble's window buttons
 * when framed; the days of the conversation in a pane on the left where there is room; and a date
 * line above the first message of each day. `/` opens Buddy's thread, which the server finds or
 * makes. The server holds the one conversation for every client (buddySurfaceGuards.ts); this only
 * leaves out what would be refused. The conversation shows what Buddy writes, not his work
 * (buddySurfaceTimeline.ts), the composer and the keys offer no choice but Hermes's speed, and the
 * surface shows no terminal (buddySurfaceControls.ts).
 */
import type { LegendListRef } from "@legendapp/list/react";
import { useAtomValue } from "@effect/atom-react";
import type { RuntimeMode } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { CircleAlert, Maximize2, Minimize2, X } from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import type { ComposerControlsBar } from "~/components/chat/ComposerControlsBar";
import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import {
  ThreadDetailsPanel,
  type ThreadDetailsPanelProps,
} from "~/components/chat/ThreadDetailsPanel";
import { ThreadErrorBanner } from "~/components/chat/ThreadErrorBanner";
import { type ChatShortcutsInput, useChatShortcuts } from "~/components/chat/useChatShortcuts";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { syncBrowserChromeTheme, useTheme } from "~/hooks/useTheme";
import { applyThemePalette } from "~/themePalette";
import { primaryServerConfigAtom } from "~/state/server";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { selectThreadTerminalUiState } from "~/terminalUiStateStore";
import {
  type BuddyComposerSelection,
  buddySpeedOf,
  buddySpeedOption,
  buddySpeedSelection,
  isBuddySpeed,
  type PanelSurfaces,
  personsQueuedRuns,
  type QueueMessage,
  withoutTerminalSurfaces,
  withoutUnusedShortcuts,
} from "./buddySurfaceControls";
import { pageRecordOf } from "./buddySurfacePage";
import { BUDDY_WORKING_ROW, buddyConversationRows, buddyFailureOf } from "./buddySurfaceTimeline";
import { prefersCzech } from "./threadTabs";
import { useBuddyFrame } from "./useBuddyFrame";

/**
 * Buddy's T3 Code; null until the primary server's config is known, false without one. With
 * `environmentId`, only for that Environment: another Environment's thread is never Buddy's.
 */
export function useBuddySurfaceMode(environmentId?: string): boolean | null {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const config = useAtomValue(primaryServerConfigAtom);
  if (primaryEnvironmentId === null) return false;
  if (environmentId !== undefined && environmentId !== primaryEnvironmentId) return false;
  return config === null ? null : config.lazurioBuddy === true;
}

const BUDDY_THREAD_ROUTE = "/api/lazurio/buddy/thread";
const BUDDY_DAYS_ROUTE = "/api/lazurio/buddy/days";
const AVATAR = "/assets/avatar.webp";

interface BuddyDay {
  readonly day: string;
  readonly firstMessageId: string;
  readonly preview: string;
  readonly messages: number;
}

/**
 * Upstream's thread details (editor, project scripts, branch) where the chat renders them; Buddy's
 * surface has none, since Buddy's thread is a conversation, not work in a checkout.
 */
export function BuddyThreadDetailsPanel(props: ThreadDetailsPanelProps) {
  return useBuddySurfaceMode() === true ? null : <ThreadDetailsPanel {...props} />;
}

/** The surface's language: the host page's when framed, else the browser's. */
function useCzech(buddy: boolean): boolean {
  const { context } = useBuddyFrame(buddy);
  return context === null ? prefersCzech() : context.lang === "cs";
}

const TEXT = {
  cs: {
    fullscreen: "Na celou obrazovku",
    panel: "Zmenšit do panelu",
    close: "Zavřít",
    days: "Dny",
    today: "Dnes",
    yesterday: "Včera",
    opening: "Otevírám Buddyho…",
    notReady: "Buddy se teprve instaluje.",
    failed: "Buddyho se nepodařilo otevřít.",
    retry: "Zkusit znovu",
    removePage: "Neposílat stránku",
    working: "Buddy na tom pracuje…",
    turnFailed: "Tohle se Buddymu nepovedlo dokončit. Zkuste to prosím znovu.",
    somethingFailed: "Něco se nepovedlo. Zkuste to prosím znovu.",
    placeholder: "Napište Buddymu…",
    speed: "Rychlost",
    normal: "Normální",
    fast: "Rychlý",
  },
  en: {
    fullscreen: "Full screen",
    panel: "Back to the panel",
    close: "Close",
    days: "Days",
    today: "Today",
    yesterday: "Yesterday",
    opening: "Opening Buddy…",
    notReady: "Buddy is still being set up.",
    failed: "Buddy could not be opened.",
    retry: "Try again",
    removePage: "Don't send the page",
    working: "Buddy is on it…",
    turnFailed: "Buddy couldn't finish this. Please try again.",
    somethingFailed: "Something went wrong. Please try again.",
    placeholder: "Message Buddy…",
    speed: "Speed",
    normal: "Normal",
    fast: "Fast",
  },
} as const;

const NO_REMOVED_PAGES: ReadonlySet<string> = new Set();

/**
 * The page the next message in Buddy's composer carries: the last valid page context of the host,
 * unless the person removed that page's chip, which stays removed while the surface is open.
 * Another page shows its own chip. None outside Buddy's T3 Code or in a thread of another
 * Environment than Buddy's.
 */
export function useBuddyPage(environmentId: string) {
  const buddy = useBuddySurfaceMode(environmentId) === true;
  const { context } = useBuddyFrame(buddy);
  const text = useCzech(buddy) ? TEXT.cs : TEXT.en;
  const [removed, setRemoved] = useState<ReadonlySet<string>>(NO_REMOVED_PAGES);
  const page = context === null ? null : pageRecordOf(context);
  const record = page !== null && !removed.has(page.contextId) ? page : null;
  return {
    record,
    removeLabel: text.removePage,
    remove: () => {
      if (page !== null) setRemoved((current) => new Set([...current, page.contextId]));
    },
  };
}

const localDayOf = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** A day as the pane and the date lines name it: today, yesterday, else its date. */
function dayLabel(day: string, czech: boolean, now = new Date()): string {
  const text = czech ? TEXT.cs : TEXT.en;
  if (day === localDayOf(now)) return text.today;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day === localDayOf(yesterday)) return text.yesterday;
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(czech ? "cs-CZ" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1));
}

let requestedMessageId: string | null = null;
const jumpListeners = new Set<() => void>();
/** Ask Buddy's timeline to bring a message into view; null takes back a request. */
export const requestJump = (messageId: string | null) => {
  requestedMessageId = messageId;
  for (const listener of jumpListeners) listener();
};
const subscribeJump = (listener: () => void) => {
  jumpListeners.add(listener);
  return () => jumpListeners.delete(listener);
};

const subscribeNothing = () => () => {};
const noTarget = () => null;

/**
 * Inside the timeline: brings the message a day pane asked for into view, loading earlier history
 * through it first when it is not loaded yet. Like the timeline's minimap, it first turns off
 * following the conversation's end, which would pin the list back to the bottom.
 */
export function useBuddyDayJump(input: {
  readonly buddy: boolean;
  readonly rows: ReadonlyArray<{
    readonly kind: string;
    readonly id: string;
    readonly message?: { readonly id: string };
  }>;
  readonly listRef: RefObject<LegendListRef | null>;
  readonly onManualNavigation: () => void;
  readonly history?:
    | {
        readonly hasMoreHistory: boolean;
        readonly loading: boolean;
        readonly onLoadEarlier: (throughEntryId?: string) => void;
      }
    | undefined;
}) {
  // Another timeline, of another Environment or outside Buddy's T3 Code, never takes the jump.
  const target = useSyncExternalStore(
    input.buddy ? subscribeJump : subscribeNothing,
    input.buddy ? () => requestedMessageId : noTarget,
    noTarget,
  );
  const { rows, listRef, onManualNavigation, history } = input;
  useEffect(() => {
    if (target === null) return;
    onManualNavigation();
    const index = rows.findIndex((row) => row.kind === "message" && row.message?.id === target);
    if (index >= 0) {
      void listRef.current?.scrollToIndex({
        index,
        animated: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        viewOffset: 24,
      });
      requestJump(null);
      return;
    }
    if (history?.hasMoreHistory && !history.loading) history.onLoadEarlier(target);
    else if (!history?.hasMoreHistory) requestJump(null);
  }, [history, listRef, onManualNavigation, rows, target]);
}

const NO_DAY_LINES: ReadonlyMap<string, string> = new Map();

/** The id of each user message that opens a local day, with the day's label; none outside Buddy. */
export function useBuddyDayLines(
  rows: ReadonlyArray<{
    readonly kind: string;
    readonly id: string;
    readonly message?: { readonly role: string; readonly createdAt: string };
  }>,
  buddy: boolean,
): ReadonlyMap<string, string> {
  const czech = useCzech(buddy);
  if (!buddy) return NO_DAY_LINES;
  const lines = new Map<string, string>();
  let previous: string | null = null;
  for (const row of rows) {
    if (row.kind !== "message" || row.message?.role !== "user") continue;
    const day = localDayOf(new Date(row.message.createdAt));
    if (day !== previous) lines.set(row.id, dayLabel(day, czech));
    previous = day;
  }
  return lines;
}

export function BuddyDayLine({ label }: { readonly label: string }) {
  return (
    <div className="my-3 flex items-center gap-3 text-muted-foreground text-xs" role="separator">
      <span className="h-px flex-1 bg-border" />
      <span className="first-letter:uppercase">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * The timeline's rows: in Buddy's surface, Buddy's conversation (buddySurfaceTimeline.ts), with the
 * quiet row while Buddy works; elsewhere, T3's rows as they are.
 */
export const buddySurfaceRows = (
  rows: MessagesTimelineRow[],
  buddy: boolean,
  working: boolean,
): MessagesTimelineRow[] => (buddy ? buddyConversationRows(rows, working) : rows);

/** Static text without a timer: nothing on the row repaints while Buddy works. */
function BuddyWorkingRow() {
  const text = useCzech(true) ? TEXT.cs : TEXT.en;
  return (
    <div className="pb-4" data-timeline-row-id={BUDDY_WORKING_ROW.id}>
      <p className="px-1 text-muted-foreground text-sm" role="status">
        {text.working}
      </p>
    </div>
  );
}

function BuddyFailedRow({ id }: { readonly id: string }) {
  const text = useCzech(true) ? TEXT.cs : TEXT.en;
  return (
    <div className="pb-4" data-timeline-row-id={id}>
      <p className="flex items-center gap-2 px-1 text-sm">
        <CircleAlert aria-hidden className="size-4 shrink-0 text-destructive" />
        {text.turnFailed}
      </p>
    </div>
  );
}

/**
 * The thread's error above the conversation: in Buddy's surface it says in human words that
 * something went wrong, never T3's or the provider's own message ("Provider turn failed.", or
 * T3's ChatGPT usage limit, which an error code selects).
 */
export function BuddyThreadErrorBanner(props: ComponentProps<typeof ThreadErrorBanner>) {
  const buddy = useBuddySurfaceMode() === true;
  const text = useCzech(buddy) ? TEXT.cs : TEXT.en;
  return buddy && props.error !== null ? (
    <ThreadErrorBanner {...props} error={text.somethingFailed} errorCode={null} />
  ) : (
    <ThreadErrorBanner {...props} />
  );
}

/** Buddy's own presentation of a row in Buddy's surface; null where T3 draws the row. */
export function buddyRowContent(row: MessagesTimelineRow, buddy: boolean): ReactNode {
  if (!buddy) return null;
  if (row.id === BUDDY_WORKING_ROW.id) return <BuddyWorkingRow />;
  return buddyFailureOf(row) === null ? null : <BuddyFailedRow id={row.id} />;
}

/**
 * Buddy's composer: the message box asks for a message to Buddy, and its controls are Buddy's
 * (BuddyComposerControls) in place of T3's, so the strip under the resting composer has something
 * to hold only while Hermes offers its speed. As T3's elsewhere.
 */
export function useBuddyComposer(environmentId: string, selection: BuddyComposerSelection) {
  const buddy = useBuddySurfaceMode(environmentId) === true;
  const text = useCzech(buddy) ? TEXT.cs : TEXT.en;
  return {
    placeholder: buddy ? text.placeholder : null,
    hasControls: !buddy || buddySpeedOption(selection) !== null,
  };
}

/**
 * The controls of Buddy's composer in place of T3's model, options, access and mode: Hermes's speed,
 * Normal or Fast, where Hermes offers it, and nothing else (buddySurfaceControls.ts). A pick is the
 * composer's option for Hermes's model, as T3's options are, so the next message carries it.
 */
export function BuddyComposerControls(
  props: Pick<
    ComponentProps<typeof ComposerControlsBar>,
    | "routeKind"
    | "routeThreadRef"
    | "draftId"
    | "selectedProvider"
    | "selectedInstanceId"
    | "selectedModel"
    | "selectedProviderModels"
    | "composerModelOptions"
    | "reportedModelSelection"
  >,
) {
  const text = useCzech(true) ? TEXT.cs : TEXT.en;
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  const modelOptions = props.composerModelOptions?.[props.selectedInstanceId] ?? [];
  const option = buddySpeedOption({
    provider: props.selectedProvider,
    model: props.selectedModel,
    models: props.selectedProviderModels,
    modelOptions,
  });
  if (option === null) return null;
  const speed = buddySpeedOf(
    option,
    { instanceId: props.selectedInstanceId, model: props.selectedModel, options: modelOptions },
    props.reportedModelSelection,
  );
  const target = props.routeKind === "server" ? props.routeThreadRef : props.draftId;
  return (
    <div className="shrink-0">
      <ToggleGroup
        aria-label={text.speed}
        value={speed === null ? [] : [speed]}
        onValueChange={(value) => {
          const next = value[0];
          if (!isBuddySpeed(next) || next === speed || target === null) return;
          setProviderModelOptions(target, props.selectedProvider, buddySpeedSelection(next), {
            instanceId: props.selectedInstanceId,
            model: props.selectedModel,
            persistSticky: true,
          });
        }}
      >
        <Toggle value="normal">{text.normal}</Toggle>
        <Toggle value="fast">{text.fast}</Toggle>
      </ToggleGroup>
    </div>
  );
}

/**
 * The runtime mode of the chat's next turn: in Buddy's surface full access, whatever a draft or the
 * thread holds, since Buddy always works with full access (root decision 0210, addendum of
 * HumanAndMachines/Lazurio#648). So the web never asks Buddy's thread for less, and a lower mode the thread holds goes
 * back to full access with the next message. As T3's elsewhere.
 */
export const buddyRuntimeMode = (buddy: boolean, mode: RuntimeMode): RuntimeMode =>
  buddy ? "full-access" : mode;

type TerminalUiState = ReturnType<typeof selectThreadTerminalUiState>;

/**
 * The thread's terminal drawer as the chat reads it: in Buddy's surface closed and empty, whatever
 * the thread holds (a drawer opened on it earlier, in T3 or by an action), since the surface has no
 * terminal (root decision 0210, addendum of HumanAndMachines/Lazurio#648). So no drawer opens there
 * and the composer keeps its focus as without one. The stored state and the terminals' shells stay
 * as they are. As T3's elsewhere.
 */
export const buddyTerminalUiState = (buddy: boolean, state: TerminalUiState): TerminalUiState =>
  buddy ? selectThreadTerminalUiState({}, null) : state;

/** The chat's shortcuts, without those Buddy's surface has no use for there. */
export function useBuddyChatShortcuts(buddy: boolean, input: ChatShortcutsInput) {
  useChatShortcuts(buddy ? withoutUnusedShortcuts(input) : input);
}

const NO_BANNERS: ReadonlyArray<never> = [];

/**
 * What T3 shows of the turn's work above the composer: work that still runs after the turn (a
 * command, a subagent or a watch, with its title, its links and Stop), a provider goal and a child
 * thread's question. None of it in Buddy's surface, where work that still runs is the timeline's
 * quiet line instead (MessagesTimeline's `buddyBackgroundWork`). As T3's elsewhere.
 */
export function buddyWorkBanners<Banner>(
  buddy: boolean,
  banners: ReadonlyArray<Banner>,
): ReadonlyArray<Banner> {
  return buddy ? NO_BANNERS : banners;
}

/**
 * The right panel's tabs the chat shows: in Buddy's surface none of the thread's terminals, which
 * the panel may hold from before (buddySurfaceControls.ts). As T3's elsewhere.
 */
export const buddyPanelSurfaces = (buddy: boolean, panel: PanelSurfaces): PanelSurfaces =>
  buddy ? withoutTerminalSurfaces(panel) : panel;

/**
 * The queued messages Buddy's composer shows to edit, steer or remove: the person's own. A message
 * an agent queued for Buddy, such as Delegace's wake, is not the person's words; once it runs, the
 * thread shows it as row 27 decides. As T3's elsewhere.
 */
export function useBuddyQueuedRuns<Queued extends { readonly messageId: string }>(
  environmentId: string,
  queued: ReadonlyArray<Queued>,
  messages: ReadonlyArray<QueueMessage> | undefined,
): ReadonlyArray<Queued> {
  return useBuddySurfaceMode(environmentId) === true ? personsQueuedRuns(queued, messages) : queued;
}

function BuddyHeader() {
  const { framed, layout, requestLayout } = useBuddyFrame(true);
  const text = useCzech(true) ? TEXT.cs : TEXT.en;
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <img alt="" className="size-8 shrink-0 rounded-full bg-muted object-contain" src={AVATAR} />
      <span className="min-w-0 flex-1 truncate font-medium text-sm">Buddy</span>
      {framed ? (
        <>
          <Button
            aria-label={layout === "fullscreen" ? text.panel : text.fullscreen}
            onClick={() => requestLayout(layout === "fullscreen" ? "panel" : "fullscreen")}
            size="icon-sm"
            title={layout === "fullscreen" ? text.panel : text.fullscreen}
            variant="ghost"
          >
            {layout === "fullscreen" ? <Minimize2 /> : <Maximize2 />}
          </Button>
          <Button
            aria-label={text.close}
            onClick={() => requestLayout("closed")}
            size="icon-sm"
            title={text.close}
            variant="ghost"
          >
            <X />
          </Button>
        </>
      ) : null}
    </header>
  );
}

const NO_DAYS: ReadonlyArray<BuddyDay> = [];
let days = NO_DAYS;
const dayListeners = new Set<() => void>();
let dayTimer: number | null = null;

async function readDays() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const response = await fetch(`${BUDDY_DAYS_ROUTE}?tz=${encodeURIComponent(zone)}`, {
    credentials: "same-origin",
  }).catch(() => null);
  if (!response?.ok) return;
  const body = (await response.json().catch(() => null)) as {
    days?: ReadonlyArray<BuddyDay>;
  } | null;
  days = body?.days ?? NO_DAYS;
  for (const listener of dayListeners) listener();
}

const readDaysWhenSeen = () => {
  if (document.visibilityState === "visible") void readDays();
};

/** The days, read while a pane shows them: on open, and every minute and on return while seen. */
function subscribeDays(listener: () => void) {
  dayListeners.add(listener);
  if (dayListeners.size === 1) {
    void readDays();
    dayTimer = window.setInterval(readDaysWhenSeen, 60_000);
    document.addEventListener("visibilitychange", readDaysWhenSeen);
  }
  return () => {
    dayListeners.delete(listener);
    if (dayListeners.size > 0) return;
    if (dayTimer !== null) window.clearInterval(dayTimer);
    dayTimer = null;
    document.removeEventListener("visibilitychange", readDaysWhenSeen);
  };
}

function BuddyDayPane() {
  const czech = useCzech(true);
  const shown = useSyncExternalStore(
    subscribeDays,
    () => days,
    () => NO_DAYS,
  );
  const text = czech ? TEXT.cs : TEXT.en;
  return (
    <nav aria-label={text.days} className="flex w-56 shrink-0 flex-col overflow-y-auto border-r">
      <h2 className="px-3 pt-3 pb-1 font-medium text-muted-foreground text-xs">{text.days}</h2>
      <ul className="flex flex-col gap-0.5 px-1.5 pb-3">
        {shown.map((day) => (
          <li key={day.day}>
            <button
              className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => requestJump(day.firstMessageId)}
              type="button"
            >
              <span className="text-sm first-letter:uppercase">{dayLabel(day.day, czech)}</span>
              <span className="w-full truncate text-muted-foreground text-xs">{day.preview}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * In the bubble the surface wears the host page's appearance, light or dark, from the first context
 * and whenever the host sends another, so Buddy looks like the page around him. It asks T3 to wear
 * it through T3's own appearance preference, which every part of the app reads, and judges by what
 * T3 then resolves, not by the preference being stored. Where T3 cannot wear it (the frame's storage
 * is blocked, or the saved theme has no such appearance, so T3 keeps the theme's own), the document
 * wears T3's standard palette in the host's appearance until T3 can again; there T3's renderers that
 * read the preference (code blocks, the terminal) keep T3's appearance.
 */
function useHostTheme() {
  const { context } = useBuddyFrame(true);
  const host = context?.theme ?? null;
  const { resolvedTheme, appearanceMode, setAppearanceMode, refreshTheme } = useTheme();
  const standIn = useRef(false);
  useEffect(() => {
    if (host === null) return;
    if (resolvedTheme === host) {
      // T3 wears the host's appearance itself: it takes the document back.
      if (standIn.current) refreshTheme();
      standIn.current = false;
      return;
    }
    // The effect runs again with what T3 resolves once the preference is stored.
    if (appearanceMode !== host && setAppearanceMode(host)) return;
    standIn.current = true;
    // "system" is T3's default theme, whose palette has both appearances.
    applyThemePalette("system", host);
    document.documentElement.classList.toggle("dark", host === "dark");
    syncBrowserChromeTheme();
  }, [host, resolvedTheme, appearanceMode, setAppearanceMode, refreshTheme]);
}

/**
 * The app around Buddy's thread, in place of T3's sidebar and command palette. The day pane is
 * there only where the window has room for it beside the conversation, as in full screen.
 */
export function BuddySurfaceLayout({ children }: { readonly children: ReactNode }) {
  useHostTheme();
  const roomForDays = useMediaQuery("sm");
  return (
    <div className="flex h-dvh w-full min-w-0 flex-col bg-background" data-lazurio-buddy-surface>
      <BuddyHeader />
      <div className="flex min-h-0 flex-1">
        {roomForDays ? <BuddyDayPane /> : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}

type Opening = { readonly attempt: number; readonly outcome: "not-ready" | "failed" };

/** Asks the server for Buddy's thread: its id, or why there is none. */
async function openBuddyThread(): Promise<string | "not-ready" | "failed"> {
  const response = await fetch(BUDDY_THREAD_ROUTE, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: "{}",
  }).catch(() => null);
  const body = (await response?.json().catch(() => null)) as {
    threadId?: string;
    error?: string;
  } | null;
  if (response?.ok && typeof body?.threadId === "string") return body.threadId;
  return body?.error === "no-project" ? "not-ready" : "failed";
}

/** `/` in Buddy's T3 Code: Buddy's thread, found or made by the server. */
export function BuddySurfaceIndex() {
  const environmentId = usePrimaryEnvironmentId();
  const navigate = useNavigate();
  const text = useCzech(true) ? TEXT.cs : TEXT.en;
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<Opening | null>(null);
  useEffect(() => {
    if (environmentId === null) return;
    let current = true;
    void openBuddyThread().then((outcome) => {
      if (!current) return;
      if (outcome === "not-ready" || outcome === "failed") setFailure({ attempt, outcome });
      else
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId: outcome },
          replace: true,
        });
    });
    return () => {
      current = false;
    };
  }, [attempt, environmentId, navigate]);
  const outcome = failure?.attempt === attempt ? failure.outcome : "opening";
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm">
      {outcome === "opening" ? (
        <>
          <Spinner />
          <p className="text-muted-foreground">{text.opening}</p>
        </>
      ) : (
        <>
          <p>{outcome === "not-ready" ? text.notReady : text.failed}</p>
          <Button onClick={() => setAttempt((current) => current + 1)} variant="ghost">
            {text.retry}
          </Button>
        </>
      )}
    </div>
  );
}
