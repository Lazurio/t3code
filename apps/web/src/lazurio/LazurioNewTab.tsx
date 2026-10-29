/**
 * Lazurio overlay (LazurioPlatform F47 points 2 and 10): where the shell defines `<lazurio-new-tab>`
 * and the server keeps the thread's tabs, "+", Mod+T and the empty panel open Nová karta instead of
 * upstream's menu and list. Its tools are upstream's "+" actions without Browser, which the address
 * bar replaces; elsewhere upstream's menu and empty state stay.
 */

import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { Globe2, Plus } from "lucide-react";
import { createElement, useEffect, useState } from "react";
import { create } from "zustand";

import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { surfaceShortcutTargetsTypingContext } from "../components/RightPanelTabs";
import { useRightPanelStore } from "../rightPanelStore";
import {
  chooseTab,
  type EnvironmentBrowserSurface,
  newTabSurface,
  panelOf,
  prefersCzech,
  snapshotOf,
  useThreadTabsStore,
} from "./threadTabs";

export const NEW_TAB_ELEMENT = "lazurio-new-tab";

/** One of the app's tools as the element takes them (`parseNewTabTools` of the Platform). */
export interface NewTabTool {
  readonly id: string;
  readonly label: string;
  readonly key: string;
  readonly icon: string;
}

/** What Nová karta became (the element's `lazurio-new-tab` event). */
export type NewTabChoice =
  | { readonly kind: "page" | "tab"; readonly tab: string; readonly view: string }
  | { readonly kind: "tool"; readonly id: string };

/** Upstream's "+" action, as RightPanelTabs lists them. */
export interface SurfaceAction {
  readonly label: string;
  readonly shortcut: string;
  readonly available: boolean;
  readonly onClick: () => void;
}

const MAX_TOOLS = 12;
const toolId = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** The element's tools: the available actions without Browser, which the address bar replaces. */
export function newTabTools(actions: ReadonlyArray<SurfaceAction>): NewTabTool[] {
  return actions
    .filter((action) => action.available && action.label !== "Browser")
    .map((action) => {
      const id = toolId(action.label);
      return { id, label: action.label, key: action.shortcut, icon: id };
    })
    .slice(0, MAX_TOOLS);
}

/** The element's choice, read field by field; null for anything else. */
export function parseNewTabChoice(detail: unknown): NewTabChoice | null {
  if (typeof detail !== "object" || detail === null) return null;
  const choice = detail as Record<string, unknown>;
  if (choice.kind === "tool") {
    return typeof choice.id === "string" ? { kind: "tool", id: choice.id } : null;
  }
  if (choice.kind !== "page" && choice.kind !== "tab") return null;
  if (typeof choice.tab !== "string" || !/^[0-9A-Fa-f]{32}$/.test(choice.tab)) return null;
  if (typeof choice.view !== "string") return null;
  return { kind: choice.kind, tab: choice.tab.toUpperCase(), view: choice.view };
}

