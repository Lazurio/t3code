import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";
import { requestJump, useBuddyDayJump } from "./BuddySurface";

/** A timeline as far as the jump reads it, with no rows loaded and earlier history to load. */
function Timeline(props: {
  readonly buddy: boolean;
  readonly onLoadEarlier: (throughEntryId?: string) => void;
  readonly onManualNavigation: () => void;
}) {
  useBuddyDayJump({
    buddy: props.buddy,
    rows: [],
    listRef: { current: null },
    onManualNavigation: props.onManualNavigation,
    history: { hasMoreHistory: true, loading: false, onLoadEarlier: props.onLoadEarlier },
  });
  return null;
}

const timeline = () => ({ onLoadEarlier: vi.fn(), onManualNavigation: vi.fn() });

describe("a day jump of Buddy's pane", () => {
  it("is taken by Buddy's timeline only, also after a timeline switched to another Environment", async () => {
    const buddy = timeline();
    const other = timeline();
    const switched = timeline();
    // The hook reads no route.
    await using screen = await render(
      <>
        <Timeline buddy {...buddy} />
        <Timeline buddy={false} {...other} />
        <Timeline buddy {...switched} />
      </>,
      { router: false },
    );
    // The third timeline now shows another Environment's thread.
    await screen.rerender(
      <>
        <Timeline buddy {...buddy} />
        <Timeline buddy={false} {...other} />
        <Timeline buddy={false} {...switched} />
      </>,
    );
    try {
      await act(() => requestJump("message-1"));
      await vi.waitFor(() => expect(buddy.onLoadEarlier).toHaveBeenCalledWith("message-1"));
      expect(buddy.onManualNavigation).toHaveBeenCalled();
      for (const { onLoadEarlier, onManualNavigation } of [other, switched]) {
        expect(onLoadEarlier).not.toHaveBeenCalled();
        expect(onManualNavigation).not.toHaveBeenCalled();
      }
    } finally {
      await act(() => requestJump(null));
    }
  });
});
