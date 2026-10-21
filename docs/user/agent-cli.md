# Agents on the host

An agent that runs on the machine hosting T3 Code, such as a personal assistant
signed in over SSH or a script, can work with your threads through the `t3`
command. It reads them, starts and messages them, answers their questions,
decides their permission requests and follows them as they change. It acts as
you: what you can do with threads in the app, it can do too.

Run `t3` as the user that runs T3 Code. It reaches the server running for the
same T3 home, so T3 Code must be running. Each command signs in for itself and
signs out when it ends, so there is nothing to set up or keep. Pass
`--base-dir` when T3 Code keeps its data somewhere other than the default.

Agents elsewhere connect over MCP instead. See [Outside agents](./outside-agents.md).

## Commands

| Task                                                 | Command                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| List threads in every project, newest change first   | `t3 thread list`                                                                |
| Read a thread's messages, or every step              | `t3 thread read <thread>`, with `--view activity`                               |
| Search titles and messages                           | `t3 thread search <words>`                                                      |
| Start a thread                                       | `t3 thread launch --title <title> <message>`                                    |
| Message a thread                                     | `t3 thread send <thread> <message>`                                             |
| Stop a running turn                                  | `t3 thread interrupt <thread>`                                                  |
| Wait until a run finishes                            | `t3 thread wait <thread>`                                                       |
| Pin, settle, archive or snooze a thread, or undo it  | `t3 thread organize <thread> <action>`                                          |
| Fork a thread                                        | `t3 thread fork <thread>`                                                       |
| List the questions and permission requests that wait | `t3 request list`                                                               |
| Answer a question                                    | `t3 request respond <request> --answer <text>`                                  |
| Approve or decline a permission request              | `t3 request approve <request>`, `t3 request deny <request>`                     |
| Work with messages queued behind a running turn      | `t3 queue list <thread>`, then `read`, `edit`, `cancel`, `reorder` or `promote` |
| Follow changes as they happen                        | `t3 events --follow`                                                            |

`t3 <command> --help` lists each command's options. `t3 thread list` shows the
threads you see in the sidebar; add `--subagents` for delegated tasks, and
filter with `--status waiting`, `--settled` or `--project <name>`.

## Output and exit codes

Add `--json` to print the result as one JSON document. A command that fails
prints `{"error": {"code": "...", "message": "..."}}` instead, and without
`--json` says why on standard error. That includes a command line that cannot
work, such as `--for-session` with `--always`: it fails before anything is read.
Only a command line `t3` cannot parse, such as one with an unknown flag or a
missing argument, prints the command's help and the error as text.

```sh
t3 thread list --status waiting --json
t3 thread read 4f1c0b2e-… --json
t3 thread send 4f1c0b2e-… "Use the staging database" --mode steer --json
```

| Exit code | Meaning                                                                        |
| --------- | ------------------------------------------------------------------------------ |
| 0         | Done.                                                                          |
| 1         | T3 Code refused or failed the request, or the command line was invalid.        |
| 3         | T3 Code is not running for this T3 home. Nothing was read or changed.          |
| 4         | `t3 thread wait` timed out. It prints the thread's state, and the run goes on. |

A command is not retried for you. If one ends without an answer, check the
thread with `t3 thread read` or `t3 thread list` before you send it again.

## Start and message threads

`t3 thread launch` starts a thread in full access and gives it the message as
its first task. It starts with the model a new thread in that project starts
with in the app: the project's own model, otherwise the environment's (see
[Defaults and inheritance](./project-settings.md#defaults-and-inheritance)). If
neither is set, T3 Code refuses the launch and says why. Without `--project`, a
Lazurio Environment starts it in its Lazurio project. `--base main` starts it in
a new worktree from `main`, and `--existing-worktree <path>` in one you already
have.

`t3 thread send` delivers a message the way the composer does. With
`--mode auto`, the default, it starts an idle thread, steers a running turn or
queues behind it. `--mode queue` waits for its own turn, `--mode steer` goes
into the running turn, and `--mode restart` stops the turn and starts again with
your message. For a long message, pass `--message-file <path>`, or
`--message-file -` to read it from standard input.

## Questions and permission requests

```sh
t3 request list --json
t3 request respond 9a2d… --answer "Yes, deploy it" --json
t3 request approve 7c41… --json
t3 request deny 7c41… --json
```

`t3 request list` shows every question and permission request a thread waits
on, oldest first. A question with several parts takes
`--answers '{"<question id>": "..."}'`, with the ids `t3 request read` shows.
Approving and declining decide a request as its buttons in the app do.
`--for-session` allows it for the rest of the agent's session where the agent
offers that, and `t3 request deny --cancel` also stops the agent's turn.

## Follow changes

`t3 events` prints one JSON line for each thread in the sidebar, then a
`synced` line, with or without `--json`. With `--follow` it keeps going, and prints a line whenever a
thread starts or finishes a run, waits on a question or permission, is renamed,
settled, snoozed or archived, or leaves the list. Output that only streams in
does not print a line; read the thread for it. Shortened, two lines look like
this:

```json
{"kind":"thread","sequence":812,"threadId":"4f1c0b2e-…","title":"Fix the login redirect","status":"waiting","pendingRequest":{"requestId":"7c41…","kind":"command","type":"approval"},"projectId":"…","projectTitle":"web-app","archived":false,"settled":false,"snoozed":false,"lastError":null,"updatedAt":"2026-10-20T12:04:11.000Z"}
{"kind":"synced","sequence":812}
```

A thread's line has the same fields as an item of `t3 thread list`. A followed
stream reconnects by itself when T3 Code restarts and continues after the last
`sequence` it printed, so it always ends on each thread's latest state. A reader
that falls behind gets a thread's newest line rather than every step in between.
It says why it reconnected on standard error.

## An MCP token without a sign-in

An MCP client that cannot open the sign-in page can use a token issued on the
host. Choose the most the threads it starts or changes may run with:

```sh
t3 auth session issue --subject mcp-client --runtime-mode-ceiling auto-accept-edits --ttl 30d --token-only
```

Without `--runtime-mode-ceiling` such a token is capped at **Supervised**: it
cannot start or change a thread that runs with more. Revoke it in
**Settings → Connections** or with `t3 auth session revoke`.
