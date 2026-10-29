// @effect-diagnostics nodeBuiltinImport:off - the guard resolves real paths and symlinks.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import { makeFolderGuard, managedFolderClientConfig } from "./managedFolder.ts";

const parent = NodeFS.realpathSync(
  NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-lazurio-guard-")),
);
const folder = NodePath.join(parent, "Lazurio");
const repository = NodePath.join(folder, "organizations", "example");
const link = NodePath.join(parent, "link-to-Lazurio");
NodeFS.mkdirSync(repository, { recursive: true });
NodeFS.symlinkSync(folder, link);

const withConfig = (lazurioFolder: string | undefined) =>
  Effect.provide(
    Layer.effect(
      ServerConfig.ServerConfig,
      Effect.map(ServerConfig.ServerConfig, (config) => ({
        ...config,
        ...(lazurioFolder === undefined ? {} : { lazurioFolder }),
      })),
    ).pipe(
      Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-lazurio-guard-" })),
      Layer.provideMerge(NodeServices.layer),
    ),
  );

const turnOutsideFolder =
  "Agents in this Environment work in its Lazurio Folder. Start a new chat in the Lazurio project.";
const repositoryAtFolder =
  "The Lazurio Folder holds separate repositories, so it cannot become a repository itself.";

it.effect("refuses nothing without T3CODE_LAZURIO_FOLDER", () =>
  Effect.gen(function* () {
    const guard = yield* makeFolderGuard;
    assert.isUndefined(guard.folder);
    for (const cwd of [undefined, null, folder, repository, "/nowhere"]) {
      assert.isNull(yield* guard.turnRefusal(cwd));
    }
    assert.isNull(yield* guard.repositoryRefusal(folder));
  }).pipe(withConfig(undefined)),
);

it.effect("runs an agent turn only in the Folder itself, a symlink to it included", () =>
  Effect.gen(function* () {
    const guard = yield* makeFolderGuard;
    assert.isNull(yield* guard.turnRefusal(folder));
    assert.isNull(yield* guard.turnRefusal(link));
    for (const cwd of [undefined, null, repository, parent, NodePath.join(folder, "missing")]) {
      assert.strictEqual(yield* guard.turnRefusal(cwd), turnOutsideFolder, String(cwd));
    }
  }).pipe(withConfig(folder)),
);

it.effect("knows the Folder by its canonical path, never without a managed Folder", () =>
  Effect.gen(function* () {
    const guard = yield* makeFolderGuard;
    for (const path of [folder, link, `${folder}/`]) {
      assert.isTrue(yield* guard.isFolder(path), path);
    }
    for (const path of [parent, repository, NodePath.join(parent, "missing"), "Lazurio"]) {
      assert.isFalse(yield* guard.isFolder(path), path);
    }
    assert.isFalse(
      yield* makeFolderGuard.pipe(
        Effect.flatMap((other) => other.isFolder(folder)),
        withConfig(undefined),
      ),
    );
  }).pipe(withConfig(folder)),
);

it.effect("never makes the Folder a repository, while repositories inside it are fine", () =>
  Effect.gen(function* () {
    const guard = yield* makeFolderGuard;
    assert.strictEqual(yield* guard.repositoryRefusal(folder), repositoryAtFolder);
    assert.strictEqual(yield* guard.repositoryRefusal(link), repositoryAtFolder);
    assert.isNull(yield* guard.repositoryRefusal(repository));
    assert.isNull(yield* guard.repositoryRefusal(NodePath.join(folder, "new-repository")));
  }).pipe(withConfig(folder)),
);

it("gives clients the managed Folder and the tools page only when they are set", () => {
  assert.deepStrictEqual(managedFolderClientConfig({}), {});
  assert.deepStrictEqual(
    managedFolderClientConfig({
      lazurioFolder: folder,
      lazurioToolsUrl: "https://launchpad.example.test/tools",
    }),
    { lazurioFolder: folder, lazurioToolsUrl: "https://launchpad.example.test/tools" },
  );
});
