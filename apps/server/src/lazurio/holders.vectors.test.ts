// @effect-diagnostics nodeBuiltinImport:off - the cases of the Node part are real files and a real socket in a directory of their own, as the vectors' README describes them.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import * as holders from "./holders.ts";
import * as ownBrowser from "./ownBrowser.ts";

// LazurioPlatform's vectors of the Environment browser contract (F50 point 4), taken from its
// release v0.1.22 (src/browser/contract/vectors/v1/, MIT, ./platform-browser-contract/LICENSE),
// and own-browser.json (C20) from Lazurio/LazurioPlatform#1262, run against the copies in
// holders.ts and ownBrowser.ts: a port of the Platform's runner without the watch steps.

const vectorDirectory = NodePath.join(import.meta.dirname, "platform-browser-contract", "vectors");

// Each file's JSON, as JSON.stringify writes it: the files here are formatted by the repository's
// formatter, so they are pinned by their content, not their bytes. One change to the release's
// text: agent-browser.json's home-directory case names the placeholder /home/example-person, as
// this public repository names no person; the case is otherwise the release's.
const vectorContents: Readonly<Record<string, string>> = {
  "agent-browser.json": "b6eb4d24e16721b3400f30a2e18479b764ef80c1f04090124cc77ad473132319",
  "boot-clock.json": "ce8de282785f73b4794aaa6d566ae54a051eaf21973c6bb8278a68dc5e67bd59",
  "holder-files.json": "5d798ba533083e849608c850a676a91fd4805c810c45760b9f398fdcd95cbafe",
  "own-browser.json": "e8e3773c2cabefae6456778511200f8bf3cd28aedbdce246b80580030a088901",
  "live-tabs.json": "e4a122ce084e5adff6d64740efa229b065adb97b1ff88921894622a2b4a924fb",
  "remote-tab-ids.json": "a05aa989e14812accee141b80045f0f0aef453b74a7a9390e39f0e4de5be11e6",
  "strips.json": "a734a73a07d4157a4d2d81862ca09c9d9828368c1a31d3064873eb2f2af46ce5",
  "unverified-binding.json": "2802cdc6f9d23f50562bec9f15acb2e9c6e9269dcdd61d108a95a5db4f914fb6",
};

// The contract's exports that holders.ts does not copy: the hub's own reading, writing and
// watching of the files, the strip and tab id rules other overlay modules keep, and the
// unverified binding's marks, whose text the overlay never reads or writes: like the hub's
// readUnverifiedSessions, it counts a mark by its file name, whatever its text.
const notCopied = new Set([
  "askDaemonSocket",
  "changeHolderFile",
  "holdsReader",
  "launchpadStrip",
  "liveTabsText",
  "noHolds",
  "noHoldsMemory",
  "parseUnverifiedBinding",
  "readHolds",
  "readLiveTabs",
  "stripAppOf",
  "stripPrefixes",
  "targetIdOf",
  "threadSession",
  "unreadableHolderFiles",
  "unverifiedBindingSchema",
  "unverifiedBindingText",
  "watchHolds",
  "writeLiveTabs",
]);

type Case = Readonly<{
  name: string;
  call: string;
  args?: readonly unknown[];
  expect?: unknown;
  directory?: Readonly<Record<string, unknown>>;
  alive?: readonly number[];
  daemon?: Daemon;
  heard?: readonly string[];
  after?: Readonly<Record<string, Readonly<{ text?: string; json?: unknown; mode?: string }>>>;
  steps?: readonly unknown[];
}>;

type Daemon = Readonly<{
  socket: string;
  reply: string | null;
  removes?: readonly string[];
  locks?: boolean;
  unreadable?: boolean;
}>;

type VectorFile = Readonly<{ file: string; schema: string; contract: string; cases: Case[] }>;

const files: readonly VectorFile[] = NodeFS.readdirSync(NodePath.join(vectorDirectory, "v1"))
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((file) => {
    const text = NodeFS.readFileSync(NodePath.join(vectorDirectory, "v1", file), "utf8");
    return { file, ...(JSON.parse(text) as Omit<VectorFile, "file">) };
  });

const exported: Readonly<Record<string, unknown>> = { ...holders, ...ownBrowser };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type Context = { dir: string; alive: readonly number[] };

const idOf = (n: number) => n.toString(16).toUpperCase().padStart(32, "0");

