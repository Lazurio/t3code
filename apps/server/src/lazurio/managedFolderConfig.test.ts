// @effect-diagnostics nodeBuiltinImport:off - the Folder is a real directory, reached through a symlink.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { resolveServerConfig } from "../cli/config.ts";
import { resolveManagedFolderConfig } from "./managedFolderConfig.ts";

const withEnv = (env: Record<string, string>) =>
  Effect.provide(
    Layer.mergeAll(
      ConfigProvider.layer(ConfigProvider.fromEnv({ env })),
      NetService.layer,
      NodeServices.layer,
    ),
  );

const makeFolder = () => {
  const parent = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-lazurio-folder-")),
  );
  const folder = NodePath.join(parent, "Lazurio");
  NodeFS.mkdirSync(folder);
  const link = NodePath.join(parent, "link-to-Lazurio");
  NodeFS.symlinkSync(folder, link);
  const buddy = NodePath.join(parent, "Buddy");
  NodeFS.mkdirSync(buddy);
  const buddyLink = NodePath.join(parent, "link-to-Buddy");
  NodeFS.symlinkSync(buddy, buddyLink);
  return { parent, folder, link, buddy, buddyLink };
};

it.effect(
  "leaves the config alone without T3CODE_LAZURIO_FOLDER and T3CODE_LAZURIO_TOOLS_URL",
  () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* resolveManagedFolderConfig.pipe(withEnv({})), {});
    }),
);

it.effect("makes the Folder's canonical path the cwd, without a cwd bootstrap", () =>
  Effect.gen(function* () {
    const { folder, link } = makeFolder();
    assert.deepStrictEqual(
      yield* resolveManagedFolderConfig.pipe(
        withEnv({
          T3CODE_LAZURIO_FOLDER: link,
          T3CODE_LAZURIO_TOOLS_URL: "https://launchpad.example.test/tools",
        }),
      ),
      {
        cwd: folder,
        lazurioFolder: folder,
        autoBootstrapProjectFromCwd: false,
        lazurioToolsUrl: "https://launchpad.example.test/tools",
      },
    );
  }),
);

it.effect("declares the Buddy folder beside the Folder by its canonical path", () =>
  Effect.gen(function* () {
    const { folder, buddy, buddyLink } = makeFolder();
    assert.deepStrictEqual(
      yield* resolveManagedFolderConfig.pipe(
        withEnv({ T3CODE_LAZURIO_FOLDER: folder, T3CODE_LAZURIO_BUDDY_FOLDER: buddyLink }),
      ),
      {
        cwd: folder,
        lazurioFolder: folder,
        autoBootstrapProjectFromCwd: false,
        lazurioBuddyFolder: buddy,
      },
    );
    // Missing (not made yet, or removed): Chat still starts and the path stays, so an earlier
    // Buddy project stays unlisted. A sibling whose name starts with two dots is still beside.
    // A link whose target was removed still names the target, the root its project was made with.
    const target = NodePath.join(NodePath.dirname(folder), "Buddy-target");
    const dangling = NodePath.join(NodePath.dirname(folder), "Buddy-link");
    NodeFS.symlinkSync(target, dangling);
    assert.strictEqual(
      (yield* resolveManagedFolderConfig.pipe(
        withEnv({ T3CODE_LAZURIO_FOLDER: folder, T3CODE_LAZURIO_BUDDY_FOLDER: dangling }),
      )).lazurioBuddyFolder,
      target,
    );
    const dotsSibling = NodePath.join(NodePath.dirname(folder), "..Buddy");
    NodeFS.mkdirSync(dotsSibling);
    for (const declared of [`${buddy}-missing`, dotsSibling]) {
      assert.deepStrictEqual(
        yield* resolveManagedFolderConfig.pipe(
          withEnv({ T3CODE_LAZURIO_FOLDER: folder, T3CODE_LAZURIO_BUDDY_FOLDER: declared }),
        ),
        {
          cwd: folder,
          lazurioFolder: folder,
          autoBootstrapProjectFromCwd: false,
          lazurioBuddyFolder: declared,
        },
      );
    }
  }),
);

