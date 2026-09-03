import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeTest from "node:test";

const workflow = await NodeFSP.readFile(".github/workflows/lazurio-release.yml", "utf8");
const dockerfile = await NodeFSP.readFile("Dockerfile.lazurio", "utf8");
const forkCi = await NodeFSP.readFile(".github/workflows/lazurio-fork-ci.yml", "utf8");
const windowsForkCi = forkCi.slice(forkCi.indexOf("  windows-generic-files:"));
const forkSafety = await NodeFSP.readFile(".github/FORK-SAFETY.md", "utf8");
const releaseContract = await NodeFSP.readFile("docs/operations/lazurio-fork-release.md", "utf8");
const workspaceConfig = await NodeFSP.readFile("pnpm-workspace.yaml", "utf8");
const versionStamp = await NodeFSP.readFile("scripts/lazurio-stamp-package-version.mjs", "utf8");
const attachmentContract = await NodeFSP.readFile("packages/contracts/src/assets.ts", "utf8");
const serverAttachmentUpload = await NodeFSP.readFile(
  "apps/server/src/assets/AttachmentUpload.ts",
  "utf8",
);
const browserAttachmentFiles = await NodeFSP.readFile(
  "apps/web/src/components/chat/composerAttachmentFiles.ts",
  "utf8",
);
const mobileAttachmentUpload = await NodeFSP.readFile(
  "apps/mobile/src/lib/attachmentUpload.ts",
  "utf8",
);
const migrations = await NodeFSP.readFile("apps/server/src/persistence/Migrations.ts", "utf8");
const dockerignore = await NodeFSP.readFile(".dockerignore", "utf8");

const requiredSensitiveDockerIgnores = [
  ".t3",
  ".env*",
  ".alchemy",
  ".vercel",
  ".logs",
  "*.log",
  "release",
  "release-mock",
  "artifacts",
  ".bun",
  ".turbo",
  ".vite-hooks",
  ".astro",
  ".tanstack",
  ".vitest-*",
  ".cache",
  ".pnpm-store",
  ".idea",
  ".DS_Store",
  "build",
  "coverage",
  "squashfs-root",
  ".electron-runtime",
  ".showcase",
  "__screenshots__",
  "apps/web/.playwright",
  "apps/web/playwright-report",
  "*.tsbuildinfo",
];

async function assertMissing(path) {
  await NodeAssert.rejects(NodeFSP.access(path), { code: "ENOENT" });
}

