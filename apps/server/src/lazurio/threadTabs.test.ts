// @effect-diagnostics nodeBuiltinImport:off - the holder files are real files in a temporary runtime directory.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { agentBrowserSessionName } from "./agentBrowserSession.ts";
import {
  type BootTime,
  holderDirectory,
  holderFileText,
  liveTabsPath,
  parseHolderRecords,
  replaceOwnerFile,
} from "./holders.ts";
import {
  createThreadTabs,
  MAX_THREAD_TABS,
  type ThreadTabsEvent,
  type ThreadTabsSnapshot,
} from "./threadTabs.ts";

// A thread's tabs live in its holder file and stay true to the browser by the hub's list
// (LazurioPlatform F47 point 4). The reconciliation cases are F47's, named as its step 2 names
// them for the Launchpad (tests/launchpad-new-tab.test.ts), here for T3 Code's threads.

const id = (n: number) => n.toString(16).toUpperCase().padStart(32, "0");
const boot = "6f2c1d0e-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const earlierBoot = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const at = (seconds: number, ofBoot: string = boot): BootTime => ({ boot: ofBoot, at: seconds });
const threadA = "4a1f9c2e-7b3d-4e5f-8a6b-9c0d1e2f3a4b";
const threadB = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const stripA = agentBrowserSessionName(threadA);
const stripB = agentBrowserSessionName(threadB);
const viewOrigin = "https://browser.vm-01.example.lazurio.io";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});

