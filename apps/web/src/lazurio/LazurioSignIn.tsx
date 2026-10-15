import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { SettingsRow } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { serverEnvironment } from "../state/server";
import { lazurioSignInOf } from "./providerSignIn";
import { prefersCzech } from "./threadTabs";

/** The Environment's sign-in page when it is a Lazurio Environment (providerSignIn.ts). */
export function useLazurioSignIn(environmentId: EnvironmentId | null) {
  return lazurioSignInOf(useAtomValue(serverEnvironment.configValueAtom(environmentId)));
}

/** The words, Czech where the person's browser is, as the rest of the overlay (root decision 0199). */
const signInWords = (czech: boolean) =>
  czech
    ? {
        title: "Přihlášení přes Lazurio",
        page: "Na Environmentu Lazuria se Codex a Claude přihlašují v Lazuriu na stránce Začínáme. Přihlášení pak platí pro T3, terminál i všechny agenty.",
        noPage:
          "Na Environmentu Lazuria se Codex a Claude přihlašují v Lazuriu. Přihlášení pak platí pro T3, terminál i všechny agenty.",
        open: "Otevřít Začínáme",
        close: "Zavřít",
      }
    : {
        title: "Sign in through Lazurio",
        page: "On a Lazurio Environment, Codex and Claude sign in through Lazurio on the Getting started page. The sign-in then works for T3, the terminal and every agent.",
        noPage:
          "On a Lazurio Environment, Codex and Claude sign in through Lazurio. The sign-in then works for T3, the terminal and every agent.",
        open: "Open Getting started",
        close: "Close",
      };

function OpenGettingStarted({ toolsUrl, label }: { toolsUrl: string; label: string }) {
  return (
    <Button size="sm" render={<a href={toolsUrl} target="_blank" rel="noreferrer" />}>
      {label}
      <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
    </Button>
  );
}

/** In place of T3's own ChatGPT sign-in in a provider's settings or setup. */
export function LazurioSignInRow({ environmentId }: { environmentId: EnvironmentId }) {
  const signIn = useLazurioSignIn(environmentId);
  const [words] = useState(() => signInWords(prefersCzech()));
  return (
    <SettingsRow
      title={words.title}
      description={signIn?.toolsUrl ? words.page : words.noPage}
      control={
        signIn?.toolsUrl ? (
          <OpenGettingStarted toolsUrl={signIn.toolsUrl} label={words.open} />
        ) : null
      }
    />
  );
}

/** In place of "Continue with ChatGPT" beside other choices, such as adding a provider. */
export function LazurioSignInButton({ toolsUrl }: { toolsUrl: string | undefined }) {
  const [words] = useState(() => signInWords(prefersCzech()));
  return toolsUrl ? <OpenGettingStarted toolsUrl={toolsUrl} label={words.open} /> : null;
}

/** In place of the dialog that adds another ChatGPT account to T3. */
export function LazurioSignInDialog({
  environmentId,
  onClose,
}: {
  environmentId: EnvironmentId;
  onClose: () => void;
}) {
  const signIn = useLazurioSignIn(environmentId);
  const [words] = useState(() => signInWords(prefersCzech()));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{words.title}</DialogTitle>
          <DialogDescription>{signIn?.toolsUrl ? words.page : words.noPage}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {words.close}
          </Button>
          {signIn?.toolsUrl ? (
            <OpenGettingStarted toolsUrl={signIn.toolsUrl} label={words.open} />
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
