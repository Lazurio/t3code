/**
 * Lazurio overlay (root decision 0210, plan LZD-0033): Buddy's window opens in a frame on the
 * Environment's own pages, which the gateway's `frame-ancestors` on Buddy's origin names. Upstream's
 * refusal beside it would narrow that to none, so Buddy's answers leave framing to the gateway.
 */
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

import { isBuddySurfaceEnvironment } from "./buddySurface.ts";

/**
 * Whether the gateway alone decides who may frame the page answering `url`: every page of Buddy's
 * own server (GEN3), which only Buddy's origin reaches, and on the shared server the pages for
 * Buddy's origin (`T3CODE_LAZURIO_BUDDY_ORIGIN`). Chat's origin keeps upstream's refusal.
 */
export const framedByGateway = Effect.fn("BuddyFraming.framedByGateway")(function* (
  lazurioBuddyOrigin: string | undefined,
  url: URL,
) {
  return (
    isBuddySurfaceEnvironment(yield* HostProcess.Environment) ||
    (lazurioBuddyOrigin !== undefined && url.host === new URL(lazurioBuddyOrigin).host)
  );
});