async function world(options: { readonly declared?: boolean; readonly ready?: boolean } = {}) {
  const runtime = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "thread-tabs-"));
  cleanups.push(() => NodeFSP.rm(runtime, { recursive: true, force: true }));
  const holders = holderDirectory({ XDG_RUNTIME_DIR: runtime })!;
  const listPath = liveTabsPath({ XDG_RUNTIME_DIR: runtime })!;
  const sockets = NodePath.join(runtime, "agent-browser");
  let clock: BootTime | null = at(100);
  const threads = new Map([
    [threadA, "Web"],
    [threadB, "Docs"],
  ]);
  const listReads: number[] = [];
  /** The fake process table: pid → command line. */
  const processes = new Map<number, string>();
  /** Sessions whose agent-browser daemon listens on its socket, and those asked to stop. */
  const listening = new Set<string>();
  const stopped: string[] = [];
  const logs: string[] = [];
  const watched: Array<ReadonlyArray<string | undefined>> = [];
  let retries = 0;
  let changed: () => void = () => undefined;
  /** Reads of a live thread wait here while the test holds them back (`holdLiveReads`). */
  let liveGate: { readonly open: Promise<void>; readonly reached: () => void } | null = null;
  let markReady = () => {};
  const ready =
    options.ready === false
      ? new Promise<void>((resolve) => {
          markReady = resolve;
        })
      : Promise.resolve();
  const make = () =>
    createThreadTabs({
      runtimeDirectory: runtime,
      socketDirectory: sockets,
      epoch: "epoch-1",
      bootClock: async () => clock,
      liveThread: async (threadId) => {
        const gate = liveGate;
        if (gate !== null) {
          gate.reached();
          await gate.open;
        }
        const title = threads.get(threadId);
        return title === undefined ? null : { id: threadId as never, title };
      },
      liveThreads: async () =>
        [...threads].map(([threadId, title]) => ({ id: threadId as never, title })),
      ready,
      readFile: async (path) => {
        if (path === listPath) listReads.push(listReads.length);
        return NodeFSP.readFile(path, "utf8");
      },
      daemon: {
        alive: (pid) => processes.has(pid),
        ask: async (socketPath) => {
          const session = NodePath.basename(socketPath, ".sock");
          if (!listening.has(session)) return { kind: "absent" };
          listening.delete(session);
          stopped.push(session);
          await NodeFSP.rm(NodePath.join(sockets, `${session}.pid`), { force: true });
          return { kind: "reply", line: '{"success":true}' };
        },
      },
      watch: (directories, onChange) => {
        watched.push(directories);
        changed = onChange;
        return {
          retry: () => {
            retries += 1;
          },
          stop: () => undefined,
        };
      },
      everyMs: 60_000,
      debounceMs: 30,
      log: (event) => logs.push(event),
    });
  const core = make();
  cleanups.push(() => core.stop());
  const events: ThreadTabsEvent[] = [];
  const unsubscribe = core.subscribe(threadA, (event) => events.push(event));
  cleanups.push(async () => unsubscribe());
  const declare = async () => {
    core.declare(viewOrigin);
    await core.settled();
  };
  if (options.declared !== false && options.ready !== false) await declare();
  const fileOf = (strip: string) => NodePath.join(holders, `${strip}.json`);
  return {
    runtime,
    holders,
    listPath,
    sockets,
    core,
    events,
    threads,
    processes,
    listening,
    stopped,
    logs,
    watched,
    listReads,
    declare,
    markReady,
    /** Holds the next reads of a live thread back: `reading` settles once one waits, `release`
     * lets them through. */
    holdLiveReads: () => {
      let release = () => {};
      let reached = () => {};
      const reading = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const open = new Promise<void>((resolve) => {
        release = resolve;
      });
      liveGate = { open, reached };
      return {
        reading,
        release: () => {
          liveGate = null;
          release();
        },
      };
    },
    retries: () => retries,
    changed: () => changed(),
    fileOf,
    /** Another T3 Code server on the same files, as after a restart. */
    restarted: async () => {
      const again = make();
      cleanups.push(() => again.stop());
      again.declare(viewOrigin);
      await again.settled();
      return again;
    },
    setClock: (next: BootTime | null) => {
      clock = next;
    },
    /** The hub's snapshot of the browser's live tabs. */
    list: (tabs: readonly string[], takenAt: BootTime) =>
      replaceOwnerFile(listPath, `${JSON.stringify({ tabs, takenAt })}\n`),
    stored: async (strip = stripA) => {
      const text = await NodeFSP.readFile(fileOf(strip), "utf8").catch(() => null);
      return text === null ? null : (parseHolderRecords(`${strip}.json`, text)?.tabs ?? "broken");
    },
    storeFile: async (strip: string, label: string, tabs: Parameters<typeof holderFileText>[2]) => {
      await NodeFSP.mkdir(holders, { recursive: true, mode: 0o700 });
      await NodeFSP.writeFile(fileOf(strip), holderFileText(strip, label, tabs), { mode: 0o600 });
    },
    bind: async (session: string, targetId: string, pid?: number) => {
      await NodeFSP.mkdir(sockets, { recursive: true });
      await NodeFSP.writeFile(
        NodePath.join(sockets, `${session}.target`),
        JSON.stringify({ targetId }),
      );
      if (pid !== undefined) {
        await NodeFSP.writeFile(NodePath.join(sockets, `${session}.pid`), `${pid}\n`);
      }
    },
    lastSnapshot: (): ThreadTabsSnapshot | { available: false } | undefined => {
      const snapshots = events.filter((event) => event.type === "snapshot");
      const last = snapshots.at(-1);
      return last?.type === "snapshot" ? last.answer : undefined;
    },
  };
}

const tabIds = (answer: unknown) =>
  (answer as ThreadTabsSnapshot | undefined)?.tabs.map((tab) => tab.tabId);

