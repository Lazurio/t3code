// @effect-diagnostics nodeBuiltinImport:off -- the session name is a synchronous SHA-256 of the thread id.
/**
 * Lazurio overlay (root decision 0191, plan DEV-6646): the agent-browser session of a thread.
 *
 * On a Lazurio Environment the agents of every thread work in the Environment browser, one
 * Chromium on the Environment, through the agent-browser CLI, each thread in a window of its
 * own. The CLI takes its session from AGENT_BROWSER_SESSION, so the agent processes T3 starts
 * for a thread carry the thread's name. The same name is the thread's strip, whose holder file
 * keeps its tabs (threadTabs.ts); the web client reaches them only through the server. The
 * variable only names the session: it permits nothing.
 *
 * Two seams carry it. Every agent process of one thread starts through the server's AgentScope
 * (`decorateAgentScope`, server.ts): Claude Code as a native binary, Pi, Muse and the ACP agents.
 * Codex runs one app-server for every thread of an instance, so its process names no thread;
 * each Codex thread's config sets the variable for the commands its agent runs instead
 * (`codexThreadConfig`, CodexAdapterV2.ts). Processes T3 does not start for one thread
 * (OpenCode's servers, Cursor in the server process, Grok's cgroup lease on Linux, Claude Code
 * through a script entry) and Windows get no session.
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

/** Agent processes that serve every thread of an instance: Codex's app-server. */
const SHARED_AGENT_PROCESSES: ReadonlySet<string> = new Set(["codex"]);

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
    wrap: (input) =>
      Effect.gen(function* () {
        const launch = yield* inner.wrap(input);
        if (input.threadId === undefined || SHARED_AGENT_PROCESSES.has(input.name)) return launch;
        // A missing binary keeps failing at spawn, not as `env`'s exit 127.
        if (!(yield* resolves(input.command, input.env ?? hostEnvironment))) return launch;
        // `env` execs the launch, so the PID, stdio and process group stay the agent's.
        return {
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
