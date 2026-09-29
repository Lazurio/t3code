// Contract for the Lazurio distribution files. Run with:
//   node --test scripts/lazurio-release-contract.test.mjs
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeTest from "node:test";

import { cliReleaseChannelOf } from "../packages/shared/src/cliRelease.ts";

const read = (path) => NodeFSP.readFile(path, "utf8");
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
  NodeAssert.match(ci, /UPSTREAM_TAG: v0\.0\.43/);
  NodeAssert.match(ci, /UPSTREAM_SHA: 27bdf1aa14e6b946b72fb7013062084ca70796a6/);
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
