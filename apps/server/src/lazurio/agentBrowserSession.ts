// @effect-diagnostics nodeBuiltinImport:off -- the session name is a synchronous SHA-256 of the thread id.
/**
 * Lazurio overlay (root decision 0191): AGENT_BROWSER_SESSION names a thread's window in the
 * Environment browser and its holder-file strip; it permits nothing. It reaches agents through
 * AgentScope, Codex through its thread config, terminals through their spawn env; processes not
 * started for one thread (OpenCode, Cursor, Grok on Linux, scripted Claude) and Windows get none.
 */

import * as NodeCrypto from "node:crypto";

import type { McpProviderSessionConfig } from "@t3tools/provider-core/server/mcpSession";
import { AgentScope, type AgentScopeShape } from "@t3tools/shared/AgentScope";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveCommandPath } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

export const AGENT_BROWSER_SESSION_ENV = "AGENT_BROWSER_SESSION";

/** agent-browser accepts [A-Za-z0-9_-] in a session name; its dashboard takes 64 characters. */
const SESSION_NAME_LIMIT = 64;

/** Hex digits of the id's SHA-256 kept in a cut or rewritten name. */
const DIGEST_LENGTH = 32;

/** SHA-256 of the UTF-8 bytes, as hex. */
const sha256Hex = (value: string): string =>
  NodeCrypto.createHash("sha256").update(value, "utf8").digest("hex");

/**
 * `t3-` and the thread id. An id with characters outside [A-Za-z0-9_-], or too long to fit, has
 * them replaced by `-`, is cut, and ends in 32 hex digits (128 bits) of the SHA-256 of the exact
 * id, so that two threads never share a session, and with it a window: a shorter, non-
 * cryptographic suffix let two imported thread ids of the same instance collide.
 */
export function agentBrowserSessionName(threadId: string): string {
  const sanitized = threadId.replace(/[^A-Za-z0-9_-]/g, "-");
  const name = `t3-${sanitized}`;
  if (sanitized === threadId && name.length <= SESSION_NAME_LIMIT) return name;
  const digest = sha256Hex(threadId).slice(0, DIGEST_LENGTH);
  return `${name.slice(0, SESSION_NAME_LIMIT - DIGEST_LENGTH - 1)}-${digest}`;
}

/**
 * The thread's session in the config of its Codex thread (`thread/start`, `thread/resume` and
 * `thread/fork`): Codex sets it in the environment of the commands that thread's agent runs,
 * which is how agents call agent-browser, xdg-open and `gh auth login --web`. The app-server's
 * own process and its MCP servers serve every thread and get none.
 */
export const codexThreadConfig = (
  mcpSession: Pick<McpProviderSessionConfig, "threadId"> | undefined,
) =>
  mcpSession === undefined
    ? {}
    : {
        [`shell_environment_policy.set.${AGENT_BROWSER_SESSION_ENV}`]: agentBrowserSessionName(
          mcpSession.threadId,
        ),
      };

/**
 * Lazurio/t3code#73: a page a thread's shell opens (`BROWSER`, `xdg-open`) joins the thread's
 * strip. Terminals reach the agent scope without their thread, so the session travels in the
 * shell's environment instead; without a thread, and on Windows, the environment stays as it is.
 */
export function setTerminalSession(
  env: NodeJS.ProcessEnv,
  threadId: string | undefined,
  platform: NodeJS.Platform,
): void {
  if (platform === "win32" || !threadId) return;
  env[AGENT_BROWSER_SESSION_ENV] = agentBrowserSessionName(threadId);
}

const make = Effect.gen(function* () {
  const inner = yield* AgentScope;
  const platform = yield* HostProcess.Platform;
  // `/usr/bin/env` is POSIX; Windows keeps upstream's launch.
  if (platform === "win32") return inner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const hostEnvironment = yield* HostProcess.Environment;
  const resolves = (command: string, env: NodeJS.ProcessEnv) =>
    resolveCommandPath(command, { env }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(HostProcess.Platform, platform),
      Effect.map((resolved) => resolved !== null),
    );
  return {
    ...inner,
    wrap: Effect.fn("LazurioAgentBrowserSession.wrap")(function* (input) {
      const launch = yield* inner.wrap(input);
      // A shared process (Codex's app-server) serves every thread of its instance.
      if (input.threadId === undefined || input.shared === true) return launch;
      // A missing binary keeps failing at spawn, not as `env`'s exit 127.
      if (!(yield* resolves(input.command, input.env ?? hostEnvironment))) return launch;
      // `env` execs the launch, so the PID, stdio and process group stay the agent's, and any
      // other field of the launch passes through.
      return {
        ...launch,
        command: "/usr/bin/env",
        args: [
          `${AGENT_BROWSER_SESSION_ENV}=${agentBrowserSessionName(input.threadId)}`,
          launch.command,
          ...launch.args,
        ],
      };
    }),
  } satisfies AgentScopeShape;
});

/**
 * The server's AgentScope with each thread's agent processes started under
 * `/usr/bin/env AGENT_BROWSER_SESSION=<the thread's session>`, around whatever `agentScope`
 * returns (on Linux, upstream's systemd scope).
 */
export const decorateAgentScope = <E, R>(agentScope: Layer.Layer<never, E, R>) =>
  Layer.effect(AgentScope, make).pipe(Layer.provide(agentScope));
