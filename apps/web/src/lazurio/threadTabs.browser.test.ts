import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { fakeTimers, stubGlobal } from "../../test/render";
import { useClosedViewStore } from "../closedViewStore";
import { toastManager } from "../components/ui/toast";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import {
  type RightPanelSurface,
  selectActiveRightPanelSurface,
  selectThreadRightPanelState,
  type ThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";
import {
  chooseTab,
  enterDraft,
  enterThreadTabs,
  holdTab,
  isNewTabSurface,
  leaveDraft,
  leaveThreadTabs,
  letGoOfTabs,
  newTabSurface,
  receiveForeign,
  receiveSnapshot,
  resetThreadTabs,
  routeShowsThread,
  showOwnTab,
  snapshotOf,
  syncOf,
  tabEnded,
  tabSurfaceId,
  type ThreadTab,
  type ThreadTabsSnapshot,
} from "./threadTabs";

const viewOrigin = "https://browser.vm-01.example.lazurio.io";
const id = (n: number) => n.toString(16).toUpperCase().padStart(32, "0");
const tab = (n: number) => ({ id: tabSurfaceId(id(n)), kind: "environment-browser" }) as const;
const foreign = {
  id: `environment-browser:${"ab".repeat(16)}`,
  kind: "environment-browser",
  view: `https://browser.vm-02.acme.lazurio.io/t/${"ab".repeat(16)}`,
} as const;
const files = { id: "files", kind: "files" } as const;
const threadA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const threadB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));
const panel = () => selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadA);
const setPanel = (state: ThreadRightPanelState) =>
  useRightPanelStore.setState({ byThreadKey: { "env-1:thread-A": state } });

const snapshot = (
  tabs: ReadonlyArray<Partial<ThreadTab> & { readonly tabId: string }>,
  overrides: Partial<ThreadTabsSnapshot> = {},
): ThreadTabsSnapshot => ({
  available: true,
  epoch: "epoch-1",
  revision: 1,
  threadId: "thread-A",
  strip: "t3-thread-A",
  viewOrigin,
  tabs: tabs.map((entry) => ({
    view: `${viewOrigin}/t/${entry.tabId}`,
    agent: false,
    alsoHeldBy: [],
    ...entry,
  })),
  ...overrides,
});

const answerWith =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * The page's own server for one test, from nothing: the stores start empty, and every POST is
 * recorded and gets the next queued answer, or an empty list.
 */
function setup() {
  resetThreadTabs();
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  useComposerDraftStore.setState({ draftThreadsByThreadKey: {} });
  const posted: Array<{ readonly action: string; readonly body: unknown }> = [];
  const answers: Array<() => Response | Promise<Response>> = [];
  const fetch = stubGlobal("fetch", async (url: string, init: RequestInit) => {
    posted.push({ action: url.split("/").at(-1) ?? "", body: JSON.parse(String(init.body)) });
    const next = answers.shift();
    return next === undefined ? answerWith(snapshot([]))() : next();
  });
  return {
    posted,
    answer: (...next: Array<() => Response>) => answers.push(...next),
    /** A POST answered only when the test says, and a promise of the moment it was sent. */
    heldAnswer() {
      let answer: (response: Response) => void = () => undefined;
      let sent: () => void = () => undefined;
      const wasSent = new Promise<void>((resolve) => {
        sent = resolve;
      });
      answers.push(
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
            sent();
          }),
      );
      return { wasSent, answer: (response: Response) => answer(response) };
    },
    [Symbol.dispose]: () => fetch[Symbol.dispose](),
  };
}

/** Waits for the thread's POSTs queued so far, and those they queue. */
async function settled() {
  const sync = syncOf(threadA);
  let queue: Promise<unknown>;
  do {
    queue = sync.queue;
    await queue;
  } while (queue !== sync.queue);
}

