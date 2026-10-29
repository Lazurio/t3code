import type { EnvironmentId } from "@t3tools/contracts";

import { recordPromptSent } from "../components/GitHubStarPrompt";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "../state/server";

/**
 * Lazurio overlay: upstream counts sent prompts toward a toast that asks for a star on upstream's
 * repository (pingdotgg/t3code#27832). A Lazurio Environment never asks, so its prompts are not
 * counted. An Environment whose config has not arrived counts as not managed, as in
 * managedFolder.ts.
 */
export function recordPromptSentOutsideLazurio(environmentId: EnvironmentId): void {
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
  if (config?.lazurioFolder !== undefined) return;
  void recordPromptSent(environmentId);
}
