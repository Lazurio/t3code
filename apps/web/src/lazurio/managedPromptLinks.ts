import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { environmentSummaries } from "../state/presentation";
import { environmentServerConfigsAtom } from "../state/server";
import { everyEnvironmentManaged } from "./managedFolder";

/**
 * Lazurio overlay: when every known Environment is managed, "Add project" and "Copy prompt link"
 * leave the web (Lazurio/t3code#77): such links open no thread on a managed Environment. One atom,
 * so consumers re-render only when the answer changes, not with each server config change.
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
