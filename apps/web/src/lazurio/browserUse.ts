/**
 * Lazurio overlay (root decision 0191, plan DEV-6646): whether the agent of the thread in view
 * uses the Environment browser, read from the thread's activities, so that the right panel can
 * show the person the thread's tab (LazurioEnvironmentBrowser.tsx).
 *
 * The web client has a thread's activities (OrchestrationThreadActivity) in its detail: what a
 * snapshot or the cache holds, the events the thread missed, then each new one live. A tool call
 * is a `tool.started`, any `tool.updated` and a `tool.completed`, each with the provider's id of
 * the call (`toolCallId`) in its payload. The agent uses the browser in a call of T3's browser
 * tools that works with a page, a command that runs agent-browser on a page, or a command that
 * runs `lazurio browser window`. Nothing here reads a page or the browser.
 */

/** What the overlay reads of a thread's activity (OrchestrationThreadActivity). */
export interface ThreadActivity {
  readonly id: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly turnId: string | null;
  readonly createdAt: string;
}

const TOOL_CALL_KINDS = new Set(["tool.started", "tool.updated", "tool.completed"]);

/** T3's browser tools that work with a page; preview_status, resizing and recording do not. */
const PAGE_TOOLS = new Set([
  "preview_open",
  "preview_navigate",
  "preview_click",
  "preview_type",
  "preview_press",
  "preview_scroll",
  "preview_snapshot",
  "preview_evaluate",
  "preview_wait_for",
]);

/**
 * A tool of T3's own MCP server as providers name it: `mcp__t3-code__preview_open` (Claude Code),
 * `t3-code · preview_open` (Codex's title), `t3-code_preview_open`, or the bare tool name.
 */
const T3_TOOL = /^(?:mcp__)?(?:(?:t3-code|t3_code|t3code)(?:__|[_.:/]|\s*·\s*))?([a-z_]+)$/i;

/**
 * Whether a tool call activity shows the agent using the Environment browser on a page. A call
 * whose command is not known yet (Claude Code streams it after the call starts) is not, until an
 * activity of the call has it.
 */
export function isBrowserUse(activity: Pick<ThreadActivity, "kind" | "payload">): boolean {
  if (!TOOL_CALL_KINDS.has(activity.kind)) return false;
  const payload = asRecord(activity.payload);
  if (payload === null) return false;
  if (toolNames(payload).some((name) => PAGE_TOOLS.has(name))) return true;
  if (payload.itemType !== "command_execution") return false;
  const command = commandOf(payload);
  return command !== null && commandUsesBrowser(command);
}

function toolNames(payload: Record<string, unknown>): string[] {
  const data = asRecord(payload.data);
  const item = asRecord(data?.item);
  const names = [
    typeof item?.server === "string" && typeof item.tool === "string"
      ? `${item.server}__${item.tool}`
      : null,
    data?.toolName,
    data?.tool,
    payload.title,
  ];
  return names.flatMap((name) => {
    const tool = typeof name === "string" ? T3_TOOL.exec(name.trim())?.[1] : undefined;
    return tool === undefined ? [] : [tool.toLowerCase()];
  });
}

/** The command a command execution ran, where the server's projection of the activity keeps it. */
function commandOf(payload: Record<string, unknown>): string | ReadonlyArray<string> | null {
  const data = asRecord(payload.data);
  const item = asRecord(data?.item);
  for (const command of [item?.command, asRecord(item?.input)?.command, data?.command]) {
    if (typeof command === "string" && command.trim() !== "") return command;
    if (
      Array.isArray(command) &&
      command.length > 0 &&
      command.every((word) => typeof word === "string")
    ) {
      return command;
    }
  }
  // The server keeps the command line, cut to its first 180 characters, as the detail.
  return typeof payload.detail === "string" && payload.detail.trim() !== "" ? payload.detail : null;
}

/** How deep commands within commands are read: `bash -c "…"`, `$(…)` and the like. */
const MAX_NESTING = 8;

/**
 * Whether a command line runs agent-browser on a page or `lazurio browser window`: as one of its
 * commands, through a shell's -c, eval, a wrapper such as env, sudo, timeout or npx, or within a
 * command substitution. Arguments, quoted text, here-documents and comments that only name
 * agent-browser do not count, and neither does agent-browser's setup, help or close.
 */
export function commandUsesBrowser(command: string | ReadonlyArray<string>, depth = 0): boolean {
  if (depth > MAX_NESTING) return false;
  const commands = typeof command === "string" ? shellCommands(command) : [command];
  return commands.some((words) => {
    const run = runOf(words);
    if (run === null) return false;
    if (run.program === "agent-browser") return agentBrowserWorksOnAPage(run.args);
    if (run.program === "lazurio") return lazurioOpensBrowserWindow(run.args);
    const script = run.program === "eval" ? run.args.join(" ") : shellScript(run);
    return script !== null && commandUsesBrowser(script, depth + 1);
  });
}

