// @vitest-environment jsdom

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { toastManager } from "../components/ui/toast";
import {
  type RightPanelSurface,
  selectActiveRightPanelSurface,
  selectThreadRightPanelState,
  type ThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";
import {
  chooseTab,
  closeToastText,
  freshReveals,
  holdTab,
  isNewTabSurface,
  letGoOfTabs,
  newTabSurface,
  parseThreadTabsAnswer,
  placesOf,
  receiveForeign,
  receiveSnapshot,
  reconcileThreadTabs,
  resetThreadTabs,
  showOwnTab,
  snapshotOf,
  syncOf,
  tabEnded,
  tabSurfaceId,
  tabTooltip,
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

/** The server's POST answers, by action, and what the page sent. */
const posted: Array<{ readonly action: string; readonly body: unknown }> = [];
let answers: Array<() => Response | Promise<Response>> = [];
const answerWith =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A POST answered only when the test says, and a promise of the moment it was sent. */
function heldAnswer() {
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

beforeEach(() => {
  resetThreadTabs();
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  posted.length = 0;
  answers = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      posted.push({ action: url.split("/").at(-1) ?? "", body: JSON.parse(String(init.body)) });
      const next = answers.shift();
      return next === undefined ? answerWith(snapshot([]))() : next();
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the strip from the server's list", () => {
  const reconcile = (
    state: ThreadRightPanelState,
    listed: readonly string[],
    kept: readonly string[] = [],
  ) => reconcileThreadTabs(state, { listed, kept: new Set(kept), viewOrigin });

  it("adds listed tabs at the end without opening a closed panel or activating them", () => {
    const state = { isOpen: false, activeSurfaceId: files.id, surfaces: [files] };
    expect(reconcile(state, [id(1), id(2)])).toEqual({
      isOpen: false,
      activeSurfaceId: files.id,
      surfaces: [files, tab(1), tab(2)],
    });
  });

  it("selects the first tab where nothing is selected, so the panel never opens on Nová karta beside them", () => {
    expect(
      reconcile({ isOpen: false, activeSurfaceId: null, surfaces: [] }, [id(1), id(2)]),
    ).toEqual({ isOpen: false, activeSurfaceId: tab(1).id, surfaces: [tab(1), tab(2)] });
    // A panel stored with tabs and no selection takes one even when the list brings nothing new.
    const unselected = { isOpen: true, activeSurfaceId: null, surfaces: [tab(1)] };
    expect(reconcile(unselected, [id(1)])).toEqual({ ...unselected, activeSurfaceId: tab(1).id });
    // An empty strip stays as it is.
    const empty = { isOpen: true, activeSurfaceId: null, surfaces: [] };
    expect(reconcile(empty, [])).toBe(empty);
  });

  it("selects another Environment's tab the server announces where nothing is selected", () => {
    setPanel({ isOpen: true, activeSurfaceId: null, surfaces: [] });
    receiveSnapshot(threadA, snapshot([]));
    receiveForeign(threadA, { tabId: "ab".repeat(16), view: foreign.view });
    expect(panel()).toEqual({ isOpen: true, activeSurfaceId: foreign.id, surfaces: [foreign] });
  });

  it("drops this Environment's unlisted tabs and keeps pending ones, Nová karta and other Environments' tabs", () => {
    const newTab = newTabSurface();
    const state = {
      isOpen: true,
      activeSurfaceId: files.id,
      surfaces: [tab(1), files, newTab, foreign, tab(2), tab(3)],
    };
    expect(reconcile(state, [id(1)], [id(3)]).surfaces).toEqual([
      tab(1),
      files,
      newTab,
      foreign,
      tab(3),
    ]);
  });

  it("drops lazurio.7's leftovers: the thread's own tab, the bare-origin new tabs and stored views", () => {
    const state = {
      isOpen: true,
      activeSurfaceId: "environment-browser",
      surfaces: [
        { id: "environment-browser", kind: "environment-browser" },
        { id: "environment-browser:new:1234", kind: "environment-browser", view: `${viewOrigin}/` },
        {
          id: `environment-browser:${id(4).toLowerCase()}`,
          kind: "environment-browser",
          view: `${viewOrigin}/t/${id(4).toLowerCase()}`,
        },
        files,
      ],
    } as unknown as ThreadRightPanelState;
    // An active surface that went falls back as upstream's reconciliation does.
    expect(reconcile(state, [id(4).toLowerCase()])).toEqual({
      isOpen: true,
      activeSurfaceId: tab(4).id,
      surfaces: [files, tab(4)],
    });
  });

  it("keeps the order a person dragged the tabs into", () => {
    setPanel({ isOpen: true, activeSurfaceId: tab(1).id, surfaces: [tab(1), tab(2), files] });
    useRightPanelStore.getState().moveSurface(threadA, tab(2).id, 0);
    receiveSnapshot(threadA, snapshot([{ tabId: id(1) }, { tabId: id(2) }, { tabId: id(3) }]));
    expect(panel().surfaces).toEqual([tab(2), tab(1), files, tab(3)]);
  });

  it("leaves the store as it is while the server says unavailable", () => {
    setPanel({ isOpen: true, activeSurfaceId: tab(1).id, surfaces: [tab(1)] });
    const before = useRightPanelStore.getState().byThreadKey;
    receiveSnapshot(threadA, { available: false });
    expect(useRightPanelStore.getState().byThreadKey).toBe(before);
  });

  it("reads only the server's own shapes, with upper-case ids", () => {
    expect(parseThreadTabsAnswer({ available: false })).toEqual({ available: false });
    expect(parseThreadTabsAnswer(snapshot([{ tabId: id(1) }]))).toEqual(
      snapshot([{ tabId: id(1) }]),
    );
    for (const bad of [
      null,
      [],
      { available: true },
      { ...snapshot([]), viewOrigin: "http://browser.example" },
      { ...snapshot([]), viewOrigin: `${viewOrigin}/` },
      { ...snapshot([]), tabs: [{ tabId: "ab".repeat(16) }] },
      { ...snapshot([]), tabs: "x" },
    ]) {
      expect(parseThreadTabsAnswer(bad)).toBeNull();
    }
  });
});

describe("reveals", () => {
  it("take the first snapshot as a baseline, then open each new request once", () => {
    const first = freshReveals(
      null,
      snapshot([{ tabId: id(1), revealRequest: { id: "epoch-1:1" } }]),
    );
    expect(first.reveal).toEqual([]);
    const second = freshReveals(
      first.baseline,
      snapshot([
        { tabId: id(1), revealRequest: { id: "epoch-1:1" } },
        { tabId: id(2), revealRequest: { id: "epoch-1:2" } },
      ]),
    );
    expect(second.reveal).toEqual([id(2)]);
    // A later reveal of the same tab is new again; another epoch is a baseline again.
    expect(
      freshReveals(
        second.baseline,
        snapshot([{ tabId: id(1), revealRequest: { id: "epoch-1:3" } }]),
      ).reveal,
    ).toEqual([id(1)]);
    expect(
      freshReveals(
        second.baseline,
        snapshot([{ tabId: id(3), revealRequest: { id: "epoch-2:1" } }], { epoch: "epoch-2" }),
      ).reveal,
    ).toEqual([]);
  });

  it("open an inline panel on the revealed tab, and never a sheet over the chat", () => {
    syncOf(threadA).inlinePanel = false;
    receiveSnapshot(threadA, snapshot([]));
    receiveSnapshot(threadA, snapshot([{ tabId: id(1), revealRequest: { id: "epoch-1:1" } }]));
    expect(panel()).toMatchObject({ isOpen: false, surfaces: [tab(1)] });
    syncOf(threadA).inlinePanel = true;
    receiveSnapshot(threadA, snapshot([{ tabId: id(1), revealRequest: { id: "epoch-1:2" } }]));
    expect(panel()).toEqual({ isOpen: true, activeSurfaceId: tab(1).id, surfaces: [tab(1)] });
  });

  it("leave the agent's tab of a thread that comes into view selected, for the panel the person opens", () => {
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
    const hold = heldAnswer();
    showOwnTab(threadA, id(1), true);
    expect(panel()).toEqual({ isOpen: true, activeSurfaceId: tab(1).id, surfaces: [tab(1)] });
    // A snapshot from before the hold does not drop the pending tab.
    receiveSnapshot(threadA, snapshot([]));
    expect(panel().surfaces).toEqual([tab(1)]);
    await hold.wasSent;
    hold.answer(answerWith(snapshot([{ tabId: id(1) }]))());
    await settled();
    expect(syncOf(threadA).pending.size).toBe(0);
    expect(posted).toEqual([{ action: "hold", body: { threadId: "thread-A", tabId: id(1) } }]);
    expect(panel().surfaces).toEqual([tab(1)]);
  });

  it("retry a failure that may pass while the tab is in the strip, and keep a refused tab as the device's own", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const warn = vi.spyOn(toastManager, "add");
    answers.push(
      answerWith({ error: "hold-failed" }, 503),
      answerWith({ error: "too-many-tabs" }, 409),
    );
    showOwnTab(threadA, id(1), true);
    await settled();
    expect(posted).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await settled();
    expect(posted).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(syncOf(threadA).local.has(id(1))).toBe(true);
    // The device keeps it although the thread's list lacks it.
    receiveSnapshot(threadA, snapshot([]));
    expect(panel().surfaces).toEqual([tab(1)]);
  });

  it("stop retrying a failure that does not pass after about a minute, keeping the tab as the device's own", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const warn = vi.spyOn(toastManager, "add");
    for (let attempt = 0; attempt < 10; attempt += 1) {
      answers.push(answerWith({ error: "unavailable" }, 503));
    }
    showOwnTab(threadA, id(1), true);
    await settled();
    for (const pause of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]) {
      await vi.advanceTimersByTimeAsync(pause);
      await settled();
    }
    expect(posted).toHaveLength(7);
    expect(syncOf(threadA).pending.size).toBe(0);
    expect(syncOf(threadA).local.has(id(1))).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    await settled();
    expect(posted).toHaveLength(7);
    expect(panel().surfaces).toEqual([tab(1)]);
  });

  it("do not retry a failed hold once × let go of the tab", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    answers.push(
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
    expect(posted.map((entry) => entry.action)).toEqual(["hold", "release"]);
    expect(panel().surfaces).toEqual([]);
    expect(syncOf(threadA).pending.size).toBe(0);
  });
});

