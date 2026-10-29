// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - the holder files are real files in a temporary runtime directory, and the watch is the operating system's.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  agentBrowserSocketDirectory,
  daemonWorking,
  holderDirectory,
  holderFileText,
  isStrip,
  keptTabs,
  liveTabsPath,
  parseBootTime,
  parseHolder,
  parseHolderRecords,
  parseLiveTabs,
  processAlive,
  readBootClock,
  readSessionBindings,
  replaceOwnerFile,
  stopSessionDaemon,
  watchDirectories,
} from "./holders.ts";

// The vectors below are LazurioPlatform's for the same helpers (tests/environment-browser-holds.test.ts
// and the holder-file tests of tests/launchpad-new-tab.test.ts at 49d54c9), with the same inputs
// and outputs, so the copy in holders.ts cannot drift from the hub's rules unnoticed.

const id = (n: number) => n.toString(16).toUpperCase().padStart(32, "0");
const boot = "6f2c1d0e-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const earlierBoot = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const at = (seconds: number, ofBoot: string = boot) => ({ boot: ofBoot, at: seconds });

let root: string | undefined;
afterEach(async () => {
  if (root) await NodeFSP.rm(root, { recursive: true, force: true });
  root = undefined;
});
const temporary = async (prefix: string) => {
  root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), prefix));
  return root;
};

