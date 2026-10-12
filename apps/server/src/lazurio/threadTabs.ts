// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - The holder files, their watches and their beat live outside the Effect runtime, as the Launchpad's do.

/**
 * Lazurio overlay (plan DEV-6646, task 501; LazurioPlatform decision F47 points 4, 5 and 10): the
 * tabs of the Environment browser that each T3 Code thread keeps.
 *
 * A thread's tabs live only in its holder file, `holders/t3-<thread>.json` (holders.ts), the
 * file the view's hub reads to keep them. Beside the ids it keeps each tab's record time on the
 * boot clock (`recordedAt`), so a restart of T3 Code finds them intact; T3 Code's database stays
 * upstream's. The server keeps only an index of the files, rebuilt when it starts, and what never
 * has to outlive it: the reveal requests, the other holders' labels and which tabs an agent works
 * in.
 *
 * Holds stay true to the browser the Launchpad's way (LazurioPlatform
 * `src/launchpad/new-tab/holder.ts`): every file is reconciled with the hub's list of live tabs
 * (`tabs.json`) when the service starts, when the list changes (watched, a burst joined into one),
 * every 30 s, and before every write, dropping exactly what `keptTabs` lets go. Every write
 * re-reads its file first, and a file that cannot be read is never written over: its holds stay
 * as the file has them. One queue serializes every write. Nothing here reads the wall clock.
 *
 * A tab enters a thread's strip when a person holds it (the web, threadTabsRoute.ts), when
 * preview_open opens or adopts it (environmentBrowser.ts `adopt`), and when the thread's own
 * agent-browser session binds another tab (`t3-<thread>.target`, watched as the hub watches it).
 * Archiving or deleting a thread removes its file and stops its agent's daemon; at the start,
 * files and daemons of threads that are no longer live go too. The service is off, answering
 * `{available: false}`, without an absolute XDG_RUNTIME_DIR or while the Environment does not
 * declare its browser (the Environment browser host's declaration).
 */

import { ThreadId } from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { forkParked } from "../serverActivation.ts";
import { agentBrowserSessionName } from "./agentBrowserSession.ts";
import {
  agentBrowserSocketDirectory,
  type BootTime,
  type DaemonSeams,
  directoryNames,
  fileText,
  holderDirectory,
  holderFileText,
  isMissing,
  isStrip,
  isTargetId,
  keptTabs,
  liveTabsPath,
  parseHolder,
  parseHolderRecords,
  parseLiveTabs,
  processAlive,
  readBootClock,
  readSessionBindings,
  replaceOwnerFile,
  type SessionBinding,
  stopSessionDaemon,
  watchDirectories,
} from "./holders.ts";
import { type LiveThread, ThreadLifecycle, type ThreadLifecycleEvent } from "./threadLifecycle.ts";

/** At most this many tabs per thread: a hold past it is refused, never one dropped to make room. */
export const MAX_THREAD_TABS = 128;
/** A defensive bound well inside the 64 KiB the hub reads of a holder file. */
const MAX_FILE_BYTES = 60 * 1024;
const MAX_LABEL_LENGTH = 200;

const REASONS = [
  "invalid-request",
  "thread-not-found",
  "too-many-tabs",
  "unavailable",
  "holder-unreadable",
  "hold-failed",
] as const;
export type ThreadTabsErrorReason = (typeof REASONS)[number];

/** Why a hold, a release or a read is refused; the route maps each reason to its status. */
export class ThreadTabsError extends Schema.TaggedError<ThreadTabsError>()("ThreadTabsError", {
  reason: Schema.Literals(REASONS),
}) {
  override get message(): string {
    return `The thread's tabs are not available (${this.reason}).`;
  }
}

/** Another strip that holds a tab: a T3 Code thread (`t3-…`), the Launchpad (`launchpad`), … */
export interface TabHolder {
  readonly strip: string;
  readonly label: string;
}

export interface ThreadTab {
  readonly tabId: string;
  /** The view of the tab, `<viewOrigin>/t/<tabId>`. */
  readonly view: string;
  /** An agent works in it: a session bound to it has a live daemon. */
  readonly agent: boolean;
  readonly alsoHeldBy: ReadonlyArray<TabHolder>;
  /** Set when an agent recorded the tab and asked to show it, replaced by its next reveal. */
  readonly revealRequest?: { readonly id: string };
}