describe("reconciliation (F47 point 4)", () => {
  it("a tab closed for everyone, or ended, while no client shows it goes with the hub's next list", async () => {
    const w = await world();
    await w.list([], at(90));
    await w.core.hold(threadA, id(1));
    await w.core.hold(threadA, id(2));
    expect(tabIds(w.lastSnapshot())).toEqual([id(1), id(2)]);
    // The hub's snapshot after the tab ended; no device shows it.
    await w.list([id(2)], at(110));
    await w.core.refresh();
    expect(await w.stored()).toEqual([{ id: id(2), recordedAt: at(100) }]);
    // The file is rewritten and the subscribers hear it.
    expect(tabIds(w.lastSnapshot())).toEqual([id(2)]);
  });

  it("after a browser restart the list of new ids drops every old one, in every thread's file", async () => {
    const w = await world();
    await w.core.hold(threadA, id(1));
    w.setClock(at(101));
    await w.core.hold(threadB, id(2));
    await w.list([id(9)], at(120));
    // A hold reconciles before it writes: the new tab is the only one left.
    w.setClock(at(121));
    await w.core.hold(threadA, id(9));
    expect(await w.stored()).toEqual([{ id: id(9), recordedAt: at(121) }]);
    await w.core.refresh();
    expect(await w.stored(stripB)).toBeNull();
  });

  it("a server that starts with stored ids that ended meanwhile drops them; one without a time counts as old", async () => {
    const w = await world({ declared: false });
    await w.storeFile(stripA, "Web", [
      { id: id(1), recordedAt: at(50) },
      { id: id(2), recordedAt: at(50) },
      { id: id(3), recordedAt: null },
    ]);
    await w.list([id(2)], at(100));
    await w.declare();
    expect(await w.stored()).toEqual([{ id: id(2), recordedAt: at(50) }]);
    expect(tabIds(await w.core.read(threadA))).toEqual([id(2)]);
  });

  it("a tab recorded before the list has it stays", async () => {
    const w = await world();
    // The snapshot began at 100, before the tab existed.
    await w.list([], at(100));
    w.setClock(at(101));
    await w.core.hold(threadA, id(1));
    await w.core.refresh();
    expect(tabIds(await w.core.read(threadA))).toEqual([id(1)]);
    // The hub's next snapshot has it.
    await w.list([id(1)], at(130));
    await w.core.refresh();
    expect(await w.stored()).toEqual([{ id: id(1), recordedAt: at(101) }]);
  });

  it("a live tab whose event reached the hub late is in the snapshot, so it stays", async () => {
    const w = await world();
    await w.core.hold(threadA, id(7));
    // A list begun before the record that lacks it never drops it.
    await w.list([], at(99));
    await w.core.refresh();
    expect(tabIds(await w.core.read(threadA))).toEqual([id(7)]);
    // The hub never heard of the tab; its snapshot asked the browser itself.
    await w.list([id(7)], at(110));
    await w.core.refresh();
    expect(tabIds(await w.core.read(threadA))).toEqual([id(7)]);
  });

  it("a tab that ended before T3 Code recorded it goes only with a list of the same boot taken after the record", async () => {
    const w = await world();
    // It ended at 99; the hub's snapshot at 99.5 lacks it.
    await w.list([], at(99.5));
    await w.core.hold(threadA, id(6));
    await w.core.refresh();
    expect(tabIds(await w.core.read(threadA))).toEqual([id(6)]);
    // A list of another boot says nothing about this one.
    await w.list([], at(500, earlierBoot));
    await w.core.refresh();
    expect(tabIds(await w.core.read(threadA))).toEqual([id(6)]);
    // The periodic snapshot 30 s later began after the record.
    await w.list([], at(130));
    await w.core.refresh();
    expect(tabIds(await w.core.read(threadA))).toEqual([]);
    expect(await w.stored()).toBeNull();
  });

  it("a record from an earlier boot goes when this boot's list lacks it", async () => {
    const w = await world({ declared: false });
    await w.storeFile(stripA, "Web", [
      { id: id(1), recordedAt: at(5_000, earlierBoot) },
      { id: id(2), recordedAt: at(5_000, earlierBoot) },
    ]);
    // Seconds since this boot are fewer than the earlier record's.
    await w.list([id(2)], at(10));
    await w.declare();
    expect(tabIds(await w.core.read(threadA))).toEqual([id(2)]);
  });

  it("a list of another boot is ignored, and so is a missing or unreadable list", async () => {
    const w = await world();
    await w.core.hold(threadA, id(1));
    await w.list([], at(5_000, earlierBoot));
    await w.core.refresh();
    expect(tabIds(await w.core.read(threadA))).toEqual([id(1)]);
    await NodeFSP.rm(w.listPath);
    await w.core.refresh();
    expect(tabIds(await w.core.read(threadA))).toEqual([id(1)]);
    await NodeFSP.writeFile(w.listPath, "{", { mode: 0o600 });
    await w.core.refresh();
    expect(tabIds(await w.core.read(threadA))).toEqual([id(1)]);
    // Without the boot clock (not Linux) nothing is dropped either.
    await w.list([], at(500));
    w.setClock(null);
    await w.core.refresh();
    expect(tabIds(await w.core.read(threadA))).toEqual([id(1)]);
  });

  it("a step of the wall clock, back or forward by an hour, changes no decision", async () => {
    const w = await world();
    await w.list([], at(100));
    const realNow = Date.now;
    try {
      // The wall clock steps back an hour after the snapshot began; the boot clock reads the
      // record as later than it all the same.
      Date.now = () => realNow() - 3_600_000;
      w.setClock(at(100.4));
      await w.core.hold(threadA, id(7));
      await w.core.refresh();
      expect(tabIds(await w.core.read(threadA))).toEqual([id(7)]);
      // And forward an hour: a snapshot begun before the record still drops nothing.
      Date.now = () => realNow() + 3_600_000;
      await w.list([], at(100.2));
      await w.core.refresh();
      expect(tabIds(await w.core.read(threadA))).toEqual([id(7)]);
    } finally {
      Date.now = realNow;
    }
    expect(await w.stored()).toEqual([{ id: id(7), recordedAt: at(100.4) }]);
  });
});

