// @effect-diagnostics nodeBuiltinImport:off - The holder files are the Platform's, read and written as it does.

/**
 * Lazurio overlay (plan DEV-6646, task 501; LazurioPlatform decision F47 points 4 and 5): who
 * keeps a remote tab of the Environment browser, as T3 Code's server writes and reads it.
 *
 * The view's hub alone ends a remote tab. It keeps one while a holder file lists it,
 * `$XDG_RUNTIME_DIR/lazurio-browser/holders/<strip>.json` (a T3 Code thread's strip is its
 * agent-browser session, `t3-<thread>`; the Launchpad's is `launchpad`), or while an agent works
 * in it: an agent-browser session bound to it (`<socket dir>/<session>.target`) whose daemon runs
 * (`<session>.pid`). Its list of the browser's live tabs, `tabs.json`, is what every app
 * reconciles its holds with, on the Environment's boot clock.
 *
 * Copied from LazurioPlatform `src/browser/people/holds.ts` at 49d54c9 (F47 step 2, on step 1
 * a2cd44d): BootTime, readBootClock, parseBootTime, RecordedTab, LiveTabs, parseLiveTabs,
 * keptTabs, isStrip, holderDirectory, liveTabsPath, parseHolder, holderFileText,
 * parseHolderRecords, replaceOwnerFile, processAlive and `watchDirectories` (the Platform's
 * `watchHolds`). holders.test.ts runs the Platform's vectors, so a drift between the copies fails
 * there. Added here: the hub's rule for a daemon that runs (`daemonWorking`, from `readHolds`),
 * the bindings of agent-browser's sessions, and the stop of a thread's daemon.
 */

import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

/** A strip's name is a file name: agent-browser's session alphabet, as T3
 * Code's `t3-<thread>` and the Launchpad's `launchpad` are. */
const stripPattern = /^[A-Za-z0-9_-]{1,64}$/;
const targetIdPattern = /^[0-9A-Fa-f]{32}$/;
const maxHolderBytes = 64 * 1024;
const maxTabsPerHolder = 500;
const maxLabelLength = 200;

export function isStrip(value: unknown): value is string {
  return typeof value === "string" && stripPattern.test(value);
}

/** A DevTools target id: 32 hexadecimal digits. */
export function isTargetId(value: unknown): value is string {
  return typeof value === "string" && targetIdPattern.test(value);
}

/** `$XDG_RUNTIME_DIR/lazurio-browser/holders`, where the apps' servers write
 * their holds; undefined without an absolute runtime directory. */
export function holderDirectory(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const runtime = env.XDG_RUNTIME_DIR;
  return runtime !== undefined && NodePath.isAbsolute(runtime)
    ? NodePath.join(runtime, "lazurio-browser", "holders")
    : undefined;
}

/** `$XDG_RUNTIME_DIR/lazurio-browser/tabs.json`: the hub's list of the
 * browser's live page targets, which every app's server reconciles its holds
 * with (F47 point 4). */
export function liveTabsPath(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const runtime = env.XDG_RUNTIME_DIR;
  return runtime !== undefined && NodePath.isAbsolute(runtime)
    ? NodePath.join(runtime, "lazurio-browser", "tabs.json")
    : undefined;
}

/** Where agent-browser keeps its sockets and a session's tab binding
 * (`AGENT_BROWSER_SOCKET_DIR` when absolute, else `$XDG_RUNTIME_DIR/agent-browser`), as the
 * Platform's `agentBrowserSocketDirectory` (`src/browser/window.ts`). */
export function agentBrowserSocketDirectory(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const named = env.AGENT_BROWSER_SOCKET_DIR;
  if (named !== undefined && NodePath.isAbsolute(named)) return named;
  const runtime = env.XDG_RUNTIME_DIR;
  return runtime !== undefined && NodePath.isAbsolute(runtime)
    ? NodePath.join(runtime, "agent-browser")
    : undefined;
}

/** A time on the Environment's boot clock (F47 point 4): the boot's id and
 * the seconds since it. Unlike the wall clock it never steps back, and every
 * process of the Environment reads the same one, so it orders an app's record
 * against the hub's snapshot. */
