import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

// A server of the thread the panel lists, whether this client has upstream's preview, and
// upstream's open it would otherwise call.
const state = vi.hoisted(() => ({
  previewAvailable: false,
  openDiscoveredPort: vi.fn(async () => ({ _tag: "Success" as const, value: undefined })),
}));
vi.mock(import("~/portDiscoveryState"), async (original) => ({
  ...(await original()),
  useThreadDiscoveredPorts: (() => [
    {
      host: "localhost",
      port: 5173,
      url: "http://localhost:5173/",
      processName: "vite",
      pid: 4242,
      terminal: { threadId: "thread-A", terminalId: "default" },
    },
  ]) as never,
}));
vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: (() => true) as never,
}));
vi.mock(import("~/browser/previewRuntime"), async (original) => ({
  ...(await original()),
  isPreviewAvailableFor: () => state.previewAvailable,
}));
vi.mock(import("~/components/preview/openDiscoveredPort"), () => ({
  openDiscoveredPort: state.openDiscoveredPort as never,
}));

import { ThreadServersPanel } from "~/components/chat/ThreadServersPanel";
import { toastManager } from "~/components/ui/toast";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";
import { render, stubGlobal } from "../../test/render";
import { receiveSnapshot, resetThreadTabs, tabSurfaceId } from "./threadTabs";

const environmentId = EnvironmentId.make("env-1");
const threadId = ThreadId.make("thread-A");
const threadRef = scopeThreadRef(environmentId, threadId);
const tabId = "C".repeat(32);
const viewOrigin = "https://browser.vm-01.example.lazurio.io";

function setup(previewAvailable: boolean) {
  resetThreadTabs();
  state.previewAvailable = previewAvailable;
  state.openDiscoveredPort.mockClear();
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
}

describe("a server of the Servers panel on an Environment with its browser", () => {
  it("opens in a new Environment browser tab in front, not in upstream's preview", async () => {
    setup(false);
    receiveSnapshot(threadRef, {
      available: true,
      epoch: "epoch-1",
      revision: 1,
      threadId: "thread-A",
      strip: "t3-thread-A",
      viewOrigin,
      tabs: [],
    });
    const posted: Array<{ readonly action: string; readonly body: unknown }> = [];
    using _fetch = stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const action = url.split("/").at(-1) ?? "";
      posted.push({ action, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(action === "open" ? { tabId } : { available: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await using screen = await render(
      <ThreadServersPanel environmentId={environmentId} threadId={threadId} />,
    );

    await userEvent.click(screen.getByText("localhost:5173"));

    await vi.waitFor(() =>
      expect(
        selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef),
      ).toEqual({
        isOpen: true,
        activeSurfaceId: tabSurfaceId(tabId),
        surfaces: [{ id: tabSurfaceId(tabId), kind: "environment-browser" }],
      }),
    );
    expect(posted[0]).toEqual({
      action: "open",
      body: { threadId: "thread-A", url: "http://localhost:5173/" },
    });
    expect(state.openDiscoveredPort).not.toHaveBeenCalled();
  });

  it("says so without a strip, since a Lazurio Environment has no upstream preview", async () => {
    setup(false);
    receiveSnapshot(threadRef, { available: false });
    await using screen = await render(
      <ThreadServersPanel environmentId={environmentId} threadId={threadId} />,
    );
    using added = vi.spyOn(toastManager, "add");

    await userEvent.click(screen.getByText("localhost:5173"));

    await vi.waitFor(() => expect(added).toHaveBeenCalledOnce());
    expect(state.openDiscoveredPort).not.toHaveBeenCalled();
  });

  it("leaves it to upstream's preview without a strip where this client has one", async () => {
    setup(true);
    receiveSnapshot(threadRef, { available: false });
    await using screen = await render(
      <ThreadServersPanel environmentId={environmentId} threadId={threadId} />,
    );
    using added = vi.spyOn(toastManager, "add");

    await userEvent.click(screen.getByText("localhost:5173"));

    await vi.waitFor(() => expect(state.openDiscoveredPort).toHaveBeenCalledOnce());
    expect(added).not.toHaveBeenCalled();
  });
});