describe("writes re-read the file and fail closed", () => {
  it("every write starts from the file on disk", async () => {
    const w = await world();
    await w.core.hold(threadA, id(1));
    // Another T3 Code process on the same file, for a moment during an update.
    await w.storeFile(stripA, "Web", [{ id: id(5), recordedAt: at(99) }]);
    w.setClock(at(102));
    await w.core.hold(threadA, id(2));
    expect(await w.stored()).toEqual([
      { id: id(5), recordedAt: at(99) },
      { id: id(2), recordedAt: at(102) },
    ]);
  });

  it("a file that breaks after a good read is never written over, until a read succeeds", async () => {
    const w = await world();
    w.setClock(at(10));
    await w.core.hold(threadA, id(1));
    // A list taken after the record that lacks id(1): a reconciliation would drop it.
    await w.list([], at(20));
    await NodeFSP.writeFile(w.fileOf(stripA), "{");
    await w.core.refresh();
    expect(await NodeFSP.readFile(w.fileOf(stripA), "utf8")).toBe("{");
    expect(w.logs).toContain("thread-tabs-reconcile-failed");
    w.setClock(at(30));
    await expect(w.core.hold(threadA, id(2))).rejects.toMatchObject({
      reason: "holder-unreadable",
    });
    await expect(w.core.release(threadA, id(1))).rejects.toMatchObject({
      reason: "holder-unreadable",
    });
    expect(await NodeFSP.readFile(w.fileOf(stripA), "utf8")).toBe("{");
    // The strip keeps the last good index meanwhile.
    expect(tabIds(await w.core.read(threadA))).toEqual([id(1)]);
    // Unreadable instead of broken: the same.
    await w.storeFile(stripA, "Web", [{ id: id(1), recordedAt: at(10) }]);
    await NodeFSP.chmod(w.fileOf(stripA), 0o000);
    try {
      await w.core.refresh();
      await expect(w.core.hold(threadA, id(2))).rejects.toMatchObject({
        reason: "holder-unreadable",
      });
    } finally {
      await NodeFSP.chmod(w.fileOf(stripA), 0o600);
    }
    expect(await w.stored()).toEqual([{ id: id(1), recordedAt: at(10) }]);
    // Readable again: the next operation reads it, drops id(1) by the list and takes the hold.
    await w.core.hold(threadA, id(2));
    expect(await w.stored()).toEqual([{ id: id(2), recordedAt: at(30) }]);
  });

  it("a burst of list changes is one reconciliation", async () => {
    const w = await world();
    await w.list([id(1)], at(90));
    await w.core.hold(threadA, id(1));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const before = w.listReads.length;
    for (let n = 0; n < 5; n++) w.changed();
    await vi.advanceTimersByTimeAsync(30);
    await w.core.settled();
    expect(w.listReads.length - before).toBe(1);
    // The watch covers the hub's directory, the holder files and the agents' bindings.
    expect(w.watched).toEqual([
      [NodePath.join(w.runtime, "lazurio-browser"), w.holders, w.sockets],
    ]);
  });

  it("the beat reads the list again and retries the watch; a file is rewritten only when a hold went", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const w = await world();
    await w.list([id(1), id(2)], at(90));
    await w.core.hold(threadA, id(1));
    await w.core.hold(threadA, id(2));
    const written = (await NodeFSP.stat(w.fileOf(stripA))).ino;
    const reads = w.listReads.length;
    await vi.advanceTimersByTimeAsync(60_000);
    await w.core.settled();
    expect(w.retries()).toBe(1);
    expect(w.listReads.length).toBeGreaterThan(reads);
    // Nothing went: the file is the same one.
    expect((await NodeFSP.stat(w.fileOf(stripA))).ino).toBe(written);
    await w.list([id(2)], at(110));
    await vi.advanceTimersByTimeAsync(60_000);
    await w.core.settled();
    expect(tabIds(await w.core.read(threadA))).toEqual([id(2)]);
  });
});

