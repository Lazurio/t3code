import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
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
import { useAtomCommand } from "../state/use-atom-command";
import { lazurioSignInOf, t3AccountToDisconnect } from "./providerSignIn";
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
        t3Account: "Účet ChatGPT v T3 Code",
        t3AccountSignedIn:
          "Tato instance je ještě přihlášená k účtu ChatGPT, který používá jen T3 Code. Odpojte ho tady; Codex se pak přihlašuje přes Lazurio.",
        disconnect: "Odpojit",
        disconnecting: "Odpojuji…",
        disconnectFailed: "Účet ChatGPT se nepodařilo odpojit",
      }
    : {
        title: "Sign in through Lazurio",
        page: "On a Lazurio Environment, Codex and Claude sign in through Lazurio on the Getting started page. The sign-in then works for T3, the terminal and every agent.",
        noPage:
          "On a Lazurio Environment, Codex and Claude sign in through Lazurio. The sign-in then works for T3, the terminal and every agent.",
        open: "Open Getting started",
        close: "Close",
        t3Account: "ChatGPT account in T3 Code",
        t3AccountSignedIn:
          "This instance is still signed in to a ChatGPT account that only T3 Code uses. Disconnect it here; Codex then signs in through Lazurio.",
        disconnect: "Disconnect",
        disconnecting: "Disconnecting…",
        disconnectFailed: "Could not disconnect the ChatGPT account",
      };
type SignInWords = ReturnType<typeof signInWords>;

function OpenGettingStarted({ toolsUrl, label }: { toolsUrl: string; label: string }) {
  return (
    <Button size="sm" render={<a href={toolsUrl} target="_blank" rel="noreferrer" />}>
      {label}
      <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
    </Button>
  );
}

/**
 * In place of T3's own ChatGPT sign-in in a provider's settings or setup. A managed Codex instance
 * still signed in to an account only T3 uses keeps its Disconnect, never its way to sign in again.
 */
export function LazurioSignInRow({
  environmentId,
  instanceId,
  mode,
  provider,
}: {
  environmentId: EnvironmentId;
  instanceId?: ProviderInstanceId;
  mode?: "managed" | "existing";
  provider?: ServerProvider | undefined;
}) {
  const signIn = useLazurioSignIn(environmentId);
  const [words] = useState(() => signInWords(prefersCzech()));
  return (
    <>
      <SettingsRow
        title={words.title}
        description={signIn?.toolsUrl ? words.page : words.noPage}
        control={
          signIn?.toolsUrl ? (
            <OpenGettingStarted toolsUrl={signIn.toolsUrl} label={words.open} />
          ) : null
        }
      />
      {instanceId !== undefined && t3AccountToDisconnect(mode, provider) ? (
        <T3AccountDisconnect environmentId={environmentId} instanceId={instanceId} words={words} />
      ) : null}
    </>
  );
}

/** Upstream's Disconnect of a managed Codex account: sign-out only, with what it reported. */
function T3AccountDisconnect({
  environmentId,
  instanceId,
  words,
}: {
  environmentId: EnvironmentId;
  instanceId: ProviderInstanceId;
  words: SignInWords;
}) {
  const logout = useAtomCommand(serverEnvironment.logoutProviderAuth, words.disconnectFailed);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <SettingsRow
      title={words.t3Account}
      description={notice ?? words.t3AccountSignedIn}
      control={
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setPending(true);
            void logout({ environmentId, input: { instanceId } }).then((result) => {
              if (result._tag === "Success" && result.value.message)
                setNotice(result.value.message);
              setPending(false);
            });
          }}
        >
          {pending ? words.disconnecting : words.disconnect}
        </Button>
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
