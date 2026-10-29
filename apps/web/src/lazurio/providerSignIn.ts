import type { ServerConfig, ServerProvider } from "@t3tools/contracts";

/**
 * Lazurio overlay (root decision 0201 point 4, Lazurio/t3code#46): on a Lazurio Environment Codex
 * and Claude sign in through their CLIs from the Launchpad's Getting started page, so every agent
 * reads the same sign-in. T3's own "Continue with ChatGPT" gives way to a link there; Disconnect
 * stays.
 */

/** The Environment's sign-in page when it is a Lazurio Environment; null where T3's own stays. */
export function lazurioSignInOf(
  config: Pick<ServerConfig, "lazurioFolder" | "lazurioToolsUrl"> | null | undefined,
): { readonly toolsUrl: string | undefined } | null {
  return config?.lazurioFolder === undefined ? null : { toolsUrl: config.lazurioToolsUrl };
}

/**
 * Whether a Codex instance is signed in to a ChatGPT account only T3 uses (T3's managed setup),
 * which a Lazurio Environment still lets the person disconnect, though never sign in to again.
 */
export function t3AccountToDisconnect(
  mode: "managed" | "existing" | undefined,
  provider: Pick<ServerProvider, "auth"> | undefined,
): boolean {
  return mode === "managed" && provider?.auth.status === "authenticated";
}