describe("holds and releases", () => {
  it("a new id gets the boot clock's time; a held id keeps its time and writes nothing", async () => {
    const w = await world();
    w.setClock(at(100.25));
    await w.core.hold(threadA, id(1).toLowerCase());
    const written = (await NodeFSP.stat(w.fileOf(stripA))).ino;
    w.setClock(at(200));
    await w.core.hold(threadA, id(1));
    expect(await w.stored()).toEqual([{ id: id(1), recordedAt: at(100.25) }]);
    expect((await NodeFSP.stat(w.fileOf(stripA))).ino).toBe(written);
    // The file is the hub's holder file, labelled with the thread's title.
    expect(JSON.parse(await NodeFSP.readFile(w.fileOf(stripA), "utf8"))).toMatchObject({
      strip: stripA,
      label: "Web",
      tabs: [id(1)],
    });
  });

  it("the 129th hold is refused and none is dropped for it", async () => {
    const w = await world();
    w.threads.set(threadA, "ž".repeat(300));
    for (let n = 1; n <= MAX_THREAD_TABS; n++) await w.core.hold(threadA, id(n));
    await expect(w.core.hold(threadA, id(MAX_THREAD_TABS + 1))).rejects.toMatchObject({
      reason: "too-many-tabs",
    });
    expect((await w.stored())?.length).toBe(MAX_THREAD_TABS);
    const text = await NodeFSP.readFile(w.fileOf(stripA), "utf8");
    expect(Buffer.byteLength(text, "utf8")).toBeLessThan(20 * 1024);
    // The label is cut at 200 characters.
    expect((JSON.parse(text) as { label: string }).label).toHaveLength(200);
  });

  it("an unknown or retired thread takes no hold", async () => {
    const w = await world();
    await expect(w.core.hold("5c4b3a29-1807-4f6e-9d5c-4b3a2918f7e6", id(1))).rejects.toMatchObject({
      reason: "thread-not-found",
    });
    await w.core.lifecycle({ type: "retired", threadId: threadA });
    await expect(w.core.hold(threadA, id(1))).rejects.toMatchObject({ reason: "thread-not-found" });
    await expect(w.core.read(threadA)).rejects.toMatchObject({ reason: "thread-not-found" });
    await w.core.record(threadA, id(2), true);
    expect(await w.stored()).toBeNull();
  });

  it("a release of the last id removes the file; a tab not held is released already", async () => {
    const w = await world();
    await w.core.hold(threadA, id(1));
    expect(tabIds(await w.core.release(threadA, id(1)))).toEqual([]);
    expect(await w.stored()).toBeNull();
    expect(tabIds(await w.core.release(threadA, id(3)))).toEqual([]);
    expect(await w.stored()).toBeNull();
    await expect(w.core.release(threadA, "nope")).rejects.toMatchObject({
      reason: "invalid-request",
    });
  });

  it("a title change rewrites only an existing file's label", async () => {
    const w = await world();
    await w.core.hold(threadA, id(1));
    await w.core.lifecycle({ type: "titled", threadId: threadA, title: "Web shop" });
    expect(JSON.parse(await NodeFSP.readFile(w.fileOf(stripA), "utf8")).label).toBe("Web shop");
    await w.core.lifecycle({ type: "titled", threadId: threadB, title: "Docs v2" });
    expect(await w.stored(stripB)).toBeNull();
  });
});