describe("the strip from the server's list", () => {
  it("selects another Environment's tab the server announces where nothing is selected", () => {
    using _server = setup();
    setPanel({ isOpen: true, activeSurfaceId: null, surfaces: [] });
    receiveSnapshot(threadA, snapshot([]));
    receiveForeign(threadA, { tabId: "ab".repeat(16), view: foreign.view });
    expect(panel()).toEqual({ isOpen: true, activeSurfaceId: foreign.id, surfaces: [foreign] });
  });

  it("keeps the order a person dragged the tabs into", () => {
    using _server = setup();
    setPanel({ isOpen: true, activeSurfaceId: tab(1).id, surfaces: [tab(1), tab(2), files] });
    useRightPanelStore.getState().moveSurface(threadA, tab(2).id, 0);
    receiveSnapshot(threadA, snapshot([{ tabId: id(1) }, { tabId: id(2) }, { tabId: id(3) }]));
    expect(panel().surfaces).toEqual([tab(2), tab(1), files, tab(3)]);
  });

  it("leaves the store as it is while the server says unavailable", () => {
    using _server = setup();
    setPanel({ isOpen: true, activeSurfaceId: tab(1).id, surfaces: [tab(1)] });
    const before = useRightPanelStore.getState().byThreadKey;
    receiveSnapshot(threadA, { available: false });
    expect(useRightPanelStore.getState().byThreadKey).toBe(before);
  });
});

describe("reveals", () => {
  it("open an inline panel on the revealed tab, and never a sheet over the chat", () => {
    using _server = setup();
    syncOf(threadA).inlinePanel = false;
    receiveSnapshot(threadA, snapshot([]));
    receiveSnapshot(threadA, snapshot([{ tabId: id(1), revealRequest: { id: "epoch-1:1" } }]));
    expect(panel()).toMatchObject({ isOpen: false, surfaces: [tab(1)] });
    syncOf(threadA).inlinePanel = true;
    receiveSnapshot(threadA, snapshot([{ tabId: id(1), revealRequest: { id: "epoch-1:2" } }]));
    expect(panel()).toEqual({ isOpen: true, activeSurfaceId: tab(1).id, surfaces: [tab(1)] });
  });

  it("bring a tab the strip already has to the front, behind another surface in view", () => {
    // Upstream's openProactive leaves a surface it finds where it is unless asked to activate it
    // (#13608); a reveal of a tab in the strip must still show it.
    using _server = setup();
    syncOf(threadA).inlinePanel = true;
    setPanel({ isOpen: true, activeSurfaceId: files.id, surfaces: [tab(1), files] });
    receiveSnapshot(threadA, snapshot([{ tabId: id(1), revealRequest: { id: "epoch-1:1" } }]));
    expect(panel().activeSurfaceId).toBe(files.id);
    receiveSnapshot(threadA, snapshot([{ tabId: id(1), revealRequest: { id: "epoch-1:2" } }]));
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: tab(1).id,
      surfaces: [tab(1), files],
    });
    // Another Environment's tab the server reveals again, while the strip still has it.
    receiveForeign(threadA, { tabId: "ab".repeat(16), view: foreign.view });
    expect(panel().activeSurfaceId).toBe(tab(1).id);
    receiveForeign(threadA, {
      tabId: "ab".repeat(16),
      view: foreign.view,
      revealRequest: { id: "e:1" },
    });
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: foreign.id,
      surfaces: [tab(1), files, foreign],
    });
  });

  it("keep what the device saw while the route shows the thread, and start again once the person left it", () => {
    using _server = setup();
    syncOf(threadA).inlinePanel = true;
    // The person sends the first message of a draft: the route still shows the draft as its thread's
    // stream opens.
    enterDraft(threadA);
    leaveDraft(threadA, true);
    enterThreadTabs(threadA);
    receiveSnapshot(threadA, snapshot([]));
    // The thread's view closes and opens again while the route still shows it (ChatView mounting
    // anew) and the agent reveals a page: the snapshot of the new stream opens the panel on it.
    leaveThreadTabs(threadA, true);
    enterThreadTabs(threadA);
    receiveSnapshot(threadA, snapshot([{ tabId: id(1), revealRequest: { id: "epoch-1:1" } }]));
    expect(panel()).toEqual({ isOpen: true, activeSurfaceId: tab(1).id, surfaces: [tab(1)] });
    // The person closes the panel and goes to Settings, where no thread or draft is in view. The
    // agent reveals a page meanwhile. Back on the thread, the first snapshot is a baseline: the
    // panel stays closed.
    useRightPanelStore.getState().toggleVisibility(threadA);
    leaveThreadTabs(threadA, false);
    enterThreadTabs(threadA);
    receiveSnapshot(threadA, snapshot([{ tabId: id(1), revealRequest: { id: "epoch-1:2" } }]));
    expect(panel().isOpen).toBe(false);
    // The same after another thread's draft.
    leaveThreadTabs(threadA, false);
    enterDraft(threadB);
    leaveDraft(threadB, false);
    enterThreadTabs(threadA);
    receiveSnapshot(threadA, snapshot([{ tabId: id(1), revealRequest: { id: "epoch-1:3" } }]));
    expect(panel().isOpen).toBe(false);
  });

  it("know the thread a route shows, its own or its draft's", () => {
    using _server = setup();
    const route = (params: Record<string, string>) => routeShowsThread(params, threadA);
    expect(route({ environmentId: "env-1", threadId: "thread-A" })).toBe(true);
    expect(route({ environmentId: "env-1", threadId: "thread-B" })).toBe(false);
    expect(route({ environmentId: "env-2", threadId: "thread-A" })).toBe(false);
    // Settings and the other routes show no thread.
    expect(route({})).toBe(false);
    // A draft's route shows the thread the draft becomes, while its session lasts.
    expect(route({ draftId: "draft-A" })).toBe(false);
    useComposerDraftStore
      .getState()
      .setProjectDraftThreadId(
        scopeProjectRef("env-1" as EnvironmentId, ProjectId.make("project-1")),
        DraftId.make("draft-A"),
        { threadId: ThreadId.make("thread-A") },
      );
    expect(route({ draftId: "draft-A" })).toBe(true);
    expect(routeShowsThread({ draftId: "draft-A" }, threadB)).toBe(false);
  });

  it("leave the agent's tab of a thread that comes into view selected, for the panel the person opens", () => {
    using _server = setup();
    // The agent opened the page while the thread was out of view (or before a reload): its
    // reveal is in the first snapshot, a baseline, so the panel does not open by itself...
    syncOf(threadA).inlinePanel = true;
    receiveSnapshot(
      threadA,
      snapshot([{ tabId: id(1), agent: true, revealRequest: { id: "epoch-1:1" } }]),
    );
    expect(panel()).toEqual({ isOpen: false, activeSurfaceId: tab(1).id, surfaces: [tab(1)] });
    // ...and when the person opens it, it shows the agent's page, not Nová karta.
    useRightPanelStore.getState().toggleVisibility(threadA);
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, threadA),
    ).toEqual(tab(1));
  });

  it("give way to a choice the person made since the snapshot came", () => {
    using _server = setup();
    syncOf(threadA).inlinePanel = true;
    setPanel({ isOpen: true, activeSurfaceId: files.id, surfaces: [files] });
    receiveSnapshot(threadA, snapshot([]));
    // The person chooses while the snapshot is taken in: here, as soon as the strip changes.
    const unsubscribe = useRightPanelStore.subscribe(() => {
      unsubscribe();
      useRightPanelStore.getState().activateSurface(threadA, files.id);
    });
    receiveSnapshot(threadA, snapshot([{ tabId: id(1), revealRequest: { id: "epoch-1:1" } }]));
    expect(panel()).toEqual({ isOpen: true, activeSurfaceId: files.id, surfaces: [files, tab(1)] });
  });
});

