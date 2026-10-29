import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { repointLauncherLink } from "./launcherLink.ts";

const PREVIOUS = "0.0.45-lazurio.9";
const CURRENT = "0.1.0-lazurio.1";
const committed = {
  protocol: 3,
  activeVersion: CURRENT,
  update: { id: "update-1", fromVersion: PREVIOUS, targetVersion: CURRENT, status: "committed" },
};

/**
 * A T3 home with both runtimes installed and the install scripts' `t3` link
 * still on the previous one, as an in-app Update leaves it.
 */
const makeHome = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-launcher-link-" });
  const baseDir = path.join(home, ".t3");
  const runtime = (version: string) => path.join(baseDir, "runtime", "versions", version, "t3");
  for (const version of [PREVIOUS, CURRENT]) {
    yield* fs.makeDirectory(path.dirname(runtime(version)), { recursive: true });
    yield* fs.writeFileString(runtime(version), "");
  }
  const link = path.join(home, ".local", "bin", "t3");
  yield* fs.makeDirectory(path.dirname(link), { recursive: true });
  yield* fs.symlink(runtime(PREVIOUS), link);
  const writeState = (state: unknown) =>
    fs.writeFileString(path.join(baseDir, "runtime", "service-state.json"), JSON.stringify(state));
  return { home, baseDir, runtime, link, writeState };
});

const onHost =
  (home: string, environment: NodeJS.ProcessEnv = {}) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(HostProcess.HomeDirectory, home),
      Effect.provideService(HostProcess.Environment, environment),
      Effect.provideService(HostProcess.Platform, "linux"),
    );

it.layer(NodeServices.layer)("repointLauncherLink", (it) => {
  it.effect("points the t3 command at the runtime the launcher committed", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { home, baseDir, runtime, link, writeState } = yield* makeHome;
      // A second launcher, found where a bare `t3` resolves on PATH.
      const onPath = path.join(home, "bin", "t3");
      yield* fs.makeDirectory(path.dirname(onPath), { recursive: true });
      yield* fs.symlink(runtime(PREVIOUS), onPath);
      yield* writeState(committed);
      const repoint = repointLauncherLink({ managed: true, baseDir, version: CURRENT }).pipe(
        onHost(home, { PATH: path.dirname(onPath) }),
      );

      assert.deepStrictEqual(yield* repoint, [onPath, link]);
      assert.equal(yield* fs.readLink(onPath), runtime(CURRENT));
      assert.equal(yield* fs.readLink(link), runtime(CURRENT));
      // A restart on the same version leaves the links as they are.
      assert.deepStrictEqual(yield* repoint, []);
    }).pipe(Effect.scoped),
  );

  it.effect.each([
    {
      name: "while the update trial can still roll back",
      state: {
        protocol: 3,
        activeVersion: PREVIOUS,
        update: {
          id: "update-1",
          fromVersion: PREVIOUS,
          targetVersion: CURRENT,
          dbPath: "/home/user/.t3/userdata/state.sqlite",
          status: "pending",
        },
      },
    },
    {
      name: "when the launcher selected another version",
      state: { protocol: 3, activeVersion: PREVIOUS },
    },
    { name: "without a launcher state", state: undefined },
  ])("leaves the t3 command alone $name", ({ state }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { home, baseDir, runtime, link, writeState } = yield* makeHome;
      if (state !== undefined) yield* writeState(state);

      const repointed = yield* repointLauncherLink({
        managed: true,
        baseDir,
        version: CURRENT,
      }).pipe(onHost(home));

      assert.deepStrictEqual(repointed, []);
      assert.equal(yield* fs.readLink(link), runtime(PREVIOUS));
    }).pipe(Effect.scoped),
  );

  it.effect("never touches a t3 that is not a link into this T3 home", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { home, baseDir, link, writeState } = yield* makeHome;
      yield* writeState(committed);
      // A `t3` from another install on PATH, and a plain copy where the install scripts link.
      const elsewhere = path.join(home, "other", "lib", "t3", "bin.mjs");
      const foreign = path.join(home, "bin", "t3");
      yield* fs.makeDirectory(path.dirname(elsewhere), { recursive: true });
      yield* fs.writeFileString(elsewhere, "");
      yield* fs.makeDirectory(path.dirname(foreign), { recursive: true });
      yield* fs.symlink(elsewhere, foreign);
      yield* fs.remove(link);
      yield* fs.writeFileString(link, "copy");

      const repointed = yield* repointLauncherLink({
        managed: true,
        baseDir,
        version: CURRENT,
      }).pipe(onHost(home, { PATH: path.dirname(foreign) }));

      assert.deepStrictEqual(repointed, []);
      assert.equal(yield* fs.readLink(foreign), elsewhere);
      assert.equal(yield* fs.readFileString(link), "copy");
    }).pipe(Effect.scoped),
  );

  it.effect("does nothing for a server the service launcher does not run", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { home, baseDir, runtime, link, writeState } = yield* makeHome;
      yield* writeState(committed);

      const repointed = yield* repointLauncherLink({
        managed: false,
        baseDir,
        version: CURRENT,
      }).pipe(onHost(home));

      assert.deepStrictEqual(repointed, []);
      assert.equal(yield* fs.readLink(link), runtime(PREVIOUS));
    }).pipe(Effect.scoped),
  );
});