export interface ThreadTabsSnapshot {
  readonly available: true;
  /** This run of the server: revisions start again in another. */
  readonly epoch: string;
  /** Grows with every change of the thread's snapshot; an equal revision is an equal snapshot. */
  readonly revision: number;
  readonly threadId: string;
  readonly strip: string;
  readonly viewOrigin: string;
  /** In the holder file's order. */
  readonly tabs: ReadonlyArray<ThreadTab>;
}

export type ThreadTabsAnswer = { readonly available: false } | ThreadTabsSnapshot;

/** Another Environment's tab preview_open answered with: the thread's devices show it, live only. */
export interface ForeignTab {
  readonly tabId: string;
  readonly view: string;
  readonly revealRequest?: { readonly id: string };
}

export type ThreadTabsEvent =
  | { readonly type: "snapshot"; readonly answer: ThreadTabsAnswer }
  | { readonly type: "foreign"; readonly tab: ForeignTab };

export interface ThreadTabsCoreSeams {
  /** An absolute XDG_RUNTIME_DIR: `lazurio-browser/` and its `holders/` are inside. */
  readonly runtimeDirectory: string;
  /** agent-browser's socket directory, or undefined without one. */
  readonly socketDirectory: string | undefined;
  /** This server's run: the prefix of every reveal request. */
  readonly epoch: string;
  /** The boot clock (`readBootClock`); null off Linux. */
  readonly bootClock: () => Promise<BootTime | null>;
  /** The live thread with this id, or null; rejects when it cannot be read. */
  readonly liveThread: (threadId: string) => Promise<LiveThread | null>;
  /** Every live thread; rejects when they cannot be read. */
  readonly liveThreads: () => Promise<ReadonlyArray<LiveThread>>;
  /** Settles once the projection has caught up (command readiness). */
  readonly ready: Promise<void>;
  readonly readFile?: ((path: string) => Promise<string>) | undefined;
  readonly daemon?: DaemonSeams | undefined;
  readonly watch?: typeof watchDirectories | undefined;
  /** The beat (30 s) and the wait that joins a burst of changes (100 ms). */
  readonly everyMs?: number | undefined;
  readonly debounceMs?: number | undefined;
  readonly log?: ((event: string, detail?: Readonly<Record<string, unknown>>) => void) | undefined;
}

export interface ThreadTabsCore {
  /** The Environment's declaration of its browser: the origin of its view, or undefined. */
  readonly declare: (viewOrigin: string | undefined) => void;
  readonly read: (threadId: string) => Promise<ThreadTabsAnswer>;
  readonly hold: (threadId: string, tabId: string) => Promise<ThreadTabsSnapshot>;
  readonly release: (threadId: string, tabId: string) => Promise<ThreadTabsSnapshot>;
  /** An agent's tab joins the thread's strip (preview_open, a new binding); never fails. */
  readonly record: (threadId: string, tabId: string, reveal: boolean) => Promise<void>;
  readonly foreign: (
    threadId: string,
    tab: { readonly tabId: string; readonly view: string },
    reveal: boolean,
  ) => void;
  /** Archive, delete, unarchive and titles; never fails. */
  readonly lifecycle: (event: ThreadLifecycleEvent) => Promise<void>;
  readonly subscribe: (threadId: string, listener: (event: ThreadTabsEvent) => void) => () => void;
  /** Reconciles, reads the other holders and the agents' bindings now (what the beat does). */
  readonly refresh: () => Promise<void>;
  /** Settles once the start and every operation queued so far are done. */
  readonly settled: () => Promise<void>;
  readonly stop: () => Promise<void>;
}

interface Held {
  label: string;
  /** Tab → its record time, in the order first recorded. */
  readonly tabs: Map<string, BootTime | null>;
}

const isThreadTabsError = Schema.is(ThreadTabsError);
const isThreadStrip = (strip: string) => isStrip(strip) && strip.startsWith("t3-");
const refusal = (reason: ThreadTabsErrorReason) => new ThreadTabsError({ reason });
const cutLabel = (label: string) => label.trim().slice(0, MAX_LABEL_LENGTH);

