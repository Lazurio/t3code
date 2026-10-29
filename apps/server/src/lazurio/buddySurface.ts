/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): Buddy's own T3 Code, a second T3 server on
 * the Osobní Prostředí that holds Buddy's one conversation with Hermes over ACP. Everything Buddy's
 * keys off `T3CODE_LAZURIO_BUDDY=1` and the provider instance `buddy`; without the switch the
 * server behaves as upstream, also with an instance called `buddy`.
 */
import { ProviderInstanceId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

export const LAZURIO_BUDDY_ENV = "T3CODE_LAZURIO_BUDDY";

/** The provider instance that runs Buddy's Hermes in Buddy's T3 Code. */
export const BUDDY_PROVIDER_INSTANCE_ID = ProviderInstanceId.make("buddy");

/** `T3CODE_LAZURIO_BUDDY` is exactly `1`. */
export const isBuddySurfaceEnvironment = (environment: NodeJS.ProcessEnv): boolean =>
  environment[LAZURIO_BUDDY_ENV] === "1";

/** Whether this server is Buddy's T3 Code. */
export const isBuddySurface = Effect.gen(function* () {
  return isBuddySurfaceEnvironment(yield* HostProcess.Environment);
});

/** Whether this instance is Buddy's: the instance `buddy` of a server that is Buddy's. */
export const isBuddyInstance = (environment: NodeJS.ProcessEnv, instanceId: string): boolean =>
  isBuddySurfaceEnvironment(environment) && instanceId === BUDDY_PROVIDER_INSTANCE_ID;