/** agent-browser's global options that take a value (its `clean_args`). */
const AGENT_BROWSER_OPTIONS_WITH_VALUE = new Set([
  "--session",
  "--restore-save",
  "--restore-check-url",
  "--restore-check-text",
  "--restore-check-fn",
  "--namespace",
  "--headers",
  "--executable-path",
  "--cdp",
  "--extension",
  "--init-script",
  "--enable",
  "--profile",
  "--state",
  "--proxy",
  "--proxy-bypass",
  "--args",
  "--user-agent",
  "-p",
  "--provider",
  "--device",
  "--session-name",
  "--color-scheme",
  "--download-path",
  "--max-output",
  "--allowed-domains",
  "--action-policy",
  "--confirm-actions",
  "--config",
  "--engine",
  "--screenshot-dir",
  "--screenshot-quality",
  "--screenshot-format",
  "--idle-timeout",
  "--ca-cert",
  "--model",
]);

/** agent-browser commands that work with no page: setup, help, sessions, reading a URL, closing. */
const AGENT_BROWSER_OFF_PAGE = new Set([
  "install",
  "upgrade",
  "doctor",
  "dashboard",
  "profiles",
  "skills",
  "plugin",
  "plugins",
  "mcp",
  "session",
  "state",
  "read",
  "connect",
  "stream",
  "help",
  "close",
  "quit",
  "exit",
]);

const isHelp = (word: string) =>
  word === "--help" || word === "-h" || word === "--version" || word === "-V";

function agentBrowserWorksOnAPage(args: ReadonlyArray<string>): boolean {
  let command: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (isHelp(arg)) return false;
    if (command !== undefined) continue;
    if (AGENT_BROWSER_OPTIONS_WITH_VALUE.has(arg)) {
      index += 1;
    } else if (arg.startsWith("-")) {
      // A switch may be followed by true or false.
      if (args[index + 1] === "true" || args[index + 1] === "false") index += 1;
    } else {
      command = arg;
    }
  }
  return command !== undefined && !AGENT_BROWSER_OFF_PAGE.has(command);
}

function lazurioOpensBrowserWindow(args: ReadonlyArray<string>): boolean {
  if (args.some(isHelp)) return false;
  const [group, command] = args.filter((arg) => !arg.startsWith("-"));
  return group === "browser" && command === "window";
}

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash", "fish"]);

/** The script a shell runs from its -c option, or null for a shell that runs a file. */
function shellScript(run: Run): string | null {
  if (!SHELLS.has(run.program)) return null;
  for (let index = 0; index < run.args.length; index += 1) {
    const arg = run.args[index]!;
    if (arg === "-c" || arg === "--command" || /^-[A-Za-z]*c[A-Za-z]*$/.test(arg)) {
      return run.args[index + 1] ?? null;
    }
    // -o, and options that end in it (-euo pipefail), take a value; so do the rc files.
    if (/^[-+][A-Za-z]*[oO]$/.test(arg) || arg === "--rcfile" || arg === "--init-file") index += 1;
    else if (!arg.startsWith("-") && !arg.startsWith("+")) return null;
  }
  return null;
}

interface Run {
  /** The program's file name, without its directory. */
  readonly program: string;
  readonly args: ReadonlyArray<string>;
}