export type BootTime = Readonly<{ boot: string; at: number }>;

const bootIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Reads the boot clock: `/proc/sys/kernel/random/boot_id` and the first
 * number of `/proc/uptime` (CLOCK_BOOTTIME). Null where there is none: not
 * Linux, where no Environment browser runs. */
export async function readBootClock(
  read: (path: string) => Promise<string> = (path) => NodeFSP.readFile(path, "utf8"),
): Promise<BootTime | null> {
  try {
    const boot = (await read("/proc/sys/kernel/random/boot_id")).trim();
    const at = Number.parseFloat((await read("/proc/uptime")).trim().split(/\s+/)[0] ?? "");
    return bootIdPattern.test(boot) && Number.isFinite(at) && at >= 0 ? { boot, at } : null;
  } catch {
    return null;
  }
}

/** A boot-clock time as it is stored, or null when the value is not one. */
export function parseBootTime(value: unknown): BootTime | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  return typeof record.boot === "string" &&
    bootIdPattern.test(record.boot) &&
    typeof record.at === "number" &&
    Number.isFinite(record.at) &&
    record.at >= 0
    ? { boot: record.boot, at: record.at }
    : null;
}

/** A stored tab of an app with the boot-clock time it recorded the tab, or
 * null for a tab without one, which counts as recorded long ago (F47 point
 * 4). */
export type RecordedTab = Readonly<{ id: string; recordedAt: BootTime | null }>;

/** One snapshot of the browser's page targets: `takenAt` is the boot-clock
 * time the hub began it, before it asked the browser. */
export type LiveTabs = Readonly<{ tabs: readonly string[]; takenAt: BootTime }>;

/** Replaces one file of `lazurio-browser` atomically and owner-only (F47
 * point 4): a temporary file of mode 0600 renamed over it, so a reader sees
 * the old text or the new one, never a part. Its directory is made with mode
 * 0700 when missing. The temporary name never ends in `.json`, so the hub skips it. */
export async function replaceOwnerFile(path: string, text: string): Promise<void> {
  await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${NodeCrypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    await NodeFSP.writeFile(temporary, text, { mode: 0o600 });
    await NodeFSP.rename(temporary, path);
  } catch (error) {
    await NodeFSP.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** The list a reader finds, or null when the file is not one. */
export function parseLiveTabs(text: string): LiveTabs | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const takenAt = parseBootTime(record.takenAt);
  if (!Array.isArray(record.tabs) || takenAt === null) return null;
  if (!record.tabs.every((id): id is string => typeof id === "string" && targetIdPattern.test(id)))
    return null;
  return {
    tabs: record.tabs.map((id) => (id as string).toUpperCase()),
    takenAt,
  };
}

/** An app's reconciliation (F47 point 4): the ids it keeps from its stored
 * ones, `boot` being the current boot. A list of another boot is ignored.
 * An id the list lacks goes when the list was taken after the app recorded
 * it: a snapshot lists every target that exists when it begins, so such an
 * id had ended by then, while a tab recorded after the snapshot began stays.
 * A record from an earlier boot, or without a time, is older than every list
 * of this boot. Without a list, or without the boot clock, it keeps
 * everything. */
export function keptTabs(
  stored: readonly RecordedTab[],
  list: LiveTabs | null,
  boot: string | null,
): string[] {
  if (list === null || boot === null || list.takenAt.boot !== boot)
    return stored.map((tab) => tab.id);
  const live = new Set(list.tabs);
  return stored
    .filter(
      (tab) =>
        live.has(tab.id.toUpperCase()) ||
        (tab.recordedAt !== null &&
          tab.recordedAt.boot === boot &&
          tab.recordedAt.at >= list.takenAt.at),
    )
    .map((tab) => tab.id);
}

/** The hold one holder file records, or null when the file is not one: its
 * `strip` must be its file name, and only target ids count. */
export function parseHolder(
  fileName: string,
  text: string,
): Readonly<{ strip: string; label: string; tabs: readonly string[] }> | null {
  if (!fileName.endsWith(".json")) return null;
  const name = fileName.slice(0, -".json".length);
  if (!isStrip(name) || text.length > maxHolderBytes) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.strip !== name || !Array.isArray(record.tabs)) return null;
  const label =
    typeof record.label === "string" ? record.label.trim().slice(0, maxLabelLength) : "";
  const tabs = [
    ...new Set(
      record.tabs
        .filter((id): id is string => typeof id === "string" && targetIdPattern.test(id))
        .map((id) => id.toUpperCase()),
    ),
  ].slice(0, maxTabsPerHolder);
  return { strip: name, label, tabs };
}