describe("holds", () => {
  it("keep a pending tab until its POST settles, then follow the answer", async () => {
    using server = setup();
    const hold = server.heldAnswer();
    showOwnTab(threadA, id(1), true);
    expect(panel()).toEqual({ isOpen: true, activeSurfaceId: tab(1).id, surfaces: [tab(1)] });
    // A snapshot from before the hold does not drop the pending tab.
    receiveSnapshot(threadA, snapshot([]));
    expect(panel().surfaces).toEqual([tab(1)]);
    await hold.wasSent;
    hold.answer(answerWith(snapshot([{ tabId: id(1) }]))());
    await settled();
    expect(syncOf(threadA).pending.size).toBe(0);
    expect(server.posted).toEqual([
      { action: "hold", body: { threadId: "thread-A", tabId: id(1) } },
    ]);
    expect(panel().surfaces).toEqual([tab(1)]);
  });

  it("retry a failure that may pass while the tab is in the strip, and keep a refused tab as the device's own", async () => {
    using server = setup();
    using _timers = fakeTimers();
    using warn = vi.spyOn(toastManager, "add");
    server.answer(
      answerWith({ error: "hold-failed" }, 503),
      answerWith({ error: "too-many-tabs" }, 409),
    );
    showOwnTab(threadA, id(1), true);
    await settled();
    expect(server.posted).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await settled();
    expect(server.posted).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(syncOf(threadA).local.has(id(1))).toBe(true);
    // The device keeps it although the thread's list lacks it.
    receiveSnapshot(threadA, snapshot([]));
    expect(panel().surfaces).toEqual([tab(1)]);
  });

  it("stop retrying a failure that does not pass after about a minute, keeping the tab as the device's own", async () => {
    using server = setup();
    using _timers = fakeTimers();
    using warn = vi.spyOn(toastManager, "add");
    server.answer(...Array.from({ length: 10 }, () => answerWith({ error: "unavailable" }, 503)));
    showOwnTab(threadA, id(1), true);
    await settled();
    for (const pause of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]) {
      await vi.advanceTimersByTimeAsync(pause);
      await settled();
    }
    expect(server.posted).toHaveLength(7);
    expect(syncOf(threadA).pending.size).toBe(0);
    expect(syncOf(threadA).local.has(id(1))).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    await settled();
    expect(server.posted).toHaveLength(7);
    expect(panel().surfaces).toEqual([tab(1)]);
  });

  it("do not retry a failed hold once × let go of the tab", async () => {
    using server = setup();
    using _timers = fakeTimers();
    server.answer(
      answerWith({ error: "hold-failed" }, 503),
      answerWith(snapshot([], { revision: 2 })),
      // What a retried hold would be told: the tab back in the list.
      answerWith(snapshot([{ tabId: id(1) }], { revision: 3 })),
    );
    receiveSnapshot(threadA, snapshot([], { revision: 1 }));
    showOwnTab(threadA, id(1), true);
    await settled();
    useRightPanelStore.getState().closeSurface(threadA, tab(1).id);
    letGoOfTabs(threadA, {
      surfaces: [{ surface: tab(1), index: 0 }],
      activeBefore: tab(1).id,
      openBefore: true,
    });
    await settled();
    await vi.advanceTimersByTimeAsync(30_000);
    await settled();
    expect(server.posted.map((entry) => entry.action)).toEqual(["hold", "release"]);
    expect(panel().surfaces).toEqual([]);
    expect(syncOf(threadA).pending.size).toBe(0);
  });
});

