/**
 * Lazurio overlay (LazurioPlatform F47): the pure part and client state of a thread's Environment
 * browser tabs. The server streams each thread's list from its holder file; every device
 * reconciles its strip to it, keeping its own order. Hooks and frames live in
 * LazurioEnvironmentBrowser.tsx, Nová karta in LazurioNewTab.tsx.
 */

import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

import { isPreviewAvailableFor } from "../browser/previewRuntime";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useComposerDraftStore } from "../composerDraftStore";
import { randomUUID } from "../lib/utils";
import {
  type RightPanelSurface,
  selectThreadRightPanelState,
  type ThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";
import { resolveThreadRouteTarget } from "../threadRoutes";
import {
  environmentBrowserLink,
  foreignEnvironmentBrowserTab,
  originOf,
} from "./environmentBrowser";

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
const NEW_TAB_PREFIX = "environment-browser:new-tab:";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The panel surface of this Environment's remote tab: its id only, the address is the server's. */
export const tabSurfaceId = (tabId: string) =>
  `environment-browser:${tabId.toUpperCase()}` as const;

/** The remote tab of a surface of this Environment, or null for any other surface. */
export function tabIdOfSurface(surface: RightPanelSurface): string | null {
  if (surface.kind !== "environment-browser" || "view" in surface) return null;
  return TAB_SURFACE.exec(surface.id)?.[1] ?? null;
}

/** A new Nová karta tab of the strip (rightPanelStore.ts names its singleton the same way). */
export function newTabSurface(): EnvironmentBrowserSurface {
  return { id: `${NEW_TAB_PREFIX}${randomUUID()}`, kind: "environment-browser" };
}

export const isNewTabSurface = (surface: RightPanelSurface) =>
  surface.kind === "environment-browser" && surface.id.startsWith(NEW_TAB_PREFIX);

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
 * Other kinds, Nová karta, foreign tabs and listed or `kept` tabs stay; other Environment browser
 * surfaces go. New listed tabs append in list order without opening a closed panel. With nothing
 * (still) selected the first Environment browser tab is, so the panel never opens on an empty
 * Nová karta beside tabs whose frames it would not load.
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
    if (surface.kind !== "environment-browser" || isNewTabSurface(surface)) return true;
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
  const next = [...surfaces, ...added];
  const activeSurfaceId = next.some((surface) => surface.id === current.activeSurfaceId)
    ? current.activeSurfaceId
    : (next.find((surface) => surface.kind === "environment-browser")?.id ?? next[0]?.id ?? null);
  if (
    added.length === 0 &&
    surfaces.length === current.surfaces.length &&
    activeSurfaceId === current.activeSurfaceId
  ) {
    return current;
  }
  return { ...current, surfaces: next, activeSurfaceId };
}

/** What the panel has seen of the server's reveal requests, per run of the server (`epoch`). */
export interface RevealBaseline {
  readonly epoch: string;
  readonly seen: ReadonlyMap<string, string>;
}

/**
 * The tabs whose reveal request is new since `baseline`, and the next baseline. The first snapshot
 * after the page loads, after the person comes back to the thread (`leaveThreadTabs`) or after the
 * server restarted (another epoch), only marks every request as seen, as upstream's own reveal
 * does: a reload never reopens what the person closed.
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
              ? "Zavře se v Prostředí."
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
            ? "Zavřou se v Prostředí."
            : "They close in the Environment."
          : czech
            ? "Některé zůstávají otevřené jinde nebo u agenta, ostatní se zavřou v Prostředí."
            : "Some stay open elsewhere or with an agent; the others close in the Environment.",
  };
}

/** The client's side of each thread's tabs: the last snapshot, and what the panel adds to it. */
interface ThreadTabsState {
  /** The last snapshot of each thread, by thread key: null while the server says unavailable. */
  readonly snapshots: Readonly<Record<string, ThreadTabsSnapshot | null>>;
  /** The titles the frames report, by surface id: a remote tab's title is the same everywhere. */
  readonly titles: Readonly<Record<string, string>>;
  /** How often each tab's frame was reloaded, by surface id: part of its frame's key, so a reload
   * is a fresh frame, also of a tab behind the one in front. */
  readonly reloads: Readonly<Record<string, number>>;
  /** The thread the chat shows, whose panel may show Nová karta. */
  readonly inView: ScopedThreadRef | null;
  /** The draft the chat shows: no thread of the server yet, so it has no tabs until its first
   * message (Lazurio/t3code#53). */
  readonly draftInView: ScopedThreadRef | null;
}

export const useThreadTabsStore = create<ThreadTabsState>(() => ({
  snapshots: {},
  titles: {},
  reloads: {},
  inView: null,
  draftInView: null,
}));