function decode(value: unknown, context: Context): unknown {
  if (typeof value === "string") {
    if (value === "$alive") return (pid: number) => context.alive.includes(pid);
    if (value === "$read")
      return (path: string) => NodeFSP.readFile(NodePath.join(context.dir, path), "utf8");
    if (value === "$pid") return process.pid;
    return value.startsWith("$dir") ? `${context.dir}${value.slice("$dir".length)}` : value;
  }
  if (Array.isArray(value)) return value.map((item) => decode(item, context));
  if (!isRecord(value)) return value;
  if ("$" in value) {
    if (value.$ === "undefined") return undefined;
    throw new Error(`No value stands for ${String(value.$)}`);
  }
  if ("$map" in value && isRecord(value.$map))
    return new Map(Object.entries(value.$map).map(([key, item]) => [key, decode(item, context)]));
  if ("$json" in value) return JSON.stringify(decode(value.$json, context));
  if ("$repeat" in value) return String(value.$repeat).repeat(Number(value.times));
  if ("$ids" in value) return Array.from({ length: Number(value.$ids) }, (_, n) => idOf(n + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, decode(item, context)]),
  );
}

// The README's rule: an object by the members the case names, a list and a Map entry by entry,
// a JSON text given as {"$json": value} by its value, anything else as it is.
function compared(
  actual: unknown,
  expected: unknown,
  context: Context,
): readonly [unknown, unknown] {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [actual, decode(expected, context)];
    const pairs = Array.from({ length: Math.max(actual.length, expected.length) }, (_, at) =>
      compared(actual[at], expected[at], context),
    );
    return [pairs.map(([seen]) => seen), pairs.map(([, wanted]) => wanted)];
  }
  if (!isRecord(expected) || "$" in expected || "$repeat" in expected || "$ids" in expected)
    return [actual, decode(expected, context)];
  if ("$json" in expected) {
    if (typeof actual !== "string") return [actual, decode(expected, context)];
    let parsed: unknown;
    try {
      parsed = JSON.parse(actual);
    } catch {
      return [actual, decode(expected, context)];
    }
    return compared(parsed, expected.$json, context);
  }
  if ("$map" in expected && isRecord(expected.$map)) {
    if (!(actual instanceof Map)) return [actual, decode(expected, context)];
    const entries = expected.$map;
    const keys = [...new Set([...actual.keys(), ...Object.keys(entries)])];
    const pairs = keys.map(
      (key) => [key, compared(actual.get(key), entries[key], context)] as const,
    );
    return [
      new Map(pairs.map(([key, [seen]]) => [key, seen])),
      new Map(pairs.map(([key, [, wanted]]) => [key, wanted])),
    ];
  }
  if (!isRecord(actual)) return [actual, decode(expected, context)];
  const seen: Record<string, unknown> = {};
  const wanted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(expected))
    [seen[key], wanted[key]] = compared(actual[key], value, context);
  return [seen, wanted];
}

function expectMatch(actual: unknown, expected: unknown, context: Context) {
  const [seen, wanted] = compared(actual, expected, context);
  expect(seen).toEqual(wanted);
}

const throws = (value: unknown) => isRecord(value) && value.$ === "throws";

// Files first, then the modes, so a file can lie in a directory that cannot be listed.
async function layOut(
  context: Context,
  layout: Readonly<Record<string, unknown>>,
  locked: string[],
): Promise<void> {
  const unreadable: string[] = [];
  for (const [path, entry] of Object.entries(layout)) {
    const target = NodePath.join(context.dir, path);
    if (path.endsWith("/")) {
      await NodeFSP.mkdir(target, { recursive: true });
      if (isRecord(entry) && entry.unreadable === true) unreadable.push(target);
      continue;
    }
    await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true });
    if (isRecord(entry) && entry.unreadable === true) {
      await NodeFSP.writeFile(target, String(entry.text ?? ""));
      unreadable.push(target);
    } else await NodeFSP.writeFile(target, String(decode(entry, context)));
  }
  for (const path of unreadable.sort().reverse()) {
    await NodeFSP.chmod(path, 0o000);
    locked.push(path);
  }
}

async function entriesOf(
  root: string,
  below = "",
): Promise<Record<string, Readonly<{ text?: string; mode: string }>>> {
  const found: Record<string, Readonly<{ text?: string; mode: string }>> = {};
  for (const name of (await NodeFSP.readdir(NodePath.join(root, below))).sort()) {
    const path = `${below}${name}`;
    const info = await NodeFSP.lstat(NodePath.join(root, path));
    const mode = (info.mode & 0o777).toString(8);
    if (info.isDirectory()) {
      found[`${path}/`] = { mode };
      Object.assign(found, await entriesOf(root, `${path}/`));
    } else found[path] = { text: await NodeFSP.readFile(NodePath.join(root, path), "utf8"), mode };
  }
  return found;
}

