// Contract for the Lazurio distribution files. Run with:
//   node --test scripts/lazurio-release-contract.test.mjs
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeTest from "node:test";

import {
  cliReleaseChannelOf,
  cliReleaseDownloadBaseUrl,
  cliReleaseIndexPageUrl,
  cliReleaseRepository,
} from "../packages/shared/src/cliRelease.ts";

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
  "apps/web/src/lazurio/LazurioEnvironmentBrowser.browser.test.tsx",
  "apps/web/src/lazurio/LazurioEnvironmentBrowser.tsx",
  "apps/web/src/lazurio/LazurioNewTab.browser.test.tsx",
  "apps/web/src/lazurio/LazurioNewTab.test.ts",
  "apps/web/src/lazurio/LazurioNewTab.tsx",
  "apps/web/src/lazurio/LazurioNewTab.withoutElement.browser.test.tsx",
  "apps/web/src/lazurio/browserView.ts",
  "apps/web/src/lazurio/environmentBrowser.test.ts",
  "apps/web/src/lazurio/environmentBrowser.ts",
  "apps/web/src/lazurio/threadTabs.browser.test.ts",
  "apps/web/src/lazurio/threadTabs.test.ts",
  "apps/web/src/lazurio/threadTabs.ts",
  "apps/web/src/rightPanelStore.ts",
];
const [release, archives, ci, dockerfile, dockerignore, docs, updateSource, issueTemplate] =
  await Promise.all([
    read(".github/workflows/lazurio-release.yml"),
    read(".github/workflows/lazurio-cli-archives.yml"),
    read(".github/workflows/lazurio-fork-ci.yml"),
    read("Dockerfile.lazurio"),
    read(".dockerignore"),
    read("docs/operations/lazurio-fork-release.md"),
    read("apps/server/src/cli/update.ts"),
    read(".github/ISSUE_TEMPLATE/1-lazurio-t3-code.yml"),
  ]);

// The guard in lazurio-fork-ci.yml: under apps/, packages/ and scripts/ the overlay changes only the
// files on its allowlist and its own folders, apps/*/src/lazurio/, which pass whole.
const overlayFolder = /^apps\/[^/]+\/src\/lazurio\//;
const allowedUpstreamChanges = (/allowed_upstream_changes=\(\n([^]*?)\n\s*\)\n/.exec(ci)?.[1] ?? "")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("#"));
const overlayMayChange = (file) =>
  overlayFolder.test(file) || allowedUpstreamChanges.includes(file);

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
  // The base is the source's own (#69): an older upstream tag is an ancestor too.
  for (const name of ["UPSTREAM_TAG", "UPSTREAM_SHA"])
    NodeAssert.ok(
      release.includes(
        `test "$(sed -n 's/^  ${name}: //p' .github/workflows/lazurio-fork-ci.yml)" = "$${name}"`,
      ),
      `the release checks ${name} against the source's lazurio-fork-ci.yml`,
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

// Root decision 0200: the fork is the distribution "Lazurio T3 Code", a modified distribution of
// T3 Code, never vanilla upstream. Its releases and its image carry that name. The notes open with
// the upstream tag the release is built on, speak of Environments, and end with where the source is
// and under which licence.
NodeTest.test("releases and the image carry the name Lazurio T3 Code", () => {
  NodeAssert.match(release, /--title "Lazurio T3 Code \$RELEASE_TAG" \\\n/);
  const notes =
    /\n( +)\{\n([^]*?)\n\1\} > "\$RUNNER_TEMP\/RELEASE_NOTES\.md"/.exec(release)?.[2] ?? "";
  const lines = [...notes.matchAll(/^\s*echo "(.*)"$/gm)].map((match) => match[1]);
  NodeAssert.equal(
    lines[0],
    "Lazurio T3 Code, a modified distribution of T3 Code $UPSTREAM_TAG for Lazurio",
  );
  NodeAssert.match(notes, /Lazurio Environments update to it from this release\."\n/);
  NodeAssert.doesNotMatch(notes, /\bMachines?\b|vanilla/i);
  NodeAssert.doesNotMatch(release, /vanilla/i);
  // The last lines of the notes: the exact source and the licence, whose exception for the Lazurio
  // brand assets links their terms at the same source.
  NodeAssert.match(
    notes,
    /\n\s+echo "Source code: https:\/\/github\.com\/\$GITHUB_REPOSITORY\/tree\/\$SOURCE_SHA\. Licensed under the"\n\s+echo "MIT License, like T3 Code, except the Lazurio brand assets \(the Lazurio symbol and Buddy's"\n\s+echo "character\), which are not under it:"\n\s+echo "https:\/\/github\.com\/\$GITHUB_REPOSITORY\/blob\/\$SOURCE_SHA\/apps\/web\/src\/lazurio\/brand\/README\.md\."\n\s+echo "Each archive and the image include T3 Code's LICENSE\."$/,
  );
  // The image's name, description, licence, address and vendor, the same in the published image and
  // in every image Dockerfile.lazurio builds.
  const expected = {
    title: "Lazurio T3 Code",
    description: "Lazurio T3 Code: a modified distribution of T3 Code for Lazurio Environments",
    licenses: "MIT",
    url: "https://github.com/Lazurio/t3code",
    vendor: "Lazurio",
  };
  const labelsOf = (pattern, source) =>
    Object.fromEntries([...source.matchAll(pattern)].map((match) => [match[1], match[2]]));
  const releaseLabels = labelsOf(/^ +org\.opencontainers\.image\.(\w+)=(.*)$/gm, release);
  const imageLabels = labelsOf(/org\.opencontainers\.image\.(\w+)="([^"]*)"/g, dockerfile);
  for (const [key, value] of Object.entries(expected)) {
    NodeAssert.equal(releaseLabels[key], value, `the release's ${key} label`);
    NodeAssert.equal(imageLabels[key], value, `Dockerfile.lazurio's ${key} label`);
  }
  // Issues: the distribution's own form, beside upstream's unchanged ones.
  NodeAssert.match(issueTemplate, /^name: Lazurio T3 Code problem\n/);
  NodeAssert.match(issueTemplate, /Report problems with it here, not to the T3 Code team\./);
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
  // The whole repository is linted with upstream's own script and rules (Lazurio/t3code#63).
  NodeAssert.match(ci, /\n {8}run: pnpm run lint\n/);
  NodeAssert.match(ci, /UPSTREAM_TAG: v0\.1\.2/);
  NodeAssert.match(ci, /UPSTREAM_SHA: 044f07257c9684ae4543bd1e1ebf9c394e9e3830/);
  const upstreamVersion = /UPSTREAM_TAG: v(\S+)/.exec(ci)?.[1];
  NodeAssert.match(
    ci,
    new RegExp(`version: ${upstreamVersion?.replaceAll(".", "\\.")}-lazurio\\.0\\n`),
  );
});

// Upstream pins Node exactly (engines.node) and refuses a native CLI built on another, and pnpm's
// version comes from packageManager. CI, the release and the image build use exactly those, so an
// upstream bump fails here, in the rebuild, rather than in a job that installs the wrong tools.
NodeTest.test("CI, the release and the image use upstream's exact Node and pnpm", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const node = pkg.engines?.node;
  const pnpm = /^pnpm@(\S+)$/.exec(pkg.packageManager ?? "")?.[1];
  NodeAssert.match(node ?? "", /^\d+\.\d+\.\d+$/, "engines.node must be an exact version");
  NodeAssert.ok(pnpm, "packageManager must name pnpm");
  const escape = (value) => value.replaceAll(".", "\\.");
  for (const workflow of [ci, release]) {
    NodeAssert.match(workflow, new RegExp(`\\n {10}node-version: ${escape(node)}\\n`));
    NodeAssert.doesNotMatch(workflow, new RegExp(`node-version: (?!${escape(node)}\\n)`));
  }
  NodeAssert.match(ci, new RegExp(`\\n {10}version: ${escape(pnpm)}\\n`));
  for (const workflow of [ci, release]) {
    NodeAssert.match(
      workflow,
      new RegExp(`NODE_BASE_IMAGE=node:${escape(node)}-bookworm@sha256:[0-9a-f]{64}`),
    );
    NodeAssert.match(workflow, new RegExp(`PNPM_VERSION=${escape(pnpm)}\\b`));
  }
  // The archives take Node from package.json through setup-vp; an override would build the native
  // CLI on another Node, which upstream's build refuses.
  NodeAssert.doesNotMatch(archives, /VP_NODE_VERSION/);
  NodeAssert.match(archives, /node-version-file: package\.json/);
});

// Fork CI tests what the overlay changes, derived from the diff against the exact upstream base: a
// new seam's tests run without editing the workflow, however its steps are laid out. A fixed gate
// keeps the tests the diff does not select: the directories whose tests import overlay seams
// without being changed, upstream's project tests, which run through the overlay's decorated
// project service, the engine test of upstream's server browser, which the Environment browser's
// host drives, and the check that the React Compiler compiles every web file. The overlay folders
// also hold the tests whose upstream files v0.1.2 deleted (the environment label, the managed
// Folder's VCS hook, and the right panel's "+" and Mod+T). A workflow edit that drops one of these
// paths fails here.
const oldTestGate = [
  "apps/server/src/auth",
  "apps/server/src/cli/config.test.ts",
  "apps/server/src/lazurio",
  "apps/server/src/preview/ServerBrowserPage.test.ts",
  "apps/server/src/project/ProjectService.test.ts",
  "apps/server/src/serverSettings.test.ts",
  "apps/web/src/lazurio",
  "apps/web/src/reactCompilerCoverage.test.ts",
];

