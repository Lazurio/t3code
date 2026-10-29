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
| Start a thread in the project of a folder            | `t3 thread start <folder or project> <message>`                                 |
| Message a thread, and wait for its reply             | `t3 thread send <thread> <message>`, with `--wait`                              |
| Show a thread's latest messages                      | `t3 thread show <thread>`                                                       |
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
`t3 thread start` and `t3 thread show` are T3 Code's own commands, described in
[Scripts on the host](./outside-agents.md#scripts-on-the-host); their output
and failures follow that guide rather than the next section.

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

A thread's `link` in the JSON of `t3 thread list` and `t3 events` has the form
`<t3-thread://v2/<environment>/<thread>>`, which T3 Code shows as a link to the thread.

| Exit code | Meaning                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------- |
| 0         | Done.                                                                                           |
| 1         | T3 Code refused or failed the request, the command line was invalid, or the awaited run failed. |
| 2         | `t3 thread send --wait`: the thread waits for an answer. It prints the thread's state.          |
| 3         | T3 Code is not running for this T3 home. Nothing was read or changed.                           |
| 4         | `t3 thread wait` timed out. It prints the thread's state, and the run goes on.                  |

A command is not retried for you. If one ends without an answer, check the
thread with `t3 thread read` or `t3 thread list` before you send it again, or
send with an idempotency key (below).

## Start and message threads

`t3 thread launch` gives the message to a new thread as its first task. The
thread starts with the model and permission mode a new thread in that project
starts with in the app: the project's own, otherwise the environment's (see
[Defaults and inheritance](./project-settings.md#defaults-and-inheritance)). If
no model is set, T3 Code refuses the launch and says why. Without `--project`, a
Lazurio Environment starts it in its Lazurio project. `--base main` starts it in
a new worktree from `main`, and `--existing-worktree <path>` in one you already
have.

`t3 thread send` delivers a message the way the composer does. With
`--mode queue`, the default, a busy thread gets it as its next turn and nothing
is interrupted. `--mode auto` starts an idle thread, steers a running turn or
queues behind it, `--mode steer` goes into the running turn, and
`--mode restart` stops the turn and starts again with your message. Pass `-` as
the message, or `--message-file -`, to read it from standard input, and
`--message-file <path>` to read it from a file.

`--wait` waits for the run your message starts and prints the agent's reply.
With `--json` it prints the send's result with the run's `status`, `reply` and
`error`. It exits 1 when the run fails or stops, and 2 when the agent waits for
an answer, which `t3 request list --thread <thread>` shows.

`--idempotency-key <key>` sends the message once per key, also when you run the
same command again later or after T3 Code restarts: a repeat sends nothing and
prints the first send's result, with the same `commandId`. Where T3 Code cannot
replay that result, for example because the thread was archived since, the
repeat prints `"delivery": "delivered"` with the message's `messageId`, `runId`
and `commandId`. A key belongs to its thread and to who sends: the same key sent
to another thread, or by another sender, is another message. T3 Code trims a
message, so spaces or a final newline around the same text do not make another
one. Use a key that names this one message, such as an id your script keeps
with it. With `--wait`, a repeat waits for the first send's run; a repeat that prints
`"delivery": "delivered"` has no run to wait for and ends there.

```sh
printf '%s' "$report" | t3 thread send 4f1c0b2e-… --message-file - --mode queue \
  --idempotency-key "report-$job_id" --json
```

With a key, a failure's code tells whether sending again can help. These
refusals are final: sending again as it is never helps, so fix the cause first.
After `idempotency_conflict` and `command_rejected` the key is spent, so send
with a new one; after the others the same key works once the cause is fixed.

| Code                                                                                        | Meaning                                                                      |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `idempotency_conflict`                                                                      | This key already sent another message to this thread. Nothing was sent.      |
| `command_rejected`                                                                          | T3 Code refused the message for this key. A key it refused stays refused.    |
| `thread_not_found`                                                                          | There is no such thread.                                                     |
| `thread_not_sendable`                                                                       | The thread is archived, or `--mode steer` found no running turn.             |
| `invalid_request`                                                                           | The command line or the message is invalid, or the thread's provider is off. |
| `capability_denied`, `runtime_mode_escalation_denied`, `interaction_mode_escalation_denied` | The command may not act on this thread.                                      |

Any other failure may pass, such as `server_not_running` (exit code 3),
`request_failed`, `auth_unavailable` or `orchestration_error`: send again later
with the same key, which never sends twice.

In Buddy's T3 Code on a Lazurio Environment, `t3 lazurio buddy thread --json`
prints Buddy's one thread as `{"threadId": "...", "projectId": "..."}`, and makes
it the first time anyone asks. It follows the output and exit codes above.

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

## Acting for you as your assistant

On a Lazurio Environment your assistant, Buddy, uses these commands for you. What
it sends or decides then shows **Buddy for <your name>** in the thread (in Czech
„Buddy za …“). A wake-up from Delegace, the service that wakes Buddy, does not show
in the thread at all: you see only Buddy's reply to it. Your own messages and
decisions show nothing new. The commands do this only when their environment says
who they act as:

```sh
T3CODE_ACTING_SENDER=buddy T3CODE_ACTING_FOR=Alena T3CODE_ACTING_FOR_ACCUSATIVE=Alenu \
  t3 thread send 4f1c0b2e-… "Run the tests first" --json
T3CODE_ACTING_SENDER=delegace t3 thread send 4f1c0b2e-… --mode queue --message-file - --json
```

`T3CODE_ACTING_SENDER` is `buddy` or `delegace`; there is no free label. With
`buddy`, `T3CODE_ACTING_FOR` is your name and `T3CODE_ACTING_FOR_ACCUSATIVE` its
Czech form after „za“, which Czech shows when it is set. Names are one line of at
most 64 characters. Any other value fails the command with `invalid_request`
before anything is read. Set the variables in the assistant's own environment,
never in T3 Code's service, whose agents would inherit them. The mark shows on
messages (`t3 thread launch`, `t3 thread send`) and on answers and decisions
(`t3 request respond`, `approve`, `deny`) in the web app. A message an agent sends
from outside the thread appears there once T3 Code knows who sent it, which takes
a moment.

## An MCP token without a sign-in

An MCP client that cannot open the sign-in page can use a token issued on the
host. Choose the most the threads it starts or changes may run with:

```sh
t3 auth session issue --subject mcp-client --runtime-mode-ceiling auto-accept-edits --ttl 30d --token-only
```

Without `--runtime-mode-ceiling` such a token is capped at **Supervised**: it
cannot start or change a thread that runs with more. Revoke it in
**Settings → Connections** or with `t3 auth session revoke`.
