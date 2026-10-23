import { EnvironmentId, MessageId, RunId } from "@t3tools/contracts";
import type { LegendListRef } from "@legendapp/list/react";
import { createRef, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { MessagesTimeline } from "~/components/chat/MessagesTimeline";
import { render } from "../../test/render";

// The timeline asks BuddySurface whether it shows Buddy's T3 Code; the rest of the module is real.
const surface = vi.hoisted(() => ({ buddy: true }));
vi.mock(import("./BuddySurface"), async (original) => ({
  ...(await original()),
  useBuddySurfaceMode: () => surface.buddy,
}));

const setup = (buddy: boolean) => {
  surface.buddy = buddy;
};

const ENVIRONMENT_ID = EnvironmentId.make("environment-buddy");
const CREATED_AT = "2026-10-22T19:12:28.000Z";
const RUN = RunId.make("run-1");

type TimelineProps = ComponentProps<typeof MessagesTimeline>;
type Entry = TimelineProps["timelineEntries"][number];

function message(id: string, role: "user" | "assistant", text: string, streaming = false): Entry {
  return {
    id,
    kind: "message",
    createdAt: CREATED_AT,
    message: {
      id: MessageId.make(id),
      role,
      text,
      runId: RUN,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      streaming,
    },
  };
}

function work(id: string, entry: Record<string, unknown>): Entry {
  return {
    id,
    kind: "work",
    createdAt: CREATED_AT,
    entry: { id, createdAt: CREATED_AT, runId: RUN, ...entry },
  } as Entry;
}

const thought = (status: "inProgress" | "completed") =>
  work("reasoning-1", {
    label: "Thinking",
    detail: "Considering the calendar request.",
    tone: "thinking",
    itemType: "reasoning",
    toolLifecycleStatus: status,
  });

const command = (status: "inProgress" | "completed") =>
  work("command-1", {
    label: "Ran command",
    command: "gcal agenda --today",
    rawCommand: "gcal agenda --today",
    tone: "tool",
    itemType: "command_execution",
    toolLifecycleStatus: status,
  });

const FAILURE_MESSAGE = "ACP agent exited with code 1";
// T3's record that the turn failed; a retry that fails again records another one.
const failure = (id: string) =>
  work(id, {
    label: "Provider error",
    detail: FAILURE_MESSAGE,
    tone: "info",
    itemType: "error",
    sourceActivityKind: "runtime.error",
    toolLifecycleStatus: "failed",
    projectedItem: {
      position: 0,
      visibility: "local",
      sourceThreadId: "thread-1",
      sourceItemId: id,
      item: {
        id,
        threadId: "thread-1",
        runId: RUN,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 0,
        status: "failed",
        title: null,
        startedAt: null,
        completedAt: null,
        updatedAt: {},
        type: "error",
        failure: { class: "provider_error", message: FAILURE_MESSAGE, retryable: false },
      },
    },
  });

const run = (status: "running" | "completed" | "failed") => ({
  runId: RUN,
  status,
  startedAt: CREATED_AT,
  completedAt: status === "running" ? null : "2026-10-22T19:12:31.000Z",
});

// Each render gets its own thread: the timeline remembers position and disclosures per thread.
async function renderTimeline(entries: ReadonlyArray<Entry>, props: Partial<TimelineProps>) {
  const container = document.createElement("div");
  container.style.cssText = "height: 900px; width: 700px; display: flex; flex-direction: column;";
  const screen = await render(
    <MessagesTimeline
      isWorking={false}
      activeTurnInProgress={false}
      listRef={createRef<LegendListRef | null>()}
      latestRun={null}
      turnDiffSummaries={[]}
      runs={[]}
      routeThreadKey={`environment-buddy:thread-${Math.random().toString(36).slice(2)}`}
      onOpenTurnDiff={() => {}}
      onOpenThread={() => {}}
      onForkFromRun={async () => {}}
      onRollbackCheckpoint={() => {}}
      supportsConversationRollback={false}
      onRevertToTurnCount={() => {}}
      isRevertingCheckpoint={false}
      onImageExpand={() => {}}
      activeThreadEnvironmentId={ENVIRONMENT_ID}
      markdownCwd={undefined}
      resolvedTheme="light"
      timestampFormat="locale"
      workspaceRoot={undefined}
      anchorMessageId={null}
      onAnchorReady={() => {}}
      onAnchorSizeChanged={() => {}}
      contentInsetEndAdjustment={0}
      emptyPlaceholderInset={0}
      liveFollowEnabled
      onIsAtEndChange={() => {}}
      onManualNavigation={() => {}}
      timelineEntries={entries as Entry[]}
      {...props}
    />,
    { container },
  );
  return Object.assign(screen, {
    text: () => container.textContent ?? "",
    disclosures: () => container.querySelectorAll("[aria-expanded]").length,
  });
}

const QUESTION = "What is on my calendar today?";
const COMMENTARY = "Let me look at your calendar.";
const ANSWER = "You have two meetings today, at ten and at three.";
const WORKING = "Buddy is on it…";
const RUNNING = { isWorking: true, activeTurnInProgress: true, latestRun: run("running") };

describe("Buddy's conversation", () => {
  it("shows one quiet line while Buddy's turn with tool calls runs, and none of the work", async () => {
    setup(true);
    await using screen = await renderTimeline(
      [message("user-1", "user", QUESTION), thought("inProgress"), command("inProgress")],
      RUNNING,
    );
    await vi.waitFor(() => expect(screen.text()).toContain(WORKING));
    expect(screen.text()).toContain(QUESTION);
    for (const work of ["Thinking", "Considering", "gcal", "Ran command", "Working"])
      expect(screen.text()).not.toContain(work);
    expect(screen.disclosures()).toBe(0);
    // One quiet line, without a timer that would repaint it.
    expect(screen.getByRole("status").element().textContent).toBe(WORKING);
  });

  it("keeps only Buddy's final message once the turn is over", async () => {
    setup(true);
    await using screen = await renderTimeline(
      [
        message("user-1", "user", QUESTION),
        thought("completed"),
        message("assistant-1", "assistant", COMMENTARY),
        command("completed"),
        message("assistant-2", "assistant", ANSWER),
      ],
      { latestRun: run("completed") },
    );
    await vi.waitFor(() => expect(screen.text()).toContain(ANSWER));
    expect(screen.text()).toContain(QUESTION);
    for (const hidden of [COMMENTARY, "Worked for", "gcal", "Thinking", WORKING])
      expect(screen.text()).not.toContain(hidden);
    expect(screen.disclosures()).toBe(0);
  });

  it("says in human words that a turn failed, once, without T3's error", async () => {
    setup(true);
    await using screen = await renderTimeline(
      [
        message("user-1", "user", QUESTION),
        command("completed"),
        failure("error-1"),
        failure("error-2"),
      ],
      { latestRun: run("failed") },
    );
    const failed = "Buddy couldn't finish this. Please try again.";
    await vi.waitFor(() => expect(screen.text()).toContain(failed));
    expect(screen.text().split(failed)).toHaveLength(2);
    for (const raw of ["Provider error", FAILURE_MESSAGE, "gcal"])
      expect(screen.text()).not.toContain(raw);
  });

  it("does not say Buddy is on it while Buddy waits for the person", async () => {
    setup(true);
    await using screen = await renderTimeline([message("user-1", "user", QUESTION)], {
      ...RUNNING,
      awaitingUser: true,
    });
    await vi.waitFor(() => expect(screen.text()).toContain(QUESTION));
    expect(screen.text()).not.toContain(WORKING);
  });

  it("leaves T3's own timeline as it is outside Buddy's T3 Code", async () => {
    setup(false);
    await using running = await renderTimeline(
      [message("user-1", "user", QUESTION), thought("inProgress"), command("inProgress")],
      RUNNING,
    );
    await vi.waitFor(() => expect(running.text()).toContain("gcal"));
    expect(running.text()).not.toContain(WORKING);
    await using failed = await renderTimeline(
      [message("user-1", "user", QUESTION), command("completed"), failure("error-1")],
      { latestRun: run("failed") },
    );
    await vi.waitFor(() => expect(failed.text()).toContain(FAILURE_MESSAGE));
  });
});
