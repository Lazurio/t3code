import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

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

/**
 * The words, Czech where the person's browser is, as the rest of the overlay (root decision 0199):
 * where Codex and Claude sign in, and what to do with an account only T3 uses. Why the sign-in
 * lives in Lazurio is not for the person (DEV-6665, LazurioPlatform F36's addendum of 2026-10-16).
 */
const signInWords = (czech: boolean) =>
  czech
    ? {
        title: "Přihlášení přes Lazurio",
        page: "Codex a Claude se přihlašují v Lazuriu na stránce Začínáme.",
        noPage: "Codex a Claude se přihlašují v Lazuriu.",
        open: "Otevřít Začínáme",
        close: "Zavřít",
        t3Account: "Účet ChatGPT v T3 Code",
        t3AccountSignedIn: "Odpojte ho a přihlaste Codex přes Lazurio.",
        disconnect: "Odpojit",
        disconnecting: "Odpojuji…",
        disconnectFailed: "Účet ChatGPT se nepodařilo odpojit",
      }
    : {
        title: "Sign in through Lazurio",
        page: "Codex and Claude sign in through Lazurio on the Getting started page.",
        noPage: "Codex and Claude sign in through Lazurio.",
        open: "Open Getting started",
        close: "Close",
        t3Account: "ChatGPT account in T3 Code",
        t3AccountSignedIn: "Disconnect it and sign Codex in through Lazurio.",
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
  readOnly = false,
  enabled = true,
}: {
  environmentId: EnvironmentId;
  instanceId?: ProviderInstanceId;
  mode?: "managed" | "existing";
  provider?: ServerProvider | undefined;
  /** The settings page's write availability, which freezes Disconnect as it does upstream's. */
  readOnly?: boolean | undefined;
  enabled?: boolean;
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
        <T3AccountDisconnect
          environmentId={environmentId}
          instanceId={instanceId}
          unavailable={readOnly || !enabled}
          words={words}
        />
      ) : null}
    </>
  );
}

/**
 * Upstream's Disconnect of a managed Codex account: sign-out only, with what it reported. Like
 * upstream's, it is unavailable to a session the sign-out command does not allow
 * (`providers:manage`).
 */
function T3AccountDisconnect({
  environmentId,
  instanceId,
  unavailable,
  words,
}: {
  environmentId: EnvironmentId;
  instanceId: ProviderInstanceId;
  unavailable: boolean;
  words: SignInWords;
}) {
  const logout = useAtomCommand(serverEnvironment.logoutProviderAuth, words.disconnectFailed);
  const allowed = useAtomValue(serverEnvironment.logoutProviderAuth.permissionAtom(environmentId));
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
          disabled={unavailable || !allowed || pending}
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

/**
 * Upstream's "Continue with ChatGPT" (`children`) beside other choices, such as adding a provider;
 * on a Lazurio Environment the Getting started page in its place.
 */
export function LazurioSignInChoice({
  environmentId,
  children,
}: {
  environmentId: EnvironmentId | null;
  children: ReactNode;
}) {
  const signIn = useLazurioSignIn(environmentId);
  const [words] = useState(() => signInWords(prefersCzech()));
  if (!signIn) return children;
  return signIn.toolsUrl ? (
    <OpenGettingStarted toolsUrl={signIn.toolsUrl} label={words.open} />
  ) : null;
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
