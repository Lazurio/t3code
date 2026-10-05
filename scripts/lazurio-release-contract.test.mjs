// Contract for the Lazurio distribution files. Run with:
//   node --test scripts/lazurio-release-contract.test.mjs
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeTest from "node:test";

import { cliReleaseChannelOf } from "../packages/shared/src/cliRelease.ts";

const read = (path) => NodeFSP.readFile(path, "utf8");
const promptOverlay = [
  "apps/web/src/lazurio/LazurioPromptDraft.tsx",
  "apps/web/src/lazurio/promptDraft.test.ts",
  "apps/web/src/lazurio/promptDraft.ts",
  "apps/web/src/main.tsx",
  "apps/web/src/routes/_chat.tsx",
];
const environmentBrowserOverlay = [
  "apps/web/src/components/ChatView.tsx",
  "apps/web/src/components/RightPanelTabs.tsx",
  "apps/web/src/lazurio/LazurioEnvironmentBrowser.tsx",
  "apps/web/src/lazurio/agentBrowserSession.ts",
  "apps/web/src/lazurio/environmentBrowser.test.ts",
  "apps/web/src/lazurio/environmentBrowser.ts",
  "apps/web/src/rightPanelStore.ts",
];
const [release, archives, ci, dockerfile, dockerignore, docs, updateSource] = await Promise.all([
  read(".github/workflows/lazurio-release.yml"),
  read(".github/workflows/lazurio-cli-archives.yml"),
  read(".github/workflows/lazurio-fork-ci.yml"),
  read("Dockerfile.lazurio"),
  read(".dockerignore"),
  read("docs/operations/lazurio-fork-release.md"),
  read("apps/server/src/cli/update.ts"),
]);

NodeTest.test("release is manual, gated, and never overwrites", () => {
  const triggers = release.slice(release.indexOf("\non:"), release.indexOf("\npermissions:"));
  NodeAssert.match(triggers, /workflow_dispatch:/);
  NodeAssert.doesNotMatch(triggers, /^ {2}(push|schedule|release|pull_request\w*):/m);
  NodeAssert.match(release, /^permissions:\n {2}contents: read\n {2}id-token: none/m);
  NodeAssert.match(release, /environment: lazurio-t3code-release/);
  NodeAssert.match(release, /test "\$RELEASE_CONTROL" = "reviewed-v1"/);
  NodeAssert.match(release, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  NodeAssert.match(release, /RELEASE_TAG: v\$\{\{ inputs\.version \}\}/);
  NodeAssert.match(
    release,
    /test "\$\(git rev-parse refs\/remotes\/origin\/main\)" = "\$SOURCE_SHA"/,
  );
  NodeAssert.match(
    release,
    /git rev-list --merges "\$UPSTREAM_SHA\.\.\$SOURCE_SHA" --count\)" = 0/,
  );
  // Servers take the newest release on their own channel, so a release must be
  // the highest version on its channel; channels are compared as upstream derives them.
  NodeAssert.match(release, /cliReleaseChannelOf\(published\) !== channel\) continue;/);
  NodeAssert.match(release, /compareExactServiceVersions\(version, published\) <= 0/);
  NodeAssert.match(release, /already exists and will not be overwritten/);
  // After approval: live main must still be the source, and only the release
  // App, whose key is an environment secret, creates the tag.
  NodeAssert.match(release, /main moved away from \$SOURCE_SHA since dispatch/);
  NodeAssert.match(release, /vars\.LAZURIO_RELEASE_APP_ID != ''/);
  NodeAssert.match(release, /secrets\.LAZURIO_RELEASE_APP_PRIVATE_KEY != ''/);
  NodeAssert.match(release, /uses: actions\/create-github-app-token@[0-9a-f]{40}/);
  NodeAssert.match(release, /owner: Lazurio\n {10}repositories: t3code\n/);
  NodeAssert.match(release, /GH_TOKEN: \$\{\{ steps\.release_app\.outputs\.token \}\}/);
  NodeAssert.match(release, /--method POST "repos\/\$GITHUB_REPOSITORY\/git\/refs"/);
  NodeAssert.doesNotMatch(release, /--force|LAZURIO_RELEASE_TAG_KEY|sshCommand/);
  NodeAssert.match(release, /--verify-tag/);
  NodeAssert.match(release, /uses: \.\/\.github\/workflows\/lazurio-cli-archives\.yml/);
  NodeAssert.match(release, /needs: \[verify, archives\]/);
  NodeAssert.match(release, /sha256sum t3-\*\.tar\.gz > SHA256SUMS/);
  NodeAssert.match(
    release,
    /subject-path: release-assets\/t3-\$\{\{ inputs\.version \}\}-linux-x64\.tar\.gz/,
  );
  NodeAssert.match(
    release,
    /subject-path: release-assets\/t3-\$\{\{ inputs\.version \}\}-darwin-arm64\.tar\.gz/,
  );
  NodeAssert.match(release, /grep -Fx 'T3CODE_CLIENT_SESSION_TTL=365d'/);
  NodeAssert.match(release, /base_path: "\/"/);
  NodeAssert.doesNotMatch(release, /:\s*latest\b/);
});

