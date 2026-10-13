// Contract for the Lazurio distribution files. Run with:
//   node --test scripts/lazurio-release-contract.test.mjs
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
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
  "apps/web/src/lazurio/LazurioEnvironmentBrowser.test.tsx",
  "apps/web/src/lazurio/LazurioEnvironmentBrowser.tsx",
  "apps/web/src/lazurio/LazurioNewTab.test.tsx",
  "apps/web/src/lazurio/LazurioNewTab.tsx",
  "apps/web/src/lazurio/browserView.ts",
  "apps/web/src/lazurio/environmentBrowser.test.ts",
  "apps/web/src/lazurio/environmentBrowser.ts",
  "apps/web/src/lazurio/threadTabs.test.ts",
  "apps/web/src/lazurio/threadTabs.ts",
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

// Fork CI tests what the overlay changes, derived from the diff against the exact upstream base: a
// new seam's tests run without editing the workflow, however its steps are laid out. A fixed gate
// keeps every test fork CI ran before the derivation, among them the directories whose tests import
// overlay seams without being changed; a workflow edit that drops one of these paths fails here.
const oldTestGate = [
  "apps/server/src/auth",
  "apps/server/src/cli/config.test.ts",
  "apps/server/src/environment/ServerEnvironmentLabel.test.ts",
  "apps/server/src/lazurio",
  "apps/server/src/orchestration/Layers/OrchestrationEngine.test.ts",
  "apps/server/src/server.test.ts",
  "apps/server/src/serverSettings.test.ts",
  "apps/server/src/vcs/VcsProvisioningService.test.ts",
  "apps/web/src/lazurio",
];

NodeTest.test(
  "CI runs the tests of everything the overlay changes and of the fixed gate",
  async () => {
    NodeAssert.match(
      ci,
      /git diff --name-only --diff-filter=d "\$UPSTREAM_SHA\.\.HEAD" -- '\*\.ts' '\*\.tsx'/,
    );
    // Every test file the overlay adds or changes, and upstream's own test beside each file it changes.
    NodeAssert.match(ci, /\*\.test\.ts \| \*\.test\.tsx\) echo "\$file" ;;/);
    NodeAssert.match(
      ci,
      /for test in "\$\{file%\.\*\}\.test\.ts" "\$\{file%\.\*\}\.test\.tsx"; do/,
    );
    // Every test under each gate path, whatever the diff says; a path that is gone or holds no tests
    // fails the step.
    const gate = (/\n\s+gate=\(\n([^]*?)\n\s*\)\n/.exec(ci)?.[1] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    for (const path of oldTestGate) {
      NodeAssert.ok(gate.includes(path), `the test gate must keep ${path}`);
    }
    for (const path of gate) {
      await NodeFSP.access(path);
    }
    NodeAssert.match(ci, /for path in "\$\{gate\[@\]\}"; do/);
    NodeAssert.match(
      ci,
      /gated="\$\(git ls-files -- "\$path" \| grep -E '\\\.test\\\.tsx\?\$' \|\| true\)"/,
    );
    NodeAssert.match(ci, /if \[ -z "\$gated" \]; then[^]*?exit 1/);
    // Each package runs its files with its own test script, and any failure fails the step.
    NodeAssert.match(ci, /\(cd "\$package" && pnpm run test "\$\{files\[@\]\}"\) \|\| status=1/);
    NodeAssert.match(ci, /exit "\$status"/);
    NodeAssert.match(ci, /node --test scripts\/lazurio-release-contract\.test\.mjs/);
  },
);

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
  },
);

