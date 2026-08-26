import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeTest from "node:test";

const workflow = await NodeFSP.readFile(".github/workflows/lazurio-release.yml", "utf8");
const dockerfile = await NodeFSP.readFile("Dockerfile.lazurio", "utf8");
const forkCi = await NodeFSP.readFile(".github/workflows/lazurio-fork-ci.yml", "utf8");
const workspaceConfig = await NodeFSP.readFile("pnpm-workspace.yaml", "utf8");
const versionStamp = await NodeFSP.readFile("scripts/lazurio-stamp-package-version.mjs", "utf8");

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
    /git merge-base --is-ancestor "\$SOURCE_SHA" refs\/remotes\/origin\/main/,
  );
  NodeAssert.ok(tagFetchIndex >= 0);
  NodeAssert.ok(tagFetchIndex < tagCheckoutIndex);
  NodeAssert.ok(tagCheckoutIndex < mainFetchIndex);
  NodeAssert.doesNotMatch(workflow, /git fetch[^\n]*--depth/);
  NodeAssert.match(workflow, /OCI tag .* already exists and will not be overwritten/);
  NodeAssert.match(workflow, /provenance: mode=max/);
  NodeAssert.match(workflow, /sbom: true/);
  NodeAssert.match(workflow, /actions\/attest-build-provenance@[0-9a-f]{40}/);
  NodeAssert.match(workflow, /release\/sbom\.spdx\.json/);
  NodeAssert.match(workflow, /release\/provenance\.slsa\.json/);
  NodeAssert.match(workflow, /release\/SHA256SUMS/);
  NodeAssert.doesNotMatch(workflow, /cat > release\/RELEASE_NOTES\.md <<EOF/);
  NodeAssert.doesNotMatch(workflow, /anchore\/sbom-action/);
  NodeAssert.doesNotMatch(workflow, /:\s*latest\b/);
});

NodeTest.test("browser image is reproducible, non-root, and protocol-neutral", () => {
  NodeAssert.match(dockerfile, /ARG NODE_BASE_IMAGE/);
  NodeAssert.match(dockerfile, /ARG BUN_BASE_IMAGE/);
  NodeAssert.match(dockerfile, /pnpm install --frozen-lockfile/);
  NodeAssert.match(
    dockerfile,
    /node scripts\/lazurio-stamp-package-version\.mjs "\$PACKAGE_VERSION"/,
  );
  NodeAssert.match(
    dockerfile,
    /pnpm --config\.allowUnusedPatches=true --filter t3 deploy \\\n\s+--prod --legacy --ignore-scripts \/opt\/lazurio-t3/,
  );
  NodeAssert.match(
    dockerfile,
    /require\.resolve\('node-pty\/package\.json', \{ paths: \['\/source\/apps\/server'\] \}\)/,
  );
  NodeAssert.match(dockerfile, /test -f "\$node_pty_source\/build\/Release\/pty\.node"/);
  NodeAssert.match(dockerfile, /cp -a "\$node_pty_source\/build" "\$node_pty_target\/"/);
  NodeAssert.doesNotMatch(dockerfile, /rebuild node-pty/);
  NodeAssert.match(
    dockerfile,
    /test -f \/opt\/lazurio-t3\/node_modules\/node-pty\/build\/Release\/pty\.node/,
  );
  NodeAssert.doesNotMatch(workspaceConfig, /^allowUnusedPatches:/m);
  NodeAssert.match(forkCi, /pty\.spawn\("\/bin\/sh"/);
  NodeAssert.match(forkCi, /pty-smoke=PASS/);
  NodeAssert.doesNotMatch(dockerfile, /VITE_HOSTED_APP_NAME/);
  NodeAssert.doesNotMatch(dockerfile, /VITE_HOSTED_APP_CHANNEL/);
  NodeAssert.match(dockerfile, /USER 10001:10001/);
  NodeAssert.match(dockerfile, /CMD \["serve", "--host", "127\.0\.0\.1"\]/);
  NodeAssert.match(versionStamp, /apps\/server\/package\.json/);
  NodeAssert.match(versionStamp, /apps\/web\/package\.json/);
  NodeAssert.doesNotMatch(versionStamp, /packages\/contracts|apps\/desktop|apps\/mobile/);
});

NodeTest.test("fork CI proves the exact upstream base and protected client boundaries", () => {
  NodeAssert.match(forkCi, /refs\/tags\/v0\.0\.34:refs\/tags\/upstream-v0\.0\.34/);
  NodeAssert.match(forkCi, /badae6a5cc8325dcd5a145bea6f7b8ac692818a1/);
  NodeAssert.match(
    forkCi,
    /\^\(packages\/contracts\|packages\/client-runtime\|apps\/mobile\|apps\/desktop\)/,
  );
  NodeAssert.match(forkCi, /--build-arg PACKAGE_VERSION=0\.0\.34/);
});