/** The text of a holder file that also keeps each tab's record time,
 * `recordedAt`, by its id: the hub ignores it, and only the app that writes
 * the file reads it back (`parseHolderRecords`), so its reconciliation
 * survives a restart. A tab without a time has no entry. */
export function holderFileText(strip: string, label: string, tabs: readonly RecordedTab[]): string {
  const recordedAt: Record<string, BootTime> = {};
  for (const tab of tabs)
    if (tab.recordedAt !== null)
      recordedAt[tab.id] = { boot: tab.recordedAt.boot, at: tab.recordedAt.at };
  return `${JSON.stringify({
    strip,
    label,
    tabs: tabs.map((tab) => tab.id),
    recordedAt,
  })}\n`;
}

/** A holder file with the record time of each of its tabs, or null when the
 * file is not a holder file (`parseHolder`'s rules). A tab whose time is
 * missing or not a boot-clock time has null. */
export function parseHolderRecords(
  fileName: string,
  text: string,
): Readonly<{
  strip: string;
  label: string;
  tabs: readonly RecordedTab[];
}> | null {
  const hold = parseHolder(fileName, text);
  if (hold === null) return null;
  const times = new Map<string, BootTime>();
  const stored = (JSON.parse(text) as Record<string, unknown>).recordedAt;
  if (typeof stored === "object" && stored !== null && !Array.isArray(stored))
    for (const [id, value] of Object.entries(stored)) {
      const at = parseBootTime(value);
      if (targetIdPattern.test(id) && at !== null) times.set(id.toUpperCase(), at);
    }
  return {
    strip: hold.strip,
    label: hold.label,
    tabs: hold.tabs.map((id) => ({ id, recordedAt: times.get(id) ?? null })),
  };
}

/** True while a process with this id runs (one of another user counts too,
 * as `kill -0` answers EPERM for it). */
export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid < 2) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** A `.pid` file's process id when it is a well-formed one of at least 2, else null. */
export function daemonProcessId(text: string): number | null {
  const digits = text.trim();
  const pid = /^[0-9]{1,10}$/.test(digits) ? Number(digits) : Number.NaN;
  return Number.isSafeInteger(pid) && pid >= 2 ? pid : null;
}

/** The hub's rule for an agent at work (`readHolds`): a session counts as ended only when its
 * `.pid` is gone (null here) or names a well-formed process id that no longer runs; one that
 * cannot be understood (empty, signed, zero) counts as working. */
export function daemonWorking(pidText: string | null, alive: (pid: number) => boolean): boolean {
  if (pidText === null) return false;
  const pid = daemonProcessId(pidText);
  return pid === null || alive(pid);
}

/** True for "no such file or directory": the one read failure that means nothing is there. */
export const isMissing = (error: unknown) =>
  (error as NodeJS.ErrnoException | null)?.code === "ENOENT";

