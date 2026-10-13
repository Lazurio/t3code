import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ScopedProjectRef, ServerConfig } from "@t3tools/contracts";

import type { useNewThreadHandler } from "../hooks/useHandleNewThread";
import type { FirstRunDecision } from "../onboarding/firstRun.logic";

/**
 * Lazurio overlay, the managed Lazurio Folder (LazurioPlatform F51). An Environment whose server
 * has `T3CODE_LAZURIO_FOLDER` is managed: its chats start in its Lazurio Folder, the one project it
 * takes. Without the variable no Environment is managed and nothing here changes upstream's
 * behaviour.
 */

/** An Environment as the web knows it: its server's config, once that has arrived. */
interface KnownEnvironment {
  readonly environmentId: EnvironmentId;
  readonly serverConfig: Pick<ServerConfig, "lazurioFolder"> | null;
}

/** The Environment's Lazurio Folder; undefined when it is not managed or its config has not arrived. */
export function lazurioFolderOf(
  environments: ReadonlyArray<KnownEnvironment>,
  environmentId: EnvironmentId | undefined,
): string | undefined {
  return environments.find((environment) => environment.environmentId === environmentId)
    ?.serverConfig?.lazurioFolder;
}

/**
 * Whether "Add project" leaves the command palette and the sidebar: only when the web knows at
 * least one Environment and every one of them is managed. With none, upstream's "Add project"
 * leads to Settings → Connections, so it stays. An Environment whose config has not arrived yet
 * counts as not managed.
 */
export function everyEnvironmentManaged(
  environments: ReadonlyArray<Pick<KnownEnvironment, "serverConfig">>,
): boolean {
  return (
    environments.length > 0 &&
    environments.every((environment) => environment.serverConfig?.lazurioFolder !== undefined)
  );
}

/**
 * Whether the command palette's project pickers offer a project: of a managed Environment only
 * its Folder's own, the one where its new threads start; every other project as upstream.
 */
export const offeredInProjectPicker =
  (environments: ReadonlyArray<KnownEnvironment>) =>
  (entry: {
    readonly targetProject: {
      readonly environmentId: EnvironmentId;
      readonly workspaceRoot: string;
    };
  }): boolean => {
    const folder = lazurioFolderOf(environments, entry.targetProject.environmentId);
    return folder === undefined || entry.targetProject.workspaceRoot === folder;
  };

type NewThreadOptions = Parameters<ReturnType<typeof useNewThreadHandler>>[1];

/**
 * Where a new thread starts. In a managed Environment, whichever project the caller names: in the
 * Folder's own project, in the Folder itself, without a branch or a worktree; null while that
 * project has not reached the web. Without a managed Folder, the request as it was.
 */
export function managedNewThread(
  serverConfigs: ReadonlyMap<EnvironmentId, Pick<ServerConfig, "lazurioFolder">>,
  projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly environmentId: EnvironmentId;
    readonly workspaceRoot: string;
  }>,
  projectRef: ScopedProjectRef,
  options: NewThreadOptions,
): { readonly projectRef: ScopedProjectRef; readonly options: NewThreadOptions } | null {
  const folder = serverConfigs.get(projectRef.environmentId)?.lazurioFolder;
  if (folder === undefined) return { projectRef, options };
  const project = projects.find(
    (candidate) =>
      candidate.environmentId === projectRef.environmentId && candidate.workspaceRoot === folder,
  );
  if (project === undefined) return null;
  return {
    projectRef: scopeProjectRef(project.environmentId, project.id),
    options: {
      ...options,
      branch: null,
      worktreePath: null,
      envMode: "local",
      startFromOrigin: false,
    },
  };
}

/**
 * A managed Environment's first run: pending until settings hydrate and the primary server's live
 * shell has the Folder's project, then its welcome until onboarding completes. It never completes
 * onboarding by itself, whatever else the workspace holds.
 */
export function managedFirstRunDecision(input: {
  hydrated: boolean;
  live: boolean;
  projectReady: boolean;
  completed: boolean;
}): FirstRunDecision {
  return !input.hydrated || !input.live || !input.projectReady
    ? "pending"
    : input.completed
      ? "app"
      : "wizard";
}
