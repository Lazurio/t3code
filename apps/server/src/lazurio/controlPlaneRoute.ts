/**
 * Lazurio overlay (plan LZD-0051, C1): `GET /api/lazurio/control-plane[/events]?threadId=`, the
 * thread's Control Plane as last published and each later publish, with the scope of upstream's
 * thread subscription. An unknown or retired thread is a 404, on which an EventSource stops.
 */

import { ORCHESTRATION_V2_WS_METHODS, ThreadId } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import { ControlPlane, type ControlPlaneSnapshot } from "./controlPlane.ts";
import { authenticateOverlayRoute as authenticate } from "./routeAuth.ts";
import { ThreadLifecycle } from "./threadLifecycle.ts";

const CONTROL_PLANE_ROUTE = "/api/lazurio/control-plane";
const HEARTBEAT = Duration.seconds(25);
const readScope = requiredScopeForRpcMethod(ORCHESTRATION_V2_WS_METHODS.subscribeThread);
const decodeThreadId = Schema.decodeUnknownOption(ThreadId);

const refused = (error: "invalid-request" | "thread-not-found" | "none", status: number) =>
  HttpServerResponse.jsonUnsafe({ error }, { status });

/** One server-sent event: the page as published now. */
const controlPlaneEvent = (snapshot: ControlPlaneSnapshot) =>
  `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;

export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const controlPlane = yield* ControlPlane;
    const lifecycle = yield* ThreadLifecycle;

    const liveThreadOfQuery = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const threadId = Option.flatMap(HttpServerRequest.toURL(request), (url) =>
        decodeThreadId(url.searchParams.get("threadId")),
      );
      if (Option.isNone(threadId)) return { refusal: refused("invalid-request", 400) } as const;
      const live = yield* lifecycle
        .liveThread(threadId.value)
        .pipe(Effect.orElseSucceed(Option.none));
      return Option.isNone(live)
        ? ({ refusal: refused("thread-not-found", 404) } as const)
        : ({ threadId: threadId.value } as const);
    });

    yield* router.add(
      "GET",
      CONTROL_PLANE_ROUTE,
      Effect.gen(function* () {
        yield* authenticate(readScope);
        const thread = yield* liveThreadOfQuery;
        if ("refusal" in thread) return thread.refusal;
        const snapshot = yield* controlPlane.read(thread.threadId);
        return snapshot === null ? refused("none", 404) : HttpServerResponse.jsonUnsafe(snapshot);
      }),
    );

    yield* router.add(
      "GET",
      `${CONTROL_PLANE_ROUTE}/events`,
      Effect.gen(function* () {
        yield* authenticate(readScope);
        const thread = yield* liveThreadOfQuery;
        if ("refusal" in thread) return thread.refusal;
        const events = controlPlane.follow(thread.threadId).pipe(Stream.map(controlPlaneEvent));
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
  }),
);
