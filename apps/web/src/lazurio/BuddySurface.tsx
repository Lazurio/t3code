/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): in Buddy's T3 Code (`lazurioBuddy` in the
 * server config) the web client is Buddy's one conversation: no thread list, new thread, fork or
 * rollback, Buddy's header and the bubble's window buttons, a day pane and day lines. The server
 * holds the one conversation (buddySurfaceGuards.ts); this only leaves out what it would refuse.
 */
import type { LegendListRef } from "@legendapp/list/react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { Maximize2, Minimize2, X } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useState, useSyncExternalStore } from "react";

import {
  ThreadDetailsPanel,
  type ThreadDetailsPanelProps,
} from "~/components/chat/ThreadDetailsPanel";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { primaryServerConfigAtom } from "~/state/server";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { pageRecordOf } from "./buddySurfacePage";
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

/** Buddy's T3 Code, read outside React when a command runs: false until the config is known. */
export const isBuddySurfaceNow = (): boolean =>
  appAtomRegistry.get(primaryServerConfigAtom)?.lazurioBuddy === true;

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
  return useBuddySurfaceMode(props.environmentId) === true ? null : (
    <ThreadDetailsPanel {...props} />
  );
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
  // oxlint-disable-next-line t3code/react-effect-budget -- scrolls the list, outside React, once the requested day's row is loaded
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
 * The app around Buddy's thread, in place of T3's sidebar and command palette. The day pane is
 * there only where the window has room for it beside the conversation, as in full screen.
 */
export function BuddySurfaceLayout({ children }: { readonly children: ReactNode }) {
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

let buddyThreadId: string | null = null;
const buddyThreadListeners = new Set<() => void>();
const subscribeBuddyThread = (listener: () => void) => {
  buddyThreadListeners.add(listener);
  return () => buddyThreadListeners.delete(listener);
};

/**
 * Whether a thread route leads to Buddy's thread instead (BuddySurfaceIndex, as `/` does): in
 * Buddy's T3 Code every thread of its Environment but the one the server named Buddy's. A thread of
 * another Environment stays T3's.
 */
export function useLeadsToBuddysThread(
  threadRef: { readonly environmentId: string; readonly threadId: string } | null,
): boolean {
  const buddy = useBuddySurfaceMode(threadRef?.environmentId) === true;
  const known = useSyncExternalStore(subscribeBuddyThread, () => buddyThreadId, noTarget);
  return threadRef !== null && buddy && threadRef.threadId !== known;
}

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

/** `/` and every other thread in Buddy's T3 Code: Buddy's thread, found or made by the server. */
export function BuddySurfaceIndex() {
  const environmentId = usePrimaryEnvironmentId();
  const navigate = useNavigate();
  const text = useCzech(true) ? TEXT.cs : TEXT.en;
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<Opening | null>(null);
  // oxlint-disable-next-line t3code/react-effect-budget -- asks the server for Buddy's thread when the surface opens or retries
  useEffect(() => {
    if (environmentId === null) return;
    let current = true;
    void openBuddyThread().then((outcome) => {
      if (!current) return;
      if (outcome === "not-ready" || outcome === "failed") {
        setFailure({ attempt, outcome });
        return;
      }
      buddyThreadId = outcome;
      for (const listener of buddyThreadListeners) listener();
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
