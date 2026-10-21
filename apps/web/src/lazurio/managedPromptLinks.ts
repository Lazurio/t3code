import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { environmentSummaries } from "../state/presentation";
import { environmentServerConfigsAtom } from "../state/server";
import { everyEnvironmentManaged } from "./managedFolder";

/**
 * Lazurio overlay. One rule leaves out of the web what leads beyond a managed Environment's
 * Lazurio Folder (`everyEnvironmentManaged`): when the web knows at least one Environment and
 * every one of them is managed. Then "Add project" leaves the sidebar (LazurioPlatform F51), and
 * T3's "Copy prompt link" leaves every sent message (Lazurio/t3code#77, the Admin's choice: hide
 * them): such a link goes to upstream's hosted app with the prompt's text in its address and on a
 * managed Environment opens no thread, because new threads start only in its Folder and its server
 * offers no Scratch. One value for the whole web, so a sent message or the sidebar renders again
 * only when the answer changes, not with each change of a server's config.
 */
const everyEnvironmentManagedAtom = Atom.make((get) =>
  everyEnvironmentManaged(
    get(environmentSummaries.identitiesAtom),
    get(environmentServerConfigsAtom),
  ),
).pipe(Atom.withLabel("lazurio-every-environment-managed"));

/** Whether "Add project" leaves the sidebar. */
export const useEveryEnvironmentManaged = (): boolean => useAtomValue(everyEnvironmentManagedAtom);

/** Whether the chat offers T3's "Copy prompt link" on its sent messages. */
export const usePromptLinksOffered = (): boolean => !useAtomValue(everyEnvironmentManagedAtom);