export function rememberTitle(surfaceId: string, title: string | null): void {
  useThreadTabsStore.setState((state) => {
    if ((state.titles[surfaceId] ?? null) === title) return state;
    const { [surfaceId]: _previous, ...others } = state.titles;
    return { titles: title === null ? others : { ...others, [surfaceId]: title } };
  });
}

/** A fresh frame of the tab's view: the tab menu's Reload, or the sign-in notice's. */
export function reloadSurface(surfaceId: string): void {
  useThreadTabsStore.setState((state) => ({
    reloads: { ...state.reloads, [surfaceId]: (state.reloads[surfaceId] ?? 0) + 1 },
  }));
}

/** The thread's last snapshot: undefined before the server's first answer, null while unavailable. */
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
  useThreadTabsStore.setState({
    snapshots: {},
    titles: {},
    reloads: {},
    inView: null,
    draftInView: null,
  });
}

export type PostOutcome =
  | { readonly ok: true; readonly answer: ThreadTabsAnswer }
  | { readonly ok: false; readonly retry: boolean; readonly status: number | null };

/** POST hold or release on this page's own origin; a network failure or a 5xx may be retried. */
async function postThreadTab(
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
/** The thread's right panel as the store has it now. */
export const panelOf = (threadRef: ScopedThreadRef) =>
  selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef);
const hasSurface = (threadRef: ScopedThreadRef, surfaceId: string) =>
  panelOf(threadRef).surfaces.some((surface) => surface.id === surfaceId);

/** Adds a surface, in front with the panel open, or behind the surface in view. Where nothing is
 * selected it is the one selected, as in the strip after the server's list, and a closed panel
 * stays closed. */
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
    : { ...current, surfaces, activeSurfaceId: current.activeSurfaceId ?? surface.id };
}

/**
 * The same update as upstream's × (`closeSurface`), applied as an automatic one: a tab that ended
 * is not the person's choice, which would hold back panels upstream opens after a turn. A test
 * holds the two equal.
 */
function withoutSurface(current: ThreadRightPanelState, surfaceId: string): ThreadRightPanelState {
  const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
  if (index < 0) return current;
  const surfaces = current.surfaces.filter((surface) => surface.id !== surfaceId);
  const isOpen = surfaces.length > 0 && current.isOpen;
  if (current.activeSurfaceId !== surfaceId) return { ...current, isOpen, surfaces };
  return {
    ...current,
    isOpen,
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
 * The strip follows the newest list the device took; an older snapshot is not taken, but a hold it
 * answered no longer keeps its tab. A reveal new since the baseline opens the inline panel unless
 * the person chose in the panel meanwhile. An unavailable snapshot leaves the strip as it is.
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
    // The reconciliation above already put the tab in the strip, where upstream's openProactive
    // leaves a surface it finds unless told to bring it to the front (activateExisting).
    useRightPanelStore
      .getState()
      .openProactive(
        threadRef,
        { id: tabSurfaceId(tabId), kind: "environment-browser" },
        revision,
        true,
      );
  }
}

/**
 * Whether a route shows the thread: its own route, or the route of the draft that becomes it.
 * `params` are the route's (`router.state.matches`), read as upstream's chat layout reads them.
 */
export function routeShowsThread(
  params: Partial<Record<"environmentId" | "threadId" | "draftId", string | undefined>>,
  threadRef: ScopedThreadRef,
): boolean {
  const target = resolveThreadRouteTarget(params);
  const shown =
    target?.kind === "server"
      ? target.threadRef
      : target?.kind === "draft"
        ? useComposerDraftStore.getState().getDraftSession(target.draftId)
        : null;
  return (
    shown !== null &&
    shown.environmentId === threadRef.environmentId &&
    shown.threadId === threadRef.threadId
  );
}

/**
 * After the person leaves (`stillShown` false), the next snapshot is a baseline of reveals, so a
 * page an agent opened meanwhile does not open the panel. A remount without leaving (draft becomes
 * thread, shell reloads) keeps what the device saw, so a reveal from that gap still opens it.
 */
function leftThread(threadRef: ScopedThreadRef, stillShown: boolean): void {
  if (!stillShown) syncOf(threadRef).baseline = null;
}

/** The thread's stream opens. */
export function enterThreadTabs(threadRef: ScopedThreadRef): void {
  useThreadTabsStore.setState({ inView: threadRef });
}

export function leaveThreadTabs(threadRef: ScopedThreadRef, stillShown: boolean): void {
  leftThread(threadRef, stillShown);
  const inView = useThreadTabsStore.getState().inView;
  if (inView !== null && scopedThreadKey(inView) === scopedThreadKey(threadRef)) {
    useThreadTabsStore.setState({ inView: null });
  }
}

