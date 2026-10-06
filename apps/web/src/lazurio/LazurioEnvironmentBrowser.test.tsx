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
import { LazurioRightPanelSurfaces } from "./LazurioEnvironmentBrowser";

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
