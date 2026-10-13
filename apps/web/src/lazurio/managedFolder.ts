import type { ServerConfig } from "@t3tools/contracts";

import type { FirstRunDecision } from "../onboarding/firstRun.logic";

/**
 * Lazurio overlay, the managed Lazurio Folder (LazurioPlatform F51). An Environment whose server
 * has `T3CODE_LAZURIO_FOLDER` is managed: its chats start in its Lazurio Folder, the one project it
 * takes. Without the variable no Environment is managed and nothing here changes upstream's
 * behaviour.
 */

/** An Environment as the web knows it: its server's config, once that has arrived. */
interface KnownEnvironment {
  readonly serverConfig: Pick<ServerConfig, "lazurioFolder"> | null;
}

/**
 * Whether "Add project" leaves the command palette and the sidebar: only when the web knows at
 * least one Environment and every one of them is managed. With none, upstream's "Add project"
 * leads to Settings → Connections, so it stays. An Environment whose config has not arrived yet
 * counts as not managed.
 */
export function everyEnvironmentManaged(environments: ReadonlyArray<KnownEnvironment>): boolean {
  return (
    environments.length > 0 &&
    environments.every((environment) => environment.serverConfig?.lazurioFolder !== undefined)
  );
}

export function managedFirstRunDecision(input: {
  hydrated: boolean;
  live: boolean;
  projectReady: boolean;
  completed: boolean;
}): { decision: FirstRunDecision; persistCompletion: boolean } {
  return {
    decision:
      !input.hydrated || !input.live || !input.projectReady
        ? "pending"
        : input.completed
          ? "app"
          : "wizard",
    persistCompletion: false,
  };
}
