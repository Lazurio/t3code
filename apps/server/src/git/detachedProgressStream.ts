import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

// Effect RPC interrupts every fiber of a client whose socket closes, so work that ran in the
// stream's fiber stopped halfway: a commit without its push, a push without its pull request.
// The work runs detached instead. Progress offered after the stream ends is dropped; the work
// still finishes, and its result reaches the client through state it already resyncs.
export const detachedProgressStream = <A, E, R>(
  run: (offer: (event: A) => Effect.Effect<void>) => Effect.Effect<unknown, E, R>,
): Stream.Stream<A, E, R> =>
  Stream.callback<A, E, R>((queue) =>
    run((event) => Queue.offer(queue, event).pipe(Effect.ignore)).pipe(
      Effect.matchCauseEffect({
        onFailure: (cause) => Queue.failCause(queue, cause),
        onSuccess: () => Queue.end(queue),
      }),
      Effect.ignore,
      Effect.forkDetach,
    ),
  );
