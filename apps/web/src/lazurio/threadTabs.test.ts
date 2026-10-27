import { describe, expect, it } from "vite-plus/test";

import type { ThreadRightPanelState } from "../rightPanelStore";
import {
  closeToastText,
  freshReveals,
  newTabSurface,
  parseThreadTabsAnswer,
  placesOf,
  reconcileThreadTabs,
  tabSurfaceId,
  tabTooltip,
  type ThreadTab,
  type ThreadTabsSnapshot,
} from "./threadTabs";

// The pure part of threadTabs.ts; the client state (the stores, the POSTs, the toasts) runs in
// threadTabs.browser.test.ts.

const viewOrigin = "https://browser.vm-01.example.lazurio.io";
const id = (n: number) => n.toString(16).toUpperCase().padStart(32, "0");
const tab = (n: number) => ({ id: tabSurfaceId(id(n)), kind: "environment-browser" }) as const;
const foreign = {
  id: `environment-browser:${"ab".repeat(16)}`,
  kind: "environment-browser",
  view: `https://browser.vm-02.acme.lazurio.io/t/${"ab".repeat(16)}`,
} as const;
const files = { id: "files", kind: "files" } as const;

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
});

describe("the words", () => {
  it("say what becomes of the tabs, from the agent and the other holders", () => {
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

  it("name Apps, other threads and other strips, and an agent at work, in the shared hint", () => {
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