describe("closing in the strip and Vrátit", () => {
  it("lets go of a closed tab with one release and offers Vrátit for 7 s", async () => {
    const toasts = vi.spyOn(toastManager, "add");
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
    expect(posted).toEqual([{ action: "release", body: { threadId: "thread-A", tabId: id(1) } }]);
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
    expect(posted.at(-1)).toEqual({ action: "hold", body: { threadId: "thread-A", tabId: id(1) } });
  });

  it("do not retry a failed release once Vrátit held the tab again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const toasts = vi.spyOn(toastManager, "add");
    answers.push(
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
    expect(posted.map((entry) => entry.action)).toEqual(["release", "hold"]);
    expect(panel().surfaces).toEqual([files, tab(1)]);
    expect(syncOf(threadA).released.size).toBe(0);
  });

  it("hides a released tab from older snapshots until the release lands", async () => {
    setPanel({ isOpen: true, activeSurfaceId: files.id, surfaces: [files, tab(1)] });
    receiveSnapshot(threadA, snapshot([{ tabId: id(1) }]));
    const release = heldAnswer();
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
    setPanel({ isOpen: true, activeSurfaceId: tab(1).id, surfaces: [tab(1), tab(2)] });
    receiveSnapshot(threadA, snapshot([{ tabId: id(1) }, { tabId: id(2) }]));
    const toasts = vi.spyOn(toastManager, "add");
    tabEnded(threadA, tab(1).id);
    expect(panel()).toEqual({ isOpen: true, activeSurfaceId: tab(2).id, surfaces: [tab(2)] });
    receiveSnapshot(threadA, snapshot([{ tabId: id(1) }, { tabId: id(2) }]));
    expect(panel().surfaces).toEqual([tab(2)]);
    await settled();
    expect(posted).toEqual([{ action: "release", body: { threadId: "thread-A", tabId: id(1) } }]);
    expect(toasts).not.toHaveBeenCalled();
    // Once a list lacks it, it is forgotten.
    receiveSnapshot(threadA, snapshot([{ tabId: id(2) }]));
    expect(syncOf(threadA).ended.size).toBe(0);
  });

  it("a tab whose view ended leaves as upstream's × would, and the panel closes with the last one", () => {
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
  });

  it("says what becomes of the tabs, from the agent and the other holders", () => {
    const shared = { tabId: id(1), view: "", agent: false, alsoHeldBy: [] };
    expect(closeToastText([{ ...shared, agent: true }], true)).toEqual({
      title: "Záložka zmizela z tohoto vlákna.",
      description: "Pracuje v ní agent, takže zůstává otevřená.",
    });
    expect(
      closeToastText(
        [
          {
            ...shared,
            alsoHeldBy: [
              { strip: "launchpad", label: "Launchpad" },
              { strip: "t3-b", label: "Web" },
            ],
          },
        ],
        true,
      ).description,
    ).toBe("Dál je v Apps a ve vlákně „Web“.");
    expect(closeToastText([shared], true).description).toBe("Zavře se v Prostředí.");
    expect(closeToastText([shared, { ...shared, agent: true }], false)).toEqual({
      title: "The tabs left this thread.",
      description:
        "Some stay open elsewhere or with an agent; the others close in the Environment.",
    });
  });
});