describe("the Platform's vectors", () => {
  it("a strip is a file name in agent-browser's session alphabet", () => {
    for (const name of ["launchpad", "t3-abc_DEF-123", "x".repeat(64)]) {
      expect(isStrip(name)).toBe(true);
    }
    for (const name of ["", "../x", "a/b", "a.b", "x".repeat(65), 7, null]) {
      expect(isStrip(name)).toBe(false);
    }
  });

  it("the holder directory and the list live in the runtime directory, never elsewhere", () => {
    expect(holderDirectory({ XDG_RUNTIME_DIR: "/run/user/1000" })).toBe(
      "/run/user/1000/lazurio-browser/holders",
    );
    expect(holderDirectory({ XDG_RUNTIME_DIR: "run/user" })).toBeUndefined();
    expect(holderDirectory({})).toBeUndefined();
    expect(liveTabsPath({ XDG_RUNTIME_DIR: "/run/user/1000" })).toBe(
      "/run/user/1000/lazurio-browser/tabs.json",
    );
    expect(liveTabsPath({})).toBeUndefined();
    // agent-browser's own directory: AGENT_BROWSER_SOCKET_DIR when absolute (window.ts).
    expect(agentBrowserSocketDirectory({ XDG_RUNTIME_DIR: "/run/user/1000" })).toBe(
      "/run/user/1000/agent-browser",
    );
    expect(
      agentBrowserSocketDirectory({ AGENT_BROWSER_SOCKET_DIR: "/srv/ab", XDG_RUNTIME_DIR: "/r" }),
    ).toBe("/srv/ab");
    expect(
      agentBrowserSocketDirectory({ AGENT_BROWSER_SOCKET_DIR: "ab", XDG_RUNTIME_DIR: "/r" }),
    ).toBe("/r/agent-browser");
    expect(agentBrowserSocketDirectory({})).toBeUndefined();
  });

  it("a holder file holds only target ids, under its own strip name", () => {
    const text = (value: unknown) => JSON.stringify(value);
    expect(
      parseHolder(
        "t3-a.json",
        text({
          strip: "t3-a",
          label: "  Vlákno o webu  ",
          tabs: [id(1), id(1).toLowerCase(), "nope", 5, id(2)],
        }),
      ),
    ).toEqual({ strip: "t3-a", label: "Vlákno o webu", tabs: [id(1), id(2)] });
    // The label is optional and cut; the strip must be the file's name.
    expect(parseHolder("launchpad.json", text({ strip: "launchpad", tabs: [] }))).toEqual({
      strip: "launchpad",
      label: "",
      tabs: [],
    });
    expect(
      parseHolder("launchpad.json", text({ strip: "launchpad", label: "x".repeat(500), tabs: [] }))
        ?.label.length,
    ).toBe(200);
    for (const [name, body] of [
      ["t3-a.json", text({ strip: "t3-b", tabs: [] })],
      ["t3-a.tmp", text({ strip: "t3-a", tabs: [] })],
      ["..json", text({ strip: ".", tabs: [] })],
      ["t3-a.json", text({ strip: "t3-a", tabs: "x" })],
      ["t3-a.json", text([id(1)])],
      ["t3-a.json", "{"],
      ["t3-a.json", text({ strip: "t3-a", tabs: [], pad: "x".repeat(70_000) })],
    ] as const) {
      expect(parseHolder(name, body)).toBeNull();
    }
    // At most 500 tabs per holder.
    expect(
      parseHolder(
        "t3-a.json",
        text({ strip: "t3-a", tabs: Array.from({ length: 600 }, (_, n) => id(n + 1)) }),
      )?.tabs.length,
    ).toBe(500);
  });

  it("a .pid releases a tab only when it names a well-formed process id that ended", async () => {
    const sockets = await temporary("holders-pid-");
    await NodeFSP.writeFile(
      NodePath.join(sockets, "codex-1.target"),
      JSON.stringify({ targetId: id(3) }),
    );
    const working = async (pid: string | null, alive = false) => {
      if (pid === null) await NodeFSP.rm(NodePath.join(sockets, "codex-1.pid"), { force: true });
      else await NodeFSP.writeFile(NodePath.join(sockets, "codex-1.pid"), pid);
      const [binding] = await readSessionBindings(sockets, () => alive);
      return binding?.working;
    };
    // Unclear: empty, blank, zero, signed, pid 1, too long, not a number.
    for (const unclear of ["", " ", "\n", "0", "-1", "1", "+5", "4.2", "99999999999", "x"]) {
      expect(await working(unclear)).toBe(true);
    }
    // A well-formed id: working while it runs, ended once it does not.
    expect(await working("4242\n", true)).toBe(true);
    expect(await working("4242")).toBe(false);
    // No .pid: the daemon ended (agent-browser removes it on exit).
    expect(await working(null)).toBe(false);
    expect(daemonWorking(null, () => true)).toBe(false);
  });

  it("the sessions' bindings are read with their daemons, and files that are no binding skipped", async () => {
    const sockets = await temporary("holders-bindings-");
    const write = (name: string, value: unknown) =>
      NodeFSP.writeFile(
        NodePath.join(sockets, name),
        typeof value === "string" ? value : JSON.stringify(value),
      );
    // A live daemon, an ended one (its binding stays), a binding without a daemon file, a daemon
    // file that cannot be understood (working, so its tab stays), and files that are no binding.
    await write("codex-1.target", { targetId: id(3) });
    await write("codex-1.pid", "4242\n");
    await write("t3-old.target", { targetId: id(4).toLowerCase() });
    await write("t3-old.pid", "4343");
    await write("claude-2.target", { targetId: id(3) });
    await write("odd-3.target", { targetId: id(5) });
    await write("odd-3.pid", "not a pid");
    await write("codex-1.sock", "");
    await write("short.target", { targetId: "abc" });
    // Here a binding that cannot be read only takes its agent's mark off (the hub keeps its last
    // reading instead).
    await write("broken.target", "{");
    expect(await readSessionBindings(sockets, (pid) => pid === 4242)).toEqual([
      { session: "claude-2", targetId: id(3), working: false },
      { session: "codex-1", targetId: id(3), working: true },
      { session: "odd-3", targetId: id(5), working: true },
      { session: "t3-old", targetId: id(4), working: false },
    ]);
    expect(await readSessionBindings(NodePath.join(sockets, "none"))).toEqual([]);
  });

  it("a process is alive while kill -0 reaches it", () => {
    expect(processAlive(process.pid)).toBe(true);
    for (const pid of [0, 1, -5, Number.NaN, 1.5]) expect(processAlive(pid)).toBe(false);
    expect(processAlive(2 ** 22 + 12_345)).toBe(false);
  });

  it("a change in a watched directory is reported, and a directory made later is watched on retry", async () => {
    const directory = await temporary("holders-watch-");
    const holders = NodePath.join(directory, "holders");
    const later = NodePath.join(directory, "agent-browser");
    await NodeFSP.mkdir(holders);
    const watched = { changes: 0 };
    let seenChange: (() => void) | undefined;
    const watcher = watchDirectories([holders, later, undefined], () => {
      watched.changes++;
      seenChange?.();
    });
    // A watch may miss a change made the instant it starts (macOS), which the beat covers; the
    // test writes until the watch sees one, waiting on the watch itself.
    const seen = async (path: string) => {
      const before = watched.changes;
      // oxlint-disable-next-line t3code/no-polling-loop-in-tests -- a missed fs.watch event never comes, so only another write shows the watch works; bounded by attempts
      for (let n = 0; watched.changes === before; n++) {
        if (n > 100) throw new Error("no change seen");
        const reported = new Promise<void>((resolve) => {
          seenChange = resolve;
        });
        await NodeFSP.writeFile(path, `{"n":${n}}`);
        // oxlint-disable-next-line t3code/no-real-time-wait-in-tests -- a missed fs.watch event never comes, so only time can end one attempt
        await Promise.race([reported, new Promise((resolve) => setTimeout(resolve, 50))]);
      }
    };
    try {
      await seen(NodePath.join(holders, "launchpad.json"));
      await NodeFSP.mkdir(later);
      watcher.retry();
      await seen(NodePath.join(later, "codex-1.target"));
    } finally {
      watcher.stop();
    }
  });

  it("the boot clock reads the boot's id and the seconds since it", async () => {
    const files: Record<string, string> = {
      "/proc/sys/kernel/random/boot_id": `${boot}\n`,
      "/proc/uptime": "12345.67 54321.00\n",
    };
    const read = async (path: string) => {
      const text = files[path];
      if (text === undefined) throw new Error("ENOENT");
      return text;
    };
    expect(await readBootClock(read)).toEqual(at(12345.67));
    files["/proc/uptime"] = "x y";
    expect(await readBootClock(read)).toBeNull();
    // Not Linux: no boot clock.
    expect(
      await readBootClock(async () => {
        throw new Error("ENOENT");
      }),
    ).toBeNull();
    expect(parseBootTime(at(1))).toEqual(at(1));
    for (const value of [null, {}, { boot, at: -1 }, { boot: "x", at: 1 }, { boot, at: "1" }]) {
      expect(parseBootTime(value)).toBeNull();
    }
  });

  it("the list of live tabs is replaced atomically, owner-only, and read back", async () => {
    const runtime = await temporary("holders-list-");
    const path = liveTabsPath({ XDG_RUNTIME_DIR: runtime })!;
    // The hub's writeLiveTabs is replaceOwnerFile of this text.
    const writeLiveTabs = (tabs: readonly string[], takenAt: ReturnType<typeof at>) =>
      replaceOwnerFile(path, `${JSON.stringify({ tabs, takenAt })}\n`);
    await writeLiveTabs([id(1), id(2)], at(100));
    await writeLiveTabs([id(3)], at(105.5));
    expect(parseLiveTabs(await NodeFSP.readFile(path, "utf8"))).toEqual({
      tabs: [id(3)],
      takenAt: at(105.5),
    });
    expect((await NodeFSP.stat(path)).mode & 0o777).toBe(0o600);
    expect(await NodeFSP.readdir(NodePath.join(runtime, "lazurio-browser"))).toEqual(["tabs.json"]);
    for (const text of [
      "{",
      "[]",
      JSON.stringify({ tabs: [id(1)] }),
      JSON.stringify({ tabs: [id(1)], takenAt: "2026-10-11T12:00:00Z" }),
      JSON.stringify({ tabs: ["x"], takenAt: at(1) }),
      JSON.stringify({ tabs: id(1), takenAt: at(1) }),
    ]) {
      expect(parseLiveTabs(text)).toBeNull();
    }
  });

  it("an app drops a stored tab only when a list of this boot taken after its record lacks it", () => {
    const list = { tabs: [id(1)], takenAt: at(100) };
    const stored = [
      { id: id(1), recordedAt: at(10) },
      { id: id(2), recordedAt: at(90) },
      { id: id(3), recordedAt: at(100) },
      { id: id(4).toLowerCase(), recordedAt: at(100.5) },
      { id: id(5), recordedAt: null },
      { id: id(6), recordedAt: at(5_000, earlierBoot) },
    ];
    // id(2) ended before the snapshot began. id(5) has no time and id(6) is from an earlier boot,
    // so both count as older than every list of this boot. id(3) and id(4) were recorded when or
    // after it began.
    expect(keptTabs(stored, list, boot)).toEqual([id(1), id(3), id(4).toLowerCase()]);
    // A list of another boot, no list, or no boot clock: nothing is dropped.
    const all = stored.map((tab) => tab.id);
    expect(keptTabs(stored, { tabs: [], takenAt: at(100, earlierBoot) }, boot)).toEqual(all);
    expect(keptTabs(stored, null, boot)).toEqual(all);
    expect(keptTabs(stored, list, null)).toEqual(all);
  });

  it("a record of a tab that had already ended goes with the hub's next periodic snapshot", () => {
    // The tab ended at 199 s and the hub's snapshot then lacks it; the app recorded it only at
    // 200 s, so that snapshot cannot drop it.
    const record = [{ id: id(6), recordedAt: at(200) }];
    expect(keptTabs(record, { tabs: [], takenAt: at(199) }, boot)).toEqual([id(6)]);
    // The periodic snapshot 30 s later began after the record and lacks it.
    expect(keptTabs(record, { tabs: [], takenAt: at(229) }, boot)).toEqual([]);
  });

  it("a step of the wall clock changes nothing: a record made after a snapshot began is kept", () => {
    // The snapshot began at boot second 100; the wall clock then stepped back ten seconds; the
    // app recorded a live tab, which the boot clock reads as 100.4. The record is later than the
    // snapshot, so the tab stays.
    const record = [{ id: id(7), recordedAt: at(100.4) }];
    expect(keptTabs(record, { tabs: [], takenAt: at(100) }, boot)).toEqual([id(7)]);
  });

  it("a holder file keeps its record times, which only its writer reads back", () => {
    const text = holderFileText("launchpad", "Launchpad", [
      { id: id(1), recordedAt: at(100.25) },
      { id: id(2), recordedAt: at(101) },
      { id: id(3), recordedAt: null },
    ]);
    expect(JSON.parse(text)).toEqual({
      strip: "launchpad",
      label: "Launchpad",
      tabs: [id(1), id(2), id(3)],
      recordedAt: { [id(1)]: at(100.25), [id(2)]: at(101) },
    });
    // The hub reads it as any holder file and ignores the times.
    expect(parseHolder("launchpad.json", text)).toEqual({
      strip: "launchpad",
      label: "Launchpad",
      tabs: [id(1), id(2), id(3)],
    });
    // A time that is none is null; an id that is none is not a tab.
    expect(
      parseHolderRecords(
        "launchpad.json",
        JSON.stringify({
          strip: "launchpad",
          label: "Launchpad",
          tabs: [id(1), id(2), id(3)],
          recordedAt: {
            [id(1).toLowerCase()]: at(5),
            [id(2)]: { boot: "x", at: 1 },
            nope: at(1),
          },
        }),
      )?.tabs,
    ).toEqual([
      { id: id(1), recordedAt: at(5) },
      { id: id(2), recordedAt: null },
      { id: id(3), recordedAt: null },
    ]);
  });
});

