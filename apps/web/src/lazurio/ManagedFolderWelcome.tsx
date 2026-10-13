import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useCompleteOnboarding } from "../onboarding/firstRun";
import { useProjects } from "../state/entities";
import { primaryServerConfigAtom } from "../state/server";

/** The primary Environment's Lazurio Folder (LazurioPlatform F51), when it is managed. */
export function usePrimaryLazurioFolder(): string | undefined {
  return useAtomValue(primaryServerConfigAtom)?.lazurioFolder;
}

/**
 * The managed Environment's welcome, in place of upstream's setup wizard: it names the Lazurio
 * Folder, completes onboarding and opens a new chat in the Folder's project.
 */
export function ManagedFolderWelcome() {
  const config = useAtomValue(primaryServerConfigAtom);
  const projects = useProjects();
  const complete = useCompleteOnboarding();
  const openNewThread = useNewThreadHandler();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const project = projects.find(
    (p) =>
      p.environmentId === config?.environment.environmentId &&
      p.workspaceRoot === config?.lazurioFolder,
  );
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
      <section className="w-full max-w-xl space-y-6 rounded-xl border border-border p-8">
        <div>
          <p className="text-sm text-muted-foreground">Lazurio Environment</p>
          <h1 className="mt-2 text-2xl font-semibold">Your workspace is ready</h1>
        </div>
        <p>
          Every new chat starts in your Lazurio Folder. It gives your agent the context for this
          Environment and the Organizations you can work with.
        </p>
        <div className="rounded-lg border border-border p-4">
          <strong>Lazurio</strong>
          <p className="mt-1 break-all text-sm text-muted-foreground">{config?.lazurioFolder}</p>
          <p className="mt-2 text-sm">
            Your projects and repositories live inside this Folder. There is nothing to import.
          </p>
        </div>
        {config?.lazurioToolsUrl ? (
          <p>
            Connect your agent account in{" "}
            <a className="underline" href={config.lazurioToolsUrl} target="_blank" rel="noreferrer">
              Environment settings
            </a>
            , then return here. An account already connected there is ready to use.
          </p>
        ) : (
          <p>Use the agent account connected to this Environment.</p>
        )}
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        <Button
          disabled={!project || busy}
          onClick={() => {
            if (!project) return;
            setBusy(true);
            setError(null);
            void complete()
              .then(() =>
                openNewThread(scopeProjectRef(project.environmentId, project.id), {
                  replace: true,
                }),
              )
              .catch(() => {
                setError("Could not open Lazurio. Please try again.");
                setBusy(false);
              });
          }}
        >
          {busy ? "Opening…" : "Start in Lazurio"}
        </Button>
      </section>
    </main>
  );
}
