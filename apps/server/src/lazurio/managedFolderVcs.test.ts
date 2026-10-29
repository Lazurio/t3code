import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type * as VcsDriver from "../vcs/VcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProvisioningService from "../vcs/VcsProvisioningService.ts";
import { layerManagedConfig, makeFolderDirectories } from "./managedFolder.testkit.ts";

it.effect("never makes a managed Environment's Lazurio Folder a repository", () => {
  const { folder, inside } = makeFolderDirectories();
  const calls: string[] = [];
  // Provisioning asks the driver only to make the repository.
  const driver = {
    initRepository: (input) => Effect.sync(() => void calls.push(input.cwd)),
  } as Partial<VcsDriver.VcsDriver["Service"]> as VcsDriver.VcsDriver["Service"];

  return Effect.gen(function* () {
    const provisioning = yield* VcsProvisioningService.VcsProvisioningService;
    const refused = yield* provisioning.initRepository({ cwd: folder }).pipe(Effect.flip);
    if (refused._tag !== "VcsUnsupportedOperationError") return assert.fail(refused._tag);
    assert.strictEqual(
      refused.detail,
      "The Lazurio Folder holds separate repositories, so it cannot become a repository itself.",
    );
    yield* provisioning.initRepository({ cwd: inside });
    assert.deepStrictEqual(calls, [inside]);
  }).pipe(
    Effect.provide(
      VcsProvisioningService.layer.pipe(
        Layer.provide(
          Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({ get: () => Effect.succeed(driver) }),
        ),
        Layer.provide(layerManagedConfig(folder)),
        Layer.provide(NodeServices.layer),
      ),
    ),
  );
});