it.effect("refuses a relative path, a file, an insecure or credentialed tools URL", () =>
  Effect.gen(function* () {
    const { parent, folder, buddy } = makeFolder();
    const file = NodePath.join(parent, "not-a-folder");
    NodeFS.writeFileSync(file, "");
    const insideFolder = NodePath.join(folder, ".agents", "buddy");
    NodeFS.mkdirSync(insideFolder, { recursive: true });
    const dotsInsideFolder = NodePath.join(folder, "..buddy");
    NodeFS.mkdirSync(dotsInsideFolder);
    NodeFS.mkdirSync(NodePath.join(folder, "..x"));
    const beside = "T3CODE_LAZURIO_BUDDY_FOLDER must be beside the Lazurio Folder";
    for (const [env, expected] of [
      [{ T3CODE_LAZURIO_FOLDER: "Lazurio" }, "T3CODE_LAZURIO_FOLDER must be an absolute"],
      [{ T3CODE_LAZURIO_FOLDER: file }, "T3CODE_LAZURIO_FOLDER must be a directory"],
      [
        { T3CODE_LAZURIO_BUDDY_FOLDER: buddy },
        "T3CODE_LAZURIO_BUDDY_FOLDER needs T3CODE_LAZURIO_FOLDER",
      ],
      [
        { T3CODE_LAZURIO_FOLDER: folder, T3CODE_LAZURIO_BUDDY_FOLDER: "Buddy" },
        "T3CODE_LAZURIO_BUDDY_FOLDER must be an absolute",
      ],
      [{ T3CODE_LAZURIO_FOLDER: folder, T3CODE_LAZURIO_BUDDY_FOLDER: folder }, beside],
      [{ T3CODE_LAZURIO_FOLDER: folder, T3CODE_LAZURIO_BUDDY_FOLDER: insideFolder }, beside],
      [{ T3CODE_LAZURIO_FOLDER: folder, T3CODE_LAZURIO_BUDDY_FOLDER: dotsInsideFolder }, beside],
      [{ T3CODE_LAZURIO_FOLDER: `${folder}/..x`, T3CODE_LAZURIO_BUDDY_FOLDER: folder }, beside],
      [{ T3CODE_LAZURIO_FOLDER: folder, T3CODE_LAZURIO_BUDDY_FOLDER: parent }, beside],
      [
        { T3CODE_LAZURIO_FOLDER: folder, T3CODE_LAZURIO_TOOLS_URL: "http://launchpad.test/" },
        "T3CODE_LAZURIO_TOOLS_URL must be an HTTPS URL",
      ],
      [
        { T3CODE_LAZURIO_TOOLS_URL: "https://user:secret@launchpad.test/" },
        "T3CODE_LAZURIO_TOOLS_URL must be an HTTPS URL",
      ],
    ] as const) {
      const error = yield* resolveManagedFolderConfig.pipe(withEnv(env), Effect.flip);
      assert.include(String(error), expected);
    }
  }),
);

it.effect("reaches the resolved server config: the Folder replaces cwd and its bootstrap", () =>
  Effect.gen(function* () {
    const { folder, parent } = makeFolder();
    const flags = {
      mode: Option.some("web" as const),
      port: Option.some(3773),
      host: Option.none<string>(),
      baseDir: Option.some(NodePath.join(parent, "t3-home")),
      cwd: Option.some(parent),
      devUrl: Option.none<URL>(),
      noBrowser: Option.none<boolean>(),
      bootstrapFd: Option.none<number>(),
      autoBootstrapProjectFromCwd: Option.some(true),
      logWebSocketEvents: Option.none<boolean>(),
      tailscaleServeEnabled: Option.none<boolean>(),
      tailscaleServePort: Option.none<number>(),
      lan: Option.none<boolean>(),
    };
    const upstream = yield* resolveServerConfig(flags, Option.none()).pipe(withEnv({}));
    assert.strictEqual(upstream.cwd, parent);
    assert.isTrue(upstream.autoBootstrapProjectFromCwd);
    assert.isUndefined(upstream.lazurioFolder);
    assert.isUndefined(upstream.lazurioToolsUrl);

    const managed = yield* resolveServerConfig(flags, Option.none()).pipe(
      withEnv({ T3CODE_LAZURIO_FOLDER: folder }),
    );
    assert.strictEqual(managed.cwd, folder);
    assert.strictEqual(managed.lazurioFolder, folder);
    assert.isFalse(managed.autoBootstrapProjectFromCwd);
  }),
);
