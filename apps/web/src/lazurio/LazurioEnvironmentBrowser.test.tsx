// @vitest-environment jsdom

import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, type ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  type RightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";
import type { ThreadActivity } from "./browserUse";
import {
  LazurioRightPanelSurfaces,
  useLazurioEnvironmentBrowserFromChat,
} from "./LazurioEnvironmentBrowser";

// The threads below are of the page's own environment.
vi.mock("../state/environments", () => ({ usePrimaryEnvironmentId: () => "env-1" }));

const viewOrigin = "https://browser.vm-01.example.lazurio.io";
const pageTab = (target: string) =>
  ({
    id: `environment-browser:${target}`,
    kind: "environment-browser",
    view: `${viewOrigin}/t/${target}`,
  }) as const;
const first = pageTab("0123456789abcdef".repeat(2));
const second = pageTab("fedcba9876543210".repeat(2));
const opened = pageTab("00112233445566778899aabbccddeeff");
const files = { id: "files", kind: "files" } as const;
const threadA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const threadB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function showPanel(
  threadRef: ScopedThreadRef,
  surfaces: readonly RightPanelSurface[],
  activeSurfaceId: string,
) {
  await act(async () =>
    root.render(
      <LazurioRightPanelSurfaces
        threadRef={threadRef}
        surfaces={surfaces}
        activeSurfaceId={activeSurfaceId}
      >
        {activeSurfaceId === files.id ? <p>Files in view</p> : null}
      </LazurioRightPanelSurfaces>,
    ),
  );
}

function frameOf(surface: { readonly view: string }): HTMLIFrameElement {
  const frame = container.querySelector<HTMLIFrameElement>(`iframe[src="${surface.view}"]`);
  if (frame === null) throw new Error(`No frame shows ${surface.view}`);
  return frame;
}

const isHidden = (frame: HTMLIFrameElement) => frame.closest("[inert]") !== null;

describe("the panel's Environment browser frames", () => {
  it("stay mounted while the panel shows the thread, only the active one in view", async () => {
    const surfaces = [first, files, second];
    await showPanel(threadA, surfaces, first.id);
    const [firstFrame, secondFrame] = [frameOf(first), frameOf(second)];
    expect([isHidden(firstFrame), isHidden(secondFrame)]).toEqual([false, true]);

    await showPanel(threadA, surfaces, second.id);
    expect(frameOf(first)).toBe(firstFrame);
    expect(frameOf(second)).toBe(secondFrame);
    expect([isHidden(firstFrame), isHidden(secondFrame)]).toEqual([true, false]);

    // Another kind of surface in view: both frames stay, both hidden.
    await showPanel(threadA, surfaces, files.id);
    expect(container.textContent).toContain("Files in view");
    expect(frameOf(first)).toBe(firstFrame);
    expect(frameOf(second)).toBe(secondFrame);
    expect([isHidden(firstFrame), isHidden(secondFrame)]).toEqual([true, true]);

    // Closing a tab ends its frame and keeps the others.
    await showPanel(threadA, [first, files], files.id);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(frameOf(first)).toBe(firstFrame);

    // Another thread's panel has frames of its own.
    await showPanel(threadB, [first], first.id);
    expect(frameOf(first)).not.toBe(firstFrame);
  });

  it("puts a page's new tab in front only from the tab in view", async () => {
    const key = scopedThreadKey(threadA);
    useRightPanelStore.setState({
      byThreadKey: {
        [key]: { isOpen: true, activeSurfaceId: first.id, surfaces: [first, second] },
      },
    });
    await showPanel(threadA, [first, second], first.id);
    const announce = (frame: HTMLIFrameElement) =>
      act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "lazurio-browser:new-tab", view: opened.view, url: "https://a.example/" },
            origin: viewOrigin,
            source: frame.contentWindow,
          }),
        );
      });
    const panel = () =>
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadA);

    // From the hidden tab: it joins the panel behind the tab in view.
    await announce(frameOf(second));
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: first.id,
      surfaces: [first, second, opened],
    });
    expect(useRightPanelStore.getState().getUserActionRevision(threadA)).toBe(0);

    // From the tab in view: it comes to the front, as in the person's browser.
    useRightPanelStore.setState({
      byThreadKey: {
        [key]: { isOpen: true, activeSurfaceId: first.id, surfaces: [first, second] },
      },
    });
    await announce(frameOf(first));
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: opened.id,
      surfaces: [first, second, opened],
    });
  });

  it("leave the desktop app's panel as it is", async () => {
    vi.stubGlobal("desktopBridge", { preview: {} });
    await showPanel(threadA, [first, files], files.id);
    expect(container.querySelectorAll("iframe")).toHaveLength(0);
    expect(container.innerHTML).toBe("<p>Files in view</p>");
  });
});

