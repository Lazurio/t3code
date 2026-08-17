import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(".github/workflows/lazurio-release.yml", "utf8");
const dockerfile = await readFile("Dockerfile.lazurio", "utf8");
const forkCi = await readFile(".github/workflows/lazurio-fork-ci.yml", "utf8");

test("release workflow is manual and keeps repository CI read-only", () => {
  const triggerBlock = workflow.slice(workflow.indexOf("on:"), workflow.indexOf("\npermissions:"));
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(triggerBlock, /^  (push|schedule|release):/m);
  assert.match(workflow, /permissions:\n  contents: read\n  id-token: none/);
  assert.match(
    workflow,
    /permissions:\n      attestations: write\n      contents: write\n      id-token: write\n      packages: write/,
  );
  assert.match(forkCi, /permissions:\n  contents: read\n  id-token: none/);
});

test("release workflow publishes one immutable GHCR tag with standard evidence", () => {
  assert.match(workflow, /IMAGE: ghcr\.io\/lazurio\/t3code/);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/tags\/\$RELEASE_TAG"/);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$SOURCE_SHA"/);
  assert.doesNotMatch(workflow, /git fetch[^\n]*--depth/);
  assert.match(workflow, /OCI tag .* already exists and will not be overwritten/);
  assert.match(workflow, /provenance: mode=max/);
  assert.match(workflow, /sbom: true/);
  assert.match(workflow, /actions\/attest-build-provenance@[0-9a-f]{40}/);
  assert.match(workflow, /release\/sbom\.spdx\.json/);
  assert.match(workflow, /release\/provenance\.slsa\.json/);
  assert.match(workflow, /release\/SHA256SUMS/);
  assert.doesNotMatch(workflow, /anchore\/sbom-action/);
  assert.doesNotMatch(workflow, /:\s*latest\b/);
});

test("browser image is reproducible, non-root, and protocol-neutral", () => {
  assert.match(dockerfile, /ARG NODE_BASE_IMAGE/);
  assert.match(dockerfile, /ARG BUN_BASE_IMAGE/);
  assert.match(dockerfile, /pnpm install --frozen-lockfile/);
  assert.match(dockerfile, /VITE_HOSTED_APP_NAME=\$HOSTED_APP_NAME/);
  assert.doesNotMatch(dockerfile, /VITE_HOSTED_APP_CHANNEL/);
  assert.match(dockerfile, /USER 10001:10001/);
  assert.match(dockerfile, /CMD \["serve", "--host", "127\.0\.0\.1"\]/);
});