/** Shell words that open or continue syntax before a command's program. */
const SHELL_SYNTAX = new Set(["!", "{", "}", "if", "then", "elif", "else", "do", "while", "until"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

/** Programs that run the command after their own options, with the options that take a value. */
const WRAPPERS = new Map<string, ReadonlySet<string>>([
  ["command", new Set()],
  ["exec", new Set(["-a"])],
  ["nohup", new Set()],
  ["time", new Set()],
  ["nice", new Set(["-n", "--adjustment"])],
  ["env", new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string"])],
  ["timeout", new Set(["-s", "--signal", "-k", "--kill-after"])],
  ["sudo", new Set(["-u", "--user", "-g", "--group", "-C", "--close-from", "-D", "--chdir", "-h"])],
  ["npx", new Set(["-p", "--package", "-c", "--call"])],
  ["bunx", new Set(["-p", "--package"])],
]);

/** The program a simple command runs and its arguments, past assignments and wrappers. */
function runOf(words: ReadonlyArray<string>): Run | null {
  let index = 0;
  while (index < words.length) {
    const word = words[index]!;
    if (SHELL_SYNTAX.has(word) || ASSIGNMENT.test(word)) {
      index += 1;
      continue;
    }
    const program = word.slice(word.lastIndexOf("/") + 1);
    const options = WRAPPERS.get(program);
    if (options === undefined) return { program, args: words.slice(index + 1) };
    // `command -v` names a program's path instead of running it.
    if (program === "command" && /^-[vV]$/.test(words[index + 1] ?? "")) return null;
    index += 1;
    while (index < words.length && words[index]!.startsWith("-")) {
      const option = words[index]!;
      index += option === "--" ? 1 : options.has(option) ? 2 : 1;
      if (option === "--") break;
    }
    if (program === "env") while (ASSIGNMENT.test(words[index] ?? "")) index += 1;
    if (program === "timeout") index += 1; // its duration
    if ((program === "npx" || program === "bunx") && index < words.length) {
      // A package and its version: agent-browser@latest runs agent-browser.
      const spec = words[index]!.replace(/(?<=.)@[^/]*$/, "");
      return { program: spec.slice(spec.lastIndexOf("/") + 1), args: words.slice(index + 1) };
    }
  }
  return null;
}

/**
 * The simple commands of a shell command line, each as its words without quotes. It splits at
 * ; & | and newlines and around subshells, reads $(…), `…` and <(…) as commands of their own,
 * skips here-document bodies, which are data, and drops redirections with their targets. A quote
 * that never closes, as in a command line cut short, runs to the end.
 */
function shellCommands(script: string): string[][] {
  const commands: string[][] = [];
  readCommands(script, 0, null, commands, 0);
  return commands;
}

/** Reads commands from `start` up to `closer` (or the end); answers where reading stopped. */
function readCommands(
  script: string,
  start: number,
  closer: ")" | "`" | null,
  commands: string[][],
  depth: number,
): number {
  if (depth > MAX_NESTING) return script.length;
  let words: string[] = [];
  let word: string | null = null;
  let redirectTarget = false;
  let subshells = 0;
  const heredocs: Array<{ readonly delimiter: string; readonly stripTabs: boolean }> = [];
  const append = (text: string) => {
    word = (word ?? "") + text;
  };
  const endWord = () => {
    if (word === null) return;
    if (redirectTarget) redirectTarget = false;
    else words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    redirectTarget = false;
    if (words.length > 0) commands.push(words);
    words = [];
  };
  // A command substitution adds its commands; what it prints is unknown, so it adds no text.
  const substitution = (from: number, end: ")" | "`") => {
    append("");
    return readCommands(script, from, end, commands, depth + 1);
  };
  const readDoubleQuoted = (from: number) => {
    let index = from;
    append("");
    while (index < script.length && script[index] !== '"') {
      const character = script[index]!;
      const next = script[index + 1];
      if (character === "\\" && next !== undefined && '"\\$`\n'.includes(next)) {
        if (next !== "\n") append(next);
        index += 2;
      } else if (character === "$" && next === "(") index = substitution(index + 2, ")");
      else if (character === "`") index = substitution(index + 1, "`");
      else {
        append(character);
        index += 1;
      }
    }
    return index + 1;
  };
  const readHeredoc = (from: number) => {
    endWord();
    let index = from;
    const stripTabs = script[index] === "-";
    if (stripTabs) index += 1;
    while (script[index] === " " || script[index] === "\t") index += 1;
    let delimiter = "";
    while (index < script.length && !/[\s;&|<>()]/.test(script[index]!)) {
      const character = script[index]!;
      if (character === "'" || character === '"') {
        const close = script.indexOf(character, index + 1);
        const end = close === -1 ? script.length : close;
        delimiter += script.slice(index + 1, end);
        index = end + 1;
      } else if (character === "\\") {
        delimiter += script[index + 1] ?? "";
        index += 2;
      } else {
        delimiter += character;
        index += 1;
      }
    }
    if (delimiter !== "") heredocs.push({ delimiter, stripTabs });
    return index;
  };
  const skipHeredocBodies = (from: number) => {
    let index = from;
    for (const { delimiter, stripTabs } of heredocs.splice(0)) {
      while (index < script.length) {
        const newline = script.indexOf("\n", index);
        const end = newline === -1 ? script.length : newline;
        const line = script.slice(index, end).replace(/\r$/, "");
        index = end + 1;
        if ((stripTabs ? line.replace(/^\t+/, "") : line) === delimiter) break;
      }
    }
    return Math.min(index, script.length);
  };
  const readRedirection = (from: number) => {
    // A number right before the operator names a file descriptor, not an argument.
    if (word !== null && /^\d+$/.test(word)) word = null;
    else endWord();
    let index = from;
    while (index < script.length && "<>&|".includes(script[index]!)) index += 1;
    // >&2 and <&- duplicate or close a descriptor and take no file.
    const descriptor = script.slice(from, index).endsWith("&")
      ? /^(?:\d+|-)/.exec(script.slice(index))?.[0]
      : undefined;
    if (descriptor !== undefined) return index + descriptor.length;
    redirectTarget = true;
    return index;
  };

  let index = start;
  while (index < script.length) {
    const character = script[index]!;
    const next = script[index + 1];
    if (character === "\\") {
      // A backslash before a newline continues the line.
      if (next !== "\n") append(next ?? "");
      index += 2;
    } else if (character === "'") {
      const close = script.indexOf("'", index + 1);
      const end = close === -1 ? script.length : close;
      append(script.slice(index + 1, end));
      index = end + 1;
    } else if (character === '"') {
      index = readDoubleQuoted(index + 1);
    } else if (character === "`") {
      if (closer === "`") {
        endCommand();
        return index + 1;
      }
      index = substitution(index + 1, "`");
    } else if (character === "$" && next === "(") {
      index = substitution(index + 2, ")");
    } else if (character === "$" && next === "{") {
      const close = script.indexOf("}", index + 2);
      const end = close === -1 ? script.length : close + 1;
      append(script.slice(index, end));
      index = end;
    } else if ((character === "<" || character === ">") && next === "(") {
      index = substitution(index + 2, ")");
    } else if (character === "<" && next === "<" && script[index + 2] !== "<") {
      index = readHeredoc(index + 2);
    } else if (character === "<" || character === ">" || (character === "&" && next === ">")) {
      index = readRedirection(index);
    } else if (character === "#" && word === null) {
      const newline = script.indexOf("\n", index);
      index = newline === -1 ? script.length : newline;
    } else if (character === "\n") {
      endCommand();
      index = skipHeredocBodies(index + 1);
    } else if (character === ";" || character === "&" || character === "|") {
      endCommand();
      index += 1;
    } else if (character === "(") {
      endCommand();
      subshells += 1;
      index += 1;
    } else if (character === ")") {
      endCommand();
      if (subshells === 0 && closer === ")") return index + 1;
      subshells = Math.max(0, subshells - 1);
      index += 1;
    } else if (character === " " || character === "\t" || character === "\r") {
      endWord();
      index += 1;
    } else {
      append(character);
      index += 1;
    }
  }
  endCommand();
  return script.length;
}

/** What the panel has taken in of the activities of the thread in view (trackBrowserUse). */
export interface BrowserUseTracker {
  readonly threadKey: string;
  /** The `createdAt` of the newest activity taken in; an activity after it is new. */
  readonly newest: string | null;
  /** The activities taken in at exactly `newest`: activities can share a millisecond. */
  readonly atNewest: ReadonlySet<string>;
  /** The tool calls that counted as browser use already. */
  readonly calls: ReadonlySet<string>;
}

/**
 * Whether the agent of the thread in view started to use the browser since the last look: a new
 * activity of a tool call that uses it (isBrowserUse) and has not counted yet, so a call counts
 * once, however many activities it has. The first look at a thread only takes in what it shows,
 * and so does every look while it is not `live` (its history loading or catching up), so that
 * opening a thread, a reload or the backlog that loads with it never counts. An activity is new
 * when it is newer than everything taken in, so older history that loads later (an earlier page)
 * does not count either.
 */
export function trackBrowserUse(
  tracker: BrowserUseTracker | null,
  threadKey: string,
  activities: ReadonlyArray<ThreadActivity>,
  live: boolean,
): { readonly tracker: BrowserUseTracker; readonly used: boolean } {
  const before = tracker?.threadKey === threadKey ? tracker : null;
  let newest = before?.newest ?? null;
  let atNewest = before?.atNewest ?? new Set<string>();
  let calls = before?.calls ?? new Set<string>();
  let used = false;
  for (const activity of activities) {
    const isNew =
      before !== null &&
      (before.newest === null ||
        activity.createdAt > before.newest ||
        (activity.createdAt === before.newest && !before.atNewest.has(activity.id)));
    if (newest === null || activity.createdAt > newest) {
      newest = activity.createdAt;
      atNewest = new Set([activity.id]);
    } else if (activity.createdAt === newest && !atNewest.has(activity.id)) {
      atNewest = new Set(atNewest).add(activity.id);
    }
    if (!isNew || !live) continue;
    const call = toolCallOf(activity);
    if (calls.has(call) || !isBrowserUse(activity)) continue;
    calls = new Set(calls).add(call);
    used = true;
  }
  return { tracker: { threadKey, newest, atNewest, calls }, used };
}

/** The tool call an activity belongs to: the provider's id of the call in its turn, else itself. */
function toolCallOf(activity: ThreadActivity): string {
  const payload = asRecord(activity.payload);
  const id = payload?.toolCallId ?? asRecord(payload?.data)?.toolCallId;
  return typeof id === "string" && id !== "" ? `tool:${activity.turnId}:${id}` : activity.id;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
