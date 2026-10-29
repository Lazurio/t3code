import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import { detachedProgressStream } from "./detachedProgressStream.ts";

describe("detachedProgressStream", () => {
  it.effect("finishes the work after the client's stream is interrupted", () =>
    Effect.gen(function* () {
      const pushing = yield* Deferred.make<void>();
      const releasePush = yield* Deferred.make<void>();
      const outcome = yield* Deferred.make<"pull request created" | "interrupted">();

      const consumed = yield* detachedProgressStream<string, never, never>((offer) =>
        offer("committed").pipe(
          Effect.andThen(Deferred.succeed(pushing, undefined)),
          Effect.andThen(Deferred.await(releasePush)),
          Effect.andThen(offer("pushed")),
          Effect.andThen(Deferred.succeed(outcome, "pull request created")),
          Effect.onInterrupt(() => Deferred.succeed(outcome, "interrupted")),
        ),
      ).pipe(Stream.runDrain, Effect.forkChild);

      yield* Deferred.await(pushing);
      // The socket closes: Effect RPC interrupts the client's request fiber.
      yield* Fiber.interrupt(consumed);
      yield* Deferred.succeed(releasePush, undefined);

      expect(yield* Deferred.await(outcome)).toBe("pull request created");
    }),
  );

  it.effect("streams progress and ends when the work succeeds", () =>
    Effect.gen(function* () {
      const events = yield* detachedProgressStream<string, never, never>((offer) =>
        offer("committed").pipe(Effect.andThen(offer("pushed"))),
      ).pipe(Stream.runCollect);

      expect(events).toEqual(["committed", "pushed"]);
    }),
  );

  it.effect("fails the stream with the work's own error", () =>
    Effect.gen(function* () {
      const error = yield* detachedProgressStream<string, string, never>((offer) =>
        offer("committed").pipe(Effect.andThen(Effect.fail("push rejected"))),
      ).pipe(Stream.runDrain, Effect.flip);

      expect(error).toBe("push rejected");
    }),
  );
});