NodeTest.test(
  "CI runs the tests of everything the overlay changes and of the fixed gate",
  async () => {
    NodeAssert.match(
      ci,
      /git diff --name-only --diff-filter=d "\$UPSTREAM_SHA\.\.HEAD" -- '\*\.ts' '\*\.tsx'/,
    );
    // Every test file the overlay adds or changes, and upstream's own tests beside each file it
    // changes, browser tests included.
    NodeAssert.match(ci, /\*\.test\.ts \| \*\.test\.tsx\) echo "\$file" ;;/);
    NodeAssert.match(
      ci,
      /for test in "\$\{file%\.\*\}"\.test\.ts "\$\{file%\.\*\}"\.test\.tsx "\$\{file%\.\*\}"\.\*\.test\.ts "\$\{file%\.\*\}"\.\*\.test\.tsx; do/,
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

// The upstream watch (runbook "Nové stabilní vydání upstreamu", stage 1): once a day it compares
// upstream's newest stable release with the base of main and opens the rebuild's tracking issue
// from the runbook's template, or comments once on the open one. It reads upstream's public
// releases and this repository's files and writes only issues here, with this repository's token.
NodeTest.test("the upstream watch reads upstream and writes only the rebuild's issue", async () => {
  const watch = await read(".github/workflows/lazurio-upstream-watch.yml");
  const triggers = watch.slice(watch.indexOf("\non:"), watch.indexOf("\npermissions:"));
  NodeAssert.deepEqual(
    [...triggers.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1]),
    ["schedule", "workflow_dispatch"],
  );
  NodeAssert.match(watch, /^permissions:\n {2}contents: read\n {2}issues: write\n\n/m);
  NodeAssert.equal(watch.match(/permissions:/g)?.length, 1, "no job widens the permissions");
  NodeAssert.match(watch, /if: github\.repository == 'Lazurio\/t3code'/);
  NodeAssert.doesNotMatch(watch, /uses:/);
  NodeAssert.deepEqual(
    [...new Set([...watch.matchAll(/secrets\.(\w+)/g)].map((match) => match[1]))],
    ["GITHUB_TOKEN"],
  );
  // Reads: main's base as CI declares it, and upstream's stable releases only.
  NodeAssert.match(watch, /sed -n 's\/\^ {2}UPSTREAM_TAG: \/\/p'/);
  NodeAssert.match(ci, /^ {2}UPSTREAM_TAG: v\d+\.\d+\.\d+$/m);
  NodeAssert.match(
    watch,
    /gh release list --repo pingdotgg\/t3code --exclude-drafts --exclude-pre-releases/,
  );
  // Writes: an issue or a comment in this repository, nothing else.
  const allowed = new Set([
    "api",
    "release list",
    "issue list",
    "issue view",
    "issue create",
    "issue comment",
  ]);
  for (const [, command, subcommand] of watch.matchAll(/\bgh (\w+)(?: (\w+))?/g)) {
    const used = command === "api" ? command : `${command} ${subcommand}`;
    NodeAssert.ok(allowed.has(used), `the watch must not run gh ${used}`);
  }
  NodeAssert.doesNotMatch(
    watch,
    /gh api[^\n]*(--method|-X\b|--field|--raw-field|-f\b|-F\b|--input)/,
  );
  NodeAssert.doesNotMatch(watch, /\bgit (push|tag)\b/);
  // The issue it opens or finds is the runbook's: the same title, and the runbook's template.
  const title = "Přestavba na upstream T3 Code";
  NodeAssert.ok(watch.includes(`startswith("${title} ")`), "it finds the open issue by title");
  NodeAssert.ok(watch.includes(`--title "${title} $latest"`), "it opens the issue by title");
  NodeAssert.ok(docs.includes(`\`${title} vX.Y.Z\``), "the runbook names the same title");
  for (const marker of ["<!-- rebuild-issue:start -->", "<!-- rebuild-issue:end -->"]) {
    NodeAssert.equal(docs.split(`\n${marker}\n`).length, 2, `the runbook has ${marker} once`);
    NodeAssert.ok(watch.includes(`/^${marker}$/`), `the watch reads the template from ${marker}`);
  }
});

// The watch's own script, run with stand-ins for gh and git: an upstream tag that does not resolve to
// exactly one commit stops it before any issue write, and a tag that does opens the issue.
NodeTest.test(
  "the upstream watch writes no issue unless upstream's tag is one commit",
  async () => {
    const watch = await read(".github/workflows/lazurio-upstream-watch.yml");
    const block = /\n {8}run: \|\n((?: {10}.*\n|\n)+)/.exec(watch)?.[1];
    NodeAssert.ok(block, "the watch has its script");
    const script = block
      .split("\n")
      .map((line) => line.slice(10))
      .join("\n");
    const dir = await NodeFSP.mkdtemp("/tmp/lazurio-watch-");
    await NodeFSP.writeFile(`${dir}/ci.yml`, ci);
    await NodeFSP.writeFile(`${dir}/runbook.md`, docs);
    // gh: main's lazurio-fork-ci.yml and the runbook from the repository, a newer upstream stable,
    // no open rebuild issue, and every issue write recorded. git: ls-remote answers $LS_REMOTE.
    const standIns = `
gh() {
  case "$1" in
    api) case "$2" in *lazurio-fork-ci.yml*) cat "$STAND_INS/ci.yml" ;; *lazurio-fork-release.md*) cat "$STAND_INS/runbook.md" ;; esac ;;
    release) echo "v9.9.9" ;;
    issue) case "$2" in list) echo "" ;; *) printf '%s\n' "gh $*" >> "$STAND_INS/writes" ;; esac ;;
  esac
}
git() { if [ "$1" = ls-remote ]; then printf '%s' "$LS_REMOTE"; fi; }
`;
    const run = async (lsRemote) => {
      await NodeFSP.rm(`${dir}/writes`, { force: true });
      const result = NodeChildProcess.spawnSync("bash", ["-c", standIns + script], {
        env: {
          PATH: process.env.PATH,
          STAND_INS: dir,
          REPO: "Lazurio/t3code",
          LS_REMOTE: lsRemote,
        },
        encoding: "utf8",
      });
      const writes = await read(`${dir}/writes`).catch(() => "");
      return { status: result.status, writes };
    };
    for (const missing of ["", "deadbeef\trefs/tags/v9.9.9\n"]) {
      const result = await run(missing);
      NodeAssert.notEqual(result.status, 0, "an unresolved tag fails the run");
      NodeAssert.equal(result.writes, "", "and writes no issue");
    }
    // A lightweight tag is its commit; an annotated tag's commit is its peeled line, never the
    // tag object.
    const commit = "c".repeat(40);
    for (const answer of [
      `${commit}\trefs/tags/v9.9.9\n`,
      `${"d".repeat(40)}\trefs/tags/v9.9.9\n${commit}\trefs/tags/v9.9.9^{}\n`,
    ]) {
      const resolved = await run(answer);
      NodeAssert.equal(resolved.status, 0);
      NodeAssert.match(resolved.writes, /^gh issue create /);
      NodeAssert.equal(resolved.writes.match(/^gh issue /gm)?.length, 1, "one issue written");
      NodeAssert.ok(resolved.writes.includes(`\`${commit}\``), "the issue names the tag's commit");
      NodeAssert.ok(!resolved.writes.includes("d".repeat(40)), "never the tag object");
    }
    await NodeFSP.rm(dir, { recursive: true, force: true });
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

// T3 Code's MIT licence travels with every copy of it: the image and each CLI archive carry its
// LICENSE beside the program. The web client they bundle wears upstream's production icons, not
// the development ones the server build applies; CI compares both with the source files.
NodeTest.test(
  "the image and the archives carry T3 Code's licence and production icons",
  async () => {
    const brand = await import("./lib/brand-assets.ts");
    const favicon = brand
      .resolveWebIconOverrides("production", "apps/server/dist/client")
      .find((icon) => icon.targetRelativePath === "apps/server/dist/client/favicon.ico");
    NodeAssert.equal(favicon?.sourceRelativePath, "assets/prod/t3-black-web-favicon.ico");
    const applyIcons = "node scripts/apply-web-brand-assets.ts production apps/server/dist/client";
    // The image: the icons after the server build and before its deploy, the licence beside it.
    const iconsInImage = dockerfile.indexOf(applyIcons);
    NodeAssert.ok(dockerfile.indexOf("pnpm exec vp run --filter t3 build") < iconsInImage);
    NodeAssert.ok(iconsInImage < dockerfile.indexOf("pnpm --filter t3 deploy"));
    NodeAssert.match(dockerfile, /^COPY LICENSE \/opt\/lazurio-t3\/LICENSE$/m);
    for (const source of [ci, release]) {
      NodeAssert.match(source, /\/opt\/lazurio-t3\/LICENSE \| cmp - LICENSE/);
      NodeAssert.match(
        source,
        /\/opt\/lazurio-t3\/dist\/client\/favicon\.ico \| cmp - assets\/prod\/t3-black-web-favicon\.ico/,
      );
    }
    // The archives: the icons before packing, the licence appended beside the executable, and both
    // checked before the smoke test.
    const iconsInArchive = archives.indexOf(applyIcons);
    NodeAssert.ok(archives.indexOf("vp run --filter t3 build") < iconsInArchive);
    NodeAssert.ok(iconsInArchive < archives.indexOf("node scripts/build-cli-archive.ts"));
    NodeAssert.match(
      archives,
      /tar -rf "release-cli\/\$stem\.tar" -C "\$RUNNER_TEMP\/cli-licence" "\$stem\/LICENSE"/,
    );
    NodeAssert.match(
      archives,
      /tar -xzOf "release-cli\/\$stem\.tar\.gz" "\$stem\/LICENSE" \| cmp - LICENSE/,
    );
    NodeAssert.match(
      archives,
      /"\$stem\/client\/favicon\.ico" \| cmp - assets\/prod\/t3-black-web-favicon\.ico/,
    );
    NodeAssert.ok(
      archives.indexOf("| cmp - LICENSE") < archives.indexOf("node scripts/smoke-cli-archive.ts"),
    );
  },
);

// T3 is served at the root of its own hostname, with no mount path. No build sets a hosted app
// variable: VITE_HOSTED_APP_CHANNEL is no name but switches the web client into app.t3.codes mode,
// where it stops treating its own server as the primary environment. The distribution's name is in
// its releases and its image (above), and the app's name comes from its stage label.
NodeTest.test("T3 is served at the root, and no build sets a hosted app variable", () => {
  for (const source of [release, archives, ci, dockerfile]) {
    NodeAssert.doesNotMatch(source, /T3CODE_BASE_PATH|VITE_HOSTED_APP_/);
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

NodeTest.test("the overlay changes only listed upstream files and its own folders", async () => {
  NodeAssert.match(ci, /grep -E '\^\(apps\|packages\|scripts\)\/'/);
  NodeAssert.match(ci, /grep -vE '\^apps\/\[\^\/\]\+\/src\/lazurio\/'/);
  NodeAssert.match(ci, /grep -vxF -f <\(printf '%s\\n' "\$\{allowed_upstream_changes\[@\]\}"\)/);
  NodeAssert.match(ci, /if \[ -n "\$unexpected" \]; then[^]*?exit 1/);
  const list = /allowed_upstream_changes=\(\n([^]*?)\n\s*\)\n/.exec(ci)?.[1];
  NodeAssert.ok(list, "the guard must declare allowed_upstream_changes");
  const lines = list.split("\n").map((line) => line.trim());
  NodeAssert.match(lines[0] ?? "", /^# \S/, "the allowlist must open with a reason");
  NodeAssert.ok(allowedUpstreamChanges.length > 0);
  for (const entry of allowedUpstreamChanges) {
    // Exact files only: no globs, directories or patterns, and none in the overlay's own folders.
    NodeAssert.match(entry, /^(apps|packages|scripts)\/[\w./-]+\.[a-z0-9]+$/, entry);
    NodeAssert.doesNotMatch(entry, /[*?[\]{}]|\.\.|\/$/, entry);
    NodeAssert.doesNotMatch(entry, overlayFolder, entry);
    await NodeFSP.access(entry);
  }
  NodeAssert.equal(
    new Set(allowedUpstreamChanges).size,
    allowedUpstreamChanges.length,
    "allowlist entries must be unique",
  );
  // The overlay's own folders pass whole only because upstream has nothing there.
  const upstreamSha = /UPSTREAM_SHA: ([0-9a-f]{40})/.exec(ci)?.[1];
  NodeAssert.ok(upstreamSha);
  const upstreamApps = NodeChildProcess.execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", upstreamSha, "--", "apps"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  NodeAssert.deepEqual(
    upstreamApps.split("\n").filter((file) => overlayFolder.test(file)),
    [],
  );
});

// Lazurio/t3code#30: an Update by the button moves only the service launcher's active version, so
// the user's `t3` kept the runtime it was installed with, and an older CLI writes pairings and
// sessions into a database a newer server does not read. Once the launcher has activated it, the
// server points that command at its own runtime under upstream's rules for `t3 update` (only a
// link into this T3 home's runtime versions), never while the trial can still roll back. The seam
// is one call in server.ts, right after activation; a rebuild that loses or moves it fails here.
NodeTest.test(
  "after an Update the user's t3 follows the version the launcher activated",
  async () => {
    const [server, link] = await Promise.all(
      ["apps/server/src/server.ts", "apps/server/src/lazurio/launcherLink.ts"].map(read),
    );
    NodeAssert.match(
      server,
      /yield\* awaitActivation;\n\s*\/\/ Lazurio\/t3code#30[^\n]*\n\s*yield\* repointLauncherLink\(\{/,
    );
    NodeAssert.equal(server.match(/repointLauncherLink\(/g)?.length, 1);
    NodeAssert.match(
      link,
      /import \{ repointLauncher, resolveLauncherPath \} from "\.\.\/cli\/update\.ts";/,
    );
    NodeAssert.match(link, /if \(!input\.managed \|\| platform === "win32"\) return \[\];/);
    NodeAssert.match(
      link,
      /if \(state\?\.activeVersion !== version \|\| state\.update\?\.status === "pending"\) return \[\];/,
    );
    NodeAssert.ok(overlayMayChange("apps/server/src/server.ts"));
  },
);

// Lazurio/t3code#22: only the service's drop-in sets T3CODE_RELEASE_REPOSITORY, so a shell on an
// Environment (SSH, Codex Desktop over SSH) lacks it, and there `t3 update` read upstream's
// releases, where upstream's X.Y.Z ranks above X.Y.Z-lazurio.N, and installed upstream T3 Code over
// the distribution. The distribution's default is its own releases: the update notice, `t3 update`,
// the service install and the Update read the index and download from Lazurio/t3code, and so do
// the install scripts; an explicit variable still names another repository.
NodeTest.test("the distribution installs and updates from Lazurio/t3code by default", async () => {
  for (const unset of [undefined, "", "  "]) {
    NodeAssert.equal(cliReleaseRepository(unset), "Lazurio/t3code");
  }
  NodeAssert.equal(cliReleaseRepository("pingdotgg/t3code"), "pingdotgg/t3code");
  // The index and the downloads follow the same repository.
  NodeAssert.equal(
    cliReleaseIndexPageUrl(1),
    "https://api.github.com/repos/Lazurio/t3code/releases?per_page=100&page=1",
  );
  NodeAssert.equal(
    cliReleaseDownloadBaseUrl("0.1.0-lazurio.4"),
    "https://github.com/Lazurio/t3code/releases/download/v0.1.0-lazurio.4",
  );
  NodeAssert.equal(
    cliReleaseDownloadBaseUrl("0.1.0", undefined, "pingdotgg/t3code"),
    "https://github.com/pingdotgg/t3code/releases/download/v0.1.0",
  );
  // The install scripts carry their own copy of the default.
  const [installSh, installPs1] = await Promise.all(
    ["scripts/install.sh", "scripts/install.ps1"].map(read),
  );
  NodeAssert.match(installSh, /\nrepo="\$\{T3CODE_RELEASE_REPOSITORY:-Lazurio\/t3code\}"\n/);
  NodeAssert.match(
    installPs1,
    /\n\$repo = if \(\$env:T3CODE_RELEASE_REPOSITORY\) \{ \$env:T3CODE_RELEASE_REPOSITORY\.Trim\(\) \} else \{ "Lazurio\/t3code" \}\n/,
  );
  for (const file of [
    "packages/shared/src/cliRelease.ts",
    "scripts/install.sh",
    "scripts/install.ps1",
  ]) {
    NodeAssert.ok(overlayMayChange(file), file);
  }
});

// Row 4 (Lazurio/t3code#30): a Lazurio Environment's web client is served by the server it updates,
// so its own version is no target. Every offer of an update (the composer's notice, a saved
// Environment's row, Settings -> Connections and bulk update) reads the mismatch's targetVersion: the
// release the server advertises, or the client's version where none is advertised. Since v0.1.2 two
// of those offers live in their own files (useSystemComposerBanners.tsx, #22710;
// SavedEnvironmentRows.tsx, #22685); a site that still read clientVersion would compile and silently
// offer the running version, so no web source reads it.
NodeTest.test("every update the web offers targets the release its server advertises", async () => {
  const webSources = (await NodeFSP.readdir("apps/web/src", { recursive: true })).filter(
    (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
  );
  const clientVersionReaders = [];
  for (const file of webSources) {
    if (/\.clientVersion\b/.test(await read(`apps/web/src/${file}`)))
      clientVersionReaders.push(file);
  }
  NodeAssert.deepEqual(clientVersionReaders, []);
  const files = [
    "apps/web/src/components/chat/useSystemComposerBanners.tsx",
    "apps/web/src/components/settings/SavedEnvironmentRows.tsx",
    "apps/web/src/components/settings/ConnectionsSettings.tsx",
    "apps/web/src/components/chat/useAutoBalanceUpdateBanner.tsx",
  ];
  const [banners, rows, connections, balance] = await Promise.all(files.map(read));
  NodeAssert.equal(banners.match(/versionMismatch\.targetVersion/g)?.length, 2);
  NodeAssert.equal(rows.match(/versionMismatch\.targetVersion/g)?.length, 2);
  NodeAssert.equal(connections.match(/[mM]ismatch\.targetVersion/g)?.length, 3);
  NodeAssert.match(balance, /mismatch!\.targetVersion/);
  for (const file of files) NodeAssert.ok(overlayMayChange(file), file);
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
  // A prompt that does not open says so in the person's language (Lazurio/t3code#75).
  NodeAssert.match(
    component,
    /stackedThreadToast\(\{ type: "error", \.\.\.failedPromptDraftText\(prefersCzech\(\)\) \}\)/,
  );
  // Upstream's pairing page reloads the tab after sign-in (#9785), so the link waits in this tab's
  // sessionStorage, briefly and for one read: its id and Organization, never the text.
  NodeAssert.match(
    promptDraft,
    /new URLSearchParams\(\{\s*\[PROMPT_PARAM\]: linked\.id,\s*\[ORGANIZATION_PARAM\]: linked\.organization,\s*\[STORED_LINK_EXPIRES\]: String\(now \+ STORED_LINK_LIFETIME_MS\),\s*\}\)/,
  );
  NodeAssert.match(promptDraft, /\(\) => window\.sessionStorage,/);
  NodeAssert.doesNotMatch(promptDraft, /localStorage/);
  // Every overlay file is the overlay's own or a reviewed allowlist entry.
  for (const file of promptOverlay) {
    NodeAssert.ok(overlayMayChange(file), file);
  }
});

// LazurioPlatform F51: with T3CODE_LAZURIO_FOLDER, Chat starts in the Environment's Lazurio Folder.
// Its code lives in apps/*/src/lazurio/; the upstream files keep only the hooks below, each a few
// lines, so a rebuild on a new upstream tag that loses or moves one fails here. Without the
// variable each hook leaves upstream's behaviour as it is (the overlay's own tests prove that).
NodeTest.test("the managed Lazurio Folder keeps its seams", async () => {
  const files = {
    bin: "apps/server/src/binCli.ts",
    cliConfig: "apps/server/src/cli/config.ts",
    runtime: "apps/server/src/orchestration-v2/runtimeLayer.ts",
    guards: "apps/server/src/lazurio/managedFolderGuards.ts",
    vcs: "apps/server/src/vcs/VcsProvisioningService.ts",
    startup: "apps/server/src/serverRuntimeStartup.ts",
    settings: "apps/server/src/serverSettings.ts",
    recommendation: "apps/server/src/lazurio/modelRecommendation.ts",
    recommendationRoute: "apps/server/src/lazurio/modelRecommendationRoute.ts",
    ws: "apps/server/src/ws.ts",
    contractsServer: "packages/contracts/src/server.ts",
    palette: "apps/web/src/components/CommandPalette.tsx",
    sidebar: "apps/web/src/components/Sidebar.tsx",
    sidebarHeader: "apps/web/src/components/sidebar/SidebarThreadHeader.tsx",
    hero: "apps/web/src/components/chat/DraftHeroHeadline.tsx",
    firstRun: "apps/web/src/components/onboarding/FirstRunGate.tsx",
    newThread: "apps/web/src/hooks/useHandleNewThread.ts",
    gitActions: "apps/web/src/components/GitActionsControl.tsx",
    welcome: "apps/web/src/routes/welcome.tsx",
    messageRows: "apps/web/src/components/chat/TimelineUserMessageRow.tsx",
    promptLinks: "apps/web/src/lazurio/managedPromptLinks.ts",
  };
  const source = Object.fromEntries(
    await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await read(file)])),
  );
  const before = (text, first, second, message) => {
    const at = text.indexOf(first);
    NodeAssert.ok(at >= 0 && at < text.indexOf(second), message);
  };

  // Server: `t3 lazurio`, the config, the startup adoption and the guards.
  NodeAssert.match(source.bin, /import \{ lazurioCommand \} from "\.\/lazurio\/cli\.ts";/);
  NodeAssert.match(source.bin, /\n\s+lazurioCommand,\n/);
  before(
    source.cliConfig,
    "const managedFolder = yield* resolveManagedFolderConfig;",
    "ServerConfig.deriveServerPaths(baseDir, devUrl",
    "the Folder is checked before the server's directories exist",
  );
  NodeAssert.match(source.cliConfig, /\n\s+\.\.\.managedFolder,\n\s+\};\n\n\s+return config;/);
  // The guards are decorators where upstream builds the services every transport reaches (the
  // WebSocket, HTTP, MCP, the CLI, scheduled tasks and the effect worker): the project service,
  // the orchestrator, whose dispatch takes every command, the provider session manager, which
  // opens every agent session, and T3's own project folders. Upstream builds each once, there,
  // and only through its guard.
  NodeAssert.match(
    source.runtime,
    /import \* as LazurioManagedFolder from "\.\.\/lazurio\/managedFolderGuards\.ts";/,
  );
  NodeAssert.match(
    source.runtime,
    /export const layerProjectService = LazurioManagedFolder\.guardProjects\(ProjectService\.layer\)\.pipe\(/,
  );
  // Buddy's one conversation (row 25) wraps the managed Folder's guard of the orchestrator, inside
  // the record of who acted (row 27), which only records what the guards let through.
  NodeAssert.match(
    source.runtime,
    /const layerOrchestratorProvided = LazurioActingSenders\.recordSteps\(\n\s+LazurioBuddyGuards\.guardBuddyCommands\(LazurioManagedFolder\.guardCommands\(Orchestrator\.layer\)\),\n\)\.pipe\(/,
  );
  NodeAssert.match(
    source.runtime,
    /const layerProviderSessionManagerProvided = LazurioManagedFolder\.guardTurns\(\s*ProviderSessionManager\.layer,?\s*\)\.pipe\(/,
  );
  NodeAssert.match(
    source.runtime,
    /const layerManagedProjectFoldersProvided = LazurioManagedFolder\.guardScratch\(\s*ManagedProjectFolders\.layer,?\s*\)\.pipe\(/,
  );
  for (const service of [
    "ProjectService",
    "Orchestrator",
    "ProviderSessionManager",
    "ManagedProjectFolders",
  ]) {
    NodeAssert.equal(
      source.runtime.match(new RegExp(`\\b${service}\\.layer\\b`, "g"))?.length,
      1,
      `${service}.layer is built once, through its guard`,
    );
  }
  // A refused command is never decided and a refused turn never opens a session: upstream's
  // dispatch and open run only when the guard refuses nothing. A project is created or adopted
  // only for the Folder, and the server offers no Scratch folder to any client.
  NodeAssert.match(
    source.guards,
    /dispatch: \(command\) =>\n\s+Effect\.flatMap\(commandRefusal\(command, \{ isFolderProject, isInFolderRoot \}\), \(refusal\) =>\n\s+refusal === null\n\s+\? orchestrator\.dispatch\(command\)/,
  );
  NodeAssert.match(
    source.guards,
    /open: \(input\) =>\n\s+Effect\.flatMap\(guard\.turnRefusal\(input\.runtimePolicy\.cwd\), \(refusal\) =>\n\s+refusal === null\n\s+\? sessions\.open\(input\)/,
  );
  NodeAssert.match(
    source.guards,
    /create: \(input\) => Effect\.flatMap\(inFolder\(input\), projects\.create\),/,
  );
  NodeAssert.match(
    source.guards,
    /bootstrap: \(input\) => Effect\.flatMap\(inFolder\(input\), projects\.bootstrap\),/,
  );
  NodeAssert.match(source.guards, /scratchRoot: Effect\.succeedNone,/);
  NodeAssert.match(source.vcs, /const lazurioFolderGuard = yield\* makeFolderGuard;/);
  before(
    source.vcs,
    "yield* lazurioFolderGuard.repositoryRefusal(input.cwd);",
    "driver.initRepository(input)",
    "the Folder is refused before any driver initializes a repository",
  );
  NodeAssert.match(
    source.startup,
    /runStartupPhase\(\s*"lazurio\.project",\s*ensureManagedFolderProject\./,
  );
  NodeAssert.match(source.startup, /\.\.\.welcomeBase,\n\s+\.\.\.managedWelcome,\n/);
  NodeAssert.doesNotMatch(source.startup, /lazurioFolder/);
  NodeAssert.match(source.settings, /readonly updateSettingsWith\?: \(/);
  // Through upstream's one settings writer, which applies a change to the settings as they are
  // when it writes.
  NodeAssert.match(
    source.settings,
    /updateSettingsWith: \(apply\) =>\s+updateAndPersistSettings\(\(current\) => Effect\.succeed\(apply\(current\)\)\),/,
  );
  NodeAssert.doesNotMatch(source.settings, /lazurio\//);
  NodeAssert.match(source.ws, /\n\s+\.\.\.managedFolderClientConfig\(config\),\n/);
  NodeAssert.match(
    source.contractsServer,
    /lazurioFolder: Schema\.optionalKey\(TrimmedNonEmptyString\),/,
  );
  // The Platform's recommended model becomes the Folder project's own model, upstream's override
  // per project, never the Environment's default; the overlay keeps its last write in a file of
  // its own, so upstream's settings contract stays as it is. The route takes upstream's scope for
  // writing settings.
  NodeAssert.match(
    source.recommendation,
    /projectSettingsOverrides: \{\n\s+\.\.\.current\.projectSettingsOverrides,\n\s+\[projectId\]: \{ \.\.\.overrides, defaultModelSelection: selection \},\n\s+\},/,
  );
  NodeAssert.ok(
    !overlayMayChange("packages/contracts/src/settings.ts"),
    "upstream's settings contract stays as it is",
  );
  NodeAssert.match(
    source.recommendationRoute,
    /authenticateOverlayRoute\(requiredScopeForRpcMethod\(WS_METHODS\.serverUpdateSettings\)\)/,
  );

  // Web: new threads start in the Folder, what leads elsewhere leaves only for a managed
  // Environment, and a managed Environment's /welcome goes to the index behind upstream's route
  // guard.
  NodeAssert.match(
    source.palette,
    /const projectPickerEntries = buildSidebarProjectPickerEntries\(\{\n\s+groups: projectGroups,\n\s+preferredProjectRef: contextualProjectRef,\n\s+\}\)\.filter\(offeredInProjectPicker\(environments\)\);\n/,
  );
  NodeAssert.match(
    source.palette,
    /\n\s+\.filter\(\(environment\) => environment\.serverConfig\?\.lazurioFolder === undefined\)\n/,
  );
  NodeAssert.match(
    source.palette,
    /if \(!everyEnvironmentManaged\(environments\)\) actionItems\.push\(addProjectItem\);/,
  );
  NodeAssert.match(
    source.sidebar,
    /onNewProject=\{\s*everyEnvironmentIsManaged\s*\?\s*undefined\s*:\s*openAddProjectCommandPalette\s*\}/,
  );
  NodeAssert.match(
    source.sidebar,
    /\} = useSidebarLookups\(\);\n\s+const everyEnvironmentIsManaged = useEveryEnvironmentManaged\(\);\n/,
  );
  NodeAssert.match(
    source.sidebar,
    /^import \{ useEveryEnvironmentManaged \} from "\.\.\/lazurio\/managedPromptLinks";\n/m,
  );
  NodeAssert.match(source.sidebarHeader, /\{onNewProject \? \(/);
  NodeAssert.match(
    source.hero,
    /const projectSelector = managedFolder === undefined \? projectPicker : <span>Lazurio<\/span>;/,
  );
  NodeAssert.match(
    source.firstRun,
    /const \{ decision: nextDecision, persistCompletion \} =\s*useManagedFirstRunDecision\(upstreamDecision\);/,
  );
  NodeAssert.match(
    source.newThread,
    /const environmentServerConfigs = appAtomRegistry\.get\(environmentServerConfigsAtom\);\n(?:\s*\/\/[^\n]*\n)?\s*const managed = managedNewThread\(environmentServerConfigs, projects, projectRef, options\);\n\s*if \(managed === null\) return Promise\.resolve\(null\);\n\s*\(\{ projectRef, options \} = managed\);/,
  );
  NodeAssert.match(
    source.gitActions,
    /if \(!gitCwd \|\| serverConfig\?\.lazurioFolder === gitCwd\) return null;/,
  );
  before(
    source.welcome,
    "const isWelcomeRoute = useLocation(",
    'if (lazurioFolder !== undefined) return isWelcomeRoute ? <Navigate to="/" replace /> : null;',
    "a managed Environment leaves /welcome behind upstream's welcome-route guard",
  );
  // T3's "Copy prompt link" leaves where "Add project" does (Lazurio/t3code#77): its links go to
  // upstream's hosted app with the text in the address and open no thread on a managed
  // Environment. Both palette entries come from one input; every sent message, a person's or an
  // automation's (TimelineUserMessageRow.tsx since #22676 and #22638), reads one value for the
  // whole chat.
  NodeAssert.match(
    source.palette,
    /const promptLinkInput =\n\s+promptLinkTarget === null \|\| everyEnvironmentManaged\(environments\)\n\s+\? null\n/,
  );
  NodeAssert.match(
    source.messageRows,
    /\nimport \{ usePromptLinksOffered \} from "\.\.\/\.\.\/lazurio\/managedPromptLinks";\n/,
  );
  // Both rows build their link only where links are offered, and every button reads that link.
  NodeAssert.match(
    source.messageRows,
    /const promptLink = usePromptLinksOffered\(\) \? promptLinkFor\(text\) : null;/,
  );
  NodeAssert.match(
    source.messageRows,
    /const promptLink = usePromptLinksOffered\(\) \? promptLinkFor\(plainText\) : null;/,
  );
  NodeAssert.equal(source.messageRows.match(/\bpromptLinkFor\(/g)?.length, 2);
  NodeAssert.equal(source.messageRows.match(/label="Copy prompt link"/g)?.length, 2);
  NodeAssert.equal(
    source.messageRows.match(
      /\{promptLink !== null && \(\n\s+<MessageCopyButton\n\s+text=\{promptLink\}\n\s+label="Copy prompt link"/g,
    )?.length,
    2,
  );
  // One atom holds the rule for both: the sidebar's "Add project" and the timeline's prompt links.
  NodeAssert.match(
    source.promptLinks,
    /const everyEnvironmentManagedAtom = Atom\.make\(\(get\) =>\n\s+everyEnvironmentManaged\(\n\s+get\(environmentSummaries\.identitiesAtom\),\n\s+get\(environmentServerConfigsAtom\),\n\s+\),\n\)/,
  );
  NodeAssert.match(
    source.promptLinks,
    /export const useEveryEnvironmentManaged = \(\): boolean => useAtomValue\(everyEnvironmentManagedAtom\);\n[^]*export const usePromptLinksOffered = \(\): boolean => !useAtomValue\(everyEnvironmentManagedAtom\);/,
  );
  // Those are all the places the web builds a prompt link to share; a new one is a review.
  const webSources = (await NodeFSP.readdir("apps/web/src", { recursive: true })).filter(
    (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
  );
  const linkBuilders = [];
  for (const file of webSources) {
    if (/\b(promptLinkFor|composerPromptLink)\(/.test(await read(`apps/web/src/${file}`))) {
      linkBuilders.push(file);
    }
  }
  NodeAssert.deepEqual(linkBuilders.toSorted(), [
    "components/CommandPalette.tsx",
    "components/chat/TimelineUserMessageRow.tsx",
    "components/promptLinks/copyPromptLink.ts",
  ]);

  // Every file is the overlay's own or a reviewed allowlist entry.
  for (const file of Object.values(files)) {
    NodeAssert.ok(overlayMayChange(file), file);
  }
});

// Root decision 0201 point 4 (Lazurio/t3code#46): on a Lazurio Environment Codex and Claude sign in
// through their CLIs from the Launchpad's Getting started page, never through T3's own "Continue
// with ChatGPT", which would keep a token only T3 sees. The web offers the page where it offered
// T3's sign-in, upstream's auth service refuses T3's own Codex sign-in for every client, and the
// Launchpad's `t3 lazurio providers` turns providers on and reads them again. The upstream files
// keep only the hooks below, so a rebuild that loses or moves one fails here.
NodeTest.test(
  "providers sign in through Lazurio, never through T3's own ChatGPT sign-in",
  async () => {
    const files = {
      runtime: "apps/server/src/orchestration-v2/runtimeLayer.ts",
      codexSetup: "apps/web/src/components/settings/CodexSetupSection.tsx",
      addProvider: "apps/web/src/components/settings/AddProviderInstanceDialog.tsx",
    };
    const source = Object.fromEntries(
      await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await read(file)])),
    );
    const [overlay, cli, signIn, refresh, signInWeb] = await Promise.all(
      [
        "apps/server/src/lazurio/overlay.ts",
        "apps/server/src/lazurio/cli.ts",
        "apps/server/src/lazurio/providerSignIn.ts",
        "apps/server/src/lazurio/providerRefresh.ts",
        "apps/web/src/lazurio/LazurioSignIn.tsx",
      ].map(read),
    );

    // Server: the one auth service every transport uses is upstream's behind the guard, which
    // runtimeLayer.ts builds once, through the guard.
    NodeAssert.match(
      source.runtime,
      /import \* as LazurioProviderSignIn from "\.\.\/lazurio\/providerSignIn\.ts";/,
    );
    NodeAssert.match(
      source.runtime,
      /const layerProviderAuthServiceProvided = LazurioProviderSignIn\.guard\(\s*ProviderAuthService\.layer,?\s*\)\.pipe\(/,
    );
    NodeAssert.equal(source.runtime.match(/\bProviderAuthService\.layer\b/g)?.length, 1);
    NodeAssert.match(signIn, /if \(config\.lazurioFolder === undefined\) return auth;/);
    NodeAssert.match(signIn, /start: \(input, ownerSessionId\) =>/);
    NodeAssert.match(signIn, /importProfile: \(input\) =>/);
    // The route is the overlay's, and the CLI the Launchpad runs reaches it. It takes upstream's
    // scopes for refreshing providers and for changing provider instances (#9786), so it does only
    // what a client with those scopes could do over the WebSocket.
    NodeAssert.match(
      overlay,
      /ProviderRefreshRoute\.layer\.pipe\(Layer\.provide\(ProviderRefresh\.layer\)\)/,
    );
    NodeAssert.match(
      refresh,
      /export const PROVIDER_REFRESH_SCOPES = \[\n\s+\.\.\.new Set\(\[\n\s+requiredScopeForRpcMethod\(WS_METHODS\.serverRefreshProviders\),\n\s+\.\.\.requiredScopesForServerSettingsPatch\(\{ providerInstances: \{\} \}\),\n\s+\]\),\n\];/,
    );
    NodeAssert.match(
      cli,
      /Command\.withSubcommands\(\[\s*modelCommand,\s*providersCommand,\s*pairingCommand,\s*capabilitiesCommand,\s*buddyCommand,?\s*\]\)/,
    );
    NodeAssert.match(cli, /providerRefresh: true/);

    // Web: on a Lazurio Environment the page takes the place of T3's sign-in, before any of it.
    const guarded = (text, component, message) => {
      const start = text.indexOf(component);
      NodeAssert.ok(start >= 0, `${message}: component`);
      const body = text.slice(start);
      const guard = body.search(
        /if \(lazurioSignIn\)\s+return (\(\s*)?<LazurioSignIn(Row|Dialog)\b/,
      );
      NodeAssert.ok(guard > 0, `${message}: guard`);
      NodeAssert.ok(guard < body.indexOf("\n  return"), `${message}: before upstream's render`);
    };
    guarded(
      source.codexSetup,
      "export function CodexSetupSection(props: CodexSetupSectionProps) {",
      "the Codex setup in Settings and the welcome",
    );
    // A managed account already signed in keeps upstream's way out (its Disconnect) there.
    NodeAssert.match(
      source.codexSetup,
      /<LazurioSignInRow\s+environmentId=\{props\.environmentId\}\s+instanceId=\{props\.instanceId\}\s+mode=\{props\.mode\}\s+provider=\{props\.provider\}\s+readOnly=\{props\.readOnly\}\s+enabled=\{props\.enabled\}\s+\/>/,
    );
    guarded(
      source.codexSetup,
      "export function AddManagedCodexAccountDialog({",
      "another ChatGPT account",
    );
    // The dialog's "Continue with ChatGPT" is upstream's button inside the overlay's choice, which
    // shows the page in its place on a Lazurio Environment and upstream's button elsewhere.
    NodeAssert.match(
      source.addProvider,
      /<LazurioSignInChoice environmentId=\{environmentId\}>\s*<ChatGptConnectionButton\s+size="sm"\s+onClick=\{\(\) => setAddingChatGptAccount\(true\)\}\s+\/>\s*<\/LazurioSignInChoice>/,
    );
    NodeAssert.match(
      signInWeb,
      /export function LazurioSignInChoice\(\{[^]*?const signIn = useLazurioSignIn\(environmentId\);[^]*?\n\s+if \(!signIn\) return children;\n\s+return signIn\.toolsUrl \? \(\n\s+<OpenGettingStarted /,
    );

    // Every file is the overlay's own or a reviewed allowlist entry.
    for (const file of Object.values(files)) {
      NodeAssert.ok(overlayMayChange(file), file);
    }
  },
);

NodeTest.test("the Lazurio shell slot survives a rebuild on a new upstream tag", async () => {
  const [page, layout, sidebarUi, chrome, threads, legacy, styles, chat] = await Promise.all([
    read("apps/web/index.html"),
    read("apps/web/src/components/AppSidebarLayout.tsx"),
    read("apps/web/src/components/ui/sidebar.tsx"),
    read("apps/web/src/components/sidebar/SidebarChrome.tsx"),
    read("apps/web/src/components/Sidebar.tsx"),
    read("apps/web/src/components/LegacySidebar.tsx"),
    read("apps/web/src/index.css"),
    read("apps/web/src/components/ChatView.tsx"),
  ]);
  // LazurioPlatform F60, addendum of 2026-10-25: while the shell draws Buddy's launcher in the
  // window's bottom-right corner it sets --lazurio-buddy-clearance, and the Chat composer keeps its
  // send button out of that corner. The rule repeats the end padding of upstream's composer lane,
  // so the lane's padding and the stack the rule moves must stay as upstream draws them.
  NodeAssert.match(
    page,
    /\[data-chat-composer-stack\] \{\s*--lazurio-composer-gutter: calc\(\s*env\(safe-area-inset-right\) \+ 0\.75rem \+ var\(--chat-lane-inset-end, 0px\)\s*\);\s*--lazurio-composer-end: max\(\s*0px,\s*var\(--lazurio-buddy-clearance, 0px\) - var\(--lazurio-composer-gutter\),\s*\(100% - var\(--chat-content-max-width\)\) \/ 2\s*\);\s*margin-inline-end: var\(--lazurio-composer-end\);\s*max-width: min\(var\(--chat-content-max-width\), 100% - var\(--lazurio-composer-end\)\);\s*\}/,
  );
  NodeAssert.match(
    page,
    /@media \(min-width: 640px\) \{\s*\[data-chat-composer-stack\] \{\s*--lazurio-composer-gutter: calc\(\s*env\(safe-area-inset-right\) \+ 3rem \+ var\(--chat-lane-inset-end, 0px\)\s*\);\s*\}\s*\}/,
  );
  NodeAssert.match(
    styles,
    /\.chat-composer-lane \{\n(?:.*\n){0,3}?\s+padding-inline-end: calc\(\n\s+env\(safe-area-inset-right\) \+ 0\.75rem \+ var\(--chat-lane-inset-end, 0px\)\n\s+\);/,
  );
  NodeAssert.match(
    styles,
    /@media \(min-width: 640px\) \{\n\s+\.chat-composer-lane \{\n(?:.*\n){0,3}?\s+padding-inline-end: calc\(env\(safe-area-inset-right\) \+ 3rem \+ var\(--chat-lane-inset-end, 0px\)\);/,
  );
  NodeAssert.match(
    chat,
    /<div ref=\{draftHeroTransitionGroupRef\} className="chat-composer-lane w-full">\n\s+<div\n\s+data-chat-composer-stack="true"\n\s+className="group\/composer-stack pointer-events-auto relative z-10 mx-auto w-full max-w-\(--chat-content-max-width\)"/,
  );
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
    /<body>\s*<lazurio-rail data-app-sidebar app="chat"><\/lazurio-rail>\s*<div id="root">/,
  );
  NodeAssert.match(
    page,
    /<\/div>\s*<lazurio-buddy><\/lazurio-buddy>\s*<script type="module" src="\/src\/bootstrap\.ts"><\/script>\s*<\/body>/,
  );
  // The column head sits under every sidebar's top row, with its toggle and the wordmark at the
  // top of the column (the approved design of 2026-10-17). The header renders it, and the thread,
  // legacy and settings sidebars all render the header; the layout and its toggle are upstream's.
  NodeAssert.match(
    chrome,
    /\nexport const SidebarChromeHeader = memo\(function SidebarChromeHeader\(props: \{\n\s*isElectron: boolean;\n\}\) \{\n\s*return \(\n\s*<>\n\s*<SidebarChromeTitlebar \{\.\.\.props\} \/>\n\s*\{createElement\("lazurio-column-head", \{ active: "chat" \}\)\}\n\s*<\/>/,
  );
  NodeAssert.equal(chrome.match(/lazurio-column-head/g)?.length, 1);
  NodeAssert.match(
    chrome,
    /\nconst SidebarChromeTitlebar = memo\(function SidebarChromeTitlebar\(\{/,
  );
  for (const sidebar of [threads, legacy]) {
    NodeAssert.match(sidebar, /<SidebarChromeHeader isElectron=\{isElectron\} \/>/);
  }
  NodeAssert.match(
    layout,
    /<SidebarChromeHeader isElectron=\{isElectron\} \/>\s*<SettingsSidebarNav /,
  );
  NodeAssert.doesNotMatch(layout, /lazurio/i);
  NodeAssert.match(layout, /\n\s*<SidebarControl \/>\n/);
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
  NodeAssert.match(page, /<lazurio-rail data-app-sidebar app="chat"><\/lazurio-rail>/);
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

// Root decision 0200: in the app, T3 Code on a Lazurio Environment is "T3 Code (Lazurio)". The
// distribution's builds have the stage label Lazurio where upstream's say Beta, the label stands
// beside the wordmark in the sidebar, and the page title, the splash and the web manifest say the
// same. A preview (X.Y.Z-preview.YYYYMMDD.N) is a canary of the next stable release, not a
// nightly. T3 Code's mark stays: the product name, the wordmark and the icons are upstream's.
NodeTest.test("the app is T3 Code (Lazurio) and keeps T3 Code's mark", async () => {
  const nameOverlay = [
    "apps/web/index.html",
    "apps/web/public/manifest.webmanifest",
    "apps/web/src/branding.logic.ts",
    // The name's tests are the overlay's since v0.1.2 deleted upstream's branding.test.ts.
    "apps/web/src/lazurio/branding.test.ts",
    "apps/web/src/branding.ts",
    "apps/web/src/components/sidebar/SidebarChrome.tsx",
  ];
  const [page, manifest, , , branding, chrome] = await Promise.all(nameOverlay.map(read));
  NodeAssert.match(
    branding,
    /export const APP_BASE_NAME = injectedDesktopAppBranding\?\.baseName \?\? "T3 Code";/,
  );
  NodeAssert.match(branding, /\(import\.meta\.env\.DEV \? "Dev" : "Lazurio"\);/);
  const logic = await import("../apps/web/src/branding.logic.ts");
  for (const primaryServerVersion of ["0.1.0-lazurio.1", "0.1.0-preview.20261017.1", null]) {
    NodeAssert.equal(
      logic.resolveServerBackedAppDisplayName({
        baseName: "T3 Code",
        fallbackDisplayName: "T3 Code (Lazurio)",
        fallbackStageLabel: "Lazurio",
        primaryServerVersion,
      }),
      "T3 Code (Lazurio)",
      String(primaryServerVersion),
    );
  }
  // The label beside the wordmark, in the slot upstream gives its Dev and Nightly pills.
  NodeAssert.match(
    chrome,
    /const pillLabel =\n\s+stageLabel === "Lazurio"\n\s+\? stageLabel\n\s+: environmentIdentificationMode === "pill"\n/,
  );
  NodeAssert.match(chrome, /data-environment-identification="pill"[^]*?\{pillLabel\}/);
  // On Lazurio the label is the overlay's, with the design system's symbol at its 16 px minimum.
  NodeAssert.match(chrome, /\{pillLabel === "Lazurio" \? \(\n\s*<LazurioBadge \/>\n\s*\) : \(/);
  NodeAssert.match(page, /<title>T3 Code \(Lazurio\)<\/title>/);
  NodeAssert.match(
    page,
    /<div id="boot-shell-card" aria-label="T3 Code \(Lazurio\) splash screen">/,
  );
  NodeAssert.match(
    page,
    /<img id="boot-shell-logo" src="\/apple-touch-icon\.png" alt="T3 Code \(Lazurio\)" \/>/,
  );
  const webManifest = JSON.parse(manifest);
  NodeAssert.equal(webManifest.name, "T3 Code (Lazurio)");
  NodeAssert.equal(webManifest.short_name, "T3 Code");
  // The mark is upstream's, byte for byte: the wordmark, the web client's icons and assets/. Buddy's
  // character (row 25) sits beside them and is not T3's mark.
  const upstreamSha = /UPSTREAM_SHA: ([0-9a-f]{40})/.exec(ci)?.[1];
  NodeAssert.ok(upstreamSha);
  NodeAssert.doesNotThrow(() =>
    NodeChildProcess.execFileSync("git", [
      "diff",
      "--quiet",
      upstreamSha,
      "--",
      "apps/web/src/components/T3Wordmark.tsx",
      "apps/web/public",
      "assets",
      ":(exclude)apps/web/public/manifest.webmanifest",
      ":(exclude)apps/web/public/assets/avatar.webp",
    ]),
  );
  for (const file of nameOverlay) {
    NodeAssert.ok(overlayMayChange(file), file);
  }
});

// A stylesheet's top-level rules, each with its selector and the declarations directly in it;
// comments and nested blocks (index.css's @variant, @layer and the like) are left out. Enough
// for index.css and the overlay's theme.css, not a general CSS parser.
function topLevelRules(css) {
  const text = css.replace(/\/\*[^]*?\*\//g, "");
  const rules = [];
  let depth = 0;
  let start = 0;
  let own = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "{") {
      if (depth === 0) {
        // After any statement at-rule (@import, @custom-variant) that ends in a semicolon.
        const prelude = text.slice(start, index);
        const selector = prelude.slice(prelude.lastIndexOf(";") + 1);
        rules.push({ selector: selector.trim().replace(/\s+/g, " ") });
        own = "";
      } else if (depth === 1) {
        // The nested block's own prelude is not a declaration of this rule.
        own = own.slice(0, Math.max(own.lastIndexOf(";"), own.lastIndexOf("}")) + 1);
      }
      depth += 1;
      start = index + 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        const rule = rules.at(-1);
        rule.declarations = own
          .split(";")
          .map((declaration) => declaration.trim())
          .filter((declaration) => declaration.length > 0)
          .map((declaration) => {
            const colon = declaration.indexOf(":");
            return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
          });
      }
      if (depth === 1) own += ";";
      start = index + 1;
    } else if (depth === 1) {
      own += character;
    }
  }
  return rules;
}

// Root decision 0200, point 4: on a Lazurio Environment, T3 Code's standard light look takes the
// design system's colours, type and radii. The Environment's shell declares the design system's
// tokens (--lz-*) on the document's root and marks it data-lazurio-theme="light" (LazurioPlatform
// F36's addendum of 2026-10-13); one overlay stylesheet maps them onto T3's raw tokens, only where
// no theme is picked, and in light mode, or in dark mode too where the Environment's theme has a
// dark variant (root decision 0208: the shell marks the root data-lazurio-theme-dark and sets the
// dark values of the same names). T3 derives its --contrast-* tokens from the raw ones, so the
// contrast setting keeps working; a picked theme and the dark mode of a light-only theme keep T3's
// palettes; the shell's colour roles (the test above) follow by themselves. Without the shell
// nothing matches.
NodeTest.test("the design system's light look maps the shell's tokens onto T3's own", async () => {
  const [main, theme, styles] = await Promise.all(
    ["apps/web/src/main.tsx", "apps/web/src/lazurio/theme.css", "apps/web/src/index.css"].map(read),
  );
  // One import, right after T3's own stylesheet.
  NodeAssert.match(main, /\nimport "\.\/index\.css";\nimport "\.\/lazurio\/theme\.css";\n/);
  NodeAssert.equal(main.match(/theme\.css/g)?.length, 1);
  NodeAssert.ok(overlayMayChange("apps/web/src/main.tsx"));
  // Two mappings, both behind the shell's mark and its value, outside a picked theme, and outside
  // dark mode unless the Environment's theme has a dark variant: the document's root and the
  // sidebar's palette scope, which the shell's rail joins. Then the rail's own rule (below).
  const gate =
    ':root[data-lazurio-theme="light"]:not([data-theme-id]):is(:not(.dark), [data-lazurio-theme-dark])';
  const [rootRule, sidebarRule, railRule, ...extra] = topLevelRules(theme);
  NodeAssert.deepEqual(
    [rootRule, sidebarRule, railRule].map((rule) => rule?.selector),
    [gate, `${gate} [data-app-sidebar]`, "lazurio-rail[data-app-sidebar]"],
  );
  NodeAssert.equal(extra.length, 0);
  const rules = [rootRule, sidebarRule];
  // The tokens T3 declares in those scopes in index.css: its root (and the font tokens of its
  // @theme, which Tailwind emits on the root), and its sidebar palette scope.
  const declared = (selectors) =>
    new Set(
      topLevelRules(styles)
        .filter((rule) => selectors.includes(rule.selector))
        .flatMap((rule) => rule.declarations.map(([name]) => name)),
    );
  const scopes = [declared([":root", "@theme"]), declared(["[data-app-sidebar]"])];
  // The design system's tokens the mapping reads, each a name the shell's interface v1 promises
  // (LazurioPlatform src/shell/interface.ts `declares`, kept by tests/shell-tokens.test.ts). The
  // values are the design system's and arrive with the Platform; a new name needs the promise.
  const promised = [
    "--lz-accent",
    "--lz-accent-button",
    "--lz-accent-button-hover",
    "--lz-danger",
    "--lz-danger-bg",
    "--lz-font-mono",
    "--lz-font-sans",
    "--lz-gray-100",
    "--lz-gray-50",
    "--lz-green-500",
    "--lz-info",
    "--lz-info-bg",
    "--lz-ink",
    "--lz-ink-muted",
    "--lz-line",
    "--lz-on-accent",
    "--lz-paper",
    "--lz-radius-sm",
    "--lz-red-500",
    "--lz-success",
    "--lz-surface",
    "--lz-warning",
    "--lz-warning-bg",
  ];
  const used = new Set();
  for (const [index, rule] of rules.entries()) {
    const values = new Map(rule.declarations);
    NodeAssert.equal(
      values.size,
      rule.declarations.length,
      `${rule.selector}: one value per token`,
    );
    for (const [name, value] of rule.declarations) {
      // T3's raw tokens only, never what T3 derives from them, a picked theme's roles, the shell's
      // colour roles or the design system's own tokens.
      NodeAssert.match(name, /^--[a-z][a-z0-9-]*$/, name);
      NodeAssert.doesNotMatch(name, /^--(contrast|app-theme|lazurio|lz)-/, name);
      NodeAssert.ok(scopes[index].has(name), `${name} is not declared in index.css's same scope`);
      // No colour literal: a promised design system token, or no grain at all.
      if (name === "--surface-grain") {
        NodeAssert.equal(value, "none");
        continue;
      }
      const token = /^var\((--lz-[a-z0-9-]+)\)$/.exec(value)?.[1];
      NodeAssert.ok(token && promised.includes(token), `${name}: ${value}`);
      used.add(token);
    }
    // The shell's switch: its active tab (row-active) never melts into its track.
    NodeAssert.ok(values.has("--sidebar-row-active") && values.has("--sidebar-control-surface"));
    NodeAssert.notEqual(
      values.get("--sidebar-row-active"),
      values.get("--sidebar-control-surface"),
    );
  }
  NodeAssert.deepEqual([...used].toSorted(), promised.toSorted());
  // The rail inherits from the document every colour an Environment theme sets (LazurioPlatform
  // src/shell/contract.ts shellThemeColors), and nothing else. The shell declares the design
  // system's tokens on its own elements (:host), which holds on the rail itself, so without this
  // the sidebar's scope on the rail would read the design system's colours, not the theme's: the
  // rail stayed Lazurio's paper beside an Ocean sidebar, light and dark, on Ring 0 (2026-10-19).
  const themeColors = [
    "--lz-surface",
    "--lz-paper",
    "--lz-ink",
    "--lz-ink-muted",
    "--lz-line",
    "--lz-accent",
    "--lz-accent-button",
    "--lz-accent-button-hover",
    "--lz-on-accent",
    "--lz-gray-50",
    "--lz-gray-100",
    "--lz-red-500",
    "--lz-danger",
    "--lz-danger-bg",
    "--lz-warning",
    "--lz-warning-bg",
    "--lz-green-500",
    "--lz-success",
    "--lz-info",
    "--lz-info-bg",
  ];
  NodeAssert.deepEqual(
    railRule.declarations,
    themeColors.map((name) => [name, "inherit"]),
  );
  // Every colour the sidebar's scope reads is one of them; type and corners are not a theme's.
  for (const [name, value] of sidebarRule.declarations) {
    const token = /^var\((--lz-[a-z0-9-]+)\)$/.exec(value)?.[1];
    if (token === undefined || /^--lz-(font|radius)-/.test(token)) continue;
    NodeAssert.ok(themeColors.includes(token), `${name}: ${token} is not a theme colour`);
  }
  NodeAssert.doesNotMatch(
    theme.replace(/\/\*[^]*?\*\//g, ""),
    /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(|!important/i,
  );
  // Type, corners and texture: the design system's faces (the shell declares them), its control
  // radius, and no grain.
  const root = new Map(rules[0].declarations);
  NodeAssert.equal(root.get("--font-sans"), "var(--lz-font-sans)");
  NodeAssert.equal(root.get("--font-mono"), "var(--lz-font-mono)");
  NodeAssert.equal(root.get("--control-radius"), "var(--lz-radius-sm)");
  NodeAssert.equal(root.get("--surface-grain"), "none");
  // A picked theme maps T3's roles on the same root, behind data-theme-id, which the gate leaves out.
  NodeAssert.match(styles, /\nhtml\[data-theme-id\]:not\(\[data-theme-id=""\]\) \{\n/);
  NodeAssert.match(styles, /\nhtml\[data-theme-id\] \[data-app-sidebar\] \{\n/);
});

// The Environment's theme is right from the first paint (root decision 0208, LazurioPlatform F36's
// addendum of 2026-10-18): `/.lazurio/shell.js` declares the tokens and the theme its origin
// remembers as it evaluates, so it runs before T3's own module. Both are module scripts, which run
// in document order, and Vite's build keeps the shell's tag before the entry it emits.
NodeTest.test("the Environment's shell runs before T3's own module", async () => {
  const html = await read("apps/web/index.html");
  const shell = html.indexOf(
    '<script type="module" src="/.lazurio/shell.js" vite-ignore></script>',
  );
  const entry = html.indexOf('<script type="module" src="/src/bootstrap.ts"></script>');
  NodeAssert.ok(shell >= 0, "the shell's script tag");
  NodeAssert.ok(entry >= 0, "T3's entry module");
  NodeAssert.ok(shell < entry);
});

// Root decision 0191 (plan DEV-6646): the agents of every thread drive a window of their own in
// the Environment browser through the agent-browser CLI, which takes the session from
// AGENT_BROWSER_SESSION. Every agent process T3 starts for one thread starts through the server's
// agent scope, which the overlay decorates with the thread's session. Codex runs one app-server
// for every thread of an instance, so each Codex thread's config sets the session for the commands
// its agent runs instead. A thread's terminals reach the agent scope without their thread, by which
// upstream keys its bookkeeping of a thread's agents, so the terminal manager puts the session into
// the environment it starts their shells with (Lazurio/t3code#73).
NodeTest.test(
  "every provider process and terminal of a thread gets the thread's agent-browser session",
  async () => {
    const [server, codex, terminals, session] = await Promise.all([
      read("apps/server/src/server.ts"),
      read("apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts"),
      read("apps/server/src/terminal/Manager.ts"),
      import("../apps/server/src/lazurio/agentBrowserSession.ts"),
    ]);
    NodeAssert.equal(session.AGENT_BROWSER_SESSION_ENV, "AGENT_BROWSER_SESSION");
    // The server's one agent scope, below every agent and terminal spawn, is upstream's behind the
    // decorator, and only through it.
    NodeAssert.match(
      server,
      /\n\s+Layer\.provideMerge\(LazurioAgentBrowserSession\.decorateAgentScope\(AgentScopeLive\.layer\)\),\n/,
    );
    NodeAssert.equal(server.match(/decorateAgentScope\(/g)?.length, 1);
    NodeAssert.equal(server.match(/AgentScopeLive\.layer/g)?.length, 1);
    // A Codex thread's start, resume and fork take its runtime params, whose config sets the
    // session through Codex's shell environment policy.
    const start = codex.indexOf("function codexThreadRuntimeParams(");
    NodeAssert.ok(start >= 0, "CodexAdapterV2.ts must build a thread's runtime params");
    const params = codex.slice(start, codex.indexOf("\n}\n", start));
    NodeAssert.match(
      params,
      /\n\s+\.\.\.LazurioAgentBrowserSession\.codexThreadConfig\(mcpSession\),\n/,
    );
    NodeAssert.equal(codex.match(/LazurioAgentBrowserSession\.codexThreadConfig\(/g)?.length, 1);
    NodeAssert.deepEqual(session.codexThreadConfig({ threadId: "thread-1" }), {
      "shell_environment_policy.set.AGENT_BROWSER_SESSION": "t3-thread-1",
    });
    NodeAssert.deepEqual(session.codexThreadConfig(undefined), {});
    // A thread's terminal: one call, right where the terminal manager builds the environment of
    // the thread's shell and before any shell starts with it. The agent scope still gets no thread
    // for a terminal, so upstream's per-thread bookkeeping stays its agents'.
    NodeAssert.match(
      terminals,
      /\n\s+const terminalEnv = createTerminalSpawnEnv\([^)]*\);\n(?:\s*\/\/[^\n]*\n)?\s+LazurioAgentBrowserSession\.setTerminalSession\(terminalEnv, session\.threadId, platform\);\n/,
    );
    NodeAssert.equal(terminals.match(/LazurioAgentBrowserSession\./g)?.length, 1);
    NodeAssert.ok(
      terminals.indexOf("LazurioAgentBrowserSession.setTerminalSession(") <
        terminals.indexOf("yield* trySpawn(shellCandidates, terminalEnv, session);"),
    );
    NodeAssert.equal(terminals.match(/agentScope\.wrap\(/g)?.length, 1);
    const terminalScope = /agentScope\.wrap\(\{([^}]*)\}\)/.exec(terminals)?.[1] ?? "";
    NodeAssert.match(terminalScope, /\bname: "terminal",/);
    NodeAssert.doesNotMatch(terminalScope, /threadId/);
    const terminalEnv = { PATH: "/usr/bin" };
    session.setTerminalSession(terminalEnv, "thread-1", "linux");
    NodeAssert.deepEqual(terminalEnv, { PATH: "/usr/bin", AGENT_BROWSER_SESSION: "t3-thread-1" });
    const windowsTerminalEnv = { PATH: "C:\\Windows" };
    session.setTerminalSession(windowsTerminalEnv, "thread-1", "win32");
    NodeAssert.deepEqual(windowsTerminalEnv, { PATH: "C:\\Windows" });
    NodeAssert.ok(overlayMayChange("apps/server/src/terminal/Manager.ts"));
  },
);

// The web client has no browser: on a Lazurio Environment the right panel shows the thread's tabs
// of the Environment browser, each the view of one remote tab in a frame, from the list T3 Code's
// server keeps in the thread's holder file (LazurioPlatform F47, task 501).
NodeTest.test(
  "the right panel shows the thread's Environment browser tabs through its seams",
  async () => {
    const [store, tabs, chatView, view, component, threadTabs, entities, chatRightPanel] =
      await Promise.all(
        [
          "apps/web/src/rightPanelStore.ts",
          "apps/web/src/components/RightPanelTabs.tsx",
          "apps/web/src/components/ChatView.tsx",
          "apps/web/src/lazurio/environmentBrowser.ts",
          "apps/web/src/lazurio/LazurioEnvironmentBrowser.tsx",
          "apps/web/src/lazurio/threadTabs.ts",
          "apps/web/src/state/entities.ts",
          "apps/web/src/components/chat/ChatRightPanel.tsx",
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
    // Upstream's reopening of closed views (Mod+Shift+T) leaves these tabs out: closing one lets
    // go of it, and Vrátit is its way back.
    NodeAssert.match(
      store,
      /\(surface\.kind === "preview" && surface\.resourceId !== null\) \|\|\n(?:\s*\/\/[^\n]*\n)?\s+surface\.kind === "environment-browser"\n\s+\)\n\s+continue;\n\s+useClosedViewStore\.getState\(\)\.remember\(/,
    );
    // The strip's title, icon and tooltip come from the overlay, its hook is one call.
    NodeAssert.match(tabs, /^import \* as Lazurio from "~\/lazurio\/LazurioEnvironmentBrowser";$/m);
    // The frames' titles reach the compiled strip as an input, never read from a store in render.
    NodeAssert.match(
      tabs,
      /case "environment-browser":\n\s+return Lazurio\.surfaceTitle\(surface, lazurioTitles\);/,
    );
    NodeAssert.match(tabs, /\n\s+lazurioTitles: Lazurio\.FrameTitles,\n\): string \{/);
    NodeAssert.match(
      tabs,
      /title=\{surfaceTitle\(\n\s+surface,\n\s+props\.previewSessions,\n\s+props\.terminalLabelsById,\n\s+lazurio\.titles,\n\s+\)\}/,
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
    // Each strip tab is upstream's compiled RightPanelTab: the overlay's tooltip is a component in
    // place of the title, so the tab's props stay upstream's.
    NodeAssert.match(
      tabs,
      /\) : \(\n\s+<Lazurio\.TabTooltip surface=\{surface\} title=\{title\} \/>\n\s+\)\}\n\s+<\/TooltipPopup>/,
    );
    NodeAssert.doesNotMatch(tabs, /environmentBrowserTitles|previewBridge \? browserDefaults/);
    // ChatView: one hook call, and upstream's surface in view wrapped once beside the frames.
    NodeAssert.equal(chatView.match(/useLazurioThreadTabs\(/g)?.length, 1);
    // A draft opens no stream until its first message makes it a thread (Lazurio/t3code#53), and
    // Buddy's surface, which has no right panel, follows no thread's tabs (row 28).
    NodeAssert.match(
      chatView,
      /useLazurioThreadTabs\(buddySurface \? null : activeThreadRef, \{\n\s+inlinePanel: !shouldUsePlanSidebarSheet,\n\s+draft: !isServerThread,\n\s+\}\);/,
    );
    NodeAssert.match(chatView, /const rightPanelActiveContent = activeThreadRef \? \(/);
    NodeAssert.match(
      chatView,
      /const rightPanelContent = activeThreadRef \? \(\n\s+<LazurioRightPanelSurfaces\n\s+threadRef=\{activeThreadRef\}\n\s+surfaces=\{renderedRightPanelSurfaces\}\n\s+activeSurfaceId=\{renderedRightPanelSurface\?\.id \?\? null\}\n\s+>\n\s+\{rightPanelActiveContent\}/,
    );
    // Since #22700 ChatView hands the panel's content once, as children, to ChatRightPanel, which
    // passes its props to RightPanelTabs inline and in the sheet alike.
    NodeAssert.equal(chatView.match(/\{rightPanelContent\}/g)?.length, 1);
    NodeAssert.match(
      chatView,
      /<ChatRightPanel\n[^]*?\n\s+\{rightPanelContent\}\n\s+<\/ChatRightPanel>/,
    );
    NodeAssert.equal(chatRightPanel.match(/<RightPanelTabs\s+\{\.\.\.tabs\}/g)?.length, 2);
    NodeAssert.doesNotMatch(chatView, /environmentBrowser\.|kind === "environment-browser"/);
    // Upstream's own Browser is there only in the desktop app or where the Environment's server
    // advertises its server browser, which a Lazurio Environment's does not (the server's seams
    // below), so the web needs no seam of its own to leave it out.
    NodeAssert.equal(
      chatView.match(
        /const activeEnvironmentServerBrowser = useEnvironmentSupportsServerBrowser\(/g,
      )?.length,
      1,
    );
    NodeAssert.equal(
      chatView.match(
        /const browserAvailable = isPreviewSupportedInRuntime\(\) \|\| activeEnvironmentServerBrowser;/g,
      )?.length,
      1,
    );
    NodeAssert.equal(
      chatView.match(/browserAvailable=\{canOperatePreview && browserAvailable\}/g)?.length,
      1,
    );
    NodeAssert.equal(entities.match(/capabilities\s*\.serverBrowser === true/g)?.length, 2);
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
      NodeAssert.ok(overlayMayChange(file), file);
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
    /openProactive: \([^]*?\{ kind: "pull-request" \| "pull-requests" \| "environment-browser" \}/,
  );
  // The strip already has the tab when it is revealed, so both reveals ask upstream to activate an
  // existing surface (#13608); without it preview_open would never open the panel.
  NodeAssert.match(
    threadTabs,
    /\.openProactive\(\n\s+threadRef,\n\s+\{ id: tabSurfaceId\(tabId\), kind: "environment-browser" \},\n\s+revision,\n\s+true,\n\s+\);/,
  );
  NodeAssert.match(
    threadTabs,
    /store\.openProactive\(threadRef, surface, store\.getUserActionRevision\(threadRef\), true\);/,
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
  const [route, service, holders, overlay, routeAuth, lifecycle] = await Promise.all(
    [
      "apps/server/src/lazurio/threadTabsRoute.ts",
      "apps/server/src/lazurio/threadTabs.ts",
      "apps/server/src/lazurio/holders.ts",
      "apps/server/src/lazurio/overlay.ts",
      "apps/server/src/lazurio/routeAuth.ts",
      "apps/server/src/lazurio/threadLifecycle.ts",
    ].map(read),
  );
  NodeAssert.match(route, /export const THREAD_TABS_ROUTE = "\/api\/lazurio\/thread-tabs";/);
  // The overlay's routes authenticate as upstream's HTTP routes do, through one helper.
  NodeAssert.match(
    route,
    /import \{ authenticateOverlayRoute as authenticate \} from "\.\/routeAuth\.ts";/,
  );
  NodeAssert.match(routeAuth, /serverAuth\.authenticateHttpRequest\(request\)/);
  NodeAssert.match(routeAuth, /if \(!session\.scopes\.includes\(scope\)\)/);
  for (const source of [route, routeAuth]) {
    NodeAssert.doesNotMatch(source, /authenticateWebSocketUpgrade|authenticateMediaRequest/);
  }
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
  // The overlay's one layer: the Environment browser host and the overlay's seven routes, over one
  // thread tabs service, which follows the threads' lifecycle.
  NodeAssert.match(
    overlay,
    /\nexport const layer = Layer\.mergeAll\(\s*EnvironmentBrowser\.layer,\s*ThreadTabsRoute\.layer,\s*ModelRecommendationRoute\.layer,\s*ProviderRefreshRoute\.layer\.pipe\(Layer\.provide\(ProviderRefresh\.layer\)\),\s*BuddySurfaceThreadRoute\.layer,\s*AgentCliSendState\.layer,\s*BuddySurfaceDays\.layer,\s*ActingSendersRoute\.layer\.pipe\(Layer\.provide\(ActingSenders\.layer\)\),?\s*\)\.pipe\(Layer\.provide\(ThreadTabs\.layer\.pipe\(Layer\.provide\(ThreadLifecycle\.layer\)\)\)\);/,
  );
  // Archiving or deleting a thread lets go of its tabs: the lifecycle follows upstream's
  // orchestrator's domain events, and the sweep of threads that are gone waits until commands are
  // ready, so a starting server never lets go of every thread's tabs.
  NodeAssert.match(lifecycle, /events: orchestrator\.streamDomainEvents\.pipe\(/);
  NodeAssert.match(lifecycle, /ready: startup\.awaitCommandReady\.pipe\(Effect\.ignore\),/);
  NodeAssert.match(
    service,
    /yield\* forkParked\(lifecycle\.ready\.pipe\(Effect\.andThen\(Effect\.sync\(\(\) => markReady\(\)\)\)\)\);/,
  );
});

// Plan DEV-6646, root decision 0191: on a Lazurio Environment T3's browser tools drive the
// Environment browser, the only browser of web T3. Upstream's server browser is neither built nor
// advertised there, and the overlay's host registers as upstream's preferred preview host and
// drives pages with upstream's page engine. The host is server overlay files in
// apps/server/src/lazurio; the seams are a few lines in upstream files, so a rebuild on a new
// upstream tag that loses one fails here.
NodeTest.test("T3's browser tools reach the Environment browser through their seams", async () => {
  const [server, environment, predicate, gate, host, connection, page, engine] = await Promise.all(
    [
      "apps/server/src/server.ts",
      "apps/server/src/environment/ServerEnvironment.ts",
      "apps/server/src/lazurio/lazurioEnvironment.ts",
      "apps/server/src/lazurio/serverBrowser.ts",
      "apps/server/src/lazurio/environmentBrowser.ts",
      "apps/server/src/lazurio/environmentBrowserConnection.ts",
      "apps/server/src/lazurio/environmentBrowserPage.ts",
      "apps/server/src/preview/ServerBrowserPage.ts",
    ].map(read),
  );
  // The overlay's one layer is the last of the routes and shares their one preview broker.
  const routes = server.slice(
    server.indexOf("const layerMakeRoutes = Layer.mergeAll("),
    server.indexOf("const layerMakeServer"),
  );
  const seam = routes.indexOf("\n  LazurioOverlay.layer,\n");
  NodeAssert.ok(seam > 0, "layerMakeRoutes must start the server overlay");
  NodeAssert.equal(server.match(/LazurioOverlay/g)?.length, 2);
  NodeAssert.ok(seam < routes.indexOf("Layer.provide(PreviewAutomationBroker.layer)"));
  // One predicate, T3CODE_LAZURIO_FOLDER, decides where the Environment browser is the browser.
  NodeAssert.match(predicate, /export const LAZURIO_FOLDER_ENV = "T3CODE_LAZURIO_FOLDER";/);
  NodeAssert.match(predicate, /return \(environment\[LAZURIO_FOLDER_ENV\] \?\? ""\) !== "";/);
  for (const source of [gate, host]) {
    NodeAssert.match(
      source,
      /import \{ isLazurioEnvironment \} from "\.\/lazurioEnvironment\.ts";/,
    );
  }
  // There upstream's server browser is never built: no broker registration, no Chromium. Its one
  // construction goes through the gate, which elsewhere is upstream's layer as it is.
  NodeAssert.match(
    server,
    /Layer\.provide\(\n\s+LazurioServerBrowser\.gate\(ServerBrowser\.layer\.pipe\(Layer\.provide\(DesktopBrowserChannel\.layer\)\)\),\n\s+\),/,
  );
  NodeAssert.equal(server.match(/ServerBrowser\.layer/g)?.length, 1);
  NodeAssert.equal(server.match(/LazurioServerBrowser\.gate\(/g)?.length, 1);
  NodeAssert.match(
    gate,
    /Effect\.map\(isLazurioEnvironment, \(lazurio\) =>\n\s+lazurio \? Layer\.succeed\(ServerBrowser\.ServerBrowser, disabled\) : upstream,/,
  );
  // Nor is it advertised there, so no client opens a server tab.
  NodeAssert.match(
    environment,
    /import \{ isLazurioEnvironment \} from "\.\.\/lazurio\/lazurioEnvironment\.ts";/,
  );
  NodeAssert.match(
    environment,
    /\n\s+\.\.\.\(\(yield\* isLazurioEnvironment\) \? \{\} : \{ serverBrowser: true \}\),\n/,
  );
  NodeAssert.equal(environment.match(/serverBrowser/g)?.length, 1);
  // The host takes the server browser's place as upstream's preferred preview host, only on a
  // Lazurio Environment, and answers within 60 s: the broker gives a preferred host's open far
  // longer, for a first install of its own browser, which this host never does.
  NodeAssert.match(
    host,
    /\.connect\(\n\s+\{\n\s+clientId: SERVER_BROWSER_AUTOMATION_CLIENT_ID,\n\s+environmentId,\n\s+supportedOperations: \[\.\.\.PREVIEW_AUTOMATION_SERVER_OPERATIONS\],\n\s+\},[^]*?\{ preferred: true \},/,
  );
  NodeAssert.match(
    host,
    /if \(!\(yield\* isLazurioEnvironment\)\) return yield\* threadTabs\.declare\(undefined\);/,
  );
  NodeAssert.match(
    host,
    /const answerBudgetMs = \(timeoutMs: number\) =>\n\s+Math\.min\(timeoutMs - Math\.min\(1_000, Math\.ceil\(timeoutMs \/ 10\)\), 60_000\);/,
  );
  NodeAssert.match(host, /const budget = answerBudgetMs\(request\.timeoutMs\);/);
  NodeAssert.match(host, /path\.join\(home, "\.local", "bin", "lazurio"\)/);
  NodeAssert.match(host, /args: \["browser", "link", "--json"\]/);
  // Pages are driven by upstream's engine. Asked for "display", it measures a window Playwright
  // does not emulate, as the Environment browser's are (#19913), so the host asks for it; the
  // engine's own test runs in the fork CI's fixed gate.
  NodeAssert.match(
    connection,
    /import \* as ServerBrowserPage from "\.\.\/preview\/ServerBrowserPage\.ts";/,
  );
  NodeAssert.match(connection, /\n\s+renderScale: "display",\n/);
  NodeAssert.equal(connection.match(/renderScale/g)?.length, 1);
  NodeAssert.match(engine, /if \(input\.renderScale !== "display"\)/);
  // The host's copy of upstream's page diagnostics drops data: payloads as upstream's host does
  // (#22156): they would reach tool results and provider logs.
  NodeAssert.match(page, /\n\s+url: withoutDataPayload\(request\.url\(\)\),\n/);
  NodeAssert.match(page, /\n\s+url: withoutDataPayload\(response\.url\(\)\),\n/);
  NodeAssert.match(page, /\n\s+text: consoleText\(message\)\.slice\(0, 2_000\),\n/);
  // The Environment browser stays the Environment's own: Playwright keeps its overrides off the
  // default context, and neither the host nor the engine adds a context, script, binding or user
  // agent of its own.
  NodeAssert.match(
    connection,
    /connectOverCDP\(endpoint, \{ noDefaults: true, timeout: 15_000 \}\)/,
  );
  NodeAssert.match(connection, /browser\.contexts\(\)\[0\]/);
  for (const source of [host, connection, page, engine]) {
    NodeAssert.doesNotMatch(
      source,
      /\.newContext\(|\.launch(?:PersistentContext)?\(|\.addInitScript\(|\.exposeBinding\(|\.exposeFunction\(|userAgent:|\.setExtraHTTPHeaders\(|\.emulateMedia\(/,
    );
  }
});

// Plan DEV-6646: another Lazurio Environment's view of a tab, where an agent works over SSH. The
// server's Environment browser host answers preview_open of such a view without loading it, and
// the web opens it as a marked tab of the right panel. Both read a view's address with one
// function, which each holds a copy of.
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
// server tells the web of the tabs itself, through the thread's strip, never through the thread's
// activities (task 501).
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
  const open = host.slice(
    host.indexOf('const open = Effect.fn("LazurioEnvironmentBrowser.open")('),
  );
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
  // Every tab preview_open opens here is answered with this Environment's view of it, on the origin
  // its declaration names, and the tool's description says who opens that address: a person
  // without the inline preview, in the desktop or mobile app (Lazurio/t3code#88).
  NodeAssert.match(
    host,
    /const ownView = \(targetId: string\) =>\n\s+ownViewOrigin === undefined \? \{\} : \{ view: `\$\{ownViewOrigin\}\/t\/\$\{targetId\}` \};/,
  );
  NodeAssert.match(
    open,
    /return \{\n\s+\.\.\.statusOf\(targetId, state, shown\(request\.threadId, targetId\)\),\n\s+\.\.\.ownView\(targetId\),\n\s+\};/,
  );
  const openTool = tools.slice(
    tools.indexOf('Tool.make("preview_open", {'),
    tools.indexOf("parameters: PreviewAutomationOpenInput,"),
  );
  NodeAssert.match(
    openTool,
    /\." \+\n(?:\s*\/\/[^\n]*\n)?\s+" When the result has a view, that is the address where a person sees the tab: someone without the inline preview, such as in the desktop or mobile app, opens it in their own browser\.",\n/,
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

// Task 501: "+", Mod+T and the empty panel open Nová karta where the Environment's shell defines
// its element; elsewhere upstream's menu and empty state stay. The seams are RightPanelTabs's hook
// call, its two conditionals and one line in its Mod+T handler.
NodeTest.test('"+" and the empty panel open Nová karta through their seams', async () => {
  const [tabs, newTab, composerFocus] = await Promise.all(
    [
      "apps/web/src/components/RightPanelTabs.tsx",
      "apps/web/src/lazurio/LazurioNewTab.tsx",
      "apps/web/src/components/chat/composerFocusRedirect.ts",
    ].map(read),
  );
  // "+" shows where upstream shows its menu, on every open panel, and opens Nová karta instead.
  NodeAssert.match(
    tabs,
    /\{props\.open !== false && lazurio\.newTab \? <Lazurio\.NewTabButton \/> : null\}\n\s+\{props\.open !== false && !lazurio\.newTab \? \(\n\s+<Menu open=\{addSurfaceMenuOpen\}/,
  );
  // Mod+T opens a Nová karta tab where "+" would, before upstream opens its menu; a held key adds
  // none.
  NodeAssert.match(
    tabs,
    /const onNewSurfaceKeyDown = useEffectEvent\(\(event: KeyboardEvent\) => \{[^]*?if \(!event\.repeat\) \{\n\s+if \(Lazurio\.openNewTab\(\)\) return;\n\s+addSurfaceTriggerRef\.current\?\.focus\(\);/,
  );
  NodeAssert.equal(tabs.match(/Lazurio\.openNewTab\(/g)?.length, 1);
  NodeAssert.match(
    tabs,
    /\{props\.activeSurfaceId === null && lazurio\.newTab \? \(\n\s+<Lazurio\.NewTab \/>\n\s+\) : props\.activeSurfaceId === null \? \(\n\s+<RightPanelEmptyState/,
  );
  // The element by its name, its tools upstream's own actions without Browser, its choice in place.
  NodeAssert.match(newTab, /export const NEW_TAB_ELEMENT = "lazurio-new-tab";/);
  NodeAssert.match(newTab, /action\.available && action\.label !== "Browser"/);
  NodeAssert.match(newTab, /customElements\s*\.whenDefined\(NEW_TAB_ELEMENT\)/);
  NodeAssert.doesNotMatch(newTab, /focus-address|focusAddress|\blang:/);
  // The composer's type-to-focus runs first once the panel opens after page load, and since v0.1.2
  // it leaves the letters a launcher declares in data-surface-launcher-keys (#22898). Nová karta
  // declares its tools' letters the same way, while it waits for the browser and once it is shown,
  // or the composer would take them.
  NodeAssert.match(
    composerFocus,
    /const SURFACE_LAUNCHER_KEYS_ATTRIBUTE = "data-surface-launcher-keys";/,
  );
  NodeAssert.match(newTab, /const launcherKeys = tools\.map\(\(tool\) => tool\.key\)\.join\(""\);/);
  NodeAssert.match(
    newTab,
    /<Empty className="min-h-0" data-surface-launcher-keys=\{launcherKeys\}>/,
  );
  NodeAssert.match(newTab, /\n\s+"data-surface-launcher-keys": launcherKeys,\n/);
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

// The Environment pairs its own browser (the Admin's decision of 2026-10-17, which replaces the
// rule of 2026-09-21 that a direct visit shows T3's pairing page). Without a link's credential or
// the desktop app's, the web's auth gate asks its own origin for one, which the Launchpad mints
// with `t3 lazurio pairing` behind the gateway, and exchanges it like any bootstrap credential; a
// session paired on 0.0.45 pairs again and keeps its scopes when that fails. The seam is two calls
// in upstream's auth gate, so a rebuild that loses or moves one fails here.
NodeTest.test("the Environment pairs its own browser through its seam", async () => {
  const [gate, pairing, cli] = await Promise.all(
    [
      "apps/web/src/environments/primary/auth.ts",
      "apps/web/src/lazurio/environmentPairing.ts",
      "apps/server/src/lazurio/cli.ts",
    ].map(read),
  );
  // A signed-in browser keeps upstream's early return; one paired on 0.0.45 pairs again before it.
  NodeAssert.match(
    gate,
    /if \(currentSession\.authenticated && !urlCredential\) \{\n(?:\s*\/\/[^\n]*\n)*\s+await pairAgainWithEnvironment\(currentSession, exchangeBootstrapCredential\);\n\s+return \{ status: "authenticated" \};\n/,
  );
  // The Environment's credential is the third source, after a link's and the desktop app's.
  NodeAssert.match(
    gate,
    /const bootstrapCredential =\n\s+urlCredential \?\?\n\s+getDesktopBootstrapCredential\(\) \?\?\n(?:\s*\/\/[^\n]*\n)*\s+\(await fetchEnvironmentPairingCredential\(\)\);\n/,
  );
  NodeAssert.equal(
    gate.match(/\b(pairAgainWithEnvironment|fetchEnvironmentPairingCredential)\(/g)?.length,
    2,
  );
  // Only from this page's own origin over HTTPS, never through a redirect or from the desktop app.
  NodeAssert.match(
    pairing,
    /export const ENVIRONMENT_PAIRING_PATH = "\/\.lazurio\/chat\/pairing";/,
  );
  NodeAssert.match(pairing, /credentials: "same-origin",\n\s+redirect: "error",/);
  NodeAssert.match(
    pairing,
    /if \(window\.desktopBridge !== undefined \|\| window\.location\.protocol !== "https:"\) \{/,
  );
  NodeAssert.match(pairing, /fetchPairingCredential\(window\.location\.origin, /);
  NodeAssert.match(pairing, /await exchange\(credential\)\.catch\(\(\) => undefined\);/);
  // The operator's scopes are upstream's standard ones without relay:write: since v0.1.1 they hold
  // access:read and access:write (#20432), so these are v0.1.0's 15 in their order, and cli.test.ts
  // lists them literally, so a change of upstream's standard set is a review.
  NodeAssert.match(
    cli,
    /export const OPERATOR_PAIRING_SCOPES = AuthStandardClientScopes\.filter\(\n\s+\(scope\) => scope !== AuthRelayWriteScope,\n\);/,
  );
  NodeAssert.doesNotMatch(cli, /AuthAdministrativeScopes/);
  NodeAssert.match(cli, /scopes: OPERATOR_PAIRING_SCOPES,/);
  NodeAssert.match(cli, /operatorPairing: true/);
  NodeAssert.ok(overlayMayChange("apps/web/src/environments/primary/auth.ts"));
});

// Root decision 0210, addendum 3 (rows 20 and 21): agents in an Environment work with T3's threads
// as its owner through `t3 thread`, `t3 request`, `t3 queue` and `t3 events`, and a headless MCP
// client gets a runtime-mode ceiling from `t3 auth session issue`. The seams are the commands' one
// spread in binCli.ts and its one `thread` group, the flag in cli/auth.ts, the optional ceiling of
// `issueSession`, and the item `t3_thread_list` returns, which a thread's line in `t3 events` reuses.
// Upstream has its own `t3 thread` since v0.1.2 (#22732): `t3` refuses to start with two groups of
// one name, so binCli.ts takes upstream's group through lazurioThreadCommand, which keeps this row's
// commands and adds upstream's others; `send --wait` reuses upstream's wait and reply readers.
NodeTest.test("agents work with threads through the agent CLI's seams", async () => {
  const [bin, auth, environmentAuth, mcpService, connection, lazurioCli, agentCli, upstreamThread] =
    await Promise.all(
      [
        "apps/server/src/binCli.ts",
        "apps/server/src/cli/auth.ts",
        "apps/server/src/auth/EnvironmentAuth.ts",
        "apps/server/src/mcp/OrchestratorMcpService.ts",
        "apps/server/src/lazurio/agentCliConnection.ts",
        "apps/server/src/lazurio/cli.ts",
        "apps/server/src/lazurio/agentCli.ts",
        "apps/server/src/cli/thread.ts",
      ].map(read),
    );
  NodeAssert.match(
    bin,
    /import \{ agentCliCommands, lazurioThreadCommand \} from "\.\/lazurio\/agentCli\.ts";/,
  );
  NodeAssert.match(bin, /\n\s+\.\.\.agentCliCommands,\n/);
  // One `thread` group: upstream's, taken whole, never registered beside it.
  NodeAssert.equal(bin.match(/\bthreadCommand\b/g)?.length, 2);
  NodeAssert.match(bin, /\n\s+lazurioThreadCommand\(threadCommand\),\n/);
  NodeAssert.match(
    agentCli,
    /export const agentCliCommands = \[requestCommand, queueCommand, eventsCommand\] as const;/,
  );
  NodeAssert.match(agentCli, /\.filter\(\(command\) => !names\.has\(command\.name\)\)/);
  // `send` queues unless told otherwise, as upstream's does: Delegace passes --mode queue itself.
  NodeAssert.match(
    agentCli,
    /mode: Flag\.Literals\("mode", \["auto", "queue", "steer", "restart"\]\)\.pipe\([^]*?Flag\.withDefault\("queue"\),/,
  );
  NodeAssert.match(upstreamThread, /\nexport const waitForRun = Effect\.fn\(/);
  NodeAssert.match(upstreamThread, /\nexport const runResultText = Effect\.fn\(/);
  // The commands' own sessions under their own label, the namespace Delegace's send keys live in;
  // never upstream's MCP client session (`t3 thread cli`), whose namespace is per command.
  NodeAssert.match(connection, /export const AGENT_CLI_SESSION_LABEL = "t3 agent cli";/);
  NodeAssert.match(
    connection,
    /\.issueSession\(\{\n\s+\.\.\.input,\n\s+ttl,\n\s+label: AGENT_CLI_SESSION_LABEL,\n/,
  );
  NodeAssert.doesNotMatch(connection, /issueMcpClientSession|withThreadTools/);
  NodeAssert.match(connection, /mcpToolSession\(\{\n[^]*?\n\s+clientName: "t3-agent-cli",\n/);
  NodeAssert.match(auth, /Flag\.Literals\("runtime-mode-ceiling", RuntimeMode\.literals\)/);
  NodeAssert.match(auth, /yield\* checkRuntimeModeCeiling\(flags\);/);
  NodeAssert.match(environmentAuth, /export const MCP_CLIENT_SUBJECT = "mcp-client";/);
  NodeAssert.match(environmentAuth, /runtimeModeCeiling: input\.runtimeModeCeiling/);
  NodeAssert.match(mcpService, /export function listItemFromShell\(/);
  // On /mcp the CLI is a full-access client, the most an approved agent may be; on the person's
  // client surface it holds the orchestration scopes alone, never access or relay.
  NodeAssert.match(
    connection,
    /scopes: EnvironmentAuth\.mcpClientScopes\("full-access"\),\n\s+runtimeModeCeiling: "full-access",/,
  );
  NodeAssert.match(
    connection,
    /const OWNER_SCOPES = \[AuthOrchestrationReadScope, AuthOrchestrationOperateScope\];/,
  );
  NodeAssert.doesNotMatch(
    connection,
    /AuthAdministrativeScopes|AuthAccessWriteScope|AuthRelayWriteScope/,
  );
  NodeAssert.match(lazurioCli, /agentCli: true/);
  for (const file of [
    "apps/server/src/binCli.ts",
    "apps/server/src/cli/auth.ts",
    "apps/server/src/cli/thread.ts",
    "apps/server/src/auth/EnvironmentAuth.ts",
    "apps/server/src/mcp/OrchestratorMcpService.ts",
  ])
    NodeAssert.ok(overlayMayChange(file), file);
});

// Root decision 0211 (row 22): agents ask people through the question tool. Codex offers
// request_user_input in Default mode only with its feature default_mode_request_user_input, under
// development and off by default. The feature leads the arguments of every app-server T3 starts for
// its threads, so the launch arguments after it can still turn it off, and the user's config.toml
// stays untouched (root decision 0161). Every turn's context tells the agent to ask with the tool,
// for each model, and the Default mode's own text no longer sends it to a plain-text question.
NodeTest.test("agents ask people through the question tool through its seams", async () => {
  const [adapter, instructions, source, questionTool] = await Promise.all([
    read("apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts"),
    read("apps/server/src/provider/CodexDeveloperInstructions.ts"),
    read("apps/server/src/lazurio/questionTool.ts"),
    import("../apps/server/src/lazurio/questionTool.ts"),
  ]);
  NodeAssert.deepEqual(questionTool.CODEX_APP_SERVER_ARGS, [
    "-c",
    "features.default_mode_request_user_input=true",
  ]);
  NodeAssert.match(
    adapter,
    /\n\s+args: \[\n\s+\/\/ Lazurio overlay \(root decision 0211\)[^\n]*\n\s+\.\.\.LazurioQuestionTool\.CODEX_APP_SERVER_ARGS,\n\s+\.\.\.codexAppServerArgs\(\n\s+resolveCodexLaunchArgs\(input\.settings\.launchArgs, input\.environment\),\n/,
  );
  NodeAssert.equal(adapter.match(/LazurioQuestionTool\./g)?.length, 1);
  NodeAssert.match(
    instructions,
    /\n {4}\.\.\.LazurioQuestionTool\.codexAdditionalContext,\n {2}\};\n\}\n$/,
  );
  NodeAssert.doesNotMatch(instructions, /plain-text question/);
  NodeAssert.deepEqual(Object.keys(questionTool.codexAdditionalContext), ["lazurio_questions"]);
  NodeAssert.equal(questionTool.codexAdditionalContext.lazurio_questions.kind, "application");
  // Only constants: the module reads and writes nothing, Codex's config files included.
  NodeAssert.doesNotMatch(source, /^import /m);
  for (const file of [
    "apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts",
    "apps/server/src/provider/CodexDeveloperInstructions.ts",
  ])
    NodeAssert.ok(overlayMayChange(file), file);
});

// Root decision 0210, plan DEV-6676 (row 23): Buddy's own T3 Code (T3CODE_LAZURIO_BUDDY=1) runs
// Buddy's Hermes as the ACP instance `buddy`, and Hermes keeps every prompt as the person's words in
// Buddy's memory. The ACP adapter leaves T3's instructions out of an instance's prompts where the
// host says so when it builds the instance (every other instance keeps them); server.ts says so for
// Buddy's instance where it builds its provider instances; and the turn start projects a page
// context as the Czech block for that instance only.
NodeTest.test("Buddy's Hermes gets only the person's words through its seams", async () => {
  const [acpAdapter, server, turnStart, buddyPrompt, buddyControls] = await Promise.all(
    [
      "packages/provider-acp/src/server/adapter.ts",
      "apps/server/src/server.ts",
      "apps/server/src/orchestration-v2/ProviderTurnStartService.ts",
      "apps/server/src/lazurio/buddyPrompt.ts",
      "apps/web/src/lazurio/buddySurfaceControls.ts",
    ].map(read),
  );
  NodeAssert.match(
    acpAdapter,
    /export class AcpT3Instructions extends Context\.Reference<\n\s+\(instanceId: ProviderInstanceId\) => boolean\n>\("@t3tools\/provider-acp\/AcpT3Instructions", \{ defaultValue: \(\) => \(\) => true \}\) \{\}/,
  );
  NodeAssert.match(
    acpAdapter,
    /const sendsT3Instructions = \(yield\* AcpT3Instructions\)\(options\.instanceId\);/,
  );
  // The adapter's one prompt site: the instruction wrapper and the runtime note both ask it.
  NodeAssert.equal(acpAdapter.match(/t3AcpPromptWithInstructions\(/g)?.length, 1);
  NodeAssert.equal(acpAdapter.match(/buildRuntimeInstructions\(/g)?.length, 1);
  NodeAssert.match(
    acpAdapter,
    /const text = sendsT3Instructions\n\s+\? t3AcpPromptWithInstructions\(\{/,
  );
  NodeAssert.match(
    acpAdapter,
    /if \(sendsT3Instructions && !isNativeSlashCommand\) \{\n\s+prompt\.push\(\{\n\s+type: "text",\n\s+text: buildRuntimeInstructions\(\{/,
  );
  // Root decision 0210, addendum of HumanAndMachines/Lazurio#648: the Platform sets Buddy's model and effort in
  // Hermes's own config, so the adapter's one place that applies a selection asks AcpT3Selection
  // first and sets no model and only the options it names for Buddy's instance.
  NodeAssert.match(
    acpAdapter,
    /export class AcpT3Selection extends Context\.Reference<\n\s+\(instanceId: ProviderInstanceId\) => ReadonlySet<string> \| null\n>\("@t3tools\/provider-acp\/AcpT3Selection", \{ defaultValue: \(\) => \(\) => null \}\) \{\}/,
  );
  NodeAssert.match(
    acpAdapter,
    /const t3SelectionOptions = \(yield\* AcpT3Selection\)\(options\.instanceId\);/,
  );
  NodeAssert.match(
    acpAdapter,
    /let appliedModel: string \| undefined;\n\s+if \(t3SelectionOptions !== null\) \{\n(?:\s+\/\/[^\n]*\n)*\s+\} else if \(flavor\.applyModelSelection !== undefined\) \{/,
  );
  NodeAssert.match(
    acpAdapter,
    /const optionSelections = \(modelSelection\.options \?\? \[\]\)\n\s+\.filter\(\n\s+\(selection\) => t3SelectionOptions === null \|\| t3SelectionOptions\.has\(selection\.id\),\n\s+\)/,
  );
  NodeAssert.equal(acpAdapter.match(/modelSelection\.options/g)?.length, 1);
  NodeAssert.equal(acpAdapter.match(/\.applyModelSelection\(\{/g)?.length, 1);
  NodeAssert.equal(acpAdapter.match(/\.setSessionModel\(/g)?.length, 1);
  NodeAssert.equal(acpAdapter.match(/const configureSession = /g)?.length, 1);
  // The one option Buddy's sessions take is the speed Buddy's composer offers.
  const buddyOption = /new Set\(\["([^"]+)"\]\)/.exec(buddyPrompt)?.[1];
  NodeAssert.ok(buddyOption);
  NodeAssert.equal(
    /\nconst BUDDY_SPEED_OPTION_ID = "([^"]+)";/.exec(buddyControls)?.[1],
    buddyOption,
  );
  NodeAssert.match(
    server,
    /Layer\.provideMerge\(LazurioBuddyPrompt\.withBuddyInstance\(ProviderInstanceRegistryHydration\.layer\)\),/,
  );
  NodeAssert.equal(server.match(/ProviderInstanceRegistryHydration\.layer/g)?.length, 1);
  NodeAssert.match(
    turnStart,
    /const userText = yield\* LazurioBuddyPrompt\.projectComposerContextForProvider\(\{\n\s+instanceId: run\.providerInstanceId,\n\s+text: message\.text,\n\s+records: message\.context\?\.records \?\? \[\],\n\s+\}\);/,
  );
  for (const file of [
    "packages/provider-acp/src/server/adapter.ts",
    "apps/server/src/orchestration-v2/ProviderTurnStartService.ts",
    "apps/server/src/server.ts",
  ])
    NodeAssert.ok(overlayMayChange(file), file);
});

// Root decision 0210, plan DEV-6676 (row 24): Delegace wakes Buddy with `t3 thread send` through
// /mcp, as an agent, and sends again after a crash. The key becomes the MCP tool's clientRequestId,
// which T3 makes idempotent in the request namespace of its MCP client; every agent command signs in
// with a session of its own, so server.ts puts the agent commands' sessions in one namespace, and
// only theirs. In that namespace the command passes a digest of the key with the thread and the
// sender, so another thread or sender never gets the first send's result. Buddy's thread is found or
// made behind one overlay route, which `t3 lazurio buddy thread` asks.
NodeTest.test(
  "an agent command's idempotency key and Buddy's thread keep their seams",
  async () => {
    const [server, requests, agentCli, connection, lazurioCli, mcpService] = await Promise.all(
      [
        "apps/server/src/server.ts",
        "apps/server/src/lazurio/agentCliRequests.ts",
        "apps/server/src/lazurio/agentCli.ts",
        "apps/server/src/lazurio/agentCliConnection.ts",
        "apps/server/src/lazurio/cli.ts",
        "apps/server/src/mcp/OrchestratorMcpService.ts",
      ].map(read),
    );
    NodeAssert.match(
      server,
      /Layer\.provide\(\n\s+LazurioAgentCliRequests\.withAgentCliRequestNamespace\(McpOAuth\.layerMcpClientAuthenticator\),\n\s+\),/,
    );
    NodeAssert.equal(server.match(/McpOAuth\.layerMcpClientAuthenticator/g)?.length, 1);
    NodeAssert.match(connection, /export const AGENT_CLI_SESSION_LABEL = "t3 agent cli";/);
    NodeAssert.match(connection, /label: AGENT_CLI_SESSION_LABEL/);
    NodeAssert.match(requests, /scope\.client\?\.label === AGENT_CLI_SESSION_LABEL/);
    // sendOnce: the key's digest is the send's clientRequestId, then T3's receipt tells the outcome.
    NodeAssert.match(
      agentCli,
      /const sendKey = yield\* agentCliSendKey\(\{ threadId: input\.threadId, key \}\);/,
    );
    NodeAssert.match(agentCli, /const sent = yield\* Effect\.result\(input\.send\(sendKey\)\);/);
    NodeAssert.match(agentCli, /connection\.callTool\(\n\s+"t3_thread_send",/);
    // The key comes before the wait (row 21's `--wait`), and only a send whose run T3 names is
    // waited for: a repeat that answers "delivered" never waits, so Delegace never waits twice.
    NodeAssert.match(
      agentCli,
      /const \{ result, waitable \} = Option\.isNone\(flags\.idempotencyKey\)\n\s+\? \{ result: yield\* send\(\), waitable: true \}\n\s+: yield\* sendOnce\(/,
    );
    NodeAssert.match(
      agentCli,
      /return flags\.wait && waitable \? yield\* waitForSentRun\(connection, result\) : result;/,
    );
    NodeAssert.match(
      agentCli,
      /delivery: "delivered",\n\s+commandId: ids\.commandId,\n\s+\},\n\s+waitable: false,/,
    );
    // What became of a keyed send is read from the overlay's own route, as the person's client with
    // the owner token, through the connection's HttpClient on this T3 home's loopback origin.
    NodeAssert.match(agentCli, /connection\.postRoute\(AGENT_CLI_SEND_STATE_ROUTE, request\)/);
    NodeAssert.match(connection, /postRoute: \(route, body\) =>\n\s+ownerToken\.pipe\(/);
    NodeAssert.match(connection, /HttpClientRequest\.post\(new URL\(route, origin\)\)/);
    NodeAssert.match(requests, /export const agentCliSendKey = /);
    NodeAssert.match(
      lazurioCli,
      /threadSendIdempotency: true,\n\s+threadSendOutcome: true,\n\s+buddyThread: true,/,
    );
    // The command asks what became of its send by the ids T3 derives from the key, so T3 must
    // still derive them as `<kind>:mcp:<namespace>:<operation>:<key>` (agentCliSendIds).
    NodeAssert.match(
      mcpService,
      /function stablePart\(value: string\): string \{\n\s+return encodeURIComponent\(value\);/,
    );
    for (const kind of ["command", "message"])
      NodeAssert.match(
        mcpService,
        new RegExp(
          `\\[\\n\\s+"${kind}",\\n\\s+"mcp",\\n\\s+stablePart\\(input\\.scope\\.requestNamespace\\),\\n\\s+stablePart\\(input\\.operation\\),\\n\\s+stablePart\\(input\\.requestKey\\),`,
        ),
      );
    NodeAssert.equal(mcpService.match(/operation: "thread-send",/g)?.length, 2);
    NodeAssert.ok(overlayMayChange("apps/server/src/server.ts"));
  },
);

// Root decision 0210, plan DEV-6676 (row 25): Buddy's T3 Code is Buddy's one conversation, for every
// client and agent. Decorators where upstream builds the orchestrator and the checkpoint store
// refuse forks, rollbacks and other threads and take no checkpoints in Buddy's project; a startup
// phase applies Buddy's defaults before recovery reads whether to continue threads after an update;
// the client config tells the web, which shows Buddy's surface in place of T3's sidebar and command
// palette, opens Buddy's thread at `/`, steers a follow-up by default and offers no thread details,
// rollback or fork.
NodeTest.test("Buddy keeps one conversation through its seams", async () => {
  const [
    runtime,
    server,
    startup,
    ws,
    contractsServer,
    root,
    index,
    layout,
    chat,
    timeline,
    rowContext,
    assistantRows,
  ] = await Promise.all(
    [
      "apps/server/src/orchestration-v2/runtimeLayer.ts",
      "apps/server/src/server.ts",
      "apps/server/src/serverRuntimeStartup.ts",
      "apps/server/src/ws.ts",
      "packages/contracts/src/server.ts",
      "apps/web/src/routes/__root.tsx",
      "apps/web/src/routes/_chat.index.tsx",
      "apps/web/src/routes/_chat.tsx",
      "apps/web/src/components/ChatView.tsx",
      "apps/web/src/components/chat/MessagesTimeline.tsx",
      "apps/web/src/components/chat/timelineRowContext.ts",
      "apps/web/src/components/chat/TimelineAssistantRows.tsx",
    ].map(read),
  );
  NodeAssert.match(
    runtime,
    /const layerOrchestratorProvided = LazurioActingSenders\.recordSteps\(\n\s+LazurioBuddyGuards\.guardBuddyCommands\(/,
  );
  NodeAssert.match(
    server,
    /const layerCheckpointStore = LazurioBuddyGuards\.withoutBuddyCheckpoints\(CheckpointStore\.layer\)\.pipe\(/,
  );
  NodeAssert.equal(server.match(/\bCheckpointStore\.layer\b/g)?.length, 1);
  const phase = startup.indexOf('runStartupPhase("lazurio.buddy", startBuddySurface);');
  NodeAssert.ok(
    phase >= 0 && phase < startup.indexOf('runStartupPhase("orchestration-v2.recovery"'),
    "Buddy's defaults are applied before recovery reads them",
  );
  NodeAssert.match(ws, /\n\s+\.\.\.\(yield\* buddySurfaceClientConfig\),\n/);
  NodeAssert.match(
    contractsServer,
    /lazurioBuddy: Schema\.optionalKey\(Schema\.Literal\(true\)\),/,
  );
  NodeAssert.match(
    root,
    /const appShell = buddySurface \? \(\n\s+<BuddySurfaceLayout>\n\s+<Outlet \/>\n\s+<\/BuddySurfaceLayout>\n\s+\) : \(/,
  );
  NodeAssert.match(root, /enabled=\{primaryEnvironmentAuthenticated && !buddySurface\}/);
  NodeAssert.match(index, /if \(buddySurface\) return <BuddySurfaceIndex \/>;/);
  NodeAssert.match(layout, /\{buddySurface \? null : <ChatRouteGlobalShortcuts \/>\}/);
  NodeAssert.match(layout, /\{buddySurface \? null : <LazurioPromptDraft \/>\}/);
  NodeAssert.match(chat, /\? \{ \.\.\.environmentSettings, followUpBehavior: "steer" as const \}/);
  NodeAssert.match(chat, /const supportsConversationRollback =\n\s+!buddySurface &&/);
  NodeAssert.match(chat, /hidden=\{buddySurface\}/);
  NodeAssert.match(
    chat,
    /\n\s+<BuddyThreadDetailsPanel\n\s+anchor=\{threadPanelPopoverAnchorRef\}/,
  );
  NodeAssert.doesNotMatch(chat, /<ThreadDetailsPanel\b/);
  // One Buddy check per timeline, for its own Environment; the rows read it from the shared state.
  NodeAssert.equal(timeline.match(/\buseBuddySurfaceMode\(/g)?.length, 1);
  NodeAssert.match(
    timeline,
    /const buddySurface = useBuddySurfaceMode\(activeThreadEnvironmentId\) === true;\n[^]*?\n\s+const buddyDayLines = useBuddyDayLines\(rows, buddySurface\);/,
  );
  NodeAssert.match(timeline, /\n\s+workGroupViewState,\n\s+buddySurface,\n\s+\};/);
  NodeAssert.match(
    timeline,
    /useBuddyDayJump\(\{\n\s+buddy: buddySurface,\n\s+rows,\n\s+listRef,\n\s+onManualNavigation,\n\s+history: historyControls,\n\s+\}\);/,
  );
  NodeAssert.match(timeline, /buddyDays: \[\.\.\.buddyDayLines\.keys\(\)\]\.join\(\),/);
  // Since v0.1.2 the rows live in their own files (#22674, #22677): the shared row state knows
  // Buddy's surface, and the assistant row's one fork button reads it. A fork button that lost the
  // check would come back on Buddy's surface, which the server refuses only after the click.
  NodeAssert.equal(rowContext.match(/\n\s+buddySurface: boolean;\n/g)?.length, 1);
  NodeAssert.match(
    rowContext,
    /export interface TimelineRowSharedState \{\n[^]*?\n\s+buddySurface: boolean;\n\}/,
  );
  NodeAssert.match(
    assistantRows,
    /projectedItem\?\.item\.type === "assistant_message" && !ctx\.buddySurface \? \(\n\s+<AssistantForkButton/,
  );
  NodeAssert.equal(assistantRows.match(/<AssistantForkButton\b/g)?.length, 1);
  for (const file of [
    "apps/server/src/orchestration-v2/runtimeLayer.ts",
    "apps/server/src/server.ts",
    "apps/server/src/serverRuntimeStartup.ts",
    "apps/server/src/ws.ts",
    "packages/contracts/src/server.ts",
    "apps/web/public/assets/avatar.webp",
    "apps/web/src/routes/__root.tsx",
    "apps/web/src/routes/_chat.index.tsx",
    "apps/web/src/routes/_chat.tsx",
    "apps/web/src/components/ChatView.tsx",
    "apps/web/src/components/chat/MessagesTimeline.tsx",
    "apps/web/src/components/chat/timelineRowContext.ts",
    "apps/web/src/components/chat/TimelineAssistantRows.tsx",
  ])
    NodeAssert.ok(overlayMayChange(file), file);
});

// Root decision 0210, plan DEV-6676 (row 26): in Buddy's surface the host page's last valid context
// is a chip above the composer. While it is there, a message the person writes carries the page as
// a `lazurio-page` record with a reference in its text, which Buddy's T3 Code projects as the Czech
// block (row 23). The chat adds both where it sends, and the composer and sent messages show the
// reference as a page chip where T3 would call an unknown context unavailable.
NodeTest.test(
  "the page Buddy is asked from travels with the message through its seams",
  async () => {
    const [chat, send, logic, composerPresentation, chips] = await Promise.all(
      [
        "apps/web/src/components/ChatView.tsx",
        "apps/web/src/components/chat/useComposerSend.ts",
        "apps/web/src/components/ChatView.logic.ts",
        "apps/web/src/components/composerContextPresentation.tsx",
        "apps/web/src/components/chat/UserMessageContextChips.tsx",
      ].map(read),
    );
    // One useBuddyPage, in ChatView: removing the chip lives in its state, so the send hook gets
    // the record as an input (since v0.1.2 the send is useComposerSend.ts, #23062) and never calls
    // useBuddyPage itself, which would keep a page the person removed.
    NodeAssert.match(chat, /const buddyPage = useBuddyPage\(environmentId\);/);
    NodeAssert.equal(chat.match(/useBuddyPage\(/g)?.length, 1);
    NodeAssert.equal(send.match(/useBuddyPage\(/g)?.length ?? 0, 0);
    NodeAssert.match(chat, /\n\s+buddyPageRecord: buddyPage\.record,\n\s+\}\);/);
    NodeAssert.match(
      chat,
      /buddyPage\.record === null \|\| queuedRunEdit\.isEditing \? null : \(\n\s+<BuddyPageChip\n\s+label=\{buddyPage\.record\.label\}/,
    );
    // The page joins the text in one place only, the regular send, whose context gets its record
    // from that same text. The queued edit and the plan follow-up send their own text, which never
    // carries the page, so no path sends a reference without its record.
    NodeAssert.equal(send.match(/withPageReference\(/g)?.length, 1);
    NodeAssert.equal(chat.match(/withPageReference\(/g)?.length ?? 0, 0);
    // T3's messageTextForSend stays the person's own words, and the page joins a text of its own.
    // A failed send gives the composer back messageTextForSend, so a retry after the person removed
    // the chip, or after the host moved to another page, carries only the page of its record.
    NodeAssert.match(
      send,
      /messageText: messageTextForSend,\n\s+\} = sendSnapshot;\n(?:\s+\/\/.*\n)*\s+const pageTextForSend = withPageReference\(messageTextForSend, buddyPageRecord\)\.trim\(\);/,
    );
    // Only the record and the text on the wire, of the single and of the multi-model send, read
    // the page's text; neither restore of a failed send does.
    NodeAssert.equal(send.match(/\bpageTextForSend\b/g)?.length, 4);
    NodeAssert.equal(
      send.match(/text: pageTextForSend \|\| ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,/g)?.length,
      1,
    );
    NodeAssert.equal(send.match(/messageText: pageTextForSend,/g)?.length, 1);
    NodeAssert.match(
      send,
      /const buildOutgoingMessageContext = \(attachmentIds: ReadonlyArray<string>\) =>\n\s+withPageRecord\(\n\s+buildMessageContext\(\{[^]*?\}\),\n\s+buddyPageRecord,\n\s+pageTextForSend,\n\s+\);/,
    );
    NodeAssert.match(send, /restoreComposerDraft\(composerDraftTarget, sendSnapshot\);/);
    NodeAssert.match(send, /promptRef\.current = messageTextForSend;/);
    NodeAssert.doesNotMatch(send, /promptRef\.current = pageTextForSend/);
    // The snapshot a failed send restores from holds no page.
    NodeAssert.doesNotMatch(logic, /buddyPage|pageTextForSend|withPageRe/);
    NodeAssert.match(
      composerPresentation,
      /fallback: \(kind, _entry, context\) =>\n\s+buddyPageReferenceChip\(kind, context\.label\) \?\?/,
    );
    NodeAssert.match(
      chips,
      /fallback: \(kind, _record, context\) =>\n\s+buddyPageReferenceChip\(kind, context\.reference\.label, context\.copyMarkdown\) \?\?/,
    );
    for (const file of [
      "apps/web/src/components/ChatView.tsx",
      "apps/web/src/components/chat/useComposerSend.ts",
      "apps/web/src/components/composerContextPresentation.tsx",
      "apps/web/src/components/chat/UserMessageContextChips.tsx",
    ])
      NodeAssert.ok(overlayMayChange(file), file);
  },
);

// Root decision 0210, evening addendum, point 5 (row 27): what Buddy writes or decides in a thread
// shows „Buddy za <user>“, and Delegace's wake in Buddy's own thread is hidden. Who acted is a claim
// of the session, signed into its token beside the runtime-mode ceiling and read from the session
// alone: the token, the sessions /mcp and the client surface authenticate, the MCP client's
// invocation, the client surface's dispatch, the orchestrator's decorator, the web's route and the
// web's three places (the thread's rows, the label of an agent's folded message, the mark at a
// request). A rebuild that loses one of them loses the mark or shows the wake; one that reads it
// from anywhere else lets a session without the claim make it. Since v0.1.2 upstream folds an
// agent's message to one row labelled with its sender thread, else "Agent" (#23135), in
// TimelineUserMessageRow.tsx, and the work log's rows live in TimelineWorkEntryRow.tsx.
NodeTest.test("Buddy's and Delegace's steps carry who took them through their seams", async () => {
  const files = [
    "apps/server/src/auth/SessionStore.ts",
    "apps/server/src/auth/EnvironmentAuth.ts",
    "apps/server/src/auth/McpOAuth.ts",
    "apps/server/src/mcp/McpInvocationContext.ts",
    "apps/server/src/ws.ts",
    "apps/server/src/orchestration-v2/runtimeLayer.ts",
    "apps/web/src/components/chat/MessagesTimeline.tsx",
    "apps/web/src/components/chat/TimelineUserMessageRow.tsx",
    "apps/web/src/components/chat/TimelineWorkEntryRow.tsx",
  ];
  const [
    store,
    environmentAuth,
    oauth,
    invocation,
    ws,
    runtimeLayer,
    timeline,
    userMessageRow,
    workEntryRow,
  ] = await Promise.all(files.map(read));
  const [overlay, connection, senders] = await Promise.all(
    [
      "apps/server/src/lazurio/overlay.ts",
      "apps/server/src/lazurio/agentCliConnection.ts",
      "apps/server/src/lazurio/actingSenders.ts",
    ].map(read),
  );
  NodeAssert.match(store, /\n\s+act: Schema\.optionalKey\(ActingSender\),\n/);
  NodeAssert.match(
    store,
    /\.\.\.\(input\?\.actingSender \? \{ act: input\.actingSender \} : \{\}\),/,
  );
  NodeAssert.match(store, /\.\.\.\(claims\.act \? \{ actingSender: claims\.act \} : \{\}\),/);
  NodeAssert.match(
    environmentAuth,
    /\.\.\.\(input\?\.actingSender \? \{ actingSender: input\.actingSender \} : \{\}\),/,
  );
  // Both authenticated sessions, /mcp's and the client surface's, carry the claim of the token.
  NodeAssert.equal(
    environmentAuth.match(
      /\.\.\.\(session\.actingSender \? \{ actingSender: session\.actingSender \} : \{\}\),/g,
    )?.length,
    2,
  );
  NodeAssert.match(
    oauth,
    /\.\.\.\(client\.actingSender \? \{ actingSender: client\.actingSender \} : \{\}\),/,
  );
  NodeAssert.match(invocation, /readonly actingSender\?: ActingSender;/);
  // The client surface runs a dispatch, and only that, as the session that sent it.
  NodeAssert.equal(ws.match(/LazurioActingSenders\.actingAs\(/g)?.length, 1);
  NodeAssert.match(
    ws,
    /Effect\.provide\(intakeContext\),\n\s+\/\/ Lazurio overlay \(root decision 0210\)[^\n]*\n\s+LazurioActingSenders\.actingAs\(currentSession\),/,
  );
  NodeAssert.match(
    runtimeLayer,
    /const layerOrchestratorProvided = LazurioActingSenders\.recordSteps\(\n\s+LazurioBuddyGuards\.guardBuddyCommands\(LazurioManagedFolder\.guardCommands\(Orchestrator\.layer\)\),\n\)/,
  );
  // Who acted comes from the session alone: the client surface's, else the MCP client's.
  NodeAssert.match(senders, /const surface = yield\* ClientSurfaceActingSender;/);
  NodeAssert.match(senders, /invocation\.value\.client\?\.actingSender/);
  NodeAssert.match(
    overlay,
    /ActingSendersRoute\.layer\.pipe\(Layer\.provide\(ActingSenders\.layer\)\)/,
  );
  NodeAssert.match(
    connection,
    /\.\.\.\(actingSender === undefined \? \{\} : \{ actingSender \}\),/,
  );
  // The thread's rows pass the overlay right after upstream keeps them stable, so a hidden wake is
  // in none of the places that draw them. Buddy's surface (row 28) filters what comes out of it.
  NodeAssert.match(
    timeline,
    /const rows = buddySurfaceRows\(\n(?:\s+\/\/[^\n]*\n)*\s+useLazurioActingSenderRows\(\n\s+useStableRows\(rawRows, listIdentityKey\),\n\s+parseScopedThreadKey\(listIdentityKey\),\n\s+\),\n/,
  );
  NodeAssert.equal(timeline.match(/useLazurioActingSenderRows\(/g)?.length, 1);
  // The label stands in the fold of an agent's message, in place of its sender thread or "Agent".
  NodeAssert.match(
    userMessageRow,
    /<FoldedMessageHeader\n\s+icon=\{MessagesSquareIcon\}\n\s+label=\{\n(?:\s+\/\/[^\n]*\n)*\s+<LazurioActingSenderLabel\n[^]*?>\n\s+\{senderShell\?\.title\.trim\(\) \|\| "Agent"\}\n\s+<\/LazurioActingSenderLabel>\n/,
  );
  NodeAssert.equal(userMessageRow.match(/<LazurioActingSenderLabel\b/g)?.length, 1);
  // The mark stands before the time of a work row, which a decided request is.
  NodeAssert.match(
    workEntryRow,
    /<LazurioActingSenderMark\n\s+environmentId=\{ctx\.activeThreadEnvironmentId\}\n\s+threadId=\{threadRef\?\.threadId\}\n\s+item=\{workEntry\.projectedItem\?\.item\}\n\s+\/>\n\s+<TimelineRowTimestamp createdAt=\{workEntry\.createdAt\}/,
  );
  NodeAssert.equal(workEntryRow.match(/<LazurioActingSenderMark\b/g)?.length, 1);
  for (const file of files) NodeAssert.ok(overlayMayChange(file), file);
});

// Root decision 0210, addendum of 2026-10-22, point 1 (row 28): Buddy's chat reads like a chat with a
// friend. The timeline's rows pass through Buddy's conversation, which keeps what Buddy writes, adds
// one quiet row while he works, also on work that still runs after his turn, and says a failed turn
// in human words, and the rows Buddy draws come before T3's; the thread's error banner speaks in
// human words too. Above the composer stands none of the turn's work: ChatView's work banners pass
// Buddy's surface, and the queue holds only the person's messages. The composer reads Buddy's
// placeholder, its controls read Buddy's options and leave out the block of T3's access and
// interaction mode, the chat's shortcuts go through Buddy's surface, which leaves the terminal's and
// the right panel's keys to the browser, and the turn's task list stays out. Since v0.1.2 the
// composer's controls are ComposerControlsBar.tsx (#23058), the thread's error banner renders in
// ChatBannerLane.tsx (#23101), and useThreadLifecycle.tsx makes the work banners ChatView joins.
NodeTest.test("Buddy's chat reads like a chat with a friend through its seams", async () => {
  const [
    timeline,
    composer,
    chat,
    root,
    queue,
    controlsBar,
    bannerLane,
    lifecycle,
    surface,
    markdown,
  ] = await Promise.all(
    [
      "apps/web/src/components/chat/MessagesTimeline.tsx",
      "apps/web/src/components/chat/ChatComposer.tsx",
      "apps/web/src/components/ChatView.tsx",
      "apps/web/src/routes/__root.tsx",
      "apps/web/src/components/chat/QueuedRunsControl.tsx",
      "apps/web/src/components/chat/ComposerControlsBar.tsx",
      "apps/web/src/components/chat/ChatBannerLane.tsx",
      "apps/web/src/components/chat/useThreadLifecycle.tsx",
      "apps/web/src/lazurio/BuddySurface.tsx",
      "apps/web/src/components/ChatMarkdown.tsx",
    ].map(read),
  );
  // Buddy's rows are what the thread shows after Delegace's wake is left out (row 27).
  NodeAssert.match(
    timeline,
    /\n\s+const rows = buddySurfaceRows\(\n(?:\s+\/\/[^\n]*\n)*\s+useLazurioActingSenderRows\(\n\s+useStableRows\(rawRows, listIdentityKey\),\n\s+parseScopedThreadKey\(listIdentityKey\),\n\s+\),\n\s+buddySurface,\n\s+\(isWorking \|\| buddyBackgroundWork\) && !awaitingUser,\n\s+\);\n/,
  );
  NodeAssert.match(timeline, /\n\s+buddyBackgroundWork = false,\n/);
  NodeAssert.equal(timeline.match(/\bconst rows = /g)?.length, 1);
  NodeAssert.match(
    timeline,
    /\{buddyRowContent\(item, buddySurface\) \?\? <TimelineRowContent row=\{item\} \/>\}/,
  );
  NodeAssert.equal(timeline.match(/<TimelineRowContent\b/g)?.length, 1);
  NodeAssert.match(
    composer,
    /\n\s+const buddyComposer = useBuddyComposer\(environmentId, \{\n\s+provider: selectedProvider,\n\s+model: selectedModel,\n\s+models: selectedProviderModels,\n\s+modelOptions: composerModelOptions\?\.\[selectedInstanceId\],\n\s+\}\);\n/,
  );
  // Root decision 0210, addendum of HumanAndMachines/Lazurio#648: Buddy's controls stand in for all of T3's (model
  // picker, options chip, access and mode, the overflow menu) before the bar builds any of them,
  // and the strip under the resting composer stands only while they hold something.
  NodeAssert.match(
    controlsBar,
    /\n\s+getModelDisabledReason,\n\s+\} = props;\n(?:\s+\/\/[^\n]*\n)*\s+const buddySurface = useBuddySurfaceMode\(environmentId\) === true;\n\s+if \(buddySurface\) return <BuddyComposerControls \{\.\.\.props\} \/>;\n\s+const providerTraitsMenuContent = /,
  );
  NodeAssert.match(
    composer,
    /const composerControlsVisibleInStrip =\n\s+composerControlsCollapsed &&\n\s+restingControlsHost !== null &&\n\s+restingControlsVisible &&\n\s+buddyComposer\.hasControls;/,
  );
  // Buddy always works with full access: the web never asks Buddy's thread for another mode.
  NodeAssert.match(
    chat,
    /\n\s+const runtimeMode = buddyRuntimeMode\(\n\s+buddySurface,\n\s+composerRuntimeMode \?\?\n/,
  );
  NodeAssert.equal(chat.match(/\bconst runtimeMode = /g)?.length, 1);
  NodeAssert.match(composer, /: \(buddyComposer\.placeholder \?\? "Ask anything\.\.\."\)\)\}/);
  NodeAssert.match(
    composer,
    /: \(buddyComposer\.placeholder \?\?\n\s+\(phase === "disconnected"\n\s+\? DISCONNECTED_COMPOSER_PLACEHOLDER\n\s+: "Ask anything, @tag files\/folders, \$use skills, or \/ for commands"\)\)/,
  );
  NodeAssert.match(
    chat,
    /\n\s+useBuddyChatShortcuts\(buddySurface, \{\n\s+enabled: activeThreadId !== null,/,
  );
  NodeAssert.doesNotMatch(chat, /\buseChatShortcuts\(/);
  NodeAssert.match(
    chat,
    /activeTasksProgress=\{\n\s+buddySurface \? null : activeComposerTasksProgress\n\s+\}/,
  );
  NodeAssert.match(root, /\{buddySurface \? null : <ReopenClosedViewShortcut \/>\}/);
  // Root decision 0210, addendum of HumanAndMachines/Lazurio#648: Buddy's chat is only the
  // conversation, so Buddy's surface shows neither T3's terminal nor its right panel, whatever the
  // thread holds. The chat reads the thread's drawer and panel as closed (its one read of each),
  // draws no drawer at all and the panel only while its reading is open, and does not follow the
  // thread's Environment browser tabs. The timeline's rows get no Run in terminal for a code block.
  // A link in the conversation opens in a new tab: Buddy's surface takes the chat's `_blank` web
  // links inside the timeline's root before T3's handlers can (BuddySurface.tsx).
  NodeAssert.match(
    chat,
    /\n\s+const terminalUiState = buddyTerminalUiState\(\n\s+buddySurface,\n\s+useTerminalUiStateStore\(\(state\) =>\n\s+selectThreadTerminalUiState\(state\.terminalUiStateByThreadKey, routeThreadRef\),\n/,
  );
  NodeAssert.equal(chat.match(/\bselectThreadTerminalUiState\(/g)?.length, 1);
  NodeAssert.match(chat, /\{buddySurface \? null : \(\n\s+<ChatTerminalDrawers\n/);
  NodeAssert.equal(chat.match(/<ChatTerminalDrawers\b/g)?.length, 1);
  NodeAssert.match(
    chat,
    /\n\s+const rightPanelState = buddyRightPanelState\(\n\s+buddySurface,\n\s+useRightPanelStore\(\(state\) => selectThreadRightPanelState\(state\.byThreadKey, activeThreadRef\)\),\n/,
  );
  NodeAssert.equal(chat.match(/\bselectThreadRightPanelState\(/g)?.length, 1);
  NodeAssert.match(chat, /\n\s+const rightPanelOpen = rightPanelState\.isOpen;\n/);
  NodeAssert.match(
    chat,
    /const rightPanelPresence = usePanelPresence\(\n\s+rightPanelOpen && activeThreadRef !== null,\n/,
  );
  NodeAssert.match(chat, /\{rightPanelPresent && activeThreadRef \? \(\n\s+<ChatRightPanel\n/);
  NodeAssert.equal(chat.match(/<ChatRightPanel\b/g)?.length, 1);
  NodeAssert.match(chat, /\n\s+useLazurioThreadTabs\(buddySurface \? null : activeThreadRef, \{\n/);
  NodeAssert.match(
    timeline,
    /\n\s+onRunShellCommand: buddySurface \? undefined : onRunShellCommand,\n/,
  );
  NodeAssert.match(timeline, /\n\s+data-timeline-root="true"\n/);
  NodeAssert.match(
    markdown,
    /\n\s+target=\{isSameDocumentLink \? undefined : "_blank"\}\n\s+rel=\{isSameDocumentLink \? undefined : "noopener noreferrer"\}\n/,
  );
  NodeAssert.match(surface, /link\.target === "_blank" && \(link\.protocol === "https:"/);
  // The work T3 shows above the composer passes Buddy's surface, and only there: each of its banners
  // is made once and goes nowhere else. Work that still runs is the timeline's quiet line instead.
  NodeAssert.match(
    chat,
    /const backgroundWorkItems = buddyWorkBanners\(buddySurface, \[\n\s+childInputBanner,\n\s+goalBanner,\n\s+backgroundWorkBanner,\n\s+\]\)\.filter\(\(item\) => item !== null\);/,
  );
  // useThreadLifecycle makes each banner once and hands it to ChatView alone, which takes it once
  // and joins it there; the background-work banner also tells the timeline that work still runs.
  for (const banner of ["childInputBanner", "goalBanner", "backgroundWorkBanner"]) {
    NodeAssert.equal(lifecycle.match(new RegExp(`\\b${banner}\\b`, "g"))?.length, 2, banner);
    NodeAssert.equal(
      chat.match(new RegExp(`\\b${banner}\\b`, "g"))?.length,
      banner === "backgroundWorkBanner" ? 3 : 2,
      banner,
    );
  }
  NodeAssert.equal(chat.match(/\buseThreadLifecycle\(/g)?.length, 1);
  NodeAssert.match(
    chat,
    /buddyBackgroundWork=\{!paintOnlyDisplayedTimeline && backgroundWorkBanner !== null\}/,
  );
  // The queue's runs, every use of them, are the person's in Buddy's surface.
  NodeAssert.match(
    queue,
    /const queued = useBuddyQueuedRuns\(\n\s+props\.environmentId,\n\s+workflow\?\.queuedRuns \?\? \[\],\n\s+projection\?\.messages,\n\s+\);/,
  );
  NodeAssert.equal(queue.match(/workflow\?\.queuedRuns/g)?.length, 1);
  // The thread's error banner says in human words that something went wrong, and no error code
  // picks T3's own text for it in Buddy's surface.
  NodeAssert.match(bannerLane, /\n\s+<BuddyThreadErrorBanner\n\s+error=\{threadError\}/);
  NodeAssert.doesNotMatch(bannerLane, /<ThreadErrorBanner\b/);
  NodeAssert.doesNotMatch(chat, /<ThreadErrorBanner\b/);
  NodeAssert.match(surface, /error=\{text\.somethingFailed\} errorCode=\{null\}/);
  for (const file of [
    "apps/web/src/components/chat/MessagesTimeline.tsx",
    "apps/web/src/components/chat/ChatComposer.tsx",
    "apps/web/src/components/chat/ComposerControlsBar.tsx",
    "apps/web/src/components/chat/ChatBannerLane.tsx",
    "apps/web/src/components/chat/QueuedRunsControl.tsx",
    "apps/web/src/components/ChatView.tsx",
    "apps/web/src/routes/__root.tsx",
  ])
    NodeAssert.ok(overlayMayChange(file), file);
});