/** A draft comes into view: the panel says that the Environment browser comes with the first
 * message, instead of upstream's desktop-only line. */
export function enterDraft(threadRef: ScopedThreadRef): void {
  useThreadTabsStore.setState({ draftInView: threadRef });
}

export function leaveDraft(threadRef: ScopedThreadRef, stillShown: boolean): void {
  leftThread(threadRef, stillShown);
  const draft = useThreadTabsStore.getState().draftInView;
  if (draft !== null && scopedThreadKey(draft) === scopedThreadKey(threadRef)) {
    useThreadTabsStore.setState({ draftInView: null });
  }
}

/** The empty panel's line on a draft (Lazurio/t3code#53; the Admin chose it on 2026-10-12). */
export const draftBrowserNote = (czech: boolean) =>
  czech
    ? "Prohlížeč Prostředí bude k dispozici po první zprávě."
    : "The Environment browser comes with the first message.";

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

/** A new intent for `tab`, a hold or a release: from now on every older one's retry and answer do
 * nothing, so × and Vrátit always win over what they replace. */
function intend(sync: ThreadTabsSync, tab: string): () => boolean {
  const intent = ++sync.intentCount;
  sync.intents.set(tab, intent);
  return () => sync.intents.get(tab) === intent;
}

/**
 * Pending until the POST answers. Network failures and 5xx retry with backoff for about a minute
 * while the tab is in the strip; a refusal or an outlasting failure leaves it the device's own,
 * which ends 30 s after its last viewer (F39). A later × replaces the hold, even mid-flight.
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
      if (outcome.retry && inStrip && tries < RETRY_DELAYS_MS.length) {
        window.setTimeout(() => attempt(tries + 1), RETRY_DELAYS_MS[tries]);
        return;
      }
      sync.pending.delete(tab);
      if (!inStrip) return;
      sync.local.add(tab);
      const czech = prefersCzech();
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: czech
            ? "Vlákno si tuto záložku neponechá."
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
function restoreTabs(threadRef: ScopedThreadRef, closed: ClosedTabs): void {
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
    // The server announces the tab again for each reveal: one the strip has comes to the front.
    store.openProactive(threadRef, surface, store.getUserActionRevision(threadRef), true);
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

/**
 * A page a person opens from the thread (a server of the Servers panel), in a new tab of this
 * Environment's browser, in front. Without a strip the page goes to upstream's preview only where
 * this client or the Environment has one; a Lazurio Environment has none, so it says so instead.
 */
export async function openPageInPanel(threadRef: ScopedThreadRef, url: string): Promise<boolean> {
  const snapshot = snapshotOf(threadRef);
  const czech = prefersCzech();
  if (snapshot === undefined || snapshot === null) {
    if (isPreviewAvailableFor(threadRef.environmentId)) return false;
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: czech
          ? "Prohlížeč Prostředí teď není k dispozici."
          : "The Environment browser is not available right now.",
        data: { threadRef },
      }),
    );
    return true;
  }
  const opened = await window
    .fetch(`${THREAD_TABS_ROUTE}/open`, {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ threadId: threadRef.threadId, url }),
    })
    .then(async (response) => (response.status === 200 ? await response.json() : null))
    .catch(() => null);
  const tabId = typeof opened?.tabId === "string" ? opened.tabId : null;
  if (tabId !== null && /^[0-9A-Fa-f]{32}$/.test(tabId)) {
    showOwnTab(threadRef, tabId, true);
    return true;
  }
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: czech
        ? "Stránku se nepodařilo otevřít v prohlížeči Prostředí."
        : "The page did not open in the Environment browser.",
      data: { threadRef },
    }),
  );
  return true;
}

/** Nová karta became a page or a tab of the Environment: that tab takes its place, held. A tab
 * the strip has already comes to the front instead. `newTabId` null is the empty panel's. */
export function chooseTab(
  threadRef: ScopedThreadRef,
  newTabId: string | null,
  tabId: string,
): void {
  const surface: EnvironmentBrowserSurface = {
    id: tabSurfaceId(tabId),
    kind: "environment-browser",
  };
  useRightPanelStore.getState().lazurio(threadRef, false, (current) => {
    const existing = current.surfaces.some((entry) => entry.id === surface.id);
    const surfaces = existing
      ? current.surfaces.filter((entry) => entry.id !== newTabId)
      : newTabId !== null && current.surfaces.some((entry) => entry.id === newTabId)
        ? current.surfaces.map((entry) => (entry.id === newTabId ? surface : entry))
        : [...current.surfaces, surface];
    return { ...current, isOpen: true, surfaces, activeSurfaceId: surface.id };
  });
  holdTab(threadRef, tabId);
}