describe("archive and delete", () => {
  it("removes the thread's file and asks only its own agent-browser daemon to stop, on its socket", async () => {
    const w = await world();
    await w.core.hold(threadA, id(1));
    await w.core.hold(threadB, id(2));
    await w.bind(stripA, id(1), 4242);
    await w.bind(stripB, id(2), 4343);
    w.processes.set(4242, "/home/u/.local/bin/agent-browser\0");
    // B's .pid is stale: its number is another live agent-browser's, and nothing listens on B's
    // socket.
    w.processes.set(4343, "/home/u/.local/bin/agent-browser\0");
    w.listening.add(stripA);
    await w.core.lifecycle({ type: "retired", threadId: threadA });
    expect(await w.stored()).toBeNull();
    expect(w.stopped).toEqual([stripA]);
    expect(tabIds(w.lastSnapshot())).toEqual([]);
    await w.core.lifecycle({ type: "retired", threadId: threadB });
    expect(w.stopped).toEqual([stripA]);
    expect(w.processes.has(4343)).toBe(true);
    expect(w.logs).not.toContain("thread-tabs-daemon-stop-failed");
  });

  it("closes no tab itself: a tab another file holds stays held there", async () => {
    const w = await world();
    await w.storeFile("launchpad", "Launchpad", [{ id: id(1), recordedAt: at(90) }]);
    await w.core.hold(threadA, id(1));
    await w.core.lifecycle({ type: "retired", threadId: threadA });
    expect(await w.stored("launchpad")).toEqual([{ id: id(1), recordedAt: at(90) }]);
  });

  it("an unarchive brings nothing back but lets the thread hold again", async () => {
    const w = await world();
    await w.core.hold(threadA, id(1));
    await w.core.lifecycle({ type: "retired", threadId: threadA });
    await w.core.lifecycle({ type: "restored", threadId: threadA });
    expect(tabIds(await w.core.read(threadA))).toEqual([]);
    await w.core.hold(threadA, id(2));
    expect(tabIds(await w.core.read(threadA))).toEqual([id(2)]);
  });

  it("removes even a file it cannot read", async () => {
    const w = await world();
    await NodeFSP.mkdir(w.holders, { recursive: true });
    await NodeFSP.writeFile(w.fileOf(stripA), "{");
    await w.core.lifecycle({ type: "retired", threadId: threadA });
    expect(await w.stored()).toBeNull();
  });

  it("wins over a person's hold whose thread read was still under way: nothing is written back", async () => {
    const w = await world();
    await w.core.hold(threadA, id(1));
    const read = w.holdLiveReads();
    const holding = w.core.hold(threadA, id(2));
    await read.reading;
    // The projection still shows the thread; only the archive's mark stops the write.
    const retiring = w.core.lifecycle({ type: "retired", threadId: threadA });
    read.release();
    await expect(holding).rejects.toMatchObject({ reason: "thread-not-found" });
    await retiring;
    await w.core.settled();
    expect(await w.stored()).toBeNull();
  });

  it("wins over an agent's tab whose thread read was still under way, without a warning", async () => {
    const w = await world();
    await w.core.hold(threadA, id(1));
    const read = w.holdLiveReads();
    const recording = w.core.record(threadA, id(3), true);
    await read.reading;
    const retiring = w.core.lifecycle({ type: "retired", threadId: threadA });
    read.release();
    await recording;
    await retiring;
    await w.core.settled();
    expect(await w.stored()).toBeNull();
    expect(w.logs).not.toContain("thread-tabs-record-failed");
  });
});

