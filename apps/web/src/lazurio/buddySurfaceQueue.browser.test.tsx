import { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

const BUDDY_ENVIRONMENT = "environment-buddy";

// Buddy's T3 Code serves the page; the queue reads its thread through mocked state, as
// QueuedRunsControl.browser.test.tsx reads it.
const state = vi.hoisted(() => ({ projection: null as unknown, workflow: null as unknown }));
vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: (() => BUDDY_ENVIRONMENT) as never,
}));
vi.mock(import("~/state/server"), async (original) => ({
  ...(await original()),
  primaryServerConfigAtom: Atom.make({ lazurioBuddy: true }) as never,
}));
vi.mock(import("@t3tools/client-runtime/state/thread-workflows"), async (original) => ({
  ...(await original()),
  deriveThreadQueueWorkflowState: (() => state.workflow) as never,
}));
vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  useThreadProjection: (() => state.projection) as never,
}));
vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => async () => undefined) as never,
}));

import { QueuedRunsControl } from "~/components/chat/QueuedRunsControl";
import { render } from "../../test/render";

const PERSONS = "Pošli mi to taky do mailu.";
const DELEGACE = "Delegace: úkol 4711 doběhl.";

/** A thread whose queue holds a message of the person's and Delegace's wake behind it. */
function setup(
  queue: ReadonlyArray<{ readonly id: string; readonly text: string; readonly by: string }>,
) {
  state.projection = {
    projection: {
      messages: queue.map((message) => ({
        id: message.id,
        text: message.text,
        createdBy: message.by,
      })),
    },
  };
  state.workflow = {
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    canReorder: true,
    queuedRuns: queue.map((message) => ({
      run: { id: `run:${message.id}`, userMessageId: message.id },
      messageId: message.id,
      text: message.text,
      attachments: [],
    })),
  };
}

const renderQueue = (environmentId: string) =>
  render(
    <QueuedRunsControl
      environmentId={EnvironmentId.make(environmentId)}
      threadId={"thread:buddy" as ComponentProps<typeof QueuedRunsControl>["threadId"]}
      optimisticMessages={[]}
      editingRunId={null}
      onEditQueuedRun={() => undefined}
      onCancelEdit={() => undefined}
    />,
  );

const BOTH = [
  { id: "message:person", text: PERSONS, by: "user" },
  { id: "message:delegace", text: DELEGACE, by: "agent" },
];

describe("the queue above Buddy's composer", () => {
  it("holds the person's own messages, never an agent's such as Delegace's wake", async () => {
    setup(BOTH);
    await using screen = await renderQueue(BUDDY_ENVIRONMENT);
    expect(screen.container.textContent).toContain(PERSONS);
    expect(screen.container.textContent).not.toContain(DELEGACE);
    expect(screen.container.querySelector('[aria-label="1 queued message"]')).not.toBeNull();
  });

  it("shows nothing while only an agent's message waits", async () => {
    setup(BOTH.slice(1));
    await using screen = await renderQueue(BUDDY_ENVIRONMENT);
    expect(screen.container.childElementCount).toBe(0);
  });

  it("stays T3's in a thread of another Environment", async () => {
    setup(BOTH);
    await using screen = await renderQueue("environment-other");
    expect(screen.container.textContent).toContain(PERSONS);
    expect(screen.container.textContent).toContain(DELEGACE);
  });
});
