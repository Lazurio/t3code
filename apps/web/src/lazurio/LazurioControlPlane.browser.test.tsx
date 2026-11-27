import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

const confirm = vi.hoisted(() => ({
  request: vi.fn<(message: string) => Promise<boolean> | undefined>(),
}));
vi.mock(import("~/confirmDialog"), async (original) => ({
  ...(await original()),
  isConfirmDialogActive: () => false,
  requestConfirmDialog: (message: string) => confirm.request(message),
}));

import { useComposerDraftStore } from "~/composerDraftStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { render } from "../../test/render";
import { controlPlaneAttachment, withControlPlaneOpen } from "./controlPlane";
import { useControlPlaneDrafts } from "./LazurioControlPlane";

const ref = scopeThreadRef(EnvironmentId.make("env-control-plane"), ThreadId.make("thread-buddy"));
const snapshot = (revision: string) => ({
  threadId: "thread-buddy",
  attachmentId: `buddy-0000000${revision}-0000-4000-8000-00000000000${revision}-html`,
  title: "Control Plane",
  revision,
});

// On "go" the page focuses itself by script and asks for a sentence: no input of the person in it.
const PAGE = `<!doctype html><input id="field"><script>
parent.postMessage("ready", "*");
addEventListener("message", (event) => {
  if (event.data !== "go") return;
  document.getElementById("field").focus();
  parent.postMessage({ type: "lazurio.control-plane.draft", v: 1, text: "Borrowed" }, "*");
});
</script>`;

function Harness() {
  useControlPlaneDrafts(ref, snapshot("a"), false);
  return (
    <div>
      <button type="button">Outside the page</button>
      <div data-right-panel-surface-content>
        <iframe sandbox="allow-scripts allow-forms" srcDoc={PAGE} title="Control Plane" />
      </div>
    </div>
  );
}

function setup(activeRevision: string) {
  confirm.request.mockReset().mockResolvedValue(false);
  useComposerDraftStore.getState().setPrompt(ref, "");
  useRightPanelStore
    .getState()
    .lazurio(ref, false, (current) =>
      withControlPlaneOpen(current, controlPlaneAttachment(snapshot(activeRevision))),
    );
}

const message = (accept: (data: unknown) => boolean) =>
  new Promise<void>((resolve) => {
    const listener = (event: MessageEvent) => {
      if (!accept(event.data)) return;
      window.removeEventListener("message", listener);
      resolve();
    };
    window.addEventListener("message", listener);
  });
const isDraft = (data: unknown) =>
  typeof data === "object" &&
  data !== null &&
  "type" in data &&
  data.type === "lazurio.control-plane.draft";

// Rendering, a click outside, then the page's request: the hook's listener, added on mount, has
// handled the request by the time the test's own listener, added later, hears it.
async function borrowedRequest() {
  const ready = message((data) => data === "ready");
  await using screen = await render(<Harness />, { router: false });
  await ready;
  await userEvent.click(screen.getByRole("button", { name: "Outside the page" }));
  const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Control Plane"]')!;
  const handled = message(isDraft);
  frame.contentWindow!.postMessage("go", "*");
  await handled;
  return { focusedFrame: document.activeElement === frame };
}

describe("a Control Plane page's sentence in a real browser", () => {
  it("cannot borrow the activation of the person's click outside the page", async () => {
    setup("a");
    const { focusedFrame } = await borrowedRequest();
    // The page took the focus by script while the window was active from the click outside it.
    expect(focusedFrame).toBe(true);
    // The app asks the person itself, and nothing reaches the composer without them.
    expect(confirm.request).toHaveBeenCalledTimes(1);
    expect(confirm.request.mock.calls[0]?.[0]).toContain("Borrowed");
    expect(useComposerDraftStore.getState().getComposerDraft(ref)?.prompt ?? "").toBe("");
  });

  it("is not taken from a frame that is not the thread's Control Plane as published now", async () => {
    // The panel shows another attachment named Control Plane, not the current revision.
    setup("b");
    await borrowedRequest();
    expect(confirm.request).not.toHaveBeenCalled();
    expect(useComposerDraftStore.getState().getComposerDraft(ref)?.prompt ?? "").toBe("");
  });
});