describe("T3 Code's holder files", () => {
  it("are read by the hub's rules: strip is the file name, ids upper case, labels cut at 200", () => {
    const strip = "t3-4a1f9c2e-7b3d-4e5f-8a6b-9c0d1e2f3a4b";
    const text = holderFileText(strip, "x".repeat(200), [
      { id: "abcdef0123456789abcdef0123456789".toUpperCase(), recordedAt: at(3) },
    ]);
    expect(parseHolder(`${strip}.json`, text)).toEqual({
      strip,
      label: "x".repeat(200),
      tabs: ["ABCDEF0123456789ABCDEF0123456789"],
    });
    expect(parseHolder("t3-another.json", text)).toBeNull();
  });

  it("stay under 20 KiB with 128 tabs and a 200-character label", () => {
    const text = holderFileText(
      `t3-${"f".repeat(61)}`,
      "ž".repeat(200),
      Array.from({ length: 128 }, (_, n) => ({ id: id(n + 1), recordedAt: at(123_456.789) })),
    );
    expect(Buffer.byteLength(text, "utf8")).toBeLessThan(20 * 1024);
  });

  it("are replaced through a .tmp file, owner-only, in an owner-only directory", async () => {
    const runtime = await temporary("holders-write-");
    const directory = holderDirectory({ XDG_RUNTIME_DIR: runtime })!;
    const path = NodePath.join(directory, "t3-a.json");
    await replaceOwnerFile(path, holderFileText("t3-a", "A", []));
    // A reader listing the directory meanwhile sees the file and at most a temporary one whose
    // name never ends in .json, so the hub skips it; it never meets half a file.
    const seen = new Set<string>();
    const writes = new AbortController();
    let torn = 0;
    const reader = (async () => {
      // oxlint-disable-next-line t3code/no-polling-loop-in-tests -- the fixture is a reader racing the writes, not a wait for a milestone
      while (!writes.signal.aborted) {
        for (const name of await NodeFSP.readdir(directory)) seen.add(name);
        const text = await NodeFSP.readFile(path, "utf8").catch(() => null);
        if (text !== null && parseHolder("t3-a.json", text) === null) torn += 1;
        // oxlint-disable-next-line t3code/no-real-time-wait-in-tests -- a zero-delay macrotask boundary so the writes interleave, not a wait for time
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();
    for (let n = 0; n < 40; n++) {
      await replaceOwnerFile(
        path,
        holderFileText("t3-a", "A", [{ id: id(n + 1), recordedAt: null }]),
      );
    }
    writes.abort();
    await reader;
    expect(torn).toBe(0);
    for (const name of seen) expect(name).toMatch(/^t3-a\.json(?:\.[0-9a-f]{12}\.tmp)?$/);
    expect(await NodeFSP.readdir(directory)).toEqual(["t3-a.json"]);
    expect((await NodeFSP.stat(path)).mode & 0o777).toBe(0o600);
    expect((await NodeFSP.stat(directory)).mode & 0o777).toBe(0o700);
    // A write that fails leaves no temporary file behind.
    await NodeFSP.chmod(directory, 0o500);
    try {
      await expect(replaceOwnerFile(NodePath.join(directory, "t3-b.json"), "{}")).rejects.toThrow();
    } finally {
      await NodeFSP.chmod(directory, 0o700);
    }
    expect(await NodeFSP.readdir(directory)).toEqual(["t3-a.json"]);
  });
});

describe("stopping a thread's agent-browser daemon", () => {
  // LazurioPlatform#348: the stop goes to the session's own socket and never signals a process
  // id, so a stale .pid whose number another session's daemon (or any process named
  // agent-browser) has now is never touched.
  it("asks only the session's own daemon, on its socket, and signals no process", async () => {
    const sockets = await temporary("holders-daemon-");
    const heard: Record<string, string[]> = { "t3-a": [], "t3-b": [] };
    const servers: NodeNet.Server[] = [];
    const daemon = (session: "t3-a" | "t3-b") =>
      new Promise<void>((resolve) => {
        const server = NodeNet.createServer((socket) => {
          socket.on("data", async (chunk) => {
            const line = chunk.toString("utf8").trim();
            heard[session]?.push(line);
            const { id } = JSON.parse(line) as { id: string };
            socket.write(`${JSON.stringify({ id, success: true, data: { closed: true } })}\n`);
            await NodeFSP.rm(NodePath.join(sockets, `${session}.pid`), { force: true });
          });
        });
        servers.push(server);
        server.listen(NodePath.join(sockets, `${session}.sock`), () => resolve());
      });
    // A live process named agent-browser whose id t3-a's stale .pid names.
    const named = NodePath.join(sockets, "agent-browser");
    await NodeFSP.symlink("/bin/sleep", named);
    const sleeper = NodeChildProcess.spawn(named, ["30"], { stdio: "ignore" });
    try {
      expect(await stopSessionDaemon(sockets, "t3-a")).toBe("none");
      await NodeFSP.writeFile(NodePath.join(sockets, "t3-a.pid"), `${sleeper.pid}\n`);
      await daemon("t3-b");
      expect(await stopSessionDaemon(sockets, "t3-a")).toBe("none");
      expect(heard["t3-b"]).toEqual([]);
      expect(sleeper.exitCode).toBeNull();
      expect(sleeper.signalCode).toBeNull();
      // A socket file nobody listens on is no daemon either.
      await NodeFSP.writeFile(NodePath.join(sockets, "t3-c.sock"), "");
      expect(await stopSessionDaemon(sockets, "t3-c")).toBe("none");
      // t3-a's own daemon: one shutdown line, then its .pid is gone.
      await daemon("t3-a");
      expect(await stopSessionDaemon(sockets, "t3-a")).toBe("stopped");
      expect(heard["t3-a"]?.map((line) => JSON.parse(line))).toEqual([
        { id: "lazurio-browser-done", action: "__agent_browser_internal_shutdown" },
      ]);
      await expect(NodeFSP.access(NodePath.join(sockets, "t3-a.pid"))).rejects.toThrow();
      expect(sleeper.signalCode).toBeNull();
    } finally {
      sleeper.kill();
      for (const server of servers) server.close();
    }
  });

  it("is stopped only once the .pid is gone: a refusal changes nothing, a lost answer or a lingering daemon is unconfirmed", async () => {
    const sockets = await temporary("holders-daemon-");
    const refusing = { ask: async () => ({ kind: "reply", line: '{"success":false}' }) as const };
    expect(await stopSessionDaemon(sockets, "t3-a", refusing)).toBe("refused");
    const silent = { ask: async () => ({ kind: "no-answer" }) as const };
    expect(await stopSessionDaemon(sockets, "t3-a", silent)).toBe("unconfirmed");
    // Acknowledged, but the daemon has not exited: it may still hold the tab.
    await NodeFSP.writeFile(NodePath.join(sockets, "t3-a.pid"), "4242\n");
    const lingering = {
      ask: async () => ({ kind: "reply", line: '{"success":true}' }) as const,
      exitWithinMs: 150,
    };
    expect(await stopSessionDaemon(sockets, "t3-a", lingering)).toBe("unconfirmed");
    expect(await stopSessionDaemon(sockets, "../t3-a")).toBe("none");
  });

  // From the review of #56: a failure that proves nothing is never "none" or "stopped".
  it("a socket or a .pid that cannot be reached is unconfirmed, never none or stopped", async () => {
    const sockets = await temporary("holders-daemon-");
    const server = NodeNet.createServer(() => undefined);
    await new Promise<void>((resolve) =>
      server.listen(NodePath.join(sockets, "t3-a.sock"), () => resolve()),
    );
    try {
      // A daemon listens, but its socket cannot be opened.
      await NodeFSP.chmod(NodePath.join(sockets, "t3-a.sock"), 0o000);
      expect(await stopSessionDaemon(sockets, "t3-a")).toBe("unconfirmed");
    } finally {
      server.close();
    }
    // Acknowledged, and the .pid's directory cannot be read: not proven gone.
    const pidDirectory = await temporary("holders-pid-");
    await NodeFSP.writeFile(NodePath.join(pidDirectory, "t3-a.pid"), "4242\n");
    const acknowledged = {
      ask: async () => {
        await NodeFSP.chmod(pidDirectory, 0o000);
        return { kind: "reply", line: '{"success":true}' } as const;
      },
      exitWithinMs: 150,
    };
    try {
      expect(await stopSessionDaemon(pidDirectory, "t3-a", acknowledged)).toBe("unconfirmed");
    } finally {
      await NodeFSP.chmod(pidDirectory, 0o700);
    }
    expect(await NodeFSP.readFile(NodePath.join(pidDirectory, "t3-a.pid"), "utf8")).toBe("4242\n");
  });
});