export function createThreadTabs(seams: ThreadTabsCoreSeams): ThreadTabsCore {
  const lazurioDirectory = NodePath.join(seams.runtimeDirectory, "lazurio-browser");
  const holdersDirectory = holderDirectory({ XDG_RUNTIME_DIR: seams.runtimeDirectory })!;
  const listPath = liveTabsPath({ XDG_RUNTIME_DIR: seams.runtimeDirectory })!;
  const read = seams.readFile ?? ((path: string) => NodeFSP.readFile(path, "utf8"));
  const alive = seams.daemon?.alive ?? processAlive;
  const log = seams.log ?? (() => undefined);
  const everyMs = seams.everyMs ?? 30_000;
  const debounceMs = seams.debounceMs ?? 100;

  /** The last good read of each of T3 Code's holder files, by strip. */
  const index = new Map<string, Held>();
  /** Strips of threads archived or deleted since the start: they take no hold. */
  const retired = new Set<string>();
  const reveals = new Map<string, Map<string, string>>();
  /** Every holder file's holds, by tab: the other holders a snapshot names. */
  let holdsOf = new Map<string, TabHolder[]>();
  /** Tabs a session with a live daemon is bound to. */
  let working = new Set<string>();
  /** The tab each `t3-` session was last seen bound to: only another one is recorded. */
  const lastBound = new Map<string, string>();
  const threadOfSessionCache = new Map<string, string | null>();
  const subscribers = new Map<
    string,
    Set<{ readonly threadId: string; readonly listener: (event: ThreadTabsEvent) => void }>
  >();
  /** Each strip's last snapshot and its revision. A snapshot that changed gets the next revision and
   * an unchanged one keeps its own, whether or not a client streams the strip, so a client orders
   * every snapshot it gets (a POST's answer against the stream) by its revision alone. */
  const stamps = new Map<string, { readonly key: string; readonly revision: number }>();
  /** What each streamed strip was last sent: its revision, or unavailable. */
  const lastSent = new Map<string, number | "unavailable">();
  let viewOrigin: string | undefined;
  let revision = 0;
  let revealCount = 0;
  let startup: Promise<void> | undefined;
  /** The start read every file: until then no snapshot goes out, as an empty index would empty
   * every device's strip. */
  let started = false;
  let stopped = false;
  let queue: Promise<unknown> = Promise.resolve();
  /** Refreshes the debounce and the beat started, so `settled` waits for them too. */
  const running = new Set<Promise<void>>();
  let beat: ReturnType<typeof setInterval> | null = null;
  let soon: ReturnType<typeof setTimeout> | null = null;
  let watcher: ReturnType<typeof watchDirectories> | null = null;

  const available = () => viewOrigin !== undefined;
  const stripOf = (threadId: string) => agentBrowserSessionName(threadId);
  const holderPath = (strip: string) => NodePath.join(holdersDirectory, `${strip}.json`);

  /** One operation at a time, so a write never carries an older state than the one before it. */
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  /** The file as it is now: only a file that does not exist holds nothing. One that cannot be read,
   * or is not a holder file, throws, so nothing is written over it until a read succeeds. */
  async function current(strip: string): Promise<Held> {
    let text: string;
    try {
      text = await read(holderPath(strip));
    } catch (error) {
      if (isMissing(error)) return { label: "", tabs: new Map() };
      throw refusal("holder-unreadable");
    }
    const file = parseHolderRecords(`${strip}.json`, text);
    if (file === null) throw refusal("holder-unreadable");
    return { label: file.label, tabs: new Map(file.tabs.map((tab) => [tab.id, tab.recordedAt])) };
  }

  /** The hub's list and the current boot, read for one reconciliation. */
  async function listAndBoot() {
    const text = await read(listPath).catch(() => null);
    const list = text === null ? null : parseLiveTabs(text);
    const boot = list === null ? null : ((await seams.bootClock())?.boot ?? null);
    return { list, boot };
  }

  /** The ids of `held` the hub's list lets go (`keptTabs`). */
  function letGo(
    held: Held,
    { list, boot }: Awaited<ReturnType<typeof listAndBoot>>,
  ): readonly string[] {
    if (held.tabs.size === 0) return [];
    const kept = new Set(
      keptTabs(
        [...held.tabs].map(([id, recordedAt]) => ({ id, recordedAt })),
        list,
        boot,
      ),
    );
    return [...held.tabs.keys()].filter((id) => !kept.has(id));
  }

  /** Writes the file, or removes it once its last tab went, so the hub reads fewer files. */
  async function write(strip: string, held: Held): Promise<void> {
    try {
      if (held.tabs.size === 0) {
        await NodeFSP.rm(holderPath(strip), { force: true });
        return;
      }
      const text = holderFileText(
        strip,
        held.label,
        [...held.tabs].map(([id, recordedAt]) => ({ id, recordedAt })),
      );
      if (Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES) throw new Error("holder file too big");
      await replaceOwnerFile(holderPath(strip), text);
    } catch {
      throw refusal("hold-failed");
    }
  }

  const forgetReveals = (strip: string, tabs: Iterable<string>) => {
    const own = reveals.get(strip);
    if (own === undefined) return;
    for (const tab of tabs) own.delete(tab);
    if (own.size === 0) reveals.delete(strip);
  };
  const remember = (strip: string, held: Held) => {
    if (held.tabs.size === 0) index.delete(strip);
    else index.set(strip, held);
  };

  /**
   * The live thread `threadId` holds `tab`, reconciling first; a tab held already keeps its time.
   * The thread is read live and not retired inside the queue, and `retired` once more right before
   * the write: an archive (`retire`) marks the strip first and removes its file through the same
   * queue, so whichever of the two comes second sees the other, and an archived thread's file is
   * never written back. Refused with thread-not-found otherwise.
   */
  const holdTab = (threadId: string, tab: string) =>
    serialized(async () => {
      const strip = stripOf(threadId);
      const live = retired.has(strip) ? null : await liveThreadOf(threadId);
      if (live === null) throw refusal("thread-not-found");
      const held = await current(strip);
      const gone = letGo(held, await listAndBoot());
      for (const id of gone) held.tabs.delete(id);
      let changed = gone.length > 0;
      if (!held.tabs.has(tab)) {
        if (held.tabs.size >= MAX_THREAD_TABS) throw refusal("too-many-tabs");
        held.tabs.set(tab, await seams.bootClock());
        changed = true;
      }
      if (held.label === "") held.label = cutLabel(live.title);
      if (retired.has(strip)) throw refusal("thread-not-found");
      if (changed) await write(strip, held);
      forgetReveals(strip, gone);
      remember(strip, held);
    });

  /** Lets go of `tab` for `strip`; a tab not held is released already. */
  const releaseTab = (strip: string, tab: string) =>
    serialized(async () => {
      const held = await current(strip);
      const gone = letGo(held, await listAndBoot());
      for (const id of gone) held.tabs.delete(id);
      const had = held.tabs.delete(tab);
      if (had || gone.length > 0) await write(strip, held);
      forgetReveals(strip, [...gone, tab]);
      remember(strip, held);
    });

  /** Every one of T3 Code's holder files against the hub's list. Never fails: a file that cannot be
   * read is left as it is, and so is its last good index. */
  async function reconcileAll(): Promise<void> {
    let names: string[];
    try {
      names = await directoryNames(holdersDirectory);
    } catch {
      log("thread-tabs-reconcile-failed", { reason: "holders-unreadable" });
      return;
    }
    const strips = names
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .filter(isThreadStrip);
    const listed = await listAndBoot();
    for (const strip of strips) {
      try {
        const held = await current(strip);
        const gone = letGo(held, listed);
        for (const id of gone) held.tabs.delete(id);
        if (gone.length > 0) await write(strip, held);
        forgetReveals(strip, gone);
        remember(strip, held);
      } catch {
        log("thread-tabs-reconcile-failed", { strip });
      }
    }
    const present = new Set(strips);
    for (const strip of index.keys()) if (!present.has(strip)) index.delete(strip);
  }

  /** Every holder file's holds, for the other holders a snapshot names. An unreadable file of
   * another app only leaves its part out. */
  async function readHolders(): Promise<void> {
    const holds = new Map<string, TabHolder[]>();
    for (const name of await directoryNames(holdersDirectory).catch(() => [])) {
      if (!name.endsWith(".json") || !isStrip(name.slice(0, -".json".length))) continue;
      const text = await fileText(NodePath.join(holdersDirectory, name), read).catch(() => null);
      const hold = text === null ? null : parseHolder(name, text);
      if (hold === null) continue;
      for (const id of hold.tabs) {
        const entry = { strip: hold.strip, label: hold.label };
        const list = holds.get(id);
        if (list === undefined) holds.set(id, [entry]);
        else list.push(entry);
      }
    }
    holdsOf = holds;
  }

  /** The agents' bindings: which tabs an agent works in, and the `t3-` sessions bound to another
   * tab since they were last seen (none on the first read, the baseline). */
  async function readBindings(baseline: boolean): Promise<SessionBinding[]> {
    if (seams.socketDirectory === undefined) {
      working = new Set();
      return [];
    }
    let bindings: SessionBinding[];
    try {
      bindings = await readSessionBindings(seams.socketDirectory, alive, seams.readFile);
    } catch {
      return [];
    }
    working = new Set(
      bindings.filter((binding) => binding.working).map((binding) => binding.targetId),
    );
    const fresh: SessionBinding[] = [];
    for (const binding of bindings) {
      if (!isThreadStrip(binding.session)) continue;
      const last = lastBound.get(binding.session);
      lastBound.set(binding.session, binding.targetId);
      if (!baseline && last !== binding.targetId) fresh.push(binding);
    }
    return fresh;
  }

  /** The live thread whose session is `session`: its id when the name is the id unchanged, else
   * by the names of the live threads. Looked up once. */
  async function threadOfSession(session: string): Promise<string | null> {
    if (!isThreadStrip(session)) return null;
    const cached = threadOfSessionCache.get(session);
    if (cached !== undefined) return cached;
    const candidate = session.slice("t3-".length);
    let threadId: string | null = null;
    try {
      if (agentBrowserSessionName(candidate) === session) {
        threadId = (await seams.liveThread(candidate))?.id ?? null;
      } else {
        threadId =
          (await seams.liveThreads()).find(
            (thread) => agentBrowserSessionName(thread.id) === session,
          )?.id ?? null;
      }
    } catch {
      return null;
    }
    threadOfSessionCache.set(session, threadId);
    return threadId;
  }

  async function stopDaemon(session: string): Promise<void> {
    if (seams.socketDirectory === undefined) return;
    try {
      const outcome = await stopSessionDaemon(seams.socketDirectory, session, seams.daemon);
      if (outcome === "failed") log("thread-tabs-daemon-stop-failed", { session });
    } catch (error) {
      log("thread-tabs-daemon-stop-failed", { session, cause: String(error) });
    }
  }

  /** Removes a strip's file even when it cannot be read: archive and delete let go of everything. */
  async function removeFile(strip: string): Promise<void> {
    try {
      await NodeFSP.rm(holderPath(strip));
    } catch (error) {
      if (!isMissing(error)) log("thread-tabs-remove-failed", { strip, cause: String(error) });
    }
    index.delete(strip);
    reveals.delete(strip);
  }

  /** At the start: files and daemons of threads that are no longer live, including those archived
   * while T3 Code was down or before this release. Names outside `t3-` are never touched. */
  async function sweep(): Promise<void> {
    let live: ReadonlyArray<LiveThread>;
    try {
      live = await seams.liveThreads();
    } catch {
      log("thread-tabs-sweep-skipped", { reason: "threads-unreadable" });
      return;
    }
    const liveStrips = new Set(live.map((thread) => stripOf(thread.id)));
    for (const name of await directoryNames(holdersDirectory).catch(() => [])) {
      if (!name.endsWith(".json")) continue;
      const strip = name.slice(0, -".json".length);
      if (!isThreadStrip(strip) || liveStrips.has(strip)) continue;
      await removeFile(strip);
      await stopDaemon(strip);
    }
    if (seams.socketDirectory === undefined) return;
    for (const name of await directoryNames(seams.socketDirectory).catch(() => [])) {
      if (!name.endsWith(".pid")) continue;
      const session = name.slice(0, -".pid".length);
      if (isThreadStrip(session) && !liveStrips.has(session)) await stopDaemon(session);
    }
  }

  const nextRevealId = () => `${seams.epoch}:${++revealCount}`;
  const reveal = (strip: string, tab: string) => {
    const own = reveals.get(strip) ?? new Map<string, string>();
    own.set(tab, nextRevealId());
    reveals.set(strip, own);
  };

  function snapshotBody(strip: string, origin: string) {
    const own = reveals.get(strip);
    return {
      strip,
      viewOrigin: origin,
      tabs: [...(index.get(strip)?.tabs.keys() ?? [])].map((tabId): ThreadTab => {
        const revealId = own?.get(tabId);
        return {
          tabId,
          view: `${origin}/t/${tabId}`,
          agent: working.has(tabId),
          alsoHeldBy: (holdsOf.get(tabId) ?? []).filter((holder) => holder.strip !== strip),
          ...(revealId === undefined ? {} : { revealRequest: { id: revealId } }),
        };
      }),
    };
  }

  /** The strip's snapshot now, with its revision (`stamps`). */
  function stamped(strip: string, origin: string) {
    const body = snapshotBody(strip, origin);
    const key = JSON.stringify(body);
    let stamp = stamps.get(strip);
    if (stamp?.key !== key) {
      revision += 1;
      stamp = { key, revision };
      stamps.set(strip, stamp);
    }
    return { revision: stamp.revision, body };
  }

  function snapshotFor(strip: string, threadId: string): ThreadTabsSnapshot {
    if (viewOrigin === undefined) throw refusal("unavailable");
    const snapshot = stamped(strip, viewOrigin);
    return {
      available: true,
      epoch: seams.epoch,
      revision: snapshot.revision,
      threadId,
      ...snapshot.body,
    };
  }

  /** Sends every subscribed strip whose snapshot changed its new snapshot. */
  function publish(): void {
    if (viewOrigin !== undefined && !started) return;
    for (const [strip, listeners] of subscribers) {
      const snapshot = viewOrigin === undefined ? null : stamped(strip, viewOrigin);
      const sent = snapshot === null ? "unavailable" : snapshot.revision;
      if (lastSent.get(strip) === sent) continue;
      lastSent.set(strip, sent);
      for (const { threadId, listener } of listeners) {
        listener({
          type: "snapshot",
          answer:
            snapshot === null
              ? { available: false }
              : {
                  available: true,
                  epoch: seams.epoch,
                  revision: snapshot.revision,
                  threadId,
                  ...snapshot.body,
                },
        });
      }
    }
  }

  const loaded = async () => {
    if (startup === undefined) throw refusal("unavailable");
    await startup;
  };

  async function liveThreadOf(threadId: string): Promise<LiveThread | null> {
    try {
      return await seams.liveThread(threadId);
    } catch {
      throw refusal("unavailable");
    }
  }

  async function record(threadId: string, tabId: string, revealed: boolean): Promise<void> {
    if (!available() || !isTargetId(tabId)) return;
    try {
      await loaded();
      const tab = tabId.toUpperCase();
      await holdTab(threadId, tab);
      if (revealed) reveal(stripOf(threadId), tab);
      publish();
    } catch (error) {
      // A thread that is gone, or went meanwhile, records nothing: no warning for that.
      if (isThreadTabsError(error) && error.reason === "thread-not-found") return;
      log("thread-tabs-record-failed", {
        reason: isThreadTabsError(error) ? error.reason : String(error),
      });
    }
  }

  /** The beat and a change: reconcile, read the other holders and the agents' bindings, then record
   * the tabs the threads' own sessions newly bound. */
  async function refresh(): Promise<void> {
    if (stopped || !available() || startup === undefined) return;
    await startup;
    let fresh: SessionBinding[] = [];
    try {
      fresh = await serialized(async () => {
        await reconcileAll();
        await readHolders();
        return readBindings(false);
      });
    } catch (error) {
      log("thread-tabs-refresh-failed", { cause: String(error) });
    }
    for (const binding of fresh) {
      const threadId = await threadOfSession(binding.session);
      if (threadId !== null) await record(threadId, binding.targetId, true);
    }
    publish();
  }

  const track = (work: Promise<void>) => {
    running.add(work);
    void work.finally(() => running.delete(work));
  };
  const refreshSoon = () => {
    if (soon !== null || stopped) return;
    soon = setTimeout(() => {
      soon = null;
      track(refresh());
    }, debounceMs);
  };

  async function start(): Promise<void> {
    await seams.ready;
    if (stopped) return;
    await serialized(async () => {
      await sweep();
      await reconcileAll();
      await readHolders();
      await readBindings(true);
    });
    started = true;
    if (stopped) return;
    watcher = (seams.watch ?? watchDirectories)(
      [lazurioDirectory, holdersDirectory, seams.socketDirectory],
      refreshSoon,
    );
    beat = setInterval(() => {
      watcher?.retry();
      track(refresh());
    }, everyMs);
    publish();
  }

  async function retire(threadId: string): Promise<void> {
    const strip = stripOf(threadId);
    retired.add(strip);
    for (const [session, cached] of threadOfSessionCache)
      if (cached === threadId) threadOfSessionCache.delete(session);
    // While the service is off, the next start's sweep lets go of it.
    if (!available() || startup === undefined) return;
    await startup;
    await serialized(() => removeFile(strip));
    await stopDaemon(strip);
    publish();
  }

  /** A title becomes the label of the thread's file, only where the file exists. */
  async function retitle(threadId: string, title: string): Promise<void> {
    if (!available() || startup === undefined) return;
    await startup;
    const strip = stripOf(threadId);
    await serialized(async () => {
      let held: Held;
      try {
        held = await current(strip);
      } catch {
        log("thread-tabs-label-skipped", { strip });
        return;
      }
      const label = cutLabel(title);
      if (held.tabs.size === 0 || held.label === label) return;
      held.label = label;
      await write(strip, held);
      remember(strip, held);
    }).catch(() => log("thread-tabs-label-failed", { strip }));
  }

  return {
    declare(origin) {
      viewOrigin = origin;
      if (origin !== undefined && startup === undefined) {
        startup = start().catch((error) => {
          log("thread-tabs-start-failed", { cause: String(error) });
        });
      }
      publish();
    },
    async read(threadId) {
      if (!available()) return { available: false };
      await loaded();
      const strip = stripOf(threadId);
      if (retired.has(strip) || (await liveThreadOf(threadId)) === null) {
        throw refusal("thread-not-found");
      }
      return snapshotFor(strip, threadId);
    },
    async hold(threadId, tabId) {
      if (!isTargetId(tabId)) throw refusal("invalid-request");
      if (!available()) throw refusal("unavailable");
      await loaded();
      await holdTab(threadId, tabId.toUpperCase());
      publish();
      return snapshotFor(stripOf(threadId), threadId);
    },
    async release(threadId, tabId) {
      if (!isTargetId(tabId)) throw refusal("invalid-request");
      if (!available()) throw refusal("unavailable");
      await loaded();
      const strip = stripOf(threadId);
      await releaseTab(strip, tabId.toUpperCase());
      publish();
      return snapshotFor(strip, threadId);
    },
    record,
    foreign(threadId, tab, revealed) {
      const event: ThreadTabsEvent = {
        type: "foreign",
        tab: {
          tabId: tab.tabId.toUpperCase(),
          view: tab.view,
          ...(revealed ? { revealRequest: { id: nextRevealId() } } : {}),
        },
      };
      for (const { listener } of subscribers.get(stripOf(threadId)) ?? []) listener(event);
    },
    async lifecycle(event) {
      try {
        if (event.type === "retired") await retire(event.threadId);
        else if (event.type === "restored") retired.delete(stripOf(event.threadId));
        else await retitle(event.threadId, event.title);
      } catch (error) {
        log("thread-tabs-lifecycle-failed", { type: event.type, cause: String(error) });
      }
    },
    subscribe(threadId, listener) {
      const strip = stripOf(threadId);
      const entry = { threadId, listener };
      const listeners = subscribers.get(strip) ?? new Set();
      listeners.add(entry);
      subscribers.set(strip, listeners);
      return () => {
        listeners.delete(entry);
        if (listeners.size === 0) {
          subscribers.delete(strip);
          lastSent.delete(strip);
        }
      };
    },
    refresh,
    async settled() {
      await startup;
      while (running.size > 0) await Promise.all(running);
      await queue;
    },
    async stop() {
      stopped = true;
      if (beat !== null) clearInterval(beat);
      if (soon !== null) clearTimeout(soon);
      beat = null;
      soon = null;
      watcher?.stop();
      watcher = null;
      await queue;
    },
  };
}