describe("closing in the strip and Vrátit", () => {
  it("lets go of a closed tab with one release and offers Vrátit for 7 s", async () => {
    using server = setup();
    using toasts = vi.spyOn(toastManager, "add");
    setPanel({ isOpen: true, activeSurfaceId: tab(1).id, surfaces: [files, tab(1)] });
    receiveSnapshot(threadA, snapshot([{ tabId: id(1) }]));
    const closed = {
      surfaces: [{ surface: tab(1), index: 1 }],
      activeBefore: tab(1).id,
      openBefore: true,
    };
    useRightPanelStore.getState().closeSurface(threadA, tab(1).id);
    letGoOfTabs(threadA, closed);
    await settled();
    expect(server.posted).toEqual([
      { action: "release", body: { threadId: "thread-A", tabId: id(1) } },
    ]);
    const [options] = toasts.mock.calls.at(-1)!;
    expect(options).toMatchObject({
      title: "The tab left this thread.",
      description: "It closes in the Environment.",
      timeout: 7_000,
      actionProps: { children: "Undo" },
    });
    // Vrátit: back where it was, in front, and held again.
    (options.actionProps as { onClick: () => void }).onClick();
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: tab(1).id,
      surfaces: [files, tab(1)],
    });
    await settled();
    expect(server.posted.at(-1)).toEqual({
      action: "hold",
      body: { threadId: "thread-A", tabId: id(1) },
    });
  });

  it("do not retry a failed release once Vrátit held the tab again", async () => {
    using server = setup();
    using _timers = fakeTimers();
    using toasts = vi.spyOn(toastManager, "add");
    server.answer(
      answerWith({ error: "hold-failed" }, 503),
      answerWith(snapshot([{ tabId: id(1) }], { revision: 2 })),
      // What a retried release would be told: the tab gone from the list.
      answerWith(snapshot([], { revision: 3 })),
    );
    setPanel({ isOpen: true, activeSurfaceId: tab(1).id, surfaces: [files, tab(1)] });
    receiveSnapshot(threadA, snapshot([{ tabId: id(1) }], { revision: 1 }));
    useRightPanelStore.getState().closeSurface(threadA, tab(1).id);
    letGoOfTabs(threadA, {
      surfaces: [{ surface: tab(1), index: 1 }],
      activeBefore: tab(1).id,
      openBefore: true,
    });
    await settled();
    const [options] = toasts.mock.calls.at(-1)!;
    (options.actionProps as { onClick: () => void }).onClick();
    await settled();
    await vi.advanceTimersByTimeAsync(30_000);
    await settled();
    expect(server.posted.map((entry) => entry.action)).toEqual(["release", "hold"]);
    expect(panel().surfaces).toEqual([files, tab(1)]);
    expect(syncOf(threadA).released.size).toBe(0);
  });

  it("hides a released tab from older snapshots until the release lands", async () => {
    using server = setup();
    setPanel({ isOpen: true, activeSurfaceId: files.id, surfaces: [files, tab(1)] });
    receiveSnapshot(threadA, snapshot([{ tabId: id(1) }]));
    const release = server.heldAnswer();
    useRightPanelStore.getState().closeSurface(threadA, tab(1).id);
    letGoOfTabs(threadA, {
      surfaces: [{ surface: tab(1), index: 1 }],
      activeBefore: files.id,
      openBefore: true,
    });
    receiveSnapshot(threadA, snapshot([{ tabId: id(1) }]));
    expect(panel().surfaces).toEqual([files]);
    await release.wasSent;
    release.answer(answerWith(snapshot([]))());
    await settled();
    expect(syncOf(threadA).released.size).toBe(0);
  });

  it("a tab whose view ended leaves at once, released, and an older snapshot cannot bring it back", async () => {
    using server = setup();
    setPanel({ isOpen: true, activeSurfaceId: tab(1).id, surfaces: [tab(1), tab(2)] });
    receiveSnapshot(threadA, snapshot([{ tabId: id(1) }, { tabId: id(2) }]));
    using toasts = vi.spyOn(toastManager, "add");
    tabEnded(threadA, tab(1).id);
    expect(panel()).toEqual({ isOpen: true, activeSurfaceId: tab(2).id, surfaces: [tab(2)] });
    receiveSnapshot(threadA, snapshot([{ tabId: id(1) }, { tabId: id(2) }]));
    expect(panel().surfaces).toEqual([tab(2)]);
    await settled();
    expect(server.posted).toEqual([
      { action: "release", body: { threadId: "thread-A", tabId: id(1) } },
    ]);
    expect(toasts).not.toHaveBeenCalled();
    // Once a list lacks it, it is forgotten.
    receiveSnapshot(threadA, snapshot([{ tabId: id(2) }]));
    expect(syncOf(threadA).ended.size).toBe(0);
  });

  it("a tab whose view ended leaves as upstream's × would, and the panel closes with the last one", async () => {
    using _server = setup();
    const states: ThreadRightPanelState[] = [
      { isOpen: true, activeSurfaceId: tab(1).id, surfaces: [tab(1)] },
      { isOpen: true, activeSurfaceId: tab(1).id, surfaces: [files, tab(1), tab(2)] },
      { isOpen: true, activeSurfaceId: files.id, surfaces: [files, tab(1)] },
      { isOpen: false, activeSurfaceId: tab(1).id, surfaces: [tab(1), tab(2)] },
    ];
    for (const state of states) {
      setPanel(state);
      useRightPanelStore.getState().closeSurface(threadA, tab(1).id);
      const upstream = panel();
      const revision = useRightPanelStore.getState().getUserActionRevision(threadA);
      setPanel(state);
      tabEnded(threadA, tab(1).id);
      expect(panel()).toEqual(upstream);
      // The view ended the tab: no choice of the person's, so upstream's later automatic
      // panels still open.
      expect(useRightPanelStore.getState().getUserActionRevision(threadA)).toBe(revision);
    }
    // The thread's last tab ended: the panel closes instead of staying open and empty.
    setPanel({ isOpen: true, activeSurfaceId: tab(1).id, surfaces: [tab(1)] });
    tabEnded(threadA, tab(1).id);
    expect(panel()).toEqual({ isOpen: false, activeSurfaceId: null, surfaces: [] });
    await settled();
  });

  it("leaves upstream's reopen of closed views to the surfaces closed beside the tabs", () => {
    using _server = setup();
    // Vrátit is a tab's way back, within the hub's grace: Mod+Shift+T skips these surfaces.
    useClosedViewStore.setState({ entries: [] });
    const diff = { id: "diff", kind: "diff" } as const;
    const [first, second] = [newTabSurface(), newTabSurface()];
    setPanel({
      isOpen: true,
      activeSurfaceId: tab(1).id,
      surfaces: [diff, tab(1), first, tab(2), second, foreign],
    });
    useRightPanelStore.getState().closeSurface(threadA, tab(1).id);
    useRightPanelStore.getState().closeSurface(threadA, first.id);
    expect(useClosedViewStore.getState().entries).toEqual([]);
    useRightPanelStore.getState().closeAllSurfaces(threadA);
    expect(
      useClosedViewStore
        .getState()
        .entries.map((entry) => (entry.kind === "panel-tab" ? entry.surface : entry.kind)),
    ).toEqual([diff]);
  });
});

