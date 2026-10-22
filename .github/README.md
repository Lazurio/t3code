# Lazurio T3 Code

Lazurio T3 Code is a modified distribution of [T3 Code](https://github.com/pingdotgg/t3code) and
the Chat app of [Lazurio](https://github.com/Lazurio). It is T3 Code's server and web client, built
from upstream's stable releases with a Lazurio overlay on top, for Lazurio Environments.

It is not an official T3 Code release, and the T3 Code team does not support it. Report problems
with it here, not upstream (see [Reporting issues](#reporting-issues)).

## How it differs from T3 Code

### The browser works differently

This is the biggest difference.

In upstream T3 Code, the desktop app has its own preview browser, and the T3 Code server runs a
headless browser of its own for the web and mobile apps, in fresh contexts without your sign-ins.

In Lazurio T3 Code's web client, the browser is the **Environment browser**: one Chromium with one
persistent profile that runs on the Lazurio Environment itself. Every app, chat and agent of the
Environment shares it, and its sign-ins with it. On a Lazurio Environment the server's own browser
never starts, so the Environment browser is the web client's only browser.

- The right panel shows a thread's tabs in that browser. Each one is a live view of a remote tab,
  which keeps running when you close the page. Every device shows the same tabs of a thread.
- A thread's agents work in their own window of that browser, through the `agent-browser` CLI or
  T3 Code's own browser tools (`preview_open`, `preview_snapshot`, `preview_click` and the rest).
  You can watch them and work in the same tab at the same time, for example to sign in or to
  solve a CAPTCHA. Nothing is handed over.
- "+" opens a New tab page with an address bar, T3 Code's tools and an overview of the
  Environment's open tabs.
- Closing a tab lets go of it for this thread, with an undo. The remote tab stays open while an
  agent works in it or another place holds it. Archiving or deleting a thread lets go of its tabs.
- A link to a tab of another Lazurio Environment opens as a marked tab of that Environment.

The official desktop and mobile apps are upstream's and unmodified. Connected to a Lazurio
Environment, the desktop app keeps its own browser and the mobile app shows no browser.

### The Lazurio Folder project

On a Lazurio Environment, Chat starts in the Environment's Lazurio Folder. The server creates or
adopts the Folder as a project when it starts, new chats start in it, and a short welcome explains
it. Earlier conversations stay as history. The model the Environment recommends is the Lazurio
project's default model (Settings → General, with the Lazurio project selected); a model you choose
there stays yours.

### Other changes

- **The name and the look.** The app calls itself "T3 Code (Lazurio)", and its wordmark and icons
  stay T3 Code's. On a Lazurio Environment, T3 Code's standard light theme takes the Lazurio
  design system's colours, font and radii from tokens the Environment's shell declares. A theme
  you pick and the dark theme stay T3 Code's own.
- **Lazurio shell.** The Environment rail, the app switcher at the top of the sidebar and Buddy
  load at runtime from the Environment. Outside Lazurio, nothing extra renders.
- **Prepared prompts.** Lazurio can open Chat with a prepared prompt in a new thread's message
  box. It is never sent on its own.
- **Signing in to Codex and Claude.** On a Lazurio Environment they sign in with their own CLIs from
  the Environment's Getting started page, so the sign-in works for T3 Code, the terminal and every
  agent alike. T3 Code's own ChatGPT sign-in is not offered there.
- **Pairing.** A Lazurio Environment pairs your browser itself: however you open Chat, a browser
  without a session signs in without a pairing token and stays on the page you opened, and a
  browser paired with an older release pairs again. **Settings → Connections** shows your
  authorized clients; on an Environment in your tailnet you create pairing links there for the
  desktop and mobile apps. The Environment's pairing never lets a browser manage T3 Connect.
- **Hosting behind a reverse proxy.** `T3CODE_EXTERNAL_ORIGIN` serves T3 Code at the root of its
  own HTTPS hostname with a Secure session cookie, `T3CODE_CLIENT_SESSION_TTL` sets how long a
  paired browser stays signed in, and `T3CODE_ENVIRONMENT_LABEL` names the Environment.
- **Buddy's chat.** With `T3CODE_LAZURIO_BUDDY=1`, a T3 Code server is Buddy's chat on a person's
  Osobní Prostředí. Its provider instance `buddy` runs Buddy's Hermes Agent over ACP and gets only
  what the person sends: their words, their attachments and the page they ask from, never T3
  Code's own instructions. The web client is Buddy's one conversation: one thread with its days
  beside it, no thread list, forks or rollbacks, and a message sent during a turn steers it. In
  Buddy's bubble it talks to the page around it through the bubble's `lazurio.buddy.*` messages,
  and that page travels with the person's message as a chip they can remove.
- **Updates from this repository.** The server offers the newest release of this repository and
  installs it with the Update button, and `t3 update` and the install scripts take it from here
  too. `T3CODE_RELEASE_REPOSITORY=owner/name` picks another repository's releases. After the
  update, the `t3` command follows the version the server runs.

Apart from the name and the release repository, each change stays off until its setting is
present or the page runs on a Lazurio Environment. Without them, the server and the web client
behave like upstream T3 Code; agent processes and thread terminals still get an
`AGENT_BROWSER_SESSION` variable, which does nothing on its own, and a page served over HTTPS
without a session first asks its own origin whether Lazurio pairs it.

## Tracking upstream

`main` is an exact upstream stable release tag with the Lazurio overlay commits on top, and nothing
else. When upstream publishes a new stable release, a daily check opens an issue in this repository
that tracks the move: the overlay is rebuilt on the new release, one commit per change, and every
change upstream now covers is dropped. Changes that would help everyone are offered upstream.

## Releases

Releases are on this repository's [Releases](https://github.com/Lazurio/t3code/releases) page, and
Lazurio Environments install and update from there.

- **Stable:** `X.Y.Z-lazurio.N`, tagged `vX.Y.Z-lazurio.N`. `X.Y.Z` is the upstream release it is
  built on, and `N` counts the releases on that base.
- **Preview:** `X.Y.Z-preview.YYYYMMDD.N`. A preview is a canary: it is never offered as an
  update, and you install one on purpose with `t3 update <version>`.

Each release has CLI archives for `linux-x64` and `darwin-arm64`, a `SHA256SUMS` file, build
provenance attestations and the OCI image `ghcr.io/lazurio/t3code:<version>`.

## Reporting issues

Report problems with Lazurio T3 Code in this repository's
[issues](https://github.com/Lazurio/t3code/issues), especially anything about the Environment
browser, the Lazurio Folder or the other changes above. Please don't report them to the T3 Code
team. If a problem also happens in upstream T3 Code, report it upstream too.

Report security problems privately: on this repository's **Security** tab, choose
**Report a vulnerability**.

## Credit and license

Lazurio T3 Code is built on [T3 Code](https://github.com/pingdotgg/t3code) by T3 Tools Inc. and its
contributors. T3 Code is licensed under the MIT License, and so are the Lazurio changes: see
[LICENSE](../LICENSE), which keeps upstream's copyright notice. Every image and CLI archive ships
that licence. Upstream's own README is [README.md](../README.md).
