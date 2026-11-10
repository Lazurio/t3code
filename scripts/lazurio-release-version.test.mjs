// lazurio-release.yml's version check, run as the release runs it. lazurio-fork-ci.yml runs this
// file after only the release's filtered install, so an import that install does not cover fails
// here instead of in a dispatched release:
//   node --test scripts/lazurio-release-version.test.mjs
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";

// One page as `gh api --paginate --slurp` writes it: an array of pages.
const published = [
  [
    { tag_name: "v0.1.6-preview.20261101.1", draft: false },
    { tag_name: "v0.1.6-preview.20261102.1", draft: true },
    { tag_name: "v0.1.3-lazurio.1", draft: false },
    { tag_name: "lazurio-v0.0.30-r1", draft: false },
  ],
];

const check = (version, channel) => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "lazurio-release-version-"));
  try {
    const releases = NodePath.join(dir, "releases.json");
    NodeFS.writeFileSync(releases, JSON.stringify(published));
    return NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/lazurio-release-version.mjs", releases],
      { encoding: "utf8", env: { ...process.env, VERSION: version, CHANNEL: channel } },
    );
  } finally {
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
};

const accepts = (version, channel) => {
  const run = check(version, channel);
  NodeAssert.equal(run.status, 0, run.stderr);
  NodeAssert.equal(
    run.stdout.trim(),
    `${version} is the highest version on the ${channel} channel.`,
  );
};

const refuses = (version, channel, reason) => {
  const run = check(version, channel);
  NodeAssert.notEqual(run.status, 0, run.stdout);
  NodeAssert.ok(run.stderr.includes(reason), run.stderr);
};

NodeTest.test("the next preview and stable pass, each on its own channel", () => {
  accepts("0.1.6-preview.20261101.2", "preview");
  // A draft is not published, so its higher version does not count.
  accepts("0.1.6-preview.20261101.3", "preview");
  // A newer preview never competes with stable.
  accepts("0.1.6-lazurio.1", "stable");
});

NodeTest.test("an existing, older or wrongly labelled version is refused", () => {
  refuses(
    "0.1.6-preview.20261101.1",
    "preview",
    "A GitHub Release for v0.1.6-preview.20261101.1 already exists.",
  );
  refuses(
    "0.1.6-preview.20261031.1",
    "preview",
    "0.1.6-preview.20261031.1 is not newer than the published 0.1.6-preview.20261101.1 on preview.",
  );
  refuses("0.1.3-lazurio.1", "stable", "A GitHub Release for v0.1.3-lazurio.1 already exists.");
  refuses(
    "0.1.6-preview.20261101.2",
    "stable",
    "0.1.6-preview.20261101.2 is on the preview channel, not stable.",
  );
});