/** The view of `tab` exactly, on the thread's view origin: `<viewOrigin>/t/<tab>`. */
const isViewOf = (view: string, tab: string, viewOrigin: string) => {
  try {
    const url = new URL(view);
    return (
      url.origin === viewOrigin &&
      url.pathname.toUpperCase() === `/T/${tab}` &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
};

/** Whether the shell defines the element, and the tools upstream's "+" offers now. */
const useNewTabStore = create<{ readonly defined: boolean; readonly tools: readonly NewTabTool[] }>(
  () => ({
    defined:
      typeof customElements !== "undefined" && customElements.get(NEW_TAB_ELEMENT) !== undefined,
    tools: [],
  }),
);
if (typeof customElements !== "undefined") {
  void customElements
    .whenDefined(NEW_TAB_ELEMENT)
    .then(() => useNewTabStore.setState({ defined: true }));
}

/** Whether this page's shell defines Nová karta: the page is a Lazurio Environment's. */
export const useNewTabDefined = () => useNewTabStore((state) => state.defined);

/** Upstream's actions as RightPanelTabs last rendered them: each runs in Nová karta's place. */
let publishedActions: ReadonlyArray<SurfaceAction> = [];

/**
 * Runs upstream's action for `id`. In a Nová karta tab (`newTabId`), the surface it opens takes
 * that tab's place; one it only brings to the front leaves Nová karta out; one that opens nothing
 * (a setup dialog) leaves Nová karta as it is. An id that is no published tool is ignored.
 */
function runTool(threadRef: ScopedThreadRef, newTabId: string | null, id: string): void {
  const action = publishedActions.find(
    (entry) => entry.available && entry.label !== "Browser" && toolId(entry.label) === id,
  );
  if (action === undefined) return;
  const before = panelOf(threadRef).surfaces;
  action.onClick();
  if (newTabId === null) return;
  const opened = panelOf(threadRef).activeSurfaceId;
  if (opened === null || opened === newTabId) return;
  const wasThere = before.some((surface) => surface.id === opened);
  useRightPanelStore.getState().lazurio(threadRef, true, (current) => {
    const index = current.surfaces.findIndex((surface) => surface.id === newTabId);
    if (index < 0) return current;
    const surfaces = current.surfaces.filter((surface) => surface.id !== newTabId);
    const moved = surfaces.find((surface) => surface.id === opened);
    if (!wasThere && moved !== undefined) {
      surfaces.splice(surfaces.indexOf(moved), 1);
      surfaces.splice(index, 0, moved);
    }
    return { ...current, surfaces };
  });
}

/** What Nová karta became: a page or tab on the thread's view origin, or a tool. */
function chooseInNewTab(
  threadRef: ScopedThreadRef,
  newTabId: string | null,
  choice: NewTabChoice,
): void {
  if (choice.kind === "tool") {
    runTool(threadRef, newTabId, choice.id);
    return;
  }
  const snapshot = snapshotOf(threadRef);
  if (snapshot === undefined || snapshot === null) return;
  if (!isViewOf(choice.view, choice.tab, snapshot.viewOrigin)) return;
  chooseTab(threadRef, newTabId, choice.tab);
}

const sameTools = (left: readonly NewTabTool[], right: readonly NewTabTool[]) =>
  left.length === right.length &&
  left.every((tool, index) => {
    const other = right[index];
    return other !== undefined && other.id === tool.id && other.key === tool.key;
  });

/** The thread in view while the server keeps its tabs, else null. */
const threadWithTabs = (state: ReturnType<typeof useThreadTabsStore.getState>) =>
  state.inView !== null && (state.snapshots[scopedThreadKey(state.inView)] ?? null) !== null
    ? state.inView
    : null;

/**
 * Whether "+" and the empty panel open Nová karta for the thread in view: the shell defines the
 * element, the server keeps the thread's tabs, and the thread is of this page's own environment.
 * While they do, it publishes upstream's current "+" actions as Nová karta's tools.
 */
export function useNewTab(actions: ReadonlyArray<SurfaceAction>): boolean {
  const available = useThreadTabsStore((state) => threadWithTabs(state) !== null);
  const defined = useNewTabStore((state) => state.defined);
  const newTab = available && defined;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the current "+" actions to a module the keydown handler reads
  useEffect(() => {
    if (!newTab) return;
    publishedActions = actions;
    const tools = newTabTools(actions);
    if (!sameTools(tools, useNewTabStore.getState().tools)) useNewTabStore.setState({ tools });
  });
  return newTab;
}

/**
 * Adds a Nová karta tab, in front, where "+" is Nová karta's (`useNewTab`), and says whether it
 * did. "+" runs it, and so does its shortcut Mod+T (RightPanelTabs `onNewSurfaceKeyDown`), which
 * reads the stores when pressed and needs no hook; elsewhere Mod+T opens upstream's menu.
 */
export function openNewTab(): boolean {
  const threadRef = threadWithTabs(useThreadTabsStore.getState());
  if (threadRef === null || !useNewTabStore.getState().defined) return false;
  const surface = newTabSurface();
  useRightPanelStore.getState().lazurio(threadRef, false, (current) => ({
    ...current,
    isOpen: true,
    surfaces: [...current.surfaces, surface],
    activeSurfaceId: surface.id,
  }));
  return true;
}

/** "+" where Nová karta is available: a new Nová karta tab, in front. */
export function NewTabButton() {
  return (
    <Button
      aria-label={prefersCzech() ? "Nová karta" : "New tab"}
      className="shrink-0"
      size="icon-xs"
      variant="ghost-muted"
      onClick={() => {
        openNewTab();
      }}
    >
      <Plus className="size-3.5" />
    </Button>
  );
}

/** Overlays that must win over the tools' letters, open or closing: a closed popup that stays
 * mounted does not (upstream's LAUNCHER_SHORTCUT_BLOCKING_LAYERS). */
const LETTER_BLOCKING_LAYERS = [
  "dialog-popup",
  "alert-dialog-popup",
  "command-dialog-popup",
  "menu-popup",
  "select-popup",
  "popover-popup",
  "combobox-popup",
  "autocomplete-popup",
]
  .map((slot) => `[data-slot="${slot}"]:is([data-open],[data-ending-style])`)
  .join(",");

/** Nová karta for a thread: the element, its choices, and the tools' letters while it is shown and
 * the focus is in T3 Code's document (inside the frame, the page passes letters on itself). */
function NewTabView(props: {
  readonly threadRef: ScopedThreadRef;
  readonly newTabId: string | null;
}) {
  const { threadRef, newTabId } = props;
  const snapshot = useThreadTabsStore((state) => state.snapshots[scopedThreadKey(threadRef)]);
  const tools = useNewTabStore((state) => state.tools);
  // The composer's type-to-focus runs first once the panel opens after page load, so it must
  // see which letters are Nová karta's, as with upstream's launcher.
  const launcherKeys = tools.map((tool) => tool.key).join("");
  // A callback ref: the element mounts only once the server's list came, and its listener then.
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [czech] = useState(prefersCzech);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the custom element's choice event
  useEffect(() => {
    if (element === null) return;
    const listen = (event: Event) => {
      const choice = parseNewTabChoice((event as CustomEvent<unknown>).detail);
      if (choice !== null) chooseInNewTab(threadRef, newTabId, choice);
    };
    element.addEventListener(NEW_TAB_ELEMENT, listen);
    return () => element.removeEventListener(NEW_TAB_ELEMENT, listen);
  }, [element, threadRef, newTabId]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a document keydown listener for the tools' letters
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      const tool = tools.find((entry) => entry.key.toLowerCase() === event.key.toLowerCase());
      if (
        tool === undefined ||
        document.querySelector(LETTER_BLOCKING_LAYERS) ||
        (event.target instanceof Element && surfaceShortcutTargetsTypingContext(event.target))
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      runTool(threadRef, newTabId, tool.id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [threadRef, newTabId, tools]);

  if (snapshot === undefined || snapshot === null) {
    return (
      <div
        aria-label={czech ? "Nová karta" : "New tab"}
        className="flex min-h-0 w-full flex-1 outline-none"
        data-surface-launcher-keys={launcherKeys}
        data-workspace-focus-default
        tabIndex={0}
      >
        <Empty className="min-h-0">
          <EmptyMedia variant="icon">
            <Globe2 />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>{czech ? "Nová karta" : "New tab"}</EmptyTitle>
            <EmptyDescription>
              {czech
                ? "Nová karta se ukáže, až Prostředí nabídne svůj prohlížeč."
                : "New tab shows once the Environment offers its browser."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }
  return createElement(NEW_TAB_ELEMENT, {
    ref: setElement,
    "aria-label": czech ? "Nová karta" : "New tab",
    strip: snapshot.strip,
    tools: JSON.stringify(tools),
    "data-surface-launcher-keys": launcherKeys,
    // F6 and opening the panel focus the surface's default target, as upstream's empty panel.
    "data-workspace-focus-default": "",
    tabIndex: 0,
    className: "flex min-h-0 w-full flex-1 outline-none",
  });
}

/** The empty panel where Nová karta is available: Nová karta, adding a tab or running a tool. */
export function NewTab() {
  const inView = useThreadTabsStore((state) => state.inView);
  return inView === null ? null : <NewTabView threadRef={inView} newTabId={null} />;
}

/** A Nová karta tab of the strip; its choice takes its place. */
export function NewTabSurface(props: {
  readonly threadRef: ScopedThreadRef;
  readonly surface: EnvironmentBrowserSurface;
}) {
  return <NewTabView threadRef={props.threadRef} newTabId={props.surface.id} />;
}