// What the daemon does after its answer goes into `steps`, awaited before the case cleans up.
async function listen(
  context: Context,
  daemon: Daemon,
  heard: string[],
  locked: string[],
  steps: Promise<void>[],
): Promise<NodeNet.Server> {
  const path = NodePath.join(context.dir, daemon.socket);
  const server = NodeNet.createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      heard.push(buffer.slice(0, end));
      buffer = "";
      if (daemon.reply === null) {
        socket.end();
        return;
      }
      socket.write(`${daemon.reply}\n`);
      steps.push(
        (async () => {
          for (const file of daemon.removes ?? [])
            await NodeFSP.rm(NodePath.join(context.dir, file), { force: true });
          if (daemon.locks === true) {
            locked.push(context.dir);
            await NodeFSP.chmod(context.dir, 0o000);
          }
        })(),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(path, () => resolve()));
  if (daemon.unreadable === true) {
    await NodeFSP.chmod(path, 0o000);
    locked.push(path);
  }
  return server;
}

type Call = (...args: unknown[]) => unknown;

// A socket's path must stay short (104 bytes on macOS), so the case's directory is under a short
// temporary directory.
async function runCase(entry: Case, call: Call): Promise<void> {
  const context: Context = {
    dir: await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "bc-")),
    alive: entry.alive ?? [],
  };
  const locked: string[] = [];
  const servers: NodeNet.Server[] = [];
  const heard: string[] = [];
  const steps: Promise<void>[] = [];
  try {
    await layOut(context, entry.directory ?? {}, locked);
    if (entry.daemon !== undefined)
      servers.push(await listen(context, entry.daemon, heard, locked, steps));
    const args = decode(entry.args ?? [], context) as unknown[];
    if (throws(entry.expect)) {
      await expect(Promise.resolve().then(() => call(...args))).rejects.toBeDefined();
      return;
    }
    const result: unknown = await call(...args);
    if (entry.steps === undefined) expectMatch(result, entry.expect, context);
    else {
      for (const step of entry.steps as readonly Readonly<{
        directory?: Readonly<Record<string, unknown>>;
        expect?: unknown;
      }>[]) {
        if (step.directory !== undefined) {
          for (const name of await NodeFSP.readdir(context.dir))
            await NodeFSP.rm(NodePath.join(context.dir, name), { recursive: true, force: true });
          await layOut(context, step.directory, []);
        }
        expectMatch(await (result as () => unknown)(), step.expect, context);
      }
    }
    if (entry.heard !== undefined) expect(heard).toEqual([...entry.heard]);
    if (entry.after !== undefined) {
      const after = await entriesOf(context.dir);
      expect(Object.keys(after).sort()).toEqual(Object.keys(entry.after).sort());
      for (const [path, wanted] of Object.entries(entry.after)) {
        if (wanted.text !== undefined) expect(after[path]?.text).toBe(wanted.text);
        if (wanted.json !== undefined)
          expectMatch(after[path]?.text, { $json: wanted.json }, context);
        if (wanted.mode !== undefined) expect(after[path]?.mode).toBe(wanted.mode);
      }
    }
  } finally {
    await Promise.allSettled(steps);
    for (const path of locked.reverse()) await NodeFSP.chmod(path, 0o700).catch(() => undefined);
    for (const server of servers) await new Promise((resolve) => server.close(resolve));
    await NodeFSP.rm(context.dir, { recursive: true, force: true });
  }
}

describe("LazurioPlatform v0.1.22's browser contract vectors", () => {
  it("are the release's files, and every case names a copied export or one left out above", () => {
    expect(
      Object.fromEntries(
        files.map(({ file, ...content }) => [
          file,
          NodeCrypto.createHash("sha256").update(JSON.stringify(content)).digest("hex"),
        ]),
      ),
    ).toEqual(vectorContents);
    for (const file of files) {
      expect(file.schema).toBe("lazurio.browser-vectors.v1");
      expect(`${file.contract}.json`).toBe(file.file);
      for (const entry of file.cases)
        expect(entry.call in exported || notCopied.has(entry.call), entry.call).toBe(true);
    }
  });

  describe.each(files)("$contract ($file)", (file) => {
    it.each(file.cases.filter((candidate) => candidate.call in exported))(
      "$call: $name",
      async (entry) => {
        const target = exported[entry.call];
        if (typeof target !== "function") {
          expect(entry.args).toBeUndefined();
          expectMatch(target, entry.expect, { dir: "", alive: [] });
          return;
        }
        await runCase(entry, target as Call);
      },
    );
  });
});
