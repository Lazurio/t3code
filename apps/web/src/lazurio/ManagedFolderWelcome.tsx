import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { Atom } from "effect/unstable/reactivity";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useClientSettings, useClientSettingsHydrationStatus } from "../hooks/useSettings";
import { useCompleteOnboarding } from "../onboarding/firstRun";
import type { FirstRunDecision } from "../onboarding/firstRun.logic";
import { useProjects } from "../state/entities";
import { primaryServerConfigAtom } from "../state/server";
import { environmentShell } from "../state/shell";
import { managedFirstRunDecision } from "./managedFolder";
import { prefersCzech } from "./threadTabs";

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
 * the welcome below once the primary server's live shell has the Folder's project, and never a
 * completion it did not ask the person for. Without a managed Folder, upstream's decision.
 */
export function useManagedFirstRunDecision(upstream: FirstRun): FirstRun {
  const config = useAtomValue(primaryServerConfigAtom);
  const live = useAtomValue(primaryShellLiveAtom);
  const projects = useProjects();
  const hydrated = useClientSettingsHydrationStatus() === "ready";
  const completed = useClientSettings((settings) => settings.onboardingCompletedAt) !== null;
  if (config?.lazurioFolder === undefined) return upstream;
  const projectReady = projects.some(
    (project) =>
      project.environmentId === config.environment.environmentId &&
      project.workspaceRoot === config.lazurioFolder,
  );
  return {
    decision: managedFirstRunDecision({ hydrated, live, projectReady, completed }),
    persistCompletion: false,
  };
}

/** The welcome's words: Czech where the person's browser is, with formal address (root decision
 * 0199) and "Prostředí" for the place (root decision 0170 with its addendum of 2026-10-15), as the
 * rest of the overlay. They say where a chat starts and what to do, not what the Folder gives an
 * agent (DEV-6665, LazurioPlatform F36's addendum of 2026-10-16). */
const welcomeWords = (czech: boolean) =>
  czech
    ? {
        eyebrow: "Prostředí Lazuria",
        title: "Vaše Prostředí je připravené",
        folder: "Každý nový chat začíná ve vašem Lazurio Folderu.",
        inside: "Vaše projekty a repozitáře jsou v tomto Folderu. Není potřeba nic importovat.",
        connectBefore: "Účet agenta připojte v ",
        connectLink: "nastavení Prostředí",
        connectAfter:
          " a pak se sem vraťte. Účet, který tam už je připojený, můžete rovnou použít.",
        connected: "Použijte účet agenta připojený k tomuto Prostředí.",
        failed: "Lazurio se nepodařilo otevřít. Zkuste to prosím znovu.",
        opening: "Otevírám…",
        start: "Začít v Lazuriu",
      }
    : {
        eyebrow: "Lazurio Environment",
        title: "Your Environment is ready",
        folder: "Every new chat starts in your Lazurio Folder.",
        inside:
          "Your projects and repositories live inside this Folder. There is nothing to import.",
        connectBefore: "Connect your agent account in ",
        connectLink: "Environment settings",
        connectAfter: ", then return here. An account already connected there is ready to use.",
        connected: "Use the agent account connected to this Environment.",
        failed: "Could not open Lazurio. Please try again.",
        opening: "Opening…",
        start: "Start in Lazurio",
      };

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
  const [words] = useState(() => welcomeWords(prefersCzech()));
  const project = projects.find(
    (p) =>
      p.environmentId === config?.environment.environmentId &&
      p.workspaceRoot === config?.lazurioFolder,
  );
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
      <section className="w-full max-w-xl space-y-6 rounded-xl border border-border p-8">
        <div>
          <p className="text-sm text-muted-foreground">{words.eyebrow}</p>
          <h1 className="mt-2 text-2xl font-semibold">{words.title}</h1>
        </div>
        <p>{words.folder}</p>
        <div className="rounded-lg border border-border p-4">
          <strong>Lazurio</strong>
          <p className="mt-1 break-all text-sm text-muted-foreground">{config?.lazurioFolder}</p>
          <p className="mt-2 text-sm">{words.inside}</p>
        </div>
        {config?.lazurioToolsUrl ? (
          <p>
            {words.connectBefore}
            <a className="underline" href={config.lazurioToolsUrl} target="_blank" rel="noreferrer">
              {words.connectLink}
            </a>
            {words.connectAfter}
          </p>
        ) : (
          <p>{words.connected}</p>
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
                setError(words.failed);
                setBusy(false);
              });
          }}
        >
          {busy ? words.opening : words.start}
        </Button>
      </section>
    </main>
  );
}