describe("the order of snapshots", () => {
  it("lets a POST answer older than the stream's newest list change nothing, and the strip follow that list", async () => {
    receiveSnapshot(threadA, snapshot([], { revision: 1 }));
    const hold = heldAnswer();
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

describe("the shared hint", () => {
  it("names Apps, other threads and other strips, and an agent at work", () => {
    const holders = [
      { strip: "launchpad", label: "Launchpad" },
      { strip: "t3-b", label: "Web shop" },
      { strip: "mausbot", label: "Automate" },
    ];
    expect(placesOf(holders, true)).toBe("v Apps, ve vlákně „Web shop“ a Automate");
    expect(placesOf(holders, false)).toBe("in Apps, in the thread “Web shop” and Automate");
    expect(
      tabTooltip(
        "Docs",
        { tabId: id(1), view: "", agent: true, alsoHeldBy: holders.slice(0, 1) },
        true,
      ),
    ).toBe("Docs · pracuje tu agent · sdílená, je i v Apps");
    expect(tabTooltip("Docs", undefined, false)).toBe("Docs");
  });
});

describe("Nová karta's surface", () => {
  it("is what the store opens for the overlay's kind", () => {
    useRightPanelStore.getState().open(threadA, "environment-browser");
    const [surface] = panel().surfaces as RightPanelSurface[];
    expect(surface !== undefined && isNewTabSurface(surface)).toBe(true);
    expect(isNewTabSurface(newTabSurface())).toBe(true);
    expect(isNewTabSurface(tab(1))).toBe(false);
  });

  it("holds a page in Nová karta's place, and brings a tab the strip has to the front instead", async () => {
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
    expect(posted.map((entry) => entry.action)).toEqual(["hold", "hold"]);
  });
});

it("holdTab is idempotent for a tab the thread holds already", async () => {
  holdTab(threadA, id(1).toLowerCase());
  await settled();
  expect(posted).toEqual([{ action: "hold", body: { threadId: "thread-A", tabId: id(1) } }]);
});
