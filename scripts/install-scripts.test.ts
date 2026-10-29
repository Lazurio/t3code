// @effect-diagnostics nodeBuiltinImport:off - runs the real install script in a shell against a fake curl.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { cliReleaseChannelOf, type CliReleaseChannel } from "@t3tools/shared/cliRelease";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

// Listing order as GitHub returns it. The first tag carries "nightly" after a
// fork's own suffix, which the runtime counts as stable; every surface that
// installs or updates must agree on that.
const tags = [
  "v1.2.3-acme-nightly.20260901.1",
  "v1.2.3-nightly.20260901.2",
  "v1.2.3-preview.20260901.3",
  "v1.2.2-acme.1",
];

// What an installer should pick for a channel: the first listed tag the
// runtime assigns to that channel.
const expectedPick = (channel: CliReleaseChannel) =>
  tags.map((tag) => tag.slice(1)).find((version) => cliReleaseChannelOf(version) === channel);

const scriptsDir = import.meta.dirname;

// GitHub lists releases newest first, 100 per page; the second page holds the preview.
const pages = [tags.slice(0, 2), tags.slice(2)];

// The release GitHub marks latest. The release workflow marks only stable releases latest.
const latest = tags.find((tag) => cliReleaseChannelOf(tag.slice(1)) === "stable");

describe("install.sh", () => {
  // Runs the real script against a fake curl that serves the release pages and
  // `releases/latest` and 404s everything else, so the script stops right after
  // choosing a version and names it in its error. It logs every URL it serves.
  const installWith = (channel: CliReleaseChannel) => {
    const work = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-install-sh-"));
    try {
      // The API pretty-prints the list, one key per line.
      pages.forEach((page, index) =>
        NodeFS.writeFileSync(
          NodePath.join(work, `page-${index + 1}.json`),
          `[\n${page.map((tag) => `  {\n    "tag_name": "${tag}",\n    "draft": false\n  }`).join(",\n")}\n]\n`,
        ),
      );
      // github.com answers `Accept: application/json` with one compact line.
      NodeFS.writeFileSync(
        NodePath.join(work, "latest.json"),
        `{"id":1,"tag_name":"${latest}","update_url":"/acme/t3code/releases/tag/${latest}"}`,
      );
      const log = NodePath.join(work, "requests.log");
      const bin = NodePath.join(work, "bin");
      NodeFS.mkdirSync(bin);
      const curl = NodePath.join(bin, "curl");
      NodeFS.writeFileSync(
        curl,
        [
          "#!/bin/sh",
          'url=""; out=""; accept=""',
          'while [ "$#" -gt 0 ]; do',
          '  case "$1" in',
          '    -o) out="$2"; shift ;;',
          '    -H) accept="$2"; shift ;;',
          '    http*) url="$1" ;;',
          "  esac",
          "  shift",
          "done",
          `printf '%s\\n' "$url" >> "${log}"`,
          'case "$url" in',
          `  https://api.github.com/repos/acme/t3code/releases\\?per_page=100\\&page=[12]) cp "${work}/page-\${url##*=}.json" "$out"; printf 200 ;;`,
          `  https://api.github.com/*) printf '[]\\n' > "$out"; printf 200 ;;`,
          "  https://github.com/acme/t3code/releases/latest)",
          '    if [ "$accept" = "Accept: application/json" ]; then',
          `      cp "${work}/latest.json" "$out"; printf 200`,
          '    else : > "$out"; printf 406; fi ;;',
          '  *) : > "$out"; printf 404 ;;',
          "esac",
          "",
        ].join("\n"),
      );
      NodeFS.chmodSync(curl, 0o755);
      const result = NodeChildProcess.spawnSync("sh", [NodePath.join(scriptsDir, "install.sh")], {
        encoding: "utf8",
        env: {
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          HOME: work,
          T3CODE_HOME: NodePath.join(work, "t3"),
          T3CODE_INSTALL_BIN_DIR: NodePath.join(work, "t3-bin"),
          T3CODE_RELEASE_REPOSITORY: "acme/t3code",
          T3CODE_CHANNEL: channel,
        },
      });
      const requests = NodeFS.readFileSync(log, "utf8").trim().split("\n");
      return { stderr: result.stderr, requests };
    } finally {
      NodeFS.rmSync(work, { recursive: true, force: true });
    }
  };

  const indexRequests = (requests: ReadonlyArray<string>) =>
    requests.filter((url) => !url.includes("/releases/download/"));

  it.effect.each(["stable", "nightly", "preview"] as const)(
    "picks the %s release the runtime would",
    (channel) =>
      Effect.gen(function* () {
        if ((yield* HostProcess.Platform) === "win32") return;
        const version = expectedPick(channel);
        expect(version).toBeDefined();
        expect(installWith(channel).stderr).toContain(`t3 ${version} has no release archive`);
      }),
  );

  it.effect("reads stable from releases/latest and pages the API for the other trains", () =>
    Effect.gen(function* () {
      if ((yield* HostProcess.Platform) === "win32") return;
      const api = "https://api.github.com/repos/acme/t3code/releases?per_page=100&page=";
      expect(indexRequests(installWith("stable").requests)).toEqual([
        "https://github.com/acme/t3code/releases/latest",
      ]);
      expect(indexRequests(installWith("nightly").requests)).toEqual([`${api}1`]);
      expect(indexRequests(installWith("preview").requests)).toEqual([`${api}1`, `${api}2`]);
    }),
  );
});

describe("install.ps1", () => {
  // No PowerShell in this test environment: evaluate the script's train rule
  // itself. The pattern is plain .NET regex syntax that JavaScript shares.
  const script = NodeFS.readFileSync(NodePath.join(scriptsDir, "install.ps1"), "utf8");
  const trainPattern = /\$candidate -match '([^']+)'/.exec(script)?.[1];

  it("classifies every tag the way the runtime does", () => {
    expect(trainPattern).toBeDefined();
    const train = new RegExp(trainPattern ?? "$^");
    for (const tag of tags) {
      const trainOf = train.exec(tag)?.[1] ?? "stable";
      expect(trainOf, tag).toBe(cliReleaseChannelOf(tag.slice(1)));
      expect(train.exec(tag.slice(1))?.[1] ?? "stable", tag).toBe(trainOf);
    }
  });

  it("reads stable from releases/latest and filters every lookup by the train rule", () => {
    expect(script).toMatch(
      /releases\/latest" -Headers @\{ "User-Agent" = "t3-install"; "Accept" = "application\/json" \}/,
    );
    expect(script).toMatch(/\$tag = & \$ofTrain \$release\n/);
    expect(script).toMatch(/\$tag = & \$ofTrain \$releases\n/);
    expect(script).toMatch(/\(& \$trainOf \$_\.tag_name\) -eq \$channel/);
  });
});
