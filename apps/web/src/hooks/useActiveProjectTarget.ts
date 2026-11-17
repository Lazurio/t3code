import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";

import { useProject } from "~/state/entities";

import { useHandleNewThread } from "./useHandleNewThread";

export interface ActiveProjectTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly projectName: string;
  readonly threadRef: ScopedThreadRef;
}

export function useActiveProjectTarget(): ActiveProjectTarget | null {
  const { activeDraftThread, activeThread } = useHandleNewThread();
  const thread = activeThread ?? activeDraftThread;
  const threadId = activeThread?.id ?? activeDraftThread?.threadId;
  // A point read: lists leave out Buddy's project (LZD-0033), its thread still has a project.
  const project = useProject(
    thread ? scopeProjectRef(thread.environmentId, thread.projectId) : null,
  );
  const cwd = thread?.worktreePath ?? project?.workspaceRoot;

  if (!thread || !threadId || !project || !cwd) return null;

  return {
    environmentId: project.environmentId,
    cwd,
    projectName: project.title,
    threadRef: scopeThreadRef(thread.environmentId, threadId),
  };
}
