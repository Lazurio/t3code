import type { ServerConfig } from "@t3tools/contracts";

/**
 * Lazurio overlay (root decision 0201 point 4, Lazurio/t3code#46). On a Lazurio Environment, one
 * whose server has `T3CODE_LAZURIO_FOLDER`, Codex and Claude sign in through their own CLIs from
 * the Launchpad's Getting started page (`T3CODE_LAZURIO_TOOLS_URL`), so the sign-in is where T3,
 * the terminal and every agent read it. T3's own "Continue with ChatGPT" would keep a token only T3
 * sees: there it gives way to a link to that page, and the server refuses it for every client.
 */

/** The Environment's sign-in page when it is a Lazurio Environment; null where T3's own stays. */
export function lazurioSignInOf(
  config: Pick<ServerConfig, "lazurioFolder" | "lazurioToolsUrl"> | null | undefined,
): { readonly toolsUrl: string | undefined } | null {
  return config?.lazurioFolder === undefined ? null : { toolsUrl: config.lazurioToolsUrl };
}