export class ThreadTabs extends Context.Service<
  ThreadTabs,
  {
    /** The thread's snapshot, or `{available: false}` while the service is off. */
    readonly read: (threadId: ThreadId) => Effect.Effect<ThreadTabsAnswer, ThreadTabsError>;
    readonly hold: (
      threadId: ThreadId,
      tabId: string,
    ) => Effect.Effect<ThreadTabsSnapshot, ThreadTabsError>;
    readonly release: (
      threadId: ThreadId,
      tabId: string,
    ) => Effect.Effect<ThreadTabsSnapshot, ThreadTabsError>;
    /** The thread's snapshot now and on every change, and another Environment's tabs, live. */
    readonly events: (threadId: ThreadId) => Stream.Stream<ThreadTabsEvent, ThreadTabsError>;
    readonly declare: (viewOrigin: string | undefined) => Effect.Effect<void>;
    readonly record: (threadId: ThreadId, tabId: string, reveal: boolean) => Effect.Effect<void>;
    readonly foreign: (
      threadId: ThreadId,
      tab: { readonly tabId: string; readonly view: string },
      reveal: boolean,
    ) => Effect.Effect<void>;
  }
>()("t3/lazurio/threadTabs") {}

/** Overrides of the core's seams, for tests: a fake boot clock, process table or watch. */
export const ThreadTabsSeams = Context.Reference<
  Partial<
    Pick<
      ThreadTabsCoreSeams,
      "epoch" | "bootClock" | "readFile" | "daemon" | "watch" | "everyMs" | "debounceMs"
    >
  >