/** A directory's names; one that does not exist is empty. Any other failure is thrown. */
export async function directoryNames(directory: string): Promise<string[]> {
  try {
    return (await NodeFSP.readdir(directory)).sort();
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

/** A file's text; null when it is gone. Any other failure is thrown. */
export async function fileText(
  path: string,
  read: (path: string) => Promise<string> = (file) => NodeFSP.readFile(file, "utf8"),
): Promise<string | null> {
  try {
    return await read(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** One agent-browser session's binding: the tab it drives and whether its daemon runs. */
export type SessionBinding = Readonly<{ session: string; targetId: string; working: boolean }>;

/**
 * The bindings in agent-browser's socket directory, by session, sorted. A binding file that
 * cannot be read or understood is skipped here: it only takes an agent's mark off a tab, unlike
 * in the hub, which keeps its last reading for a read it could not make.
 */
export async function readSessionBindings(
  directory: string,
  alive: (pid: number) => boolean = processAlive,
  read?: (path: string) => Promise<string>,
): Promise<SessionBinding[]> {
  const bindings: SessionBinding[] = [];
  for (const name of await directoryNames(directory)) {
    if (!name.endsWith(".target")) continue;
    const session = name.slice(0, -".target".length);
    if (!isStrip(session)) continue;
    let targetId: unknown;
    try {
      const content = await fileText(NodePath.join(directory, name), read);
      if (content === null) continue;
      targetId = (JSON.parse(content) as { targetId?: unknown } | null)?.targetId;
    } catch {
      continue;
    }
    if (!isTargetId(targetId)) continue;
    const pidText = await fileText(NodePath.join(directory, `${session}.pid`), read).catch(
      () => "",
    );
    bindings.push({
      session,
      targetId: targetId.toUpperCase(),
      working: daemonWorking(pidText, alive),
    });
  }
  return bindings;
}

/** What the daemon stop needs of the host: overridable in tests (a fake process table). */
export type DaemonSeams = Readonly<{
  alive?: (pid: number) => boolean;
  /** `/proc/<pid>/cmdline`, NUL-separated. */
  commandLine?: (pid: number) => Promise<string>;
  terminate?: (pid: number) => void;
  read?: (path: string) => Promise<string>;
}>;

/** The daemon is agent-browser's own executable, re-run with AGENT_BROWSER_DAEMON=1 and no
 * arguments (agent-browser `cli/src/connection.rs`), so its command line names agent-browser. */
const namesAgentBrowser = (commandLine: string) =>
  /^agent-browser(?:[-_.][A-Za-z0-9_.-]*)?$/.test(
    NodePath.basename(commandLine.split("\0")[0] ?? ""),
  );

/**
 * Stops a session's agent-browser daemon: SIGTERM to the process its `.pid` names, only when
 * that is a well-formed id of a live process whose command line is agent-browser's. On SIGTERM
 * the daemon of an attached browser disconnects without closing a tab and removes its `.pid`, so
 * its binding no longer counts for the hub. Never `agent-browser close`, which first spawns a
 * daemon when none runs. Resolves what happened; a failed signal is thrown.
 */
export async function stopSessionDaemon(
  socketDirectory: string,
  session: string,
  seams: DaemonSeams = {},
): Promise<"stopped" | "none" | "not-agent-browser"> {
  if (!isStrip(session)) return "none";
  const pidText = await fileText(NodePath.join(socketDirectory, `${session}.pid`), seams.read);
  const pid = pidText === null ? null : daemonProcessId(pidText);
  if (pid === null || !(seams.alive ?? processAlive)(pid)) return "none";
  const commandLine = await (
    seams.commandLine ?? ((id) => NodeFSP.readFile(`/proc/${id}/cmdline`, "utf8"))
  )(pid).catch(() => "");
  if (!namesAgentBrowser(commandLine)) return "not-agent-browser";
  (seams.terminate ?? ((id) => process.kill(id, "SIGTERM")))(pid);
  return "stopped";
}

/** Calls `changed` whenever something in one of the directories changes.
 * A directory that does not exist yet is watched once it does: `retry` is
 * called on the periodic read. The Platform's `watchHolds`. */
export function watchDirectories(
  directories: readonly (string | undefined)[],
  changed: () => void,
): Readonly<{ retry: () => void; stop: () => void }> {
  const watchers = new Map<string, NodeFS.FSWatcher>();
  const retry = () => {
    for (const directory of directories) {
      if (directory === undefined || watchers.has(directory)) continue;
      try {
        const watcher = NodeFS.watch(directory, { persistent: false }, () => changed());
        watcher.on("error", () => {
          watcher.close();
          watchers.delete(directory);
        });
        watchers.set(directory, watcher);
      } catch {}
    }
  };
  retry();
  return Object.freeze({
    retry,
    stop: () => {
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  });
}
