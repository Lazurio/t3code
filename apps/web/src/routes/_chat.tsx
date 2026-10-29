import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { Outlet, createFileRoute, redirect, useMatches } from "@tanstack/react-router";
import { useState } from "react";

import { ThreadRouteView } from "../components/ThreadRouteView";
import { isAppModalPage } from "../components/sidebar/mainAppLocation";
import { SidebarInset } from "../components/ui/sidebar";
import { resolveThreadRouteTarget, type ThreadRouteTarget } from "../threadRoutes";
import { retainThreadFindForRoute } from "../components/chat/threadFindStore";
import { ThreadLinkPrompt } from "../components/promptLinks/ThreadLinkPrompt";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { LazurioPromptDraft } from "~/lazurio/LazurioPromptDraft";
import {
  BuddySurfaceIndex,
  useBuddySurfaceMode,
  useLeadsToBuddysThread,
} from "~/lazurio/BuddySurface";

function threadRouteTargetKey(target: ThreadRouteTarget | null) {
  if (!target) return null;
  return target.kind === "server" ? scopedThreadKey(target.threadRef) : target.draftId;
}

function ChatRouteLayout() {
  // Render both routes here so draft promotion keeps the same ChatView mounted.
  const threadTarget = useThreadRouteTarget();
  // Read matches, not location, so this agrees with the params useThreadRouteTarget reads.
  const modalOpen = useMatches({
    select: (matches) => matches.some((match) => isAppModalPage(match.pathname)),
  });
  // Settings and Usage render over the thread that opened them, so ChatView never remounts.
  const [backgroundTarget, setBackgroundTarget] = useState(threadTarget);
  if (!modalOpen && threadRouteTargetKey(backgroundTarget) !== threadRouteTargetKey(threadTarget)) {
    setBackgroundTarget(threadTarget);
  }
  const shownTarget = modalOpen ? backgroundTarget : threadTarget;
  // Lazurio overlay (plan DEV-6676): Buddy's one conversation has no prompt links.
  const buddySurface = useBuddySurfaceMode() === true;
  // Any other thread of Buddy's Environment, a link or a typed address, leads to Buddy's thread.
  const toBuddysThread = useLeadsToBuddysThread(
    shownTarget?.kind === "server" && !modalOpen ? shownTarget.threadRef : null,
  );
  return (
    <>
      {buddySurface ? null : <LazurioPromptDraft />}
      {shownTarget?.kind === "server" && !modalOpen && !toBuddysThread ? (
        <ThreadLinkPrompt threadRef={shownTarget.threadRef} />
      ) : null}
      {toBuddysThread ? (
        <BuddySurfaceIndex />
      ) : shownTarget ? (
        <ThreadRouteView target={shownTarget} background={modalOpen} />
      ) : modalOpen ? (
        <SidebarInset className="h-dvh" />
      ) : (
        <Outlet />
      )}
      {modalOpen ? <Outlet /> : null}
    </>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context, location }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
    return { appModalPage: isAppModalPage(location.pathname) };
  },
  component: ChatRouteLayout,
  // Every match carries the whole location's params, so this layout sees the thread route's too.
  onEnter: ({ context, params }) => retainThreadFindForRouteMatch(context.appModalPage, params),
  onStay: ({ context, params }) => retainThreadFindForRouteMatch(context.appModalPage, params),
  onLeave: () => retainThreadFindForRoute({ modalPage: false, threadRef: null }),
});

function retainThreadFindForRouteMatch(
  modalPage: boolean,
  params: Partial<Record<"environmentId" | "threadId", string>>,
) {
  const target = resolveThreadRouteTarget(params);
  retainThreadFindForRoute({
    modalPage,
    threadRef: target?.kind === "server" ? target.threadRef : null,
  });
}