// Only the two upstream channel shapes are releasable: stable X.Y.Z-lazurio.N and
// preview X.Y.Z-preview.YYYYMMDD.N, both on the exact upstream base X.Y.Z.
const versionPattern = new RegExp(/\[\[ "\$VERSION" =~ (\S+) \]\]/.exec(release)?.[1] ?? "(?!)");

NodeTest.test("release accepts only upstream stable-train and preview versions", () => {
  for (const version of ["0.0.43-lazurio.1", "0.0.43-lazurio.12", "0.0.43-preview.20260929.1"]) {
    NodeAssert.match(version, versionPattern, version);
    // The workflow's CHANNEL expression must agree with upstream's rule.
    const workflowChannel = version.includes("-preview.") ? "preview" : "stable";
    NodeAssert.equal(cliReleaseChannelOf(version), workflowChannel, version);
  }
  for (const version of [
    "0.0.43",
    "0.0.43-lazurio.0",
    "0.0.43-preview.20260929.0",
    "0.0.43-preview.2026092.1",
    "0.0.43-nightly.20260929.1",
    "0.0.43-lazurio.1+build",
  ]) {
    NodeAssert.doesNotMatch(version, versionPattern, version);
  }
  NodeAssert.match(release, /\[\[ "\$VERSION" == "\$\{UPSTREAM_TAG#v\}-"\* \]\]/);
  NodeAssert.match(
    release,
    /CHANNEL: \$\{\{ contains\(inputs\.version, '-preview\.'\) && 'preview' \|\| 'stable' \}\}/,
  );
});

NodeTest.test("the archive build accepts every releasable version and CI's -lazurio.0", () => {
  const archivePattern = new RegExp(/\[\[ "\$VERSION" =~ (\S+) \]\]/.exec(archives)?.[1] ?? "(?!)");
  for (const version of [
    "0.0.43-lazurio.0",
    "0.0.43-lazurio.1",
    "0.0.43-preview.20260929.1",
    "0.0.43-preview.20260929.12",
  ]) {
    NodeAssert.match(version, archivePattern, version);
  }
  for (const version of ["0.0.43", "0.0.43-nightly.20260929.1"]) {
    NodeAssert.doesNotMatch(version, archivePattern, version);
  }
});

NodeTest.test("the launcher smoke passes the real preview consent prompt in a TTY", () => {
  const prompt = /prompt = b"([^"]+)"/.exec(archives)?.[1];
  NodeAssert.ok(prompt, "the smoke must answer a named prompt");
  // The exact upstream prompt, so a changed prompt fails here instead of hanging in CI.
  NodeAssert.ok(updateSource.includes(`message: "${prompt}"`), prompt);
  NodeAssert.match(archives, /pid, fd = pty\.fork\(\)/);
  NodeAssert.match(archives, /\[\[ "\$VERSION" == \*-preview\.\* \]\] && expect_prompt=1/);
  NodeAssert.match(archives, /a stable target must not ask for preview consent/);
  NodeAssert.match(archives, /a preview target must ask for consent before installing/);
});

NodeTest.test("a preview is a GitHub pre-release and never latest; stable is latest", () => {
  NodeAssert.match(
    release,
    /if \[\[ "\$CHANNEL" == preview \]\]; then\n\s+channel_flags=\(--prerelease --latest=false\)\n\s+else\n\s+channel_flags=\(--latest\)\n/,
  );
  NodeAssert.match(release, /"\$\{channel_flags\[@\]\}"/);
  NodeAssert.match(release, /releases\/latest" --jq \.tag_name\)" != "\$RELEASE_TAG"/);
  NodeAssert.doesNotMatch(release, /^\s+--latest \\$/m);
});