describe("the order of snapshots", () => {
  it("lets a POST answer older than the stream's newest list change nothing, and the strip follow that list", async () => {
    using server = setup();
    receiveSnapshot(threadA, snapshot([], { revision: 1 }));
    const hold = server.heldAnswer();
    showOwnTab(threadA, id(1), true);
    await hold.wasSent;
    // The stream: the hold landed (2), then another device let go of the tab (3).
    receiveSnapshot(threadA, snapshot([{ tabId: id(1) }], { revision: 2 }));
    receiveSnapshot(threadA, snapshot([], { revision: 3 }));
    expect(panel().surfaces).toEqual([tab(1)]);
    // The hold's own answer comes last: older, it changes nothing, and the settled hold no longer
    // keeps the tab the newest list lacks.
    hold.answer(answerWith(snapshot([{ tabId: id(1) }], { revision: 2 }))());
    await settled();
    expect(panel().surfaces).toEqual([]);
    expect(snapshotOf(threadA)?.revision).toBe(3);
  });

  it("take the same snapshot again after a reconnect, start over with a restarted server, and never go back to the run it left", () => {
    using _server = setup();
    receiveSnapshot(threadA, snapshot([{ tabId: id(1) }], { revision: 5 }));
    // A reconnect replays the newest snapshot: the same revision, the same strip.
    receiveSnapshot(threadA, snapshot([{ tabId: id(1) }], { revision: 5 }));
    expect(panel().surfaces).toEqual([tab(1)]);
    receiveSnapshot(threadA, snapshot([], { revision: 4 }));
    expect(panel().surfaces).toEqual([tab(1)]);
    // The server restarted: another epoch, whose revisions start again.
    receiveSnapshot(threadA, snapshot([{ tabId: id(2) }], { epoch: "epoch-2", revision: 1 }));
    expect(panel().surfaces).toEqual([tab(2)]);
    // A late answer of the run the device left never comes back.
    receiveSnapshot(threadA, snapshot([{ tabId: id(1) }], { revision: 6 }));
    expect(panel().surfaces).toEqual([tab(2)]);
    // After a spell without the browser, the same snapshot is taken again.
    receiveSnapshot(threadA, { available: false });
    expect(snapshotOf(threadA)).toBeNull();
    receiveSnapshot(threadA, snapshot([{ tabId: id(2) }], { epoch: "epoch-2", revision: 1 }));
    expect(snapshotOf(threadA)?.revision).toBe(1);
    receiveSnapshot(
      threadA,
      snapshot([{ tabId: id(2) }, { tabId: id(3) }], { epoch: "epoch-2", revision: 2 }),
    );
    expect(panel().surfaces).toEqual([tab(2), tab(3)]);
  });
});

