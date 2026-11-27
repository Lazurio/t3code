import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { userEvent } from "vite-plus/test/browser";
import { describe, expect, it } from "vite-plus/test";

import { useComposerDraftStore } from "~/composerDraftStore";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";
import { act, render } from "../../test/render";
import {
  type ControlPlaneSnapshot,
  controlPlaneAttachment,
  withControlPlaneOpen,
  withControlPlaneRevision,
} from "./controlPlane";
import { ControlPlaneAnswers } from "./LazurioControlPlane";

const ref = scopeThreadRef(EnvironmentId.make("env-control-plane"), ThreadId.make("thread-buddy"));
const snapshot = (revision: string): ControlPlaneSnapshot => ({
  threadId: "thread-buddy",
  attachmentId: `buddy-0000000${revision}-0000-4000-8000-00000000000${revision}-html`,
  title: "Control Plane",
  revision,
  answers: [
    { label: "Yes", sentence: "Example: yes" },
    { label: "No", sentence: "Example: no" },
  ],
});

const prompt = () => useComposerDraftStore.getState().getComposerDraft(ref)?.prompt ?? "";
const setPrompt = (text: string) =>
  act(() => useComposerDraftStore.getState().setPrompt(ref, text));
const showRevision = (revision: string, open: boolean) =>
  act(() =>
    useRightPanelStore
      .getState()
      .lazurio(ref, !open, (current) =>
        (open ? withControlPlaneOpen : withControlPlaneRevision)(
          current,
          controlPlaneAttachment(snapshot(revision)),
        ),
      ),
  );

async function setup(overWindow = false) {
  await setPrompt("");
  await showRevision("a", true);
  const screen = await render(
    <ControlPlaneAnswers
      czech={false}
      overWindow={overWindow}
      snapshot={snapshot("a")}
      threadRef={ref}
    />,
    { router: false },
  );
  return screen;
}

describe("the Control Plane's answers in a real browser", () => {
  it("are the app's own buttons, marked as coming from the Control Plane", async () => {
    await using screen = await setup();
    const group = screen.getByRole("group", { name: "Proposal from the Control Plane" });
    await expect.element(group).toBeVisible();
    await expect.element(group.getByRole("button", { name: "Yes" })).toBeVisible();
    // They belong to the tab being looked at: another tab in the panel hides them.
    await act(() =>
      useRightPanelStore.getState().lazurio(ref, false, (current) => ({
        ...current,
        activeSurfaceId: "files",
      })),
    );
    await expect.element(group).not.toBeInTheDocument();
  });

  it("put a sentence into the composer, replace their own and never the person's words", async () => {
    await using screen = await setup();
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(prompt()).toBe("Example: yes");
    await userEvent.click(screen.getByRole("button", { name: "No" }));
    expect(prompt()).toBe("Example: no");
    // The person changed the composer: their text stays, the answer follows on its own line.
    await setPrompt("Example: not sure");
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(prompt()).toBe("Example: not sure\nExample: yes");
  });

  it("keep the record of the last sentence when a new revision arrives", async () => {
    await using screen = await setup();
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    await showRevision("b", false);
    await screen.rerender(
      <ControlPlaneAnswers
        czech={false}
        overWindow={false}
        snapshot={snapshot("b")}
        threadRef={ref}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "No" }));
    expect(prompt()).toBe("Example: no");
  });

  it("go back to the conversation when the panel covers the whole window", async () => {
    await using screen = await setup(true);
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(prompt()).toBe("Example: yes");
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).isOpen).toBe(
      false,
    );
  });
});
