import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { environmentSummaries } from "../state/presentation";
import { environmentServerConfigsAtom } from "../state/server";
import { everyEnvironmentManaged } from "./managedFolder";

/**
 * Lazurio overlay (Lazurio/t3code#77, the Admin's choice: hide them). T3's "Copy prompt link"
 * shares a prompt as a link to upstream's hosted app, with the prompt's text in its address, and
 * on a managed Environment such a link opens no thread: new threads start only in its Lazurio
 * Folder, and its server offers no Scratch. The entries leave where "Add project" does
 * (`everyEnvironmentManaged`): when the web knows at least one Environment and every one of them
 * is managed. One value for every sent message of the chat, so a message renders again only when
 * the answer changes, not with each change of a server's config.
 */
const promptLinksOfferedAtom = Atom.make(
  (get) =>
    !everyEnvironmentManaged(
      get(environmentSummaries.identitiesAtom),
      get(environmentServerConfigsAtom),
    ),
).pipe(Atom.withLabel("lazurio-prompt-links-offered"));

/** Whether the chat offers T3's "Copy prompt link" on its sent messages. */
export const usePromptLinksOffered = (): boolean => useAtomValue(promptLinksOfferedAtom);
