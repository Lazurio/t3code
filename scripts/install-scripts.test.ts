// @effect-diagnostics nodeBuiltinImport:off - runs the real install script in a shell against a fake curl.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { cliReleaseChannelOf, type CliReleaseChannel } from "@t3tools/shared/cliRelease";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
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

describe("install.sh", () => {
  // Runs the real script against a fake curl that serves the release index
  // and 404s everything else, so the script stops right after choosing a
  // version and names it in its error.
  const installWith = (channel: CliReleaseChannel) => {
    const work = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-install-sh-"));
    try {
      const index = NodePath.join(work, "index.json");
      NodeFS.writeFileSync(
        index,
        // GitHub pretty-prints the list, one key per line.
        `[\n${tags.map((tag) => `  {\n    "tag_name": "${tag}",\n    "draft": false\n  }`).join(",\n")}\n]\n`,
      );
      const bin = NodePath.join(work, "bin");
      NodeFS.mkdirSync(bin);
      const curl = NodePath.join(bin, "curl");
      NodeFS.writeFileSync(
        curl,
        [
          "#!/bin/sh",
          'url=""; out=""',
          'while [ "$#" -gt 0 ]; do',
          '  case "$1" in',
          '    -o) out="$2"; shift ;;',
          '    http*) url="$1" ;;',
          "  esac",
          "  shift",
          "done",
          'case "$url" in',
          `  https://api.github.com/*) cp "${index}" "$out"; printf 200 ;;`,
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
      return result.stderr;
    } finally {
      NodeFS.rmSync(work, { recursive: true, force: true });
    }
  };

  it.effect.each(["stable", "nightly", "preview"] as const)(
    "picks the %s release the runtime would",
    (channel) =>
      Effect.gen(function* () {
        if ((yield* HostProcessPlatform) === "win32") return;
        const version = expectedPick(channel);
        expect(version).toBeDefined();
        expect(installWith(channel)).toContain(`t3 ${version} has no release archive`);
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
});
