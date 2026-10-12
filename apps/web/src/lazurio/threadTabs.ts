/**
 * Lazurio overlay (plan DEV-6646, task 501; LazurioPlatform decision F47): a thread's tabs of the
 * Environment browser in the right panel, from the server's list.
 *
 * The server keeps each thread's tabs in its holder file and streams the thread's list
 * (`/api/lazurio/thread-tabs/events`, apps/server/src/lazurio/threadTabsRoute.ts). Every device
 * reconciles its strip to that list: the same tabs everywhere, new ones appended in the list's
 * order, and where a device already shows a tab stays its own choice (it may drag it). A person
 * holds a tab by a page's new tab or by a link in the chat (POST hold), and lets go of it with ×
 * (POST release, with Vrátit for a while). An agent's tab reaches
 * the strip from the server, which also asks to reveal it; the panel then opens on it.
 *
 * This module is the pure part (the reconciliation, the reveals, the words) and the client state
 * (the last snapshot per thread, the pending holds, the titles the frames report); the hooks, the
 * frames and the strip's title, icon and tooltip are in LazurioEnvironmentBrowser.tsx.
 */

import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import {
  type RightPanelSurface,
  selectThreadRightPanelState,
  type ThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";
import { environmentBrowserLink, foreignEnvironmentBrowserTab } from "./environmentBrowser";

export const THREAD_TABS_ROUTE = "/api/lazurio/thread-tabs";

export interface TabHolder {
  readonly strip: string;
  readonly label: string;
}

export interface ThreadTab {
  readonly tabId: string;
  readonly view: string;
  readonly agent: boolean;
  readonly alsoHeldBy: ReadonlyArray<TabHolder>;
  readonly revealRequest?: { readonly id: string };
}

export interface ThreadTabsSnapshot {
  readonly available: true;
  readonly epoch: string;
  readonly revision: number;
  readonly threadId: string;
  readonly strip: string;
  readonly viewOrigin: string;
  readonly tabs: ReadonlyArray<ThreadTab>;
}

export type ThreadTabsAnswer = { readonly available: false } | ThreadTabsSnapshot;

export interface ForeignTab {
  readonly tabId: string;
  readonly view: string;
  readonly revealRequest?: { readonly id: string };
}

export type EnvironmentBrowserSurface = Extract<RightPanelSurface, { kind: "environment-browser" }>;

const TARGET_ID = /^[0-9A-F]{32}$/;
const TAB_SURFACE = /^environment-browser:([0-9A-F]{32})$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const originOf = (address: string) => {
  try {
    return new URL(address).origin;
  } catch {
    return null;
  }
};

/** The panel surface of this Environment's remote tab: its id only, the address is the server's. */
export const tabSurfaceId = (tabId: string) =>
  `environment-browser:${tabId.toUpperCase()}` as const;

/** The remote tab of a surface of this Environment, or null for any other surface. */
export function tabIdOfSurface(surface: RightPanelSurface): string | null {
  if (surface.kind !== "environment-browser" || "view" in surface) return null;
  return TAB_SURFACE.exec(surface.id)?.[1] ?? null;
}

/** The server's answer, read field by field; null for anything that is not one. */
export function parseThreadTabsAnswer(value: unknown): ThreadTabsAnswer | null {
  if (!isRecord(value)) return null;
  if (value.available === false) return { available: false };
  const { epoch, revision, threadId, strip, viewOrigin, tabs } = value;
  if (
    value.available !== true ||
    typeof epoch !== "string" ||
    typeof revision !== "number" ||
    typeof threadId !== "string" ||
    typeof strip !== "string" ||
    typeof viewOrigin !== "string" ||
    originOf(viewOrigin) !== viewOrigin ||
    !viewOrigin.startsWith("https://") ||
    !Array.isArray(tabs)
  ) {
    return null;
  }
  const parsed: ThreadTab[] = [];
  for (const tab of tabs) {
    if (!isRecord(tab) || typeof tab.tabId !== "string" || !TARGET_ID.test(tab.tabId)) return null;
    const holders = Array.isArray(tab.alsoHeldBy) ? tab.alsoHeldBy : [];
    const reveal = isRecord(tab.revealRequest) ? tab.revealRequest.id : undefined;
    parsed.push({
      tabId: tab.tabId,
      view: `${viewOrigin}/t/${tab.tabId}`,
      agent: tab.agent === true,
      alsoHeldBy: holders.flatMap((holder) =>
        isRecord(holder) && typeof holder.strip === "string" && typeof holder.label === "string"
          ? [{ strip: holder.strip, label: holder.label }]
          : [],
      ),
      ...(typeof reveal === "string" ? { revealRequest: { id: reveal } } : {}),
    });
  }
  return { available: true, epoch, revision, threadId, strip, viewOrigin, tabs: parsed };
}

/** Another Environment's tab the server announced, or null. */
export function parseForeignTab(value: unknown): ForeignTab | null {
  if (!isRecord(value) || typeof value.tabId !== "string" || typeof value.view !== "string") {
    return null;
  }
  const reveal = isRecord(value.revealRequest) ? value.revealRequest.id : undefined;
  return {
    tabId: value.tabId,
    view: value.view,
    ...(typeof reveal === "string" ? { revealRequest: { id: reveal } } : {}),
  };
}

/**
 * The strip after the server's list: every surface of another kind stays, so do another
 * Environment's tabs (each device's own) and this Environment's tabs that the list or
 * `kept` (pending holds, tabs the device keeps itself) has. Every other Environment browser
 * surface goes, lazurio.7's included (its own tab and its new tabs at the view's bare origin).
 * Listed tabs without a surface are added at the end, in the list's order, without opening a
 * closed panel. An active surface that went falls back as upstream's reconciliation does.
 */
export function reconcileThreadTabs(
  current: ThreadRightPanelState,
  input: {
    readonly listed: readonly string[];
    readonly kept: ReadonlySet<string>;
    readonly viewOrigin: string;
  },
): ThreadRightPanelState {
  const listed = input.listed.map((tabId) => tabId.toUpperCase());
  const stays = new Set([...listed, ...input.kept]);
  const surfaces = current.surfaces.filter((surface) => {
    if (surface.kind !== "environment-browser") return true;
    if ("view" in surface && surface.view !== undefined) {
      return originOf(surface.view) !== input.viewOrigin;
    }
    const tabId = tabIdOfSurface(surface);
    return tabId !== null && stays.has(tabId);
  });
  const known = new Set(surfaces.map((surface) => surface.id));
  const added = listed
    .filter((tabId) => !known.has(tabSurfaceId(tabId)))
    .map((tabId): EnvironmentBrowserSurface => ({
      id: tabSurfaceId(tabId),
      kind: "environment-browser",
    }));
  if (added.length === 0 && surfaces.length === current.surfaces.length) return current;
  const next = [...surfaces, ...added];
  const activeStillExists = next.some((surface) => surface.id === current.activeSurfaceId);
  return {
    ...current,
    surfaces: next,
    activeSurfaceId: activeStillExists
      ? current.activeSurfaceId
      : current.activeSurfaceId === null
        ? null
        : (next.find((surface) => surface.kind === "environment-browser")?.id ??
          next[0]?.id ??
          null),
  };
}

/** What the panel has seen of the server's reveal requests, per run of the server (`epoch`). */
export interface RevealBaseline {
  readonly epoch: string;
  readonly seen: ReadonlyMap<string, string>;
}

/**
 * The tabs whose reveal request is new since `baseline`, and the next baseline. The first snapshot
 * after the thread comes into view, or after the server restarted (another epoch), only marks every
 * request as seen, as upstream's own reveal does: a reload never reopens what the person closed.
 */
export function freshReveals(
  baseline: RevealBaseline | null,
  snapshot: ThreadTabsSnapshot,
): { readonly reveal: readonly string[]; readonly baseline: RevealBaseline } {
  const seen = new Map<string, string>();
  for (const tab of snapshot.tabs) {
    if (tab.revealRequest !== undefined) seen.set(tab.tabId, tab.revealRequest.id);
  }
  const next = { epoch: snapshot.epoch, seen };
  if (baseline === null || baseline.epoch !== snapshot.epoch) return { reveal: [], baseline: next };
  const reveal = [...seen]
    .filter(([tabId, id]) => baseline.seen.get(tabId) !== id)
    .map(([tabId]) => tabId);
  return { reveal, baseline: next };
}

/** The overlay's words are Czech where the person's browser is, as in the Environment's view. */
export const prefersCzech = () => navigator.language.toLowerCase().startsWith("cs");

/** Where else a tab is: "v Apps", "ve vlákně „…“" or another strip's label, joined. */
export function placesOf(holders: ReadonlyArray<TabHolder>, czech: boolean): string {
  const places = holders.map((holder) =>
    holder.strip === "launchpad"
      ? czech
        ? "v Apps"
        : "in Apps"
      : holder.strip.startsWith("t3-")
        ? czech
          ? `ve vlákně „${holder.label}“`
          : `in the thread “${holder.label}”`
        : holder.label || holder.strip,
  );
  const last = places.at(-1) ?? "";
  if (places.length < 2) return last;
  return `${places.slice(0, -1).join(", ")} ${czech ? "a" : "and"} ${last}`;
}

/** The tab's tooltip: its title, an agent at work and where else it is (wireframe HostPanel). */
export function tabTooltip(title: string, tab: ThreadTab | undefined, czech: boolean): string {
  if (tab === undefined) return title;
  return [
    title,
    tab.agent ? (czech ? "pracuje tu agent" : "an agent works here") : "",
    tab.alsoHeldBy.length > 0
      ? `${czech ? "sdílená, je i" : "shared, also"} ${placesOf(tab.alsoHeldBy, czech)}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** What becomes of the tabs × let go of, said from the last snapshot (agent, alsoHeldBy). */
export function closeToastText(
  tabs: ReadonlyArray<ThreadTab | undefined>,
  czech: boolean,
): { readonly title: string; readonly description: string } {
  const stays = (tab: ThreadTab | undefined) =>
    tab !== undefined && (tab.agent || tab.alsoHeldBy.length > 0);
  if (tabs.length === 1) {
    const [tab] = tabs;
    return {
      title: czech ? "Záložka zmizela z tohoto vlákna." : "The tab left this thread.",
      description:
        tab?.agent === true
          ? czech
            ? "Pracuje v ní agent, takže zůstává otevřená."
            : "An agent works in it, so it stays open."
          : tab !== undefined && tab.alsoHeldBy.length > 0
            ? czech
              ? `Dál je ${placesOf(tab.alsoHeldBy, true)}.`
              : `It stays ${placesOf(tab.alsoHeldBy, false)}.`
            : czech
              ? "Zavře se v Environmentu."
              : "It closes in the Environment.",
    };
  }
  const staying = tabs.filter(stays).length;
  return {
    title: czech ? "Záložky zmizely z tohoto vlákna." : "The tabs left this thread.",
    description:
      staying === tabs.length
        ? czech
          ? "Zůstávají otevřené jinde nebo u agenta."
          : "They stay open elsewhere or with an agent."
        : staying === 0
          ? czech
            ? "Zavřou se v Environmentu."
            : "They close in the Environment."
          : czech
            ? "Některé zůstávají otevřené jinde nebo u agenta, ostatní se zavřou v Environmentu."
            : "Some stay open elsewhere or with an agent; the others close in the Environment.",
  };
}

/** The client's side of each thread's tabs: the last snapshot, and what the panel adds to it. */
interface ThreadTabsState {
  /** The last snapshot of each thread, by thread key: null while the server says unavailable. */
  readonly snapshots: Readonly<Record<string, ThreadTabsSnapshot | null>>;
  /** The titles the frames report, by surface id: a remote tab's title is the same everywhere. */
  readonly titles: Readonly<Record<string, string>>;
  /** The thread the chat shows. */
  readonly inView: ScopedThreadRef | null;
}

export const useThreadTabsStore = create<ThreadTabsState>(() => ({
  snapshots: {},
  titles: {},
  inView: null,
}));

export function rememberTitle(surfaceId: string, title: string | null): void {
  useThreadTabsStore.setState((state) => {
    if ((state.titles[surfaceId] ?? null) === title) return state;
    const { [surfaceId]: _previous, ...others } = state.titles;
    return { titles: title === null ? others : { ...others, [surfaceId]: title } };
  });
}

export const snapshotOf = (threadRef: ScopedThreadRef | null) =>
  threadRef === null
    ? undefined
    : useThreadTabsStore.getState().snapshots[scopedThreadKey(threadRef)];

/** Session-only state of a thread's holds on this device. */
export interface ThreadTabsSync {
  /** Tabs whose POST hold has not settled: the reconciliation keeps them meanwhile. */
  readonly pending: Set<string>;
  /** Tabs the server refused to keep (404, 409): the device keeps them itself. */
  readonly local: Set<string>;
  /** Tabs whose view said they ended: filtered until a list lacks them. */
  readonly ended: Set<string>;
  /** Tabs the person let go of with ×, still in the last list until the release lands. */
  readonly released: Set<string>;
  baseline: RevealBaseline | null;
  /** Whether the panel is inline beside the chat: only there may it open by itself. */
  inlinePanel: boolean;
  /** The thread's POSTs, one after another. */
  queue: Promise<unknown>;
  /** Each tab's newest intent, a hold or a release: an older one's retry and answer do nothing. */
  readonly intents: Map<string, number>;
  /** The intents given out so far: a number is never given twice. */
  intentCount: number;
  /** The newest snapshot the device took: its run of the server and its revision. */
  accepted: { readonly epoch: string; readonly revision: number } | null;
  /** Runs of the server the device saw replaced: their snapshots never come back. */
  readonly leftEpochs: Set<string>;
}

const syncs = new Map<string, ThreadTabsSync>();
export function syncOf(threadRef: ScopedThreadRef): ThreadTabsSync {
  const key = scopedThreadKey(threadRef);
  let sync = syncs.get(key);
  if (sync === undefined) {
    sync = {
      pending: new Set(),
      local: new Set(),
      ended: new Set(),
      released: new Set(),
      baseline: null,
      inlinePanel: false,
      queue: Promise.resolve(),
      intents: new Map(),
      intentCount: 0,
      accepted: null,
      leftEpochs: new Set(),
    };
    syncs.set(key, sync);
  }
  return sync;
}

/** Tests start from nothing. */
export function resetThreadTabs(): void {
  syncs.clear();
  useThreadTabsStore.setState({ snapshots: {}, titles: {}, inView: null });
}

export type PostOutcome =
  | { readonly ok: true; readonly answer: ThreadTabsAnswer }
  | { readonly ok: false; readonly retry: boolean; readonly status: number | null };

/** POST hold or release on this page's own origin; a network failure or a 5xx may be retried. */
export async function postThreadTab(
  action: "hold" | "release",
  threadId: string,
  tabId: string,
): Promise<PostOutcome> {
  try {
    const response = await window.fetch(`${THREAD_TABS_ROUTE}/${action}`, {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ threadId, tabId }),
    });
    if (response.status === 200) {
      const answer = parseThreadTabsAnswer(await response.json());
      return answer === null ? { ok: false, retry: true, status: 200 } : { ok: true, answer };
    }
    return { ok: false, retry: response.status >= 500, status: response.status };
  } catch {
    return { ok: false, retry: true, status: null };
  }
}

const enqueue = (sync: ThreadTabsSync, work: () => Promise<void>) => {
  sync.queue = sync.queue.then(work, work);
};
const setSnapshot = (key: string, snapshot: ThreadTabsSnapshot | null) =>
  useThreadTabsStore.setState((state) => ({ snapshots: { ...state.snapshots, [key]: snapshot } }));
const panelOf = (threadRef: ScopedThreadRef) =>
  selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef);
const hasSurface = (threadRef: ScopedThreadRef, surfaceId: string) =>
  panelOf(threadRef).surfaces.some((surface) => surface.id === surfaceId);

/** Adds a surface, in front with the panel open, or behind the surface in view. */
function withSurface(
  current: ThreadRightPanelState,
  surface: EnvironmentBrowserSurface,
  front: boolean,
): ThreadRightPanelState {
  const surfaces = current.surfaces.some((entry) => entry.id === surface.id)
    ? current.surfaces
    : [...current.surfaces, surface];
  return front
    ? { ...current, isOpen: true, surfaces, activeSurfaceId: surface.id }
    : {
        ...current,
        surfaces,
        activeSurfaceId: current.activeSurfaceId ?? (current.isOpen ? null : surface.id),
      };
}

/** Removes a surface the way upstream closes one: the neighbour comes to the front. */
function withoutSurface(current: ThreadRightPanelState, surfaceId: string): ThreadRightPanelState {
  const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
  if (index < 0) return current;
  const surfaces = current.surfaces.filter((surface) => surface.id !== surfaceId);
  if (current.activeSurfaceId !== surfaceId) return { ...current, surfaces };
  return {
    ...current,
    surfaces,
    activeSurfaceId: surfaces[Math.min(index, surfaces.length - 1)]?.id ?? null,
  };
}

/**
 * Whether the device takes `snapshot`: one not older than the newest it took of this run of the
 * server (an equal revision is the same snapshot), or of a run that replaced it (a restart is
 * another epoch, whose revisions start again). So a delayed POST answer never undoes a newer list
 * from the stream, and a run the device saw replaced never comes back.
 */
function takes(sync: ThreadTabsSync, snapshot: ThreadTabsSnapshot): boolean {
  const last = sync.accepted;
  if (last !== null && last.epoch === snapshot.epoch) {
    if (snapshot.revision < last.revision) return false;
  } else if (sync.leftEpochs.has(snapshot.epoch)) {
    return false;
  } else if (last !== null) {
    sync.leftEpochs.add(last.epoch);
  }
  sync.accepted = { epoch: snapshot.epoch, revision: snapshot.revision };
  return true;
}

/**
 * The thread's snapshot arrived (the stream, or a POST's answer): the strip follows the newest
 * list the device took, and a reveal request new since the baseline opens the inline panel on its
 * tab, unless the person made a choice in the panel since the snapshot came (an automatic opening,
 * `openProactive`). An older snapshot is not taken, but the strip follows the newest list again:
 * a hold whose answer it is no longer keeps its tab. A snapshot that says unavailable leaves the
 * strip as it is.
 */
export function receiveSnapshot(threadRef: ScopedThreadRef, answer: ThreadTabsAnswer): void {
  const revision = useRightPanelStore.getState().getUserActionRevision(threadRef);
  const key = scopedThreadKey(threadRef);
  if (!answer.available) {
    setSnapshot(key, null);
    return;
  }
  const sync = syncOf(threadRef);
  const fresh = takes(sync, answer);
  const latest = fresh ? answer : snapshotOf(threadRef);
  if (latest === undefined || latest === null) return;
  const listed = latest.tabs.map((tab) => tab.tabId);
  if (fresh) {
    const inList = new Set(listed);
    for (const tabId of sync.ended) if (!inList.has(tabId)) sync.ended.delete(tabId);
    setSnapshot(key, latest);
  }
  const hidden = (tabId: string) => sync.ended.has(tabId) || sync.released.has(tabId);
  useRightPanelStore.getState().lazurio(threadRef, true, (current) =>
    reconcileThreadTabs(current, {
      listed: listed.filter((tabId) => !hidden(tabId)),
      kept: new Set([...sync.pending, ...sync.local]),
      viewOrigin: latest.viewOrigin,
    }),
  );
  if (!fresh) return;
  const { reveal, baseline } = freshReveals(sync.baseline, latest);
  sync.baseline = baseline;
  if (!sync.inlinePanel) return;
  for (const tabId of reveal) {
    if (hidden(tabId)) continue;
    useRightPanelStore
      .getState()
      .openProactive(threadRef, { id: tabSurfaceId(tabId), kind: "environment-browser" }, revision);
  }
}

/** The thread's view of the panel comes anew: the next snapshot is a baseline of reveals. */
export function enterThreadTabs(threadRef: ScopedThreadRef): void {
  syncOf(threadRef).baseline = null;
  useThreadTabsStore.setState({ inView: threadRef });
}

export function leaveThreadTabs(threadRef: ScopedThreadRef): void {
  const inView = useThreadTabsStore.getState().inView;
  if (inView !== null && scopedThreadKey(inView) === scopedThreadKey(threadRef)) {
    useThreadTabsStore.setState({ inView: null });
  }
}

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

/** A new intent for `tab`, a hold or a release: from now on every older one's retry and answer do
 * nothing, so × and Vrátit always win over what they replace. */
function intend(sync: ThreadTabsSync, tab: string): () => boolean {
  const intent = ++sync.intentCount;
  sync.intents.set(tab, intent);
  return () => sync.intents.get(tab) === intent;
}

/**
 * The thread holds `tabId` (a page's new tab, a link, Vrátit). Until the
 * POST answers, the tab is pending and the strip keeps it. A network failure or a 5xx is retried
 * with a growing pause while the tab is in the strip; a refusal (the thread is gone, or has as many
 * tabs as it may) leaves it as the device's own, which ends 30 s after its last viewer (F39).
 * A later × of the tab replaces the hold: a retry still waiting does not go, and an answer still
 * under way changes nothing.
 */
export function holdTab(threadRef: ScopedThreadRef, tabId: string): void {
  const sync = syncOf(threadRef);
  const tab = tabId.toUpperCase();
  const current = intend(sync, tab);
  sync.pending.add(tab);
  sync.released.delete(tab);
  sync.ended.delete(tab);
  sync.local.delete(tab);
  const attempt = (tries: number) =>
    enqueue(sync, async () => {
      if (!current()) return;
      const outcome = await postThreadTab("hold", threadRef.threadId, tab);
      if (!current()) return;
      if (outcome.ok) {
        sync.pending.delete(tab);
        receiveSnapshot(threadRef, outcome.answer);
        return;
      }
      const inStrip = hasSurface(threadRef, tabSurfaceId(tab));
      if (outcome.retry && inStrip) {
        const delay = RETRY_DELAYS_MS[Math.min(tries, RETRY_DELAYS_MS.length - 1)];
        window.setTimeout(() => attempt(tries + 1), delay);
        return;
      }
      sync.pending.delete(tab);
      if (!inStrip || outcome.retry) return;
      sync.local.add(tab);
      const czech = prefersCzech();
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: czech
            ? "Vlákno si tuhle záložku neponechá."
            : "This thread does not keep this tab.",
          description:
            outcome.status === 409
              ? czech
                ? "Vlákno má tolik záložek, kolik smí. Zavře se 30 s poté, co ji nikdo nesleduje."
                : "The thread has as many tabs as it may. It closes 30 s after nobody views it."
              : czech
                ? "Zavře se 30 s poté, co ji nikdo nesleduje."
                : "It closes 30 s after nobody views it.",
          data: { threadRef },
        }),
      );
    });
  attempt(0);
}

/**
 * Lets go of `tabId` for the thread, idempotent; retried a few times on a failure that may pass.
 * A later hold of the tab (Vrátit, a link) replaces the release: a retry still waiting does not go,
 * and an answer still under way changes nothing.
 */
function releaseTab(threadRef: ScopedThreadRef, tabId: string): void {
  const sync = syncOf(threadRef);
  const current = intend(sync, tabId);
  sync.pending.delete(tabId);
  const attempt = (tries: number) =>
    enqueue(sync, async () => {
      if (!current()) return;
      const outcome = await postThreadTab("release", threadRef.threadId, tabId);
      if (!current()) return;
      if (!outcome.ok && outcome.retry && tries < 3) {
        window.setTimeout(() => attempt(tries + 1), RETRY_DELAYS_MS[tries]);
        return;
      }
      sync.released.delete(tabId);
      if (outcome.ok) receiveSnapshot(threadRef, outcome.answer);
    });
  attempt(0);
}

/** Surfaces × removed, where they were, and what the panel showed before. */
export interface ClosedTabs {
  readonly surfaces: ReadonlyArray<{
    readonly surface: EnvironmentBrowserSurface;
    readonly index: number;
  }>;
  readonly activeBefore: string | null;
  readonly openBefore: boolean;
}

/**
 * The person closed tabs of the thread in the strip (×, middle click, Close others, Close all):
 * the thread lets go of them, and one toast says what becomes of them, with Vrátit for 7 s, within
 * the hub's 8 s grace. The remote tab stays while anything still needs it.
 */
export function letGoOfTabs(threadRef: ScopedThreadRef, closed: ClosedTabs): void {
  const sync = syncOf(threadRef);
  const snapshot = snapshotOf(threadRef);
  const tabs: string[] = [];
  for (const { surface } of closed.surfaces) {
    const tab = tabIdOfSurface(surface);
    if (tab === null) continue;
    tabs.push(tab);
    sync.released.add(tab);
    releaseTab(threadRef, tab);
  }
  if (tabs.length === 0) return;
  const czech = prefersCzech();
  const text = closeToastText(
    tabs.map((tab) => snapshot?.tabs.find((entry) => entry.tabId === tab)),
    czech,
  );
  const toastId = toastManager.add(
    stackedThreadToast({
      type: "info",
      title: text.title,
      description: text.description,
      timeout: 7_000,
      actionProps: {
        children: czech ? "Vrátit" : "Undo",
        onClick: () => {
          toastManager.close(toastId);
          restoreTabs(threadRef, closed);
        },
      },
      data: { threadRef },
    }),
  );
}

/** Vrátit: the tabs go back where they were and the thread holds them again (a new record). */
export function restoreTabs(threadRef: ScopedThreadRef, closed: ClosedTabs): void {
  useRightPanelStore.getState().lazurio(threadRef, false, (current) => {
    const surfaces = [...current.surfaces];
    for (const { surface, index } of [...closed.surfaces].sort((a, b) => a.index - b.index)) {
      if (surfaces.some((entry) => entry.id === surface.id)) continue;
      surfaces.splice(Math.min(index, surfaces.length), 0, surface);
    }
    const back = closed.surfaces.some(({ surface }) => surface.id === closed.activeBefore);
    return {
      ...current,
      isOpen: current.isOpen || closed.openBefore,
      surfaces,
      activeSurfaceId: back
        ? closed.activeBefore
        : (current.activeSurfaceId ?? surfaces[0]?.id ?? null),
    };
  });
  for (const { surface } of closed.surfaces) {
    const tab = tabIdOfSurface(surface);
    if (tab !== null) holdTab(threadRef, tab);
  }
}

/** The view said its tab ended (`lazurio-browser:closed`): it leaves the strip at once and stays
 * out of it until a list lacks it, so an older snapshot cannot bring it back. No Vrátit. */
export function tabEnded(threadRef: ScopedThreadRef, surfaceId: string): void {
  const surface = panelOf(threadRef).surfaces.find((entry) => entry.id === surfaceId);
  if (surface === undefined) return;
  const tab = tabIdOfSurface(surface);
  if (tab !== null) {
    const sync = syncOf(threadRef);
    sync.ended.add(tab);
    sync.pending.delete(tab);
    sync.local.delete(tab);
    releaseTab(threadRef, tab);
  }
  useRightPanelStore
    .getState()
    .lazurio(threadRef, true, (current) => withoutSurface(current, surfaceId));
}

/** A tab of this Environment a person chose (a page's new tab, a link): the thread holds it. */
export function showOwnTab(threadRef: ScopedThreadRef, tabId: string, front: boolean): void {
  const surface: EnvironmentBrowserSurface = {
    id: tabSurfaceId(tabId),
    kind: "environment-browser",
  };
  useRightPanelStore
    .getState()
    .lazurio(threadRef, !front, (current) => withSurface(current, surface, front));
  holdTab(threadRef, tabId);
}

/** Another Environment's tab: the device's own, marked as that Environment's. */
export function showForeignTab(
  threadRef: ScopedThreadRef,
  address: string,
  front: boolean,
  reveal = false,
): boolean {
  const snapshot = snapshotOf(threadRef);
  const tab = foreignEnvironmentBrowserTab(
    address,
    window.location.origin,
    snapshot?.viewOrigin ?? null,
  );
  if (tab === null) return false;
  const surface: EnvironmentBrowserSurface = {
    id: tab.id,
    kind: "environment-browser",
    view: tab.view,
  };
  const store = useRightPanelStore.getState();
  if (reveal) {
    store.openProactive(threadRef, surface, store.getUserActionRevision(threadRef));
  } else {
    store.lazurio(threadRef, !front, (current) => withSurface(current, surface, front));
  }
  return true;
}

/** The server announced another Environment's tab of the thread (preview_open), live only. */
export function receiveForeign(threadRef: ScopedThreadRef, tab: ForeignTab): void {
  const reveal = tab.revealRequest !== undefined && syncOf(threadRef).inlinePanel;
  showForeignTab(threadRef, tab.view, false, reveal);
}

/** A plain click on a link in the chat to one remote tab, of this Environment's view (held) or of
 * another Environment's; false leaves the link to the browser. */
export function openLinkInPanel(threadRef: ScopedThreadRef, href: string): boolean {
  const snapshot = snapshotOf(threadRef);
  const own =
    snapshot === undefined || snapshot === null
      ? null
      : environmentBrowserLink(href, window.location.origin, snapshot.viewOrigin);
  const target = own === null ? null : /\/t\/([0-9A-Fa-f]{32})$/.exec(own.view)?.[1];
  if (target !== undefined && target !== null) {
    showOwnTab(threadRef, target, true);
    return true;
  }
  return showForeignTab(threadRef, href, true);
}