NodeTest.test("archives are built with upstream's own release steps", () => {
  NodeAssert.match(archives, /on:\n {2}workflow_call:/);
  NodeAssert.match(archives, /^permissions:\n {2}contents: read\n {2}id-token: none/m);
  NodeAssert.match(archives, /key: linux-x64\n {12}runner: ubuntu-24\.04/);
  NodeAssert.match(archives, /key: darwin-arm64\n {12}runner: macos-15/);
  const stamp = archives.indexOf('node scripts/update-release-package-versions.ts "$VERSION"');
  NodeAssert.ok(stamp > 0 && stamp < archives.indexOf("vp run --filter t3 build"));
  NodeAssert.match(archives, /node apps\/server\/scripts\/cli\.ts build-exe/);
  NodeAssert.match(archives, /node scripts\/build-cli-archive\.ts/);
  NodeAssert.match(archives, /node scripts\/smoke-cli-archive\.ts .* --expect-version "\$VERSION"/);
  NodeAssert.match(archives, /T3CODE_RELEASE_BASE_URL=http:\/\/127\.0\.0\.1:8765/);
  NodeAssert.match(archives, /__service-preflight/);
  for (const source of [archives, release, ci]) {
    for (const [, action] of source.matchAll(/uses: ([^\s.][^\s]*)/g)) {
      NodeAssert.match(action, /@[0-9a-f]{40}$/, `${action} must be pinned by commit`);
    }
  }
});