>("t3/lazurio/ThreadTabsSeams", { defaultValue: () => ({}) });

const asError = (error: unknown) => (isThreadTabsError(error) ? error : refusal("hold-failed"));

/** No absolute XDG_RUNTIME_DIR: the service is off, writes nothing and says so. */
const offService = ThreadTabs.of({
  read: () => Effect.succeed({ available: false }),
  hold: () => Effect.fail(refusal("unavailable")),
  release: () => Effect.fail(refusal("unavailable")),
  events: () =>
    Stream.concat(
      Stream.succeed<ThreadTabsEvent>({ type: "snapshot", answer: { available: false } }),
      Stream.never,
    ),
  declare: () => Effect.void,
  record: () => Effect.void,
  foreign: () => Effect.void,
});

const make = Effect.gen(function* () {
  const env = yield* HostProcessEnvironment;
  const lifecycle = yield* ThreadLifecycle;
  const overrides = yield* ThreadTabsSeams;
  const runtimeDirectory = env.XDG_RUNTIME_DIR;
  if (runtimeDirectory === undefined || !NodePath.isAbsolute(runtimeDirectory)) return offService;
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  const runFork = Effect.runForkWith(context);
  let markReady = () => {};
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  const core = createThreadTabs({
    runtimeDirectory,
    socketDirectory: agentBrowserSocketDirectory(env),
    epoch: overrides.epoch ?? NodeCrypto.randomBytes(8).toString("hex"),
    bootClock: overrides.bootClock ?? (() => readBootClock()),
    liveThread: (threadId) =>
      runPromise(lifecycle.liveThread(ThreadId.make(threadId)).pipe(Effect.map(Option.getOrNull))),
    liveThreads: () => runPromise(lifecycle.liveThreads),
    ready,
    readFile: overrides.readFile,
    daemon: overrides.daemon,
    watch: overrides.watch,
    everyMs: overrides.everyMs,
    debounceMs: overrides.debounceMs,
    log: (event, detail) => {
      runFork(Effect.logWarning(event, detail ?? {}));
    },
  });
  yield* Effect.addFinalizer(() => Effect.promise(() => core.stop()));
  // After command readiness, so the projection has caught up before the sweep reads it.
  yield* forkParked(lifecycle.ready.pipe(Effect.andThen(Effect.sync(() => markReady()))));
  yield* forkParked(
    Stream.runForEach(lifecycle.events, (event) => Effect.promise(() => core.lifecycle(event))),
  );
  const attempt = <A>(work: () => Promise<A>) => Effect.tryPromise({ try: work, catch: asError });
  return ThreadTabs.of({
    read: (threadId) => attempt(() => core.read(threadId)),
    hold: (threadId, tabId) => attempt(() => core.hold(threadId, tabId)),
    release: (threadId, tabId) => attempt(() => core.release(threadId, tabId)),
    events: (threadId) =>
      Stream.callback<ThreadTabsEvent, ThreadTabsError>(
        (queue) =>
          Effect.gen(function* () {
            // Subscribed first, so no change between the snapshot and the subscription is lost;
            // every event is a whole snapshot, so a newer one simply follows.
            yield* Effect.acquireRelease(
              Effect.sync(() =>
                core.subscribe(threadId, (event) => {
                  Queue.offerUnsafe(queue, event);
                }),
              ),
              (unsubscribe) => Effect.sync(unsubscribe),
            );
            const answer = yield* attempt(() => core.read(threadId));
            Queue.offerUnsafe(queue, { type: "snapshot", answer });
          }),
        { bufferSize: 64, strategy: "sliding" },
      ),
    declare: (viewOrigin) => Effect.sync(() => core.declare(viewOrigin)),
    record: (threadId, tabId, reveal) => Effect.promise(() => core.record(threadId, tabId, reveal)),
    foreign: (threadId, tab, reveal) => Effect.sync(() => core.foreign(threadId, tab, reveal)),
  });
});

export const layer = Layer.effect(ThreadTabs, make);