describe("the chat and the Environment browser", () => {
  const ownTab = `${viewOrigin}/t/${"8A3F0C2D4E5B6A79".repeat(2)}`;
  const browse = (id: string, second: number, call = id, kind = "tool.started") => ({
    id,
    kind,
    turnId: "turn-1",
    createdAt: `2026-10-08T10:00:${String(second).padStart(2, "0")}.000Z`,
    payload: {
      itemType: "command_execution",
      toolCallId: call,
      data: { command: "agent-browser --cdp 9222 snapshot -i" },
    },
  });
  // What the Environment answers at /.lazurio/browser.json on this page's origin.
  const answer = () => {
    const body = JSON.stringify({ available: true, view: ownTab, session: null });
    const response = new Response(body, { headers: { "content-type": "application/json" } });
    Object.defineProperty(response, "url", {
      value: `${window.location.origin}/.lazurio/browser.json`,
    });
    return response;
  };
  const panel = () =>
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadA);

  function Chat(props: {
    readonly activities: ReadonlyArray<ThreadActivity>;
    readonly live?: boolean;
    readonly inlinePanel?: boolean;
  }) {
    useLazurioEnvironmentBrowserFromChat({
      threadRef: threadA,
      activities: props.activities,
      live: props.live ?? true,
      inlinePanel: props.inlinePanel ?? true,
    });
    return null;
  }
  const showChat = (props: Parameters<typeof Chat>[0]) =>
    act(async () => root.render(<Chat {...props} />));
  // The Environment's answer and the opening it leads to.
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

  it("opens the panel on the thread's own tab when its agent starts to use the browser", async () => {
    const fetch = vi.fn(async () => answer());
    vi.stubGlobal("fetch", fetch);
    const history = [browse("before", 1)];
    await showChat({ activities: history });
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    expect(panel().isOpen).toBe(false);

    const started = [...history, browse("call", 2)];
    await showChat({ activities: started });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(panel()).toEqual({
      isOpen: true,
      activeSurfaceId: "environment-browser",
      surfaces: [{ id: "environment-browser", kind: "environment-browser" }],
    });
    // The app opened it, not the person.
    expect(useRightPanelStore.getState().getUserActionRevision(threadA)).toBe(0);

    // The person closes it: the call going on leaves it closed, the agent's next call opens it.
    act(() => useRightPanelStore.getState().close(threadA));
    const ended = [...started, browse("call-done", 3, "call", "tool.completed")];
    await showChat({ activities: ended });
    await settle();
    expect(panel().isOpen).toBe(false);
    await showChat({ activities: [...ended, browse("next", 4)] });
    await settle();
    expect(panel().isOpen).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("leaves the panel for the backlog, on a narrow screen, without the browser, and while it shows", async () => {
    const fetch = vi.fn(async () => answer());
    vi.stubGlobal("fetch", fetch);
    // A thread that loads: its backlog arrives before it is live.
    await showChat({ activities: [], live: false });
    await showChat({ activities: [browse("a", 1)], live: false });
    await showChat({ activities: [browse("a", 1)] });
    // On a narrow screen the panel is a sheet over the chat and its composer.
    await showChat({ activities: [browse("a", 1), browse("b", 2)], inlinePanel: false });
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    expect(panel().isOpen).toBe(false);

    // An Environment without the browser: T3 answers its own page.
    fetch.mockImplementation(
      async () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } }),
    );
    await showChat({ activities: [browse("a", 1), browse("b", 2), browse("c", 3)] });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(panel().isOpen).toBe(false);

    // The person picked the Environment browser already: nothing to ask.
    act(() => useRightPanelStore.getState().open(threadA, "environment-browser"));
    await showChat({
      activities: [browse("a", 1), browse("b", 2), browse("c", 3), browse("d", 4)],
    });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not open over a choice the person made while the Environment was asked", async () => {
    let respond = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (respond = () => resolve(answer())))),
    );
    await showChat({ activities: [] });
    await showChat({ activities: [browse("a", 1)] });
    act(() => useRightPanelStore.getState().open(threadA, "files"));
    respond();
    await settle();
    expect(panel()).toMatchObject({ isOpen: true, activeSurfaceId: "files" });
  });
});
