import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

const BUDDY_ENVIRONMENT = "environment-buddy";

// Buddy's T3 Code serves the page. The chat layout's thread view stands in for ChatView, and
// records which threads it was asked to show.
const shown = vi.hoisted(() => ({ threads: [] as string[] }));
vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: (() => BUDDY_ENVIRONMENT) as never,
}));
vi.mock(import("~/state/server"), async (original) => ({
  ...(await original()),
  primaryServerConfigAtom: Atom.make({ lazurioBuddy: true }) as never,
}));
vi.mock(import("~/components/ThreadRouteView"), () => ({
  ThreadRouteView: (({ target }: { target: { threadRef?: { threadId: string } } }) => {
    const threadId = target.threadRef?.threadId ?? "draft";
    shown.threads.push(threadId);
    return <p>thread {threadId}</p>;
  }) as never,
}));
vi.mock(import("~/components/promptLinks/ThreadLinkPrompt"), () => ({
  ThreadLinkPrompt: (() => null) as never,
}));
vi.mock(import("./LazurioPromptDraft"), () => ({ LazurioPromptDraft: (() => null) as never }));

import { render, stubGlobal } from "../../test/render";
import { Route as ChatRoute } from "../routes/_chat";

function setup() {
  shown.threads = [];
  const realFetch = globalThis.fetch;
  // The server names Buddy's thread; every other request goes where it went.
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input) === "/api/lazurio/buddy/thread"
      ? new Response(JSON.stringify({ threadId: "buddy" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      : realFetch(input, init),
  );
  return { fetch, fetchStub: stubGlobal("fetch", fetch) };
}

/** The chat layout on the thread route, opened at `path` as a typed address or a link opens it. */
async function openAt(path: string) {
  const ChatLayout = ChatRoute.options.component!;
  const rootRoute = createRootRoute();
  const threadRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/$environmentId/$threadId",
    component: () => <ChatLayout />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([threadRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  // The test needs the thread route's params, which the default router has no route for.
  const screen = await render(<RouterProvider router={router} />, { router: false });
  return { screen, router };
}

describe("a thread's address in Buddy's T3 Code", () => {
  it("leads from another thread of Buddy's Environment to Buddy's thread, never showing it", async () => {
    const { fetch, fetchStub } = setup();
    using _fetch = fetchStub;
    const { screen, router } = await openAt(`/${BUDDY_ENVIRONMENT}/other-thread`);
    await using _screen = screen;
    await expect.element(screen.getByText("thread buddy")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/${BUDDY_ENVIRONMENT}/buddy`);
    expect(shown.threads).not.toContain("other-thread");
    expect(fetch).toHaveBeenCalledWith("/api/lazurio/buddy/thread", expect.anything());
  });

  it("keeps a thread of another Environment as T3 shows it", async () => {
    const { fetch, fetchStub } = setup();
    using _fetch = fetchStub;
    const { screen, router } = await openAt("/environment-other/thread-1");
    await using _screen = screen;
    await expect.element(screen.getByText("thread thread-1")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/environment-other/thread-1");
    expect(fetch).not.toHaveBeenCalledWith("/api/lazurio/buddy/thread", expect.anything());
  });
});