// The web client has no browser: on a Lazurio Environment the right panel shows the thread's tabs
// of the Environment browser, each the view of one remote tab in a frame, from the list T3 Code's
// server keeps in the thread's holder file (LazurioPlatform F47, task 501).
NodeTest.test(
  "the right panel shows the thread's Environment browser tabs through its seams",
  async () => {
    const [store, tabs, chatView, view, component, threadTabs] = await Promise.all(
      [
        "apps/web/src/rightPanelStore.ts",
        "apps/web/src/components/RightPanelTabs.tsx",
        "apps/web/src/components/ChatView.tsx",
        "apps/web/src/lazurio/environmentBrowser.ts",
        "apps/web/src/lazurio/LazurioEnvironmentBrowser.tsx",
        "apps/web/src/lazurio/threadTabs.ts",
      ].map(read),
    );
    // A surface kind of its own: preview reconciliation drops preview tabs without a server tab.
    // One member: this Environment's tab by its id only, another Environment's with its view.
    NodeAssert.match(
      store,
      /\| \{ id: `environment-browser:\$\{string\}`; kind: "environment-browser"; view\?: string \};/,
    );
    NodeAssert.equal(store.match(/kind: "environment-browser"/g)?.length, 1);
    // The overlay's kind opens Nová karta, the same id the overlay's new tabs have.
    NodeAssert.match(
      store,
      /case "environment-browser":\n(?:\s*\/\/[^\n]*\n)?\s+return \{ id: `environment-browser:new-tab:\$\{randomUUID\(\)\}`, kind \};/,
    );
    NodeAssert.match(threadTabs, /const NEW_TAB_PREFIX = "environment-browser:new-tab:";/);
    // One generic store action, through upstream's own automatic or user updates; no other overlay
    // action, and no import of the overlay in the store.
    NodeAssert.match(
      store,
      /lazurio: \(ref, automatic, update\) =>\n\s+set\(\(state\) =>\s+\(automatic \? automaticUpdate : userAction\)\(state, scopedThreadKey\(ref\), update\),?\s+\),/,
    );
    NodeAssert.doesNotMatch(store, /openEnvironmentBrowser|settleEnvironmentBrowser|\.\/lazurio\//);
    // The strip's title, icon and tooltip come from the overlay, its hook is one call.
    NodeAssert.match(tabs, /^import \* as Lazurio from "~\/lazurio\/LazurioEnvironmentBrowser";$/m);
    NodeAssert.match(
      tabs,
      /case "environment-browser":\n\s+return Lazurio\.surfaceTitle\(surface\);/,
    );
    NodeAssert.match(
      tabs,
      /case "environment-browser":\n\s+return <Lazurio\.SurfaceIcon surface=\{surface\} \/>;/,
    );
    NodeAssert.match(tabs, /\n {2}const lazurio = Lazurio\.useRightPanel\(addSurfaceActions\);\n/);
    // The empty panel's line on a draft: the Browser row's reason and one line under the list.
    NodeAssert.match(tabs, /browserNote=\{lazurio\.browserNote\}/);
    NodeAssert.match(
      tabs,
      /disabledReason: props\.browserNote \?\? SURFACE_UNAVAILABLE_HINTS\.browser,/,
    );
    NodeAssert.equal(tabs.match(/props\.browserNote/g)?.length, 3);
    NodeAssert.match(
      tabs,
      /\) : \(\n\s+lazurio\.tooltip\(surface, title\)\n\s+\)\}\n\s+<\/TooltipPopup>/,
    );
    NodeAssert.doesNotMatch(tabs, /environmentBrowserTitles|previewBridge \? browserDefaults/);
    // ChatView: one hook call, and upstream's surface in view wrapped once beside the frames.
    NodeAssert.equal(chatView.match(/useLazurioThreadTabs\(/g)?.length, 1);
    // A draft opens no stream until its first message makes it a thread (Lazurio/t3code#53).
    NodeAssert.match(
      chatView,
      /useLazurioThreadTabs\(activeThreadRef, \{\n\s+inlinePanel: !shouldUseRightPanelSheet,\n\s+draft: !isServerThread,\n\s+\}\);/,
    );
    NodeAssert.match(chatView, /const rightPanelActiveContent = activeThreadRef \? \(/);
    NodeAssert.match(
      chatView,
      /const rightPanelContent = activeThreadRef \? \(\n\s+<LazurioRightPanelSurfaces\n\s+threadRef=\{activeThreadRef\}\n\s+surfaces=\{renderedRightPanelSurfaces\}\n\s+activeSurfaceId=\{renderedRightPanelSurface\?\.id \?\? null\}\n\s+>\n\s+\{rightPanelActiveContent\}/,
    );
    NodeAssert.equal(chatView.match(/\{rightPanelContent\}/g)?.length, 2);
    NodeAssert.doesNotMatch(chatView, /environmentBrowser\.|kind === "environment-browser"/);
    NodeAssert.equal(
      chatView.match(/browserAvailable=\{isPreviewSupportedInRuntime\(\)\}/g)?.length,
      2,
    );
    // Mounted while the panel shows the thread, one per thread and tab; a hidden one keeps its size
    // (visibility, never display: the view sizes its remote window to its page area, F39 point 3).
    NodeAssert.match(component, /if \(isPreviewSupportedInRuntime\(\)\) return props\.children;/);
    NodeAssert.match(component, /props\.surfaces\.filter\(isEnvironmentBrowserSurface\)\.map\(/);
    NodeAssert.match(component, /key=\{`\$\{threadKey\}:\$\{surface\.id\}`\}/);
    NodeAssert.match(component, /!shown && "invisible"/);
    NodeAssert.match(component, /inert=\{!shown\}/);
    NodeAssert.doesNotMatch(component, /"hidden"|\bhidden=|display: ?"?none/);
    NodeAssert.match(
      component,
      /threadRef\.environmentId === primaryEnvironmentId &&\n\s+!isPreviewSupportedInRuntime\(\)/,
    );
    // The list comes from this page's own server, the holds go there too, never elsewhere.
    NodeAssert.match(threadTabs, /export const THREAD_TABS_ROUTE = "\/api\/lazurio\/thread-tabs";/);
    NodeAssert.match(
      component,
      /new EventSource\(\n\s+`\$\{THREAD_TABS_ROUTE\}\/events\?threadId=\$\{encodeURIComponent\(threadRef\.threadId\)\}`,/,
    );
    NodeAssert.match(threadTabs, /window\.fetch\(`\$\{THREAD_TABS_ROUTE\}\/\$\{action\}`, \{/);
    NodeAssert.match(threadTabs, /credentials: "same-origin"/);
    NodeAssert.match(threadTabs, /redirect: "error"/);
    // A frame of this Environment's tab is the server's view origin and the tab's id; no address of
    // it is stored, and a framed view is never on this page's origin.
    NodeAssert.match(component, /`\$\{snapshot\.viewOrigin\}\/t\/\$\{tabId\}`/);
    NodeAssert.match(threadTabs, /!viewOrigin\.startsWith\("https:\/\/"\)/);
    NodeAssert.match(view, /if \(url\.origin === pageOrigin\) return null;/);
    for (const source of [view, component, threadTabs]) {
      NodeAssert.doesNotMatch(source, /localStorage|sessionStorage|persist\(|ClientSettings/);
    }
    // The frame, and the way out of it when the gateway's sign-in cannot render in a frame.
    NodeAssert.match(component, /allow="clipboard-read; clipboard-write; fullscreen"/);
    NodeAssert.match(
      component,
      /sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"/,
    );
    NodeAssert.match(component, /<a href=\{view\} target="_blank" rel="noopener" \/>/);
    // Only the panel's own frame, on its view's origin, is heard (unit tests in src/lazurio).
    NodeAssert.match(
      component,
      /readEnvironmentBrowserMessage\(\n\s+event,\n\s+frame\.current\?\.contentWindow \?\? null,/,
    );
    NodeAssert.match(view, /if \(frame === null \|\| event\.source !== frame\) return null;/);
    NodeAssert.match(view, /if \(origin === null \|\| event\.origin !== origin\) return null;/);
    NodeAssert.match(view, /message\.type === "lazurio-browser:closed"/);
    for (const file of environmentBrowserOverlay) {
      NodeAssert.match(ci, new RegExp(`\\n {12}${file.replaceAll(".", "\\.")}\\n`), file);
    }
    for (const retired of ["browserUse", "agentBrowserSession"]) {
      NodeAssert.doesNotMatch(ci, new RegExp(`apps/web/src/lazurio/${retired}`), retired);
    }
  },
);

// Plan DEV-6646, task 501: the panel opens by itself only on the server's reveal of a tab an agent
// opened (preview_open, a new window of the thread's agent-browser session), and a plain click on a
// link in the chat to one remote tab opens that tab there. The seams are ChatView's one hook call,
// openProactive's surface type and the chat's timeline rows, which upstream marks with
// data-timeline-root; a rebuild that loses one fails here.
NodeTest.test("the panel opens on an agent's tab through its seams", async () => {
  const [store, timeline, component, threadTabs, host, tabsService] = await Promise.all(
    [
      "apps/web/src/rightPanelStore.ts",
      "apps/web/src/components/chat/MessagesTimeline.tsx",
      "apps/web/src/lazurio/LazurioEnvironmentBrowser.tsx",
      "apps/web/src/lazurio/threadTabs.ts",
      "apps/server/src/lazurio/environmentBrowser.ts",
      "apps/server/src/lazurio/threadTabs.ts",
    ].map(read),
  );
  // The app opens it, not the person: an automatic update, refused once the person chose.
  NodeAssert.match(
    store,
    /openProactive: \([^]*?\{ kind: "diff" \| "pull-request" \| "pull-requests" \| "environment-browser" \}/,
  );
  NodeAssert.match(
    threadTabs,
    /\.openProactive\(threadRef, \{ id: tabSurfaceId\(tabId\), kind: "environment-browser" \}, revision\);/,
  );
  NodeAssert.match(threadTabs, /if \(!sync\.inlinePanel\) return;/);
  // Links in the chat's timeline rows, before the chat's own handlers, on a plain click only.
  NodeAssert.match(timeline, /data-timeline-root="true"/);
  NodeAssert.match(component, /const CHAT_ROW = "\[data-timeline-root\]";/);
  NodeAssert.match(component, /document\.addEventListener\("click", openInPanel, true\);/);
  NodeAssert.match(component, /if \(!isPlainPrimaryClick\(event\)/);
  NodeAssert.match(
    threadTabs,
    /environmentBrowserLink\(href, window\.location\.origin, snapshot\.viewOrigin\)/,
  );
  // The host records every tab preview_open opens or adopts in the thread's strip, revealed unless
  // it asked for background work; the service records a new binding of the thread's session too.
  NodeAssert.match(
    host,
    /const reveals = \(input: PreviewAutomationOpenInput\) => \(input\.open \?\? input\.show\) !== false;/,
  );
  NodeAssert.match(host, /yield\* adopt\(request\.threadId, targetId, reveals\(input\)\);/);
  NodeAssert.match(host, /Effect\.andThen\(threadTabs\.record\(threadId, targetId, revealed\)\)/);
  NodeAssert.match(
    tabsService,
    /if \(threadId !== null\) await record\(threadId, binding\.targetId, true\);/,
  );
});

// Task 501: a thread's tabs live in its holder file, which the view's hub reads, and the web reaches
// them through an overlay route with its own prefix, authenticated like T3 Code's routes, with
// upstream's preview scopes, its event stream never compressed or buffered.
NodeTest.test("a thread's tabs live in its holder file behind an overlay route", async () => {
  const [route, service, holders, overlay] = await Promise.all(
    [
      "apps/server/src/lazurio/threadTabsRoute.ts",
      "apps/server/src/lazurio/threadTabs.ts",
      "apps/server/src/lazurio/holders.ts",
      "apps/server/src/lazurio/overlay.ts",
    ].map(read),
  );
  NodeAssert.match(route, /export const THREAD_TABS_ROUTE = "\/api\/lazurio\/thread-tabs";/);
  NodeAssert.match(route, /serverAuth\s*\.authenticateHttpRequest\(request\)/);
  NodeAssert.doesNotMatch(route, /authenticateWebSocketUpgrade|authenticateMediaRequest/);
  NodeAssert.match(route, /read: requiredScopeForRpcMethod\(WS_METHODS\.previewList\),/);
  NodeAssert.match(route, /hold: requiredScopeForRpcMethod\(WS_METHODS\.previewOpen\),/);
  NodeAssert.match(route, /release: requiredScopeForRpcMethod\(WS_METHODS\.previewClose\),/);
  NodeAssert.match(
    route,
    /headers: \{ "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" \}/,
  );
  // The holder file is the Platform's, copied with its source named and its vectors tested.
  NodeAssert.match(holders, /src\/browser\/people\/holds\.ts` at 49d54c9/);
  NodeAssert.match(service, /export const MAX_THREAD_TABS = 128;/);
  NodeAssert.match(service, /holderFileText\(/);
  // T3 Code never closes a tab of the browser: the service has no browser connection at all.
  NodeAssert.doesNotMatch(
    service,
    /connectEnvironmentBrowser|Target\.closeTarget|agent-browser.*close/,
  );
  NodeAssert.match(
    overlay,
    /Layer\.mergeAll\(\s*EnvironmentBrowser\.layer,\s*ThreadTabsRoute\.layer,\s*ModelRecommendationRoute\.layer,?\s*\)/,
  );
});

// Plan DEV-6646: T3's browser tools drive the Environment browser. The host is server overlay
// files in apps/server/src/lazurio; the seams are a few lines in upstream files, ported from
// upstream (611132c1) where it has the same idea, so a rebuild on a new upstream tag that loses
// one fails here.
NodeTest.test("T3's browser tools reach the Environment browser through their seams", async () => {
  const [server, broker, mcp, externals, serverPackage, host, connection, engine] =
    await Promise.all(
      [
        "apps/server/src/server.ts",
        "apps/server/src/mcp/PreviewAutomationBroker.ts",
        "apps/server/src/mcp/McpHttpServer.ts",
        "scripts/lib/cli-external-packages.ts",
        "apps/server/package.json",
        "apps/server/src/lazurio/environmentBrowser.ts",
        "apps/server/src/lazurio/environmentBrowserConnection.ts",
        "apps/server/src/lazurio/environmentBrowserPage.ts",
      ].map(read),
    );
  // The overlay's one layer shares the routes' one preview broker.
  const routes = server.slice(server.indexOf("export const makeRoutesLayer"));
  const seam = routes.indexOf("LazurioOverlay.layer.pipe(Layer.provide(ProcessRunner.layer)),");
  NodeAssert.ok(seam > 0, "makeRoutesLayer must start the server overlay");
  NodeAssert.equal(server.match(/LazurioOverlay/g)?.length, 2);
  NodeAssert.ok(seam < routes.indexOf("Layer.provide(PreviewAutomationBroker.layer)"));
  // A preferred host takes new work before any desktop; only an explicit tab's owner outranks it.
  NodeAssert.match(
    broker,
    /export interface PreviewAutomationConnectOptions \{[^}]*readonly preferred\?: boolean;/,
  );
  NodeAssert.match(
    broker,
    /Number\(input\.tabId !== undefined && ownsTargetTab\(right\)\) -\n\s+Number\(input\.tabId !== undefined && ownsTargetTab\(left\)\) \|\|\n\s+Number\(right\.preferred\) - Number\(left\.preferred\) \|\|/,
  );
  NodeAssert.match(
    broker,
    /input\.operation === "open" && connection\.preferred \? 60_000 : 15_000/,
  );
  NodeAssert.match(host, /\{ preferred: true \}/);
  NodeAssert.match(host, /path\.join\(home, "\.local", "bin", "lazurio"\)/);
  NodeAssert.match(host, /args: \["browser", "link", "--json"\]/);
  // Agents see a server host's ARIA refs.
  NodeAssert.match(
    mcp,
    /const ariaTree = typeof accessibilityTree === "string" \? accessibilityTree : undefined;/,
  );
  // Playwright, upstream's exact version, beside the CLI bundle.
  NodeAssert.equal(JSON.parse(serverPackage).dependencies["playwright-core"], "1.60.0");
  NodeAssert.match(externals, /\n {2}"playwright-core",\n/);
  // The Environment browser stays the Environment's own: Playwright keeps its overrides off the
  // default context, and the host adds no context, script, binding or user agent of its own.
  NodeAssert.match(
    connection,
    /connectOverCDP\(endpoint, \{ noDefaults: true, timeout: 15_000 \}\)/,
  );
  NodeAssert.match(connection, /browser\.contexts\(\)\[0\]/);
  for (const source of [host, connection, engine]) {
    NodeAssert.doesNotMatch(
      source,
      /\.newContext\(|\.launch(?:PersistentContext)?\(|\.addInitScript\(|\.exposeBinding\(|\.exposeFunction\(|userAgent:|\.setExtraHTTPHeaders\(|\.emulateMedia\(/,
    );
  }
});

// Plan DEV-6646: another Lazurio Environment's view of a tab, where an agent works over SSH. The
// server's Environment browser host answers preview_open of such a view without loading it, and
// the web opens it as a marked tab of the right panel. Both read a view's address with one
// function, which each holds a copy of, as with the session name.
NodeTest.test("the server and the web read a Lazurio browser view's address alike", async () => {
  const [server, web] = await Promise.all([
    import("../apps/server/src/lazurio/browserView.ts"),
    import("../apps/web/src/lazurio/browserView.ts"),
  ]);
  NodeAssert.equal(web.lazurioBrowserView.toString(), server.lazurioBrowserView.toString());
  const targetId = "0123456789abcdef".repeat(2);
  NodeAssert.deepEqual(
    server.lazurioBrowserView(`https://browser.vm-01.acme.lazurio.io/t/${targetId}`),
    {
      view: `https://browser.vm-01.acme.lazurio.io/t/${targetId}`,
      origin: "https://browser.vm-01.acme.lazurio.io",
      targetId,
      owner: "acme",
      environment: "vm-01",
      personal: false,
    },
  );
  for (const address of [
    `https://browser.jana.lazurio.io/t/${targetId}`,
    `https://browser.jana.lazurio.io/t/${targetId}?`,
    `https://browser.jana.lazurio.io:8443/t/${targetId}`,
    `https://t3code.jana.lazurio.io/t/${targetId}`,
    "not an address",
  ]) {
    NodeAssert.deepEqual(
      web.lazurioBrowserView(address),
      server.lazurioBrowserView(address),
      address,
    );
  }
});

// The seams are lines in upstream files: preview_open's result schema and the panel store. The
// activity projection is upstream's again: the server tells the web of the tabs itself (task 501).
NodeTest.test("another Environment's tabs and agent-opened tabs reach the panel", async () => {
  const [host, tools, component, threadTabs] = await Promise.all(
    [
      "apps/server/src/lazurio/environmentBrowser.ts",
      "apps/server/src/mcp/toolkits/preview/tools.ts",
      "apps/web/src/lazurio/LazurioEnvironmentBrowser.tsx",
      "apps/web/src/lazurio/threadTabs.ts",
    ].map(read),
  );
  // Another Environment's view is answered before this browser, the CLI or a tab is touched, and
  // goes to the thread's devices as a live event, never into a holder file.
  const open = host.slice(host.indexOf("const open = (request: PreviewAutomationRequest"));
  const answer = open.indexOf(
    "return yield* foreignOpen(request.threadId, foreign, reveals(input));",
  );
  NodeAssert.ok(answer > 0, "preview_open must answer another Environment's view");
  for (const step of ["yield* liveTab(", "yield* newWindow(", "yield* threadWindow("]) {
    NodeAssert.ok(answer < open.indexOf(step), step);
  }
  NodeAssert.match(
    host,
    /threadTabs\.foreign\(threadId, \{ tabId: view\.targetId, view: view\.view \}, visible\)/,
  );
  NodeAssert.match(
    host,
    /return view !== null && view\.origin !== ownViewOrigin \? view : undefined;/,
  );
  NodeAssert.match(
    host,
    /ownViewOrigin = viewOriginOf\(declaration\.value\.link\);\n\s+yield\* threadTabs\.declare\(ownViewOrigin\);/,
  );
  // Any other operation on such a tab fails with the host's advice, which reaches the agent.
  NodeAssert.match(host, /if \(requested !== undefined\) yield\* notForeign\(requested\);/);
  NodeAssert.match(
    host,
    /const foreignTab = \(view: LazurioBrowserView\) =>\n\s+failure\(\n\s+"PreviewAutomationExecutionError",/,
  );
  // The answer's view and advice survive preview_open's result encoding.
  NodeAssert.match(
    tools,
    /success: Schema\.Struct\(\{\n\s+\.\.\.PreviewAutomationStatus\.fields,\n\s+view: Schema\.optional\(Schema\.String\),\n\s+message: Schema\.optional\(Schema\.String\),\n\s+\}\),/,
  );
  // The activity projection is upstream's, byte for byte.
  const upstreamSha = /UPSTREAM_SHA: ([0-9a-f]{40})/.exec(ci)?.[1];
  NodeAssert.ok(upstreamSha);
  NodeAssert.doesNotThrow(() =>
    NodeChildProcess.execFileSync("git", [
      "diff",
      "--quiet",
      upstreamSha,
      "--",
      "apps/server/src/orchestration/ActivityPayloadProjection.ts",
    ]),
  );
  // The web keeps of another Environment's tab only its id and view, and frames T3 by the origin
  // its request names (LazurioPlatform).
  NodeAssert.match(
    threadTabs,
    /id: tab\.id,\n\s+kind: "environment-browser",\n\s+view: tab\.view,/,
  );
  NodeAssert.equal(component.match(/<iframe\n/g)?.length, 1);
  NodeAssert.match(component, /\n\s+referrerPolicy="origin"\n/);
});

// Task 501: "+" and the empty panel open Nová karta where the Environment's shell defines its
// element; elsewhere upstream's menu and empty state stay. The seams are RightPanelTabs's hook call
// and its two conditionals.
NodeTest.test('"+" and the empty panel open Nová karta through their seams', async () => {
  const [tabs, newTab] = await Promise.all(
    ["apps/web/src/components/RightPanelTabs.tsx", "apps/web/src/lazurio/LazurioNewTab.tsx"].map(
      read,
    ),
  );
  NodeAssert.match(
    tabs,
    /\{props\.surfaces\.length > 0 && lazurio\.newTab \? <Lazurio\.NewTabButton \/> : null\}\n\s+\{props\.surfaces\.length > 0 && !lazurio\.newTab \? \(\n\s+<Menu open=\{addSurfaceMenuOpen\}/,
  );
  NodeAssert.match(
    tabs,
    /\{props\.activeSurfaceId === null && lazurio\.newTab \? \(\n\s+<Lazurio\.NewTab \/>\n\s+\) : props\.activeSurfaceId === null \? \(\n\s+<RightPanelEmptyState/,
  );
  // The element by its name, its tools upstream's own actions without Browser, its choice in place.
  NodeAssert.match(newTab, /export const NEW_TAB_ELEMENT = "lazurio-new-tab";/);
  NodeAssert.match(newTab, /action\.available && action\.label !== "Browser"/);
  NodeAssert.match(newTab, /customElements\s*\.whenDefined\(NEW_TAB_ELEMENT\)/);
  NodeAssert.doesNotMatch(newTab, /focus-address|focusAddress|\blang:/);
});

// The panel has no head row (approved by the Admin on 2026-10-13): the view's own bar, which the
// Environment's Platform serves, is its only toolbar, and what the head row offered moves into the
// strip tab's menu: "Open in new tab" and "Reload" for an Environment browser tab, before upstream's
// close items, which stay. The seams are the menu's action type, one call for the items and one for
// the action; a rebuild on a new upstream tag that loses one fails here.
NodeTest.test("the strip tab's menu opens and reloads a tab's view through its seams", async () => {
  const [tabs, component] = await Promise.all(
    [
      "apps/web/src/components/RightPanelTabs.tsx",
      "apps/web/src/lazurio/LazurioEnvironmentBrowser.tsx",
    ].map(read),
  );
  NodeAssert.match(tabs, /\n {2}\| "close-all"\n {2}\| Lazurio\.TabMenuAction;\n/);
  NodeAssert.match(
    tabs,
    /\n\s+items\.push\(\.\.\.Lazurio\.tabMenuItems\(surface\)\);\n\s+items\.push\(\n\s+\{ id: "close", label: "Close" \},/,
  );
  NodeAssert.match(
    tabs,
    /\n\s+case null:\n\s+break;\n\s+default:\n\s+Lazurio\.runTabMenuAction\(action, surface\);\n\s+\}/,
  );
  NodeAssert.equal(tabs.match(/Lazurio\.(tabMenuItems|runTabMenuAction)\(/g)?.length, 2);
  // The view opens in a tab of its own, which never reaches back into T3 Code.
  NodeAssert.match(component, /window\.open\(view, "_blank", "noopener"\)/);
});