describe("the startup sweep", () => {
  it("removes files and stops daemons of no live thread; names outside t3- are never touched", async () => {
    const w = await world({ declared: false });
    const gone = "5c4b3a29-1807-4f6e-9d5c-4b3a2918f7e6";
    const stripGone = agentBrowserSessionName(gone);
    const stripDaemon = agentBrowserSessionName("7d6c5b4a-3928-4170-8e6f-5d4c3b2a1908");
    await w.storeFile(stripGone, "Archived", [{ id: id(1), recordedAt: at(50) }]);
    await w.bind(stripGone, id(1), 5001);
    await w.bind(stripDaemon, id(2), 5002);
    await w.bind("codex-1", id(3), 5003);
    await w.storeFile("launchpad", "Launchpad", [{ id: id(4), recordedAt: at(50) }]);
    await w.storeFile(stripA, "Web", [
      { id: id(5), recordedAt: at(50) },
      { id: id(6), recordedAt: at(50) },
    ]);
    for (const pid of [5001, 5002, 5003]) w.processes.set(pid, "agent-browser\0");
    for (const session of [stripGone, stripDaemon, "codex-1"]) w.listening.add(session);
    await w.list([id(4), id(6)], at(100));
    await w.declare();
    expect(await w.stored(stripGone)).toBeNull();
    expect(w.stopped.toSorted()).toEqual([stripGone, stripDaemon].toSorted());
    expect(await w.stored("launchpad")).toEqual([{ id: id(4), recordedAt: at(50) }]);
    // Live threads' files are kept and reconciled.
    expect(await w.stored()).toEqual([{ id: id(6), recordedAt: at(50) }]);
  });

  it("waits for the projection to catch up before it reads which threads live", async () => {
    const w = await world({ ready: false });
    await w.storeFile(stripA, "Web", [{ id: id(1), recordedAt: at(50) }]);
    w.core.declare(viewOrigin);
    w.threads.clear();
    let read = false;
    const reading = w.core.read(threadA).then(
      () => (read = true),
      () => (read = true),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(read).toBe(false);
    w.threads.set(threadA, "Web");
    w.markReady();
    await reading;
    expect(await w.stored()).toEqual([{ id: id(1), recordedAt: at(50) }]);
  });
});

describe("tabs an agent opens", () => {
  it("preview_open records with a reveal, open: false without", async () => {
    const w = await world();
    await w.core.record(threadA, id(1), true);
    await w.core.record(threadA, id(2), false);
    const snapshot = (await w.core.read(threadA)) as ThreadTabsSnapshot;
    expect(snapshot.tabs.map((tab) => [tab.tabId, tab.revealRequest?.id])).toEqual([
      [id(1), "epoch-1:1"],
      [id(2), undefined],
    ]);
    // A later reveal of the same tab replaces the request.
    await w.core.record(threadA, id(1), true);
    expect(((await w.core.read(threadA)) as ThreadTabsSnapshot).tabs[0]?.revealRequest).toEqual({
      id: "epoch-1:2",
    });
  });

  it("a new binding of the thread's session records with a reveal; one present at the start does not", async () => {
    const w = await world({ declared: false });
    await w.bind(stripB, id(8));
    await w.declare();
    expect(await w.stored(stripB)).toBeNull();
    await w.bind(stripA, id(3));
    await w.core.refresh();
    const snapshot = (await w.core.read(threadA)) as ThreadTabsSnapshot;
    expect(snapshot.tabs.map((tab) => tab.tabId)).toEqual([id(3)]);
    expect(snapshot.tabs[0]?.revealRequest).toBeDefined();
  });

  it("a binding unchanged after a release is not recorded again; a retired thread's is ignored", async () => {
    const w = await world();
    await w.bind(stripA, id(3));
    await w.core.refresh();
    await w.core.release(threadA, id(3));
    await w.core.refresh();
    expect(await w.stored()).toBeNull();
    await w.core.lifecycle({ type: "retired", threadId: threadB });
    await w.bind(stripB, id(4));
    await w.core.refresh();
    expect(await w.stored(stripB)).toBeNull();
  });

  it("another Environment's tab goes to the thread's subscribers only, live", async () => {
    const w = await world();
    const other: ThreadTabsEvent[] = [];
    const unsubscribe = w.core.subscribe(threadB, (event) => other.push(event));
    cleanups.push(async () => unsubscribe());
    const view = `https://browser.vm-02.acme.lazurio.io/t/${id(9).toLowerCase()}`;
    w.core.foreign(threadA, { tabId: id(9).toLowerCase(), view }, true);
    expect(w.events.at(-1)).toEqual({
      type: "foreign",
      tab: { tabId: id(9), view, revealRequest: { id: "epoch-1:1" } },
    });
    expect(other).toEqual([]);
  });
});

describe("what a snapshot says of each tab", () => {
  it("names Apps and other threads that hold it too, and leaves out the thread's own strip", async () => {
    const w = await world();
    await w.storeFile("launchpad", "Launchpad", [{ id: id(1), recordedAt: at(90) }]);
    await w.core.hold(threadB, id(1));
    await w.core.hold(threadA, id(1));
    await w.core.refresh();
    const [tab] = ((await w.core.read(threadA)) as ThreadTabsSnapshot).tabs;
    expect(tab).toEqual({
      tabId: id(1),
      view: `${viewOrigin}/t/${id(1)}`,
      agent: false,
      alsoHeldBy: [
        { strip: "launchpad", label: "Launchpad" },
        { strip: stripB, label: "Docs" },
      ],
    });
    // Another app's file that cannot be read only leaves its own part out.
    await NodeFSP.writeFile(NodePath.join(w.holders, "mausbot.json"), "{");
    await w.core.refresh();
    expect(((await w.core.read(threadA)) as ThreadTabsSnapshot).tabs[0]?.alsoHeldBy).toHaveLength(
      2,
    );
  });

  it("says an agent works in a tab while a session bound to it has a live daemon", async () => {
    const w = await world();
    await w.core.hold(threadA, id(1));
    await w.bind("codex-1", id(1), 4242);
    w.processes.set(4242, "agent-browser\0");
    await w.core.refresh();
    expect(((await w.core.read(threadA)) as ThreadTabsSnapshot).tabs[0]?.agent).toBe(true);
    expect((w.lastSnapshot() as ThreadTabsSnapshot).tabs[0]?.agent).toBe(true);
    w.processes.delete(4242);
    await w.core.refresh();
    expect(((await w.core.read(threadA)) as ThreadTabsSnapshot).tabs[0]?.agent).toBe(false);
  });

  it("carries a revision that grows with every change of it, streamed or not", async () => {
    const w = await world();
    // Nobody streams thread B: its answers still order by their revisions.
    const first = await w.core.hold(threadB, id(1));
    expect(((await w.core.read(threadB)) as ThreadTabsSnapshot).revision).toBe(first.revision);
    const second = await w.core.hold(threadB, id(2));
    expect(second.revision).toBeGreaterThan(first.revision);
    // Another thread's change leaves it as it is.
    await w.core.hold(threadA, id(3));
    expect(((await w.core.read(threadB)) as ThreadTabsSnapshot).revision).toBe(second.revision);
    expect((await w.core.release(threadB, id(1))).revision).toBeGreaterThan(second.revision);
    // A streamed thread's event and the answer of the same change agree.
    const held = await w.core.hold(threadA, id(4));
    expect(w.lastSnapshot()).toMatchObject({ revision: held.revision, epoch: "epoch-1" });
  });
});

describe("when something is missing", () => {
  it("without the Environment's declaration the service is unavailable and writes nothing", async () => {
    const w = await world({ declared: false });
    expect(await w.core.read(threadA)).toEqual({ available: false });
    await expect(w.core.hold(threadA, id(1))).rejects.toMatchObject({ reason: "unavailable" });
    await w.core.record(threadA, id(1), true);
    expect(await NodeFSP.readdir(w.runtime)).toEqual([]);
    // Declared later: the subscribers hear the snapshot.
    await w.declare();
    expect(w.lastSnapshot()).toMatchObject({ available: true, tabs: [] });
    w.core.declare(undefined);
    expect(w.lastSnapshot()).toEqual({ available: false });
  });

  it("without the hub's list nothing is dropped", async () => {
    const w = await world();
    await w.core.hold(threadA, id(1));
    await w.core.refresh();
    expect(tabIds(await w.core.read(threadA))).toEqual([id(1)]);
  });
});
