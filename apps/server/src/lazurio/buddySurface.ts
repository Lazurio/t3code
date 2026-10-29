/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): Buddy's own T3 Code, a second T3 server on
 * the Osobní Prostředí that holds Buddy's one conversation with Hermes over ACP. Everything Buddy's
 * keys off `T3CODE_LAZURIO_BUDDY=1` and the provider instance `buddy`; without the switch the
 * server behaves as upstream, also with an instance called `buddy`.
 */
import { ProviderInstanceId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";

const LAZURIO_BUDDY_ENV = "T3CODE_LAZURIO_BUDDY";

/** The provider instance that runs Buddy's Hermes in Buddy's T3 Code. */
export const BUDDY_PROVIDER_INSTANCE_ID = ProviderInstanceId.make("buddy");

/** `T3CODE_LAZURIO_BUDDY` is exactly `1`. */
export const isBuddySurfaceEnvironment = (environment: NodeJS.ProcessEnv): boolean =>
  environment[LAZURIO_BUDDY_ENV] === "1";

/** Whether this server is Buddy's T3 Code. */
const isBuddySurface = Effect.gen(function* () {
  return isBuddySurfaceEnvironment(yield* HostProcess.Environment);
});

/** Whether this instance is Buddy's: the instance `buddy` of a server that is Buddy's. */
export const isBuddyInstance = (environment: NodeJS.ProcessEnv, instanceId: string): boolean =>
  isBuddySurfaceEnvironment(environment) && instanceId === BUDDY_PROVIDER_INSTANCE_ID;

/** Buddy's T3 Code in the config the server gives its clients (`server.getConfig`). */
export const buddySurfaceClientConfig = Effect.map(isBuddySurface, (buddy) =>
  buddy ? { lazurioBuddy: true as const } : {},
);

/**
 * Buddy's project folder, Buddy's layer of the Lazurio Folder. Machines declare it as the managed
 * Folder of Buddy's T3 Code (`T3CODE_LAZURIO_FOLDER`), whose startup adopts or creates its project
 * (managedFolderStartup.ts); without that, `~/Lazurio/.agents/buddy` of the person the server runs
 * as. Null when neither is known.
 */
export const buddyProjectFolder = Effect.gen(function* () {
  const { lazurioFolder } = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  // Upstream's tests mock the config, and a mock answers a field it lacks with a function.
  if (typeof lazurioFolder === "string") return path.resolve(lazurioFolder);
  const home = (yield* HostProcess.Environment).HOME;
  return home === undefined || home === ""
    ? null
    : path.resolve(home, "Lazurio", ".agents", "buddy");
});
