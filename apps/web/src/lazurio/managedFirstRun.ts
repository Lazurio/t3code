import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useClientSettingsHydrationStatus } from "../hooks/useSettings";
import type { FirstRunDecision } from "../onboarding/firstRun.logic";
import { useProjects } from "../state/entities";
import { primaryServerConfigAtom } from "../state/server";
import { environmentShell } from "../state/shell";
import { managedFirstRunDecision } from "./managedFolder";

/** The primary Environment's Lazurio Folder (LazurioPlatform F51), when it is managed. */
export function usePrimaryLazurioFolder(): string | undefined {
  return useAtomValue(primaryServerConfigAtom)?.lazurioFolder;
}

const primaryShellLiveAtom = Atom.make((get) => {
  const config = get(primaryServerConfigAtom);
  return (
    config !== null &&
    get(environmentShell.stateValueAtom(config.environment.environmentId)).status === "live"
  );
}).pipe(Atom.withLabel("lazurio-managed-first-run-primary-shell-live"));

type FirstRun = { readonly decision: FirstRunDecision; readonly persistCompletion: boolean };

/**
 * FirstRunGate's decision, with a managed Environment's own first run in place of upstream's:
 * the app once the primary server's live shell has the Folder's project, which completes
 * onboarding, so later loads open the app at once. Without a managed Folder, upstream's decision.
 */
export function useManagedFirstRunDecision(upstream: FirstRun): FirstRun {
  const config = useAtomValue(primaryServerConfigAtom);
  const live = useAtomValue(primaryShellLiveAtom);
  const projects = useProjects();
  const hydrated = useClientSettingsHydrationStatus() === "ready";
  if (config?.lazurioFolder === undefined) return upstream;
  const projectReady = projects.some(
    (project) =>
      project.environmentId === config.environment.environmentId &&
      project.workspaceRoot === config.lazurioFolder,
  );
  const decision = managedFirstRunDecision({ hydrated, live, projectReady });
  return { decision, persistCompletion: decision === "app" };
}