NodeTest.test("release workflow is manual and keeps repository CI read-only", () => {
  const triggerBlock = workflow.slice(workflow.indexOf("on:"), workflow.indexOf("\npermissions:"));
  NodeAssert.match(workflow, /workflow_dispatch:/);
  NodeAssert.doesNotMatch(triggerBlock, /^  (push|schedule|release):/m);
  NodeAssert.match(workflow, /permissions:\n  contents: read\n  id-token: none/);
  NodeAssert.match(
    workflow,
    /permissions:\n      attestations: write\n      contents: write\n      id-token: write\n      packages: write/,
  );
  NodeAssert.match(forkCi, /permissions:\n  contents: read\n  id-token: none/);
  NodeAssert.match(forkCi, /^  pull_request:$/m);
  NodeAssert.match(
    forkCi,
    /SOURCE_REPOSITORY: \$\{\{ github\.event\.pull_request\.head\.repo\.full_name \|\| github\.repository \}\}/,
  );
  NodeAssert.match(
    forkCi,
    /git remote add source "https:\/\/github\.com\/\$\{SOURCE_REPOSITORY\}\.git"/,
  );
  NodeAssert.match(
    forkCi,
    /git remote add source "https:\/\/github\.com\/\$env:SOURCE_REPOSITORY\.git"/,
  );
  NodeAssert.match(forkCi, /push:\n    branches:\n      - main/);
  NodeAssert.doesNotMatch(forkCi, /- ["']?codex\/\*\*/);
});

NodeTest.test("rolling main publication is exact, reviewed, and release-separated", () => {
  NodeAssert.match(releaseContract, /main` is the readable snapshot/);
  NodeAssert.match(
    releaseContract,
    /previous `main` must already equal an existing protected immutable/,
  );
  NodeAssert.match(
    releaseContract,
    /approval from an authorized Principal on the exact candidate HEAD/,
  );
  NodeAssert.match(releaseContract, /no\s+unresolved conversation/);
  NodeAssert.match(releaseContract, /--force-with-lease="refs\/heads\/main:\$expected_old_main"/);
  NodeAssert.match(releaseContract, /origin "\$candidate_head:refs\/heads\/main"/);
  NodeAssert.match(releaseContract, /Release creation and deployment are separate explicit gates/);
  NodeAssert.match(releaseContract, /Greptile is advisory/);
  NodeAssert.doesNotMatch(releaseContract, /tree-neutral `ours` merge/);
  NodeAssert.doesNotMatch(releaseContract, /git merge -s ours/);
  NodeAssert.match(forkSafety, /reviewed rolling stable-refresh contract/);
  NodeAssert.match(
    forkSafety,
    /Release tags, OCI tags, deployed digests, and all other refs remain/,
  );
});

NodeTest.test("release workflow publishes one immutable GHCR tag with standard evidence", () => {
  const tagFetchIndex = workflow.indexOf(
    'git fetch --filter=blob:none --no-tags origin "$GITHUB_REF"',
  );
  const tagCheckoutIndex = workflow.indexOf("git checkout --detach FETCH_HEAD");
  const mainFetchIndex = workflow.indexOf('"refs/heads/main:refs/remotes/origin/main"');

  NodeAssert.match(workflow, /IMAGE: ghcr\.io\/lazurio\/t3code/);
  NodeAssert.match(workflow, /environment: lazurio-t3code-release/);
  NodeAssert.match(workflow, /test "\$RELEASE_CONTROL" = "reviewed-v1"/);
  NodeAssert.match(workflow, /test "\$GITHUB_REF" = "refs\/tags\/\$RELEASE_TAG"/);
  NodeAssert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$SOURCE_SHA"/);
  NodeAssert.match(
    workflow,
    /test "\$\(git rev-parse refs\/remotes\/origin\/main\)" = "\$SOURCE_SHA"/,
  );
  NodeAssert.ok(tagFetchIndex >= 0);
  NodeAssert.ok(tagFetchIndex < tagCheckoutIndex);
  NodeAssert.ok(tagCheckoutIndex < mainFetchIndex);
  NodeAssert.doesNotMatch(workflow, /git fetch[^\n]*--depth/);
  NodeAssert.match(workflow, /OCI tag .* already exists and will not be overwritten/);
  NodeAssert.match(workflow, /release_status=0/);
  NodeAssert.match(workflow, /\^HTTP\/\[0-9\.\]\+ 404\( \|\$\)/);
  NodeAssert.match(workflow, /Unable to prove that GitHub Release .* is absent/);
  NodeAssert.match(workflow, /gh api --paginate --slurp/);
  NodeAssert.match(workflow, /orgs\/Lazurio\/packages\/container\/t3code\/versions\?per_page=100/);
  NodeAssert.match(workflow, /\.metadata\.container\.tags\[\]\?/);
  NodeAssert.match(workflow, /tag_query_status != 1/);
  NodeAssert.match(workflow, /Unable to enumerate GHCR package versions/);
  NodeAssert.match(workflow, /Unable to evaluate GHCR package version metadata/);
  NodeAssert.doesNotMatch(workflow, /docker buildx imagetools inspect "\$IMAGE:\$RELEASE_TAG"/);
  NodeAssert.match(
    workflow,
    /test "\$\(git merge-base "\$UPSTREAM_SHA" "\$SOURCE_SHA"\)" = "\$UPSTREAM_SHA"/,
  );
  NodeAssert.match(
    workflow,
    /test "\$\(git rev-list --merges "\$UPSTREAM_SHA\.\.\$SOURCE_SHA" --count\)" = 0/,
  );
  NodeAssert.match(
    workflow,
    /Release source changed an upstream client or shared protocol package/,
  );
  NodeAssert.match(
    workflow,
    /Release source changed upstream-owned attachment, provider, or migration code/,
  );
  NodeAssert.match(workflow, /Release source changed upstream-owned browser file attachments/);
  NodeAssert.match(workflow, /provenance: mode=max/);
  NodeAssert.match(workflow, /sbom: true/);
  NodeAssert.match(workflow, /actions\/attest-build-provenance@[0-9a-f]{40}/);
  NodeAssert.match(workflow, /release\/sbom\.spdx\.json/);
  NodeAssert.match(workflow, /release\/provenance\.slsa\.json/);
  NodeAssert.match(workflow, /release\/SHA256SUMS/);
  NodeAssert.doesNotMatch(workflow, /:\s*latest\b/);
});

NodeTest.test("browser image is reproducible, non-root, and protocol-neutral", () => {
  NodeAssert.match(dockerfile, /ARG NODE_BASE_IMAGE/);
  NodeAssert.match(dockerfile, /ARG BUN_BASE_IMAGE/);
  NodeAssert.match(dockerfile, /pnpm config set allowUnusedPatches true --location=project/);
  NodeAssert.match(dockerfile, /pnpm install --frozen-lockfile/);
  NodeAssert.match(
    dockerfile,
    /node scripts\/lazurio-stamp-package-version\.mjs "\$PACKAGE_VERSION"/,
  );
  NodeAssert.match(
    dockerfile,
    /pnpm --filter t3 deploy \\\n\s+--prod --legacy --ignore-scripts \/opt\/lazurio-t3/,
  );
  NodeAssert.match(dockerfile, /T3CODE_PAIRING_TOKEN_TTL=15m/);
  NodeAssert.match(dockerfile, /T3CODE_CLIENT_SESSION_TTL=365d/);
  NodeAssert.match(dockerfile, /USER 10001:10001/);
  NodeAssert.match(dockerfile, /CMD \["serve", "--host", "127\.0\.0\.1"\]/);
  NodeAssert.match(forkCi, /pty-smoke=PASS/);
  NodeAssert.match(workflow, /VITE_HOSTED_APP_NAME=Lazurio T3 Code/);
  NodeAssert.match(versionStamp, /apps\/server\/package\.json/);
  NodeAssert.match(versionStamp, /apps\/web\/package\.json/);
  NodeAssert.doesNotMatch(versionStamp, /packages\/contracts|apps\/desktop|apps\/mobile/);
  NodeAssert.doesNotMatch(workspaceConfig, /^allowUnusedPatches:/m);
});

NodeTest.test("browser image excludes local state and secret-bearing build inputs", () => {
  const patterns = new Set(
    dockerignore
      .split("\n")
      .map((line) => line.trim().replace(/\/$/, ""))
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );

  for (const pattern of requiredSensitiveDockerIgnores) {
    NodeAssert.ok(patterns.has(pattern), `.dockerignore must exclude ${pattern}`);
  }
});

NodeTest.test(
  "fork CI proves the exact upstream base and protects upstream clients and files",
  () => {
    NodeAssert.match(forkCi, /refs\/tags\/v0\.0\.38:refs\/tags\/upstream-v0\.0\.38/);
    NodeAssert.match(forkCi, /c0995d2eaf8ec787b3318ed1169ae266ed1529f8/);
    NodeAssert.match(forkCi, /\^\(apps\/\(mobile\|desktop\)\|packages\)/);
    NodeAssert.match(forkCi, /upstream-owned attachment, provider, or migration code/);
    NodeAssert.match(forkCi, /upstream-owned browser file attachments/);
    NodeAssert.match(forkCi, /name: Windows generic-file compatibility/);
    NodeAssert.match(forkCi, /runs-on: windows-latest/);
    NodeAssert.match(
      windowsForkCi,
      /run: pnpm exec vp test run src\/assets\/AssetAccess\.test\.ts --testNamePattern attachment/,
    );
    NodeAssert.match(windowsForkCi, /working-directory: apps\/server/);
    NodeAssert.doesNotMatch(windowsForkCi, /cd packages\/contracts/);
    NodeAssert.match(forkCi, /--build-arg PACKAGE_VERSION=0\.0\.38/);
    NodeAssert.match(forkCi, /--build-arg "VITE_HOSTED_APP_NAME=Lazurio T3 Code"/);
  },
);

NodeTest.test("v0.0.38 owns file attachments across contracts, server, web, and mobile", () => {
  NodeAssert.match(attachmentContract, /type: Schema\.Literal\("file"\)/);
  NodeAssert.match(attachmentContract, /PROVIDER_SEND_TURN_MAX_FILE_BYTES/);
  NodeAssert.match(serverAttachmentUpload, /attachmentType === "file"/);
  NodeAssert.match(serverAttachmentUpload, /createPendingAttachmentId/);
  NodeAssert.match(browserAttachmentFiles, /return "file"/);
  NodeAssert.match(browserAttachmentFiles, /fileAttachmentStagingLimit/);
  NodeAssert.match(mobileAttachmentUpload, /validateDraftFileAttachments/);
  NodeAssert.match(mobileAttachmentUpload, /prepareTurnAttachments/);
  NodeAssert.match(forkCi, /Test upstream-owned file attachments/);
  NodeAssert.match(forkSafety, /former Lazurio `contextFiles` implementation/);
});

NodeTest.test("the retired Lazurio contextFiles implementation is absent", async () => {
  await Promise.all([
    assertMissing("packages/contracts/src/vanilla-v0.0.35-compat.test.ts"),
    assertMissing("scripts/lazurio-context-file-migration-contract.test.mjs"),
    assertMissing(
      "apps/server/src/persistence/Migrations/044_ProjectionThreadMessagesContextFiles.ts",
    ),
    assertMissing(
      "apps/server/src/persistence/Migrations/044_ProjectionThreadMessagesContextFiles.test.ts",
    ),
  ]);
  NodeAssert.match(migrations, /\[43, "ProjectionThreadsUnsettledAt", Migration0043\]/);
  NodeAssert.doesNotMatch(migrations, /LazurioProjectionThreadMessagesContextFiles/);
});
