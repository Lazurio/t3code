/**
 * Lazurio overlay (root decision 0191): Machines mark a Lazurio Environment with
 * `T3CODE_LAZURIO_FOLDER` (LazurioPlatform F51). Every switch between upstream's server browser and
 * the Environment browser asks this one predicate, so the two hosts never run at once.
 */

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

export const LAZURIO_FOLDER_ENV = "T3CODE_LAZURIO_FOLDER";

/** `T3CODE_LAZURIO_FOLDER` is set and not empty. */
export const isLazurioEnvironment = Effect.gen(function* () {
  const environment = yield* HostProcess.Environment;
  return (environment[LAZURIO_FOLDER_ENV] ?? "") !== "";
});
