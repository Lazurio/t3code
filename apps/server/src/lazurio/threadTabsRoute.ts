/**
 * Lazurio overlay (plan DEV-6646, task 501): the web's way to a thread's tabs (threadTabs.ts),
 * under a prefix upstream does not use, so `packages/contracts` stays upstream's.
 *
 * - `GET  /api/lazurio/thread-tabs?threadId=<id>`: the snapshot, or `{"available": false}`.
 * - `GET  /api/lazurio/thread-tabs/events?threadId=<id>`: `text/event-stream` of `snapshot`
 *   events (the same JSON) at once and on every change, `foreign` events, and a comment every
 *   25 s. Every event is a whole snapshot, so a reconnect replays nothing.
 * - `POST /api/lazurio/thread-tabs/hold` and `/release`, `{threadId, tabId}`: the snapshot after.
 *
 * Errors are `{"error": <reason>}`: 400 invalid-request, 404 thread-not-found, 409 too-many-tabs,
 * 503 unavailable | holder-unreadable | hold-failed. Requests authenticate as any of T3 Code's
 * HTTP routes do (a session cookie, or a bearer or DPoP token; routeAuth.ts); a cookie-authenticated
 * request from a foreign origin is refused by upstream's Origin rule (EnvironmentAuth), while a
 * same-origin EventSource, which sends no Origin, passes. The scopes are upstream's for listing,
 * opening and closing a preview (`requiredScopeForRpcMethod`), so they follow upstream: hold and
 * release need `preview:operate`. The stream is never compressed or buffered on the way:
 * `cache-control: no-transform` keeps the compression middleware off it.
 */

import { ThreadId, WS_METHODS } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import { authenticateOverlayRoute as authenticate } from "./routeAuth.ts";
import * as ThreadTabs from "./threadTabs.ts";

export const THREAD_TABS_ROUTE = "/api/lazurio/thread-tabs";
const HEARTBEAT = Duration.seconds(25);

const STATUS: Record<ThreadTabs.ThreadTabsErrorReason, number> = {
  "invalid-request": 400,
  "thread-not-found": 404,
  "too-many-tabs": 409,
  unavailable: 503,
  "holder-unreadable": 503,
  "hold-failed": 503,
};

/** The scopes of the preview RPCs the route stands beside, read from upstream's own table. */
export const threadTabsScopes = {
  read: requiredScopeForRpcMethod(WS_METHODS.previewList),
  hold: requiredScopeForRpcMethod(WS_METHODS.previewOpen),
  release: requiredScopeForRpcMethod(WS_METHODS.previewClose),
};

const decodeThreadId = Schema.decodeUnknownOption(ThreadId);
const TabRequest = Schema.Struct({
  threadId: ThreadId,
  tabId: Schema.String.check(Schema.isPattern(/^[0-9A-Fa-f]{32}$/)),
});

const refused = (reason: ThreadTabs.ThreadTabsErrorReason) =>
  HttpServerResponse.jsonUnsafe({ error: reason }, { status: STATUS[reason] });
const answered = <A>(effect: Effect.Effect<A, ThreadTabs.ThreadTabsError>) =>
  effect.pipe(
    Effect.map((body) => HttpServerResponse.jsonUnsafe(body)),
    Effect.catchTags({ ThreadTabsError: (error) => Effect.succeed(refused(error.reason)) }),
  );

/** One server-sent event: the thread's snapshot, or another Environment's tab. */
const serverSentEvent = (event: ThreadTabs.ThreadTabsEvent) =>
  event.type === "snapshot"
    ? `event: snapshot\ndata: ${JSON.stringify(event.answer)}\n\n`
    : `event: foreign\ndata: ${JSON.stringify(event.tab)}\n\n`;

export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const threadTabs = yield* ThreadTabs.ThreadTabs;

    const threadIdOfQuery = Effect.map(HttpServerRequest.HttpServerRequest, (request) =>
      Option.flatMap(HttpServerRequest.toURL(request), (url) =>
        decodeThreadId(url.searchParams.get("threadId")),
      ),
    );

    const tabRequest = HttpServerRequest.schemaBodyJson(TabRequest).pipe(
      Effect.asSome,
      Effect.orElseSucceed(() => Option.none<typeof TabRequest.Type>()),
    );

    yield* router.add(
      "GET",
      THREAD_TABS_ROUTE,
      Effect.gen(function* () {
        yield* authenticate(threadTabsScopes.read);
        const threadId = yield* threadIdOfQuery;
        if (Option.isNone(threadId)) return refused("invalid-request");
        return yield* answered(threadTabs.read(threadId.value));
      }),
    );

    yield* router.add(
      "GET",
      `${THREAD_TABS_ROUTE}/events`,
      Effect.gen(function* () {
        yield* authenticate(threadTabsScopes.read);
        const threadId = yield* threadIdOfQuery;
        if (Option.isNone(threadId)) return refused("invalid-request");
        // An unknown or retired thread is a 404, on which an EventSource stops reconnecting.
        const first = yield* threadTabs.read(threadId.value).pipe(Effect.result);
        if (first._tag === "Failure") return refused(first.failure.reason);
        const events = threadTabs
          .events(threadId.value)
          .pipe(Stream.ignore, Stream.map(serverSentEvent));
        const heartbeat = Stream.tick(HEARTBEAT).pipe(
          Stream.drop(1),
          Stream.map(() => ": keep-alive\n\n"),
        );
        return HttpServerResponse.stream(Stream.merge(events, heartbeat).pipe(Stream.encodeText), {
          contentType: "text/event-stream",
          headers: { "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" },
        });
      }),
    );

    yield* router.add(
      "POST",
      `${THREAD_TABS_ROUTE}/hold`,
      Effect.gen(function* () {
        yield* authenticate(threadTabsScopes.hold);
        const body = yield* tabRequest;
        if (Option.isNone(body)) return refused("invalid-request");
        return yield* answered(threadTabs.hold(body.value.threadId, body.value.tabId));
      }),
    );

    yield* router.add(
      "POST",
      `${THREAD_TABS_ROUTE}/release`,
      Effect.gen(function* () {
        yield* authenticate(threadTabsScopes.release);
        const body = yield* tabRequest;
        if (Option.isNone(body)) return refused("invalid-request");
        return yield* answered(threadTabs.release(body.value.threadId, body.value.tabId));
      }),
    );
  }),
);
