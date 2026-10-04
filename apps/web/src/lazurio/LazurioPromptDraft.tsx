import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useEffect, useRef } from "react";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { findProjectByPath, inferProjectTitleFromPath } from "../lib/projectPaths";
import { newProjectId } from "../lib/utils";
import {
  readProjects,
  useAllEnvironmentShellsBootstrapped,
  waitForProject,
} from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { projectEnvironment } from "../state/projects";
import { useAtomCommand } from "../state/use-atom-command";
import { openPromptDraft, takeLazurioPromptLink } from "./promptDraft";

/**
 * Lazurio overlay (Lazurio/t3code#35): once the primary environment's shell
 * is loaded, opens the prompt a Lazurio link named in a new thread of the
 * primary environment's project rooted at the prompt's folder, with the text
 * in the composer and nothing sent. Renders nothing; without a link it does
 * nothing at all.
 */
export function LazurioPromptDraft() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const handleNewThread = useNewThreadHandler();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !bootstrapped || primaryEnvironmentId === null) return;
    const link = takeLazurioPromptLink();
    if (link === null) return;
    started.current = true;
    void openPromptDraft(link, {
      origin: window.location.origin,
      fetch: (url, init) => window.fetch(url, init),
      findProject: (cwd) => {
        const project = findProjectByPath(
          readProjects().filter((candidate) => candidate.environmentId === primaryEnvironmentId),
          cwd,
        );
        return project ? scopeProjectRef(project.environmentId, project.id) : null;
      },
      addProject: async (cwd) => {
        const projectId = newProjectId();
        const created = await createProject({
          environmentId: primaryEnvironmentId,
          input: {
            projectId,
            title: inferProjectTitleFromPath(cwd),
            workspaceRoot: cwd,
            createWorkspaceRootIfMissing: false,
            defaultModelSelection: null,
          },
        });
        if (created._tag === "Failure") return null;
        const projectRef = scopeProjectRef(primaryEnvironmentId, projectId);
        await waitForProject(projectRef, 3_000).catch(() => null);
        return projectRef;
      },
      openThread: (projectRef) => handleNewThread(projectRef),
      setPrompt: (draftId, text) => useComposerDraftStore.getState().setPrompt(draftId, text),
    }).then((outcome) => {
      if (outcome === "failed") {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not open the prepared prompt",
            description: "Nothing was added to the composer.",
          }),
        );
      }
    });
  }, [bootstrapped, createProject, handleNewThread, primaryEnvironmentId]);

  return null;
}