NodeTest.test("CI is read-only and pins the exact upstream base", () => {
  NodeAssert.match(ci, /^permissions:\n {2}contents: read\n {2}id-token: none/m);
  NodeAssert.match(ci, /name: Server and web compatibility/);
  NodeAssert.match(ci, /UPSTREAM_TAG: v0\.0\.45/);
  NodeAssert.match(ci, /UPSTREAM_SHA: 6c8fed35dded9ff71c5b46807125457acbb76be6/);
  NodeAssert.match(ci, /\^\(apps\/\(web\|mobile\|desktop\)\|packages\)\//);
  const upstreamVersion = /UPSTREAM_TAG: v(\S+)/.exec(ci)?.[1];
  NodeAssert.match(
    ci,
    new RegExp(`version: ${upstreamVersion?.replaceAll(".", "\\.")}-lazurio\\.0\\n`),
  );
});

NodeTest.test("image is root-served, non-root, and self-checks its terminal", () => {
  NodeAssert.match(
    dockerfile,
    /node scripts\/update-release-package-versions\.ts "\$PACKAGE_VERSION"/,
  );
  NodeAssert.match(dockerfile, /pnpm install --frozen-lockfile/);
  NodeAssert.match(dockerfile, /pnpm --filter t3 deploy --prod --legacy --ignore-scripts/);
  NodeAssert.match(dockerfile, /lazurio-pty-ok/);
  NodeAssert.match(dockerfile, /T3CODE_CLIENT_SESSION_TTL=365d/);
  NodeAssert.match(dockerfile, /USER 10001:10001/);
  NodeAssert.match(dockerfile, /CMD \["serve", "--host", "127\.0\.0\.1"\]/);
});

NodeTest.test("T3 is served at the root; no mount path or branding overlay remains", () => {
  for (const source of [release, archives, ci, dockerfile]) {
    NodeAssert.doesNotMatch(source, /T3CODE_BASE_PATH|VITE_HOSTED_APP_NAME/);
  }
  NodeAssert.match(docs, /v kořeni vlastního hostname/);
});

NodeTest.test("the image build context excludes local state and secrets", () => {
  const patterns = new Set(
    dockerignore
      .split("\n")
      .map((line) => line.trim().replace(/\/$/, ""))
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );
  for (const pattern of [
    ".git",
    ".t3",
    ".env*",
    "**/.env*",
    ".npmrc",
    ".netrc",
    "**/node_modules",
  ]) {
    NodeAssert.ok(patterns.has(pattern), `.dockerignore must exclude ${pattern}`);
  }
});

NodeTest.test("the overlay may change only listed upstream client and shared files", async () => {
  NodeAssert.match(ci, /grep -E '\^\(apps\/\(web\|mobile\|desktop\)\|packages\)\/'/);
  NodeAssert.match(ci, /grep -vxF -f <\(printf '%s\\n' "\$\{allowed_upstream_changes\[@\]\}"\)/);
  NodeAssert.match(ci, /if \[ -n "\$unexpected" \]; then[^]*?exit 1/);
  const list = /allowed_upstream_changes=\(\n([^]*?)\n\s*\)\n/.exec(ci)?.[1];
  NodeAssert.ok(list, "the guard must declare allowed_upstream_changes");
  const lines = list.split("\n").map((line) => line.trim());
  NodeAssert.match(lines[0] ?? "", /^# \S/, "the allowlist must open with a reason");
  const entries = lines.filter((line) => line.length > 0 && !line.startsWith("#"));
  NodeAssert.ok(entries.length > 0);
  for (const entry of entries) {
    // Exact files only: no globs, directories or patterns.
    NodeAssert.match(entry, /^(apps\/(web|mobile|desktop)|packages)\/[\w./-]+\.[a-z]+$/, entry);
    NodeAssert.doesNotMatch(entry, /[*?[\]{}]|\.\.|\/$/, entry);
    await NodeFSP.access(entry);
  }
  NodeAssert.equal(new Set(entries).size, entries.length, "allowlist entries must be unique");
});

// Lazurio/t3code#35: the Lazurio shell opens Chat with a prompt id and an
// Organization login in the link; the overlay fetches the text from its own
// origin and leaves it unsent in a new thread's composer. The seam is two
// lines in upstream files, so a rebase onto a new upstream tag that loses
// either fails here.
NodeTest.test("the prompt hand-off overlay keeps its seam and never sends", async () => {
  const [main, chatLayout, promptDraft, component] = await Promise.all(
    [
      "apps/web/src/main.tsx",
      "apps/web/src/routes/_chat.tsx",
      "apps/web/src/lazurio/promptDraft.ts",
      "apps/web/src/lazurio/LazurioPromptDraft.tsx",
    ].map(read),
  );
  // The link leaves the address before the router or the pairing read it.
  const capture = main.indexOf("\ncaptureLazurioPromptLink();\n");
  NodeAssert.ok(capture > 0, "main.tsx must capture the prompt link");
  NodeAssert.ok(capture < main.indexOf("createBrowserHistory()"), "capture before the history");
  NodeAssert.ok(capture < main.indexOf("getRouter(history)"), "capture before the router");
  // The chat layout, which renders only once the environment is signed in, opens it.
  NodeAssert.match(chatLayout, /<LazurioPromptDraft \/>/);
  // Text only from this origin's /.lazurio/prompts/<id>, never from the link.
  NodeAssert.match(
    promptDraft,
    /new URL\(`\/\.lazurio\/prompts\/\$\{encodeURIComponent\(link\.id\)\}`, origin\)/,
  );
  NodeAssert.match(promptDraft, /credentials: "same-origin"/);
  NodeAssert.match(promptDraft, /redirect: "error"/);
  NodeAssert.match(component, /origin: window\.location\.origin/);
  // Nothing here can start a turn: it only writes the composer draft.
  for (const source of [promptDraft, component]) {
    NodeAssert.doesNotMatch(source, /turn\.start|startTurn|dispatchCommand|queuedMessage|onSend/);
  }
  NodeAssert.match(component, /\.setPrompt\(draftId, text\)/);
  // Every overlay file is a reviewed allowlist entry.
  for (const file of promptOverlay) {
    NodeAssert.match(ci, new RegExp(`\\n {12}${file.replaceAll(".", "\\.")}\\n`), file);
  }
  NodeAssert.match(ci, /working-directory: apps\/web\n\s+run: pnpm exec vp test run src\/lazurio/);
});

NodeTest.test("the Lazurio shell slot survives a rebuild on a new upstream tag", async () => {
  const [page, layout, sidebarUi] = await Promise.all([
    read("apps/web/index.html"),
    read("apps/web/src/components/AppSidebarLayout.tsx"),
    read("apps/web/src/components/ui/sidebar.tsx"),
  ]);
  // Same-origin loader that Vite leaves alone; the Environment's Launchpad serves it.
  NodeAssert.match(
    page,
    /<script type="module" src="\/\.lazurio\/shell\.js" vite-ignore><\/script>/,
  );
  // Padding, not margin: #root is full width under an overflow-hidden body.
  NodeAssert.match(
    page,
    /#root \{\s*box-sizing: border-box;\s*padding-left: var\(--lazurio-rail-width, 0px\);\s*\}/,
  );
  // T3's sidebar and its toggle are position: fixed, so padding alone leaves them under the
  // rail; with the shell present, the sidebar wrapper becomes their containing block.
  NodeAssert.match(
    page,
    /lazurio-rail:defined ~ #root \[data-slot="sidebar-wrapper"\] \{\s*contain: layout paint;\s*\}/,
  );
  NodeAssert.match(sidebarUi, /data-slot="sidebar-wrapper"/);
  NodeAssert.match(
    page,
    /<body>\s*<lazurio-rail data-app-sidebar><\/lazurio-rail>\s*<div id="root">/,
  );
  NodeAssert.match(
    page,
    /<\/div>\s*<lazurio-buddy><\/lazurio-buddy>\s*<script type="module" src="\/src\/bootstrap\.ts"><\/script>\s*<\/body>/,
  );
  // The column head is the sidebar's first child, above the upstream top row, for the thread,
  // legacy and settings sidebars alike; the toggle moves down with that row.
  NodeAssert.match(
    layout,
    /\n\s*>\n(?:\s*\{\/\*[^\n]*\*\/\}\n)?\s*\{createElement\("lazurio-column-head", \{\s*active: "chat",\s*ref: observeLazurioColumnHead,?\s*\}\)\}\n\s*\{isOnSettings \? \(/,
  );
  NodeAssert.equal(layout.match(/lazurio-column-head/g)?.length, 1);
  NodeAssert.match(
    layout,
    /<SidebarControl lazurioColumnHeadHeight=\{lazurioColumnHeadHeight\} \/>/,
  );
  NodeAssert.match(
    layout,
    /new ResizeObserver\(\(\) => setLazurioColumnHeadHeight\(element\.offsetHeight\)\)/,
  );
  NodeAssert.match(
    layout,
    /isSidebarVisible && !isMobile && lazurioColumnHeadHeight > 0\s*\?\s*\{ top: `calc\(var\(--workspace-controls-top\) \+ \$\{lazurioColumnHeadHeight\}px\)` \}/,
  );
});

NodeTest.test("the Lazurio shell takes T3's sidebar colours through the colour roles", async () => {
  const [page, styles, layout] = await Promise.all([
    read("apps/web/index.html"),
    read("apps/web/src/index.css"),
    read("apps/web/src/components/AppSidebarLayout.tsx"),
  ]);
  // The roles name T3's own tokens, so they follow every theme, light and dark, live. They are
  // declared where T3 recomputes its sidebar palette, so they resolve against the sidebar's values.
  const roles = page.match(/\n\s*:root,\s*\[data-app-sidebar\] \{([^}]*)\}/)?.[1] ?? "";
  const tokens = {
    surface: "var\\(--sidebar\\)",
    ink: "var\\(--contrast-sidebar-foreground\\)",
    "ink-muted": "var\\(--contrast-sidebar-muted-foreground\\)",
    line: "var\\(--contrast-sidebar-border\\)",
    "line-strong":
      "color-mix\\(\\s*in oklab,\\s*var\\(--contrast-sidebar-foreground\\) 24%,\\s*var\\(--sidebar\\)\\s*\\)",
    hover: "var\\(--sidebar-row-hover\\)",
    selected: "var\\(--sidebar-row-selected\\)",
    control: "var\\(--sidebar-control-surface\\)",
    raised: "var\\(--sidebar-row-active\\)",
    overlay: "var\\(--popover\\)",
    "overlay-ink": "var\\(--contrast-popover-foreground\\)",
    focus: "var\\(--ring\\)",
  };
  for (const [role, token] of Object.entries(tokens)) {
    NodeAssert.match(roles, new RegExp(`--lazurio-${role}: ${token};`), role);
  }
  NodeAssert.equal(roles.match(/--lazurio-/g)?.length, Object.keys(tokens).length);
  // The rail joins T3's sidebar palette scope, so it reads as one surface with the sidebar beside
  // it (the default dark sidebar is darker than the document's own --sidebar), grain included.
  NodeAssert.match(page, /<lazurio-rail data-app-sidebar><\/lazurio-rail>/);
  NodeAssert.match(
    page,
    /lazurio-rail:defined \{\s*background-image: var\(--surface-grain\);\s*background-repeat: repeat;\s*background-size: var\(--surface-grain-size\);\s*\}/,
  );
  // A rebuild on a new upstream tag keeps every token the roles name, the sidebar palette scope
  // and its contrast recomputation.
  for (const token of [
    "--sidebar",
    "--contrast-sidebar-foreground",
    "--contrast-sidebar-muted-foreground",
    "--contrast-sidebar-border",
    "--sidebar-row-hover",
    "--sidebar-row-selected",
    "--sidebar-control-surface",
    "--sidebar-row-active",
    "--popover",
    "--contrast-popover-foreground",
    "--ring",
    "--surface-grain",
    "--surface-grain-size",
  ]) {
    NodeAssert.match(styles, new RegExp(`\\n\\s*${token}: `), token);
  }
  NodeAssert.match(styles, /\n\[data-app-sidebar\] \{\n\s*--background: /);
  NodeAssert.match(styles, /\n:root,\n\[data-app-sidebar\] \{\n\s*--contrast-/);
  NodeAssert.match(layout, /\n\s*data-app-sidebar=""\n/);
  // With the rail in that scope, a script lookup of [data-app-sidebar] would find the rail first.
  // Upstream uses the attribute only as a CSS scope; a rebuild that starts querying it is a review.
  const sources = (await NodeFSP.readdir("apps/web/src", { recursive: true })).filter((file) =>
    /\.tsx?$/.test(file),
  );
  const users = [];
  for (const file of sources) {
    if ((await read(`apps/web/src/${file}`)).includes("data-app-sidebar")) users.push(file);
  }
  NodeAssert.deepEqual(users, ["components/AppSidebarLayout.tsx"]);
});

// Root decision 0191 (plan DEV-6646): the agents of every thread drive a window of their own in
// the Environment browser through the agent-browser CLI, which takes the session from
// AGENT_BROWSER_SESSION. Every adapter spreads the provider session ProviderService records for a
// thread into the processes it starts for that thread, so the thread's session joins it there.
NodeTest.test(
  "every provider process of a thread gets the thread's agent-browser session",
  async () => {
    const [providerService, session] = await Promise.all([
      read("apps/server/src/provider/Layers/ProviderService.ts"),
      import("../apps/server/src/lazurio/agentBrowserSession.ts"),
    ]);
    NodeAssert.equal(session.AGENT_BROWSER_SESSION_ENV, "AGENT_BROWSER_SESSION");
    NodeAssert.match(
      providerService,
      /McpProviderSession\.setMcpProviderSession\(\n(?:\s*\/\/[^\n]*\n)?\s*withAgentBrowserSession\(\{\n\s*\.\.\.credential\.config,/,
    );
    NodeAssert.equal(providerService.match(/withAgentBrowserSession\(/g)?.length, 1);
    NodeAssert.match(
      ci,
      /working-directory: apps\/server\n\s+run: pnpm exec vp test run src\/lazurio\n/,
    );
  },
);

// The web asks the Environment for the view of the thread's session. packages/shared's export
// map is upstream-hot, so the server and the web each have a copy of the name; one function.
NodeTest.test("the server and the web name a thread's agent-browser session alike", async () => {
  const [server, web] = await Promise.all([
    import("../apps/server/src/lazurio/agentBrowserSession.ts"),
    import("../apps/web/src/lazurio/agentBrowserSession.ts"),
  ]);
  for (const threadId of [
    "4a1f9c2e-7b3d-4e5f-8a6b-9c0d1e2f3a4b",
    "thread.with:colons/and/slashes",
    "vlákno-č",
    "emoji-\u{1F642}",
    "x".repeat(100),
    `import:codex-${"w".repeat(58)}:019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a70`,
    `import:codex-${"w".repeat(58)}:f64cccd6-59c8-42a7-aa0e-319969aeccc9`,
    `import:codex-${"w".repeat(58)}:3c4a8834-35dc-418d-a6dd-d8d1934ab83f`,
    "",
  ]) {
    const name = server.agentBrowserSessionName(threadId);
    NodeAssert.equal(web.agentBrowserSessionName(threadId), name, threadId);
    // agent-browser's grammar and its dashboard's 64 characters.
    NodeAssert.match(name, /^t3-[A-Za-z0-9_-]{0,61}$/, threadId);
  }
  NodeAssert.equal(
    web.agentBrowserSessionName.toString(),
    server.agentBrowserSessionName.toString(),
  );
  // The pair whose 32-bit suffixes once collided gets two sessions on both sides.
  const pair = [
    `import:codex-${"w".repeat(58)}:f64cccd6-59c8-42a7-aa0e-319969aeccc9`,
    `import:codex-${"w".repeat(58)}:3c4a8834-35dc-418d-a6dd-d8d1934ab83f`,
  ];
  NodeAssert.notEqual(
    server.agentBrowserSessionName(pair[0]),
    server.agentBrowserSessionName(pair[1]),
  );
});

// The web client has no browser: without the desktop preview, the right panel's Browser frames
// the Environment browser's view that the Environment names at /.lazurio/browser.json.
NodeTest.test("the Environment browser keeps its seams and never stores the view", async () => {
  const [store, tabs, chatView, view, component] = await Promise.all(
    [
      "apps/web/src/rightPanelStore.ts",
      "apps/web/src/components/RightPanelTabs.tsx",
      "apps/web/src/components/ChatView.tsx",
      "apps/web/src/lazurio/environmentBrowser.ts",
      "apps/web/src/lazurio/LazurioEnvironmentBrowser.tsx",
    ].map(read),
  );
  // A surface kind of its own: preview reconciliation drops preview tabs without a server tab.
  NodeAssert.match(store, /\| \{ id: "environment-browser"; kind: "environment-browser" \}/);
  NodeAssert.match(
    store,
    /case "environment-browser":\n\s+return \{ id: "environment-browser", kind \};/,
  );
  NodeAssert.match(tabs, /case "environment-browser":\n\s+return "Browser";/);
  NodeAssert.match(
    tabs,
    /const browserProfiles = previewBridge \? browserDefaults\.profiles : \[\];/,
  );
  // The desktop preview stays first; the Environment browser only where the Environment offers it.
  NodeAssert.equal(
    chatView.match(
      /browserAvailable=\{isPreviewSupportedInRuntime\(\) \|\| environmentBrowser\.available\}/g,
    )?.length,
    2,
  );
  NodeAssert.equal(
    chatView.match(
      /environmentBrowser\.available \? environmentBrowser\.open : \(\) => createBrowserSurface\(\)/g,
    )?.length,
    2,
  );
  NodeAssert.match(
    chatView,
    /renderedRightPanelSurface\?\.kind === "environment-browser" \? \(\n\s+<LazurioEnvironmentBrowser /,
  );
  NodeAssert.match(
    component,
    /threadRef\.environmentId === primaryEnvironmentId &&\n\s+!isPreviewSupportedInRuntime\(\)/,
  );
  // The view only from this origin's /.lazurio/browser.json, and only at an https: URL.
  NodeAssert.match(view, /const BROWSER_VIEW_PATH = "\/\.lazurio\/browser\.json";/);
  NodeAssert.match(view, /new URL\(BROWSER_VIEW_PATH, origin\)/);
  NodeAssert.match(
    view,
    /if \(response\.status !== 200 \|\| new URL\(response\.url\)\.origin !== url\.origin\)/,
  );
  NodeAssert.match(view, /credentials: "same-origin"/);
  NodeAssert.match(view, /redirect: "error"/);
  NodeAssert.match(view, /cache: "no-store"/);
  NodeAssert.match(view, /if \(viewUrl\.protocol !== "https:"\) return null;/);
  // allow-same-origin confines the framed view only while it is on another origin.
  NodeAssert.match(view, /if \(viewUrl\.origin === pageOrigin\) return null;/);
  NodeAssert.match(
    component,
    /fetchEnvironmentBrowser\(agentBrowserSessionName\(threadId\), window\.location\.origin,/,
  );
  // The frame, and the way out of it when the gateway's sign-in cannot render in a frame.
  NodeAssert.match(component, /allow="clipboard-read; clipboard-write; fullscreen"/);
  NodeAssert.match(
    component,
    /sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"/,
  );
  NodeAssert.match(component, /<a href=\{view\.view\} target="_blank" rel="noopener" \/>/);
  // The URL carries an access token: it lives in component state only.
  for (const source of [view, component]) {
    NodeAssert.doesNotMatch(source, /localStorage|sessionStorage|persist\(|ClientSettings/);
  }
  for (const file of environmentBrowserOverlay) {
    NodeAssert.match(ci, new RegExp(`\\n {12}${file.replaceAll(".", "\\.")}\\n`), file);
  }
  NodeAssert.match(
    ci,
    /working-directory: apps\/web\n\s+run: pnpm exec vp test run src\/lazurio\n/,
  );
});
