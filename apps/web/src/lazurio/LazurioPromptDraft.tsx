import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { Atom } from "effect/unstable/reactivity";
import { useEffect, useRef } from "react";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { findProjectByPath, inferProjectTitleFromPath } from "../lib/projectPaths";
import { newProjectId } from "../lib/utils";
import { readProjects, waitForProject } from "../state/entities";
import { projectEnvironment } from "../state/projects";
import { primaryServerConfigAtom } from "../state/server";
import { environmentShell } from "../state/shell";
import { useAtomCommand } from "../state/use-atom-command";
import { openPromptDraft, takeLazurioPromptLink } from "./promptDraft";

// The primary environment once its shell is live: its project list is
// complete, so a missing project is really missing, and commands reach it.
// Null until then (still loading, or disconnected), and the link waits.
const livePrimaryEnvironmentIdAtom = Atom.make((get) => {
  const serverConfig = get(primaryServerConfigAtom);
  if (serverConfig === null) return null;
  const environmentId = serverConfig.environment.environmentId;
  return get(environmentShell.stateValueAtom(environmentId)).status === "live"
    ? environmentId
    : null;
}).pipe(Atom.withLabel("lazurio-prompt-draft-live-primary-environment"));

/**
 * Lazurio overlay (Lazurio/t3code#35): once the primary environment's shell
 * is live, opens the prompt a Lazurio link named in a new thread of the
 * primary environment's project rooted at the prompt's folder, with the text
 * in the composer and nothing sent. Renders nothing; without a link it does
 * nothing at all.
 */
export function LazurioPromptDraft() {
  const primaryEnvironmentId = useAtomValue(livePrimaryEnvironmentIdAtom);
  const handleNewThread = useNewThreadHandler();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const started = useRef(false);

  useEffect(() => {
    if (started.current || primaryEnvironmentId === null) return;
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
  }, [createProject, handleNewThread, primaryEnvironmentId]);

  return null;
}