describe("Nová karta's surface", () => {
  it("is what the store opens for the overlay's kind", () => {
    using _server = setup();
    useRightPanelStore.getState().open(threadA, "environment-browser");
    const [surface] = panel().surfaces as RightPanelSurface[];
    expect(surface !== undefined && isNewTabSurface(surface)).toBe(true);
    expect(isNewTabSurface(newTabSurface())).toBe(true);
    expect(isNewTabSurface(tab(1))).toBe(false);
  });

  it("holds a page in Nová karta's place, and brings a tab the strip has to the front instead", async () => {
    using server = setup();
    const newTab = newTabSurface();
    setPanel({ isOpen: true, activeSurfaceId: newTab.id, surfaces: [files, newTab, tab(2)] });
    chooseTab(threadA, newTab.id, id(1));
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: tab(1).id,
      surfaces: [files, tab(1), tab(2)],
    });
    const another = newTabSurface();
    useRightPanelStore.getState().lazurio(threadA, false, (current) => ({
      ...current,
      surfaces: [...current.surfaces, another],
      activeSurfaceId: another.id,
    }));
    chooseTab(threadA, another.id, id(2));
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: tab(2).id,
      surfaces: [files, tab(1), tab(2)],
    });
    await settled();
    expect(server.posted.map((entry) => entry.action)).toEqual(["hold", "hold"]);
  });
});

it("holdTab is idempotent for a tab the thread holds already", async () => {
  using server = setup();
  holdTab(threadA, id(1).toLowerCase());
  await settled();
  expect(server.posted).toEqual([{ action: "hold", body: { threadId: "thread-A", tabId: id(1) } }]);
});
