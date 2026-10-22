/**
 * Lazurio overlay (root decision 0210, evening addendum, point 5; plan DEV-6676): the web's way to
 * who sent a thread's messages and decided its requests when a session acted as someone
 * (actingSenders.ts), under a prefix upstream does not use, so `packages/contracts` stays
 * upstream's.
 *
 * `GET /api/lazurio/acting-senders?threadId=<id>` answers
 * `{"at": <epoch ms>, "messages": [{"messageId", "sender"}], "requests": [{"requestId", "sender"}]}`
 * with `cache-control: no-store`. A message or decision from before `at` without an entry was
 * the person's own, or T3's. Errors are `{"error": <reason>}`: 400 invalid-request, 503
 * unavailable. It authenticates as T3 Code's other HTTP routes do (routeAuth.ts), with the scope
 * of reading a thread in upstream's own table (`requiredScopeForRpcMethod`).
 */
import { ORCHESTRATION_V2_WS_METHODS, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import * as ActingSenders from "./actingSenders.ts";
import { authenticateOverlayRoute } from "./routeAuth.ts";

export const ACTING_SENDERS_ROUTE = "/api/lazurio/acting-senders";

const decodeThreadId = Schema.decodeUnknownOption(ThreadId);
const refused = (reason: "invalid-request" | "unavailable") =>
  HttpServerResponse.jsonUnsafe(
    { error: reason },
    { status: reason === "invalid-request" ? 400 : 503 },
  );

export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const senders = yield* ActingSenders.ActingSenders;
    yield* router.add(
      "GET",
      ACTING_SENDERS_ROUTE,
      Effect.gen(function* () {
        yield* authenticateOverlayRoute(
          requiredScopeForRpcMethod(ORCHESTRATION_V2_WS_METHODS.subscribeThread),
        );
        const request = yield* HttpServerRequest.HttpServerRequest;
        const threadId = Option.flatMap(HttpServerRequest.toURL(request), (url) =>
          decodeThreadId(url.searchParams.get("threadId")),
        );
        if (Option.isNone(threadId)) return refused("invalid-request");
        const answer = yield* senders.read(threadId.value).pipe(Effect.option);
        if (Option.isNone(answer)) return refused("unavailable");
        return HttpServerResponse.jsonUnsafe(
          {
            at: answer.value.at,
            messages: answer.value.records.flatMap((record) =>
              record.kind === "message" ? [{ messageId: record.id, sender: record.sender }] : [],
            ),
            requests: answer.value.records.flatMap((record) =>
              record.kind === "request" ? [{ requestId: record.id, sender: record.sender }] : [],
            ),
          },
          { headers: { "cache-control": "no-store" } },
        );
      }),
    );
  }),
);
