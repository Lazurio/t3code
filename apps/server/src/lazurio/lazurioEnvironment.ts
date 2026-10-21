/**
 * Lazurio overlay (root decision 0191, plan DEV-6646): whether this server runs on a Lazurio
 * Environment. Machines mark one with `T3CODE_LAZURIO_FOLDER`, the Environment's Lazurio Folder
 * (LazurioPlatform F51). There, the Environment browser is the only browser of web T3: upstream's
 * server browser is neither built nor advertised (serverBrowser.ts, ServerEnvironment.ts), and
 * T3's browser tools drive the Environment browser, once it declares itself
 * (environmentBrowser.ts). Every one of them asks this predicate, so the two hosts never run at
 * once.
 */

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

export const LAZURIO_FOLDER_ENV = "T3CODE_LAZURIO_FOLDER";

/** `T3CODE_LAZURIO_FOLDER` is set and not empty. */
export const isLazurioEnvironment = Effect.gen(function* () {
  const environment = yield* HostProcess.Environment;
  return (environment[LAZURIO_FOLDER_ENV] ?? "") !== "";
});
