// @effect-diagnostics nodeBuiltinImport:off - the service under the route keeps real files in a temporary runtime directory.
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthSessionId,
  ThreadId,
  WS_METHODS,
  type AuthEnvironmentScope,
  type AuthGrantScope,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerResponse } from "effect/http";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { layerHttpCompression } from "../http.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import { requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as SessionStore from "../auth/SessionStore.ts";
import * as EnvironmentBrowser from "./environmentBrowser.ts";
import { ThreadLifecycle } from "./threadLifecycle.ts";
import * as ThreadTabs from "./threadTabs.ts";
import * as ThreadTabsRoute from "./threadTabsRoute.ts";

const appOrigin = "https://t3code.vm-01.example.lazurio.io";
/** What a browser sends with a POST from the app's own page. */
const sameOrigin = { origin: appOrigin, "sec-fetch-site": "same-origin" };
const viewOrigin = "https://browser.vm-01.example.lazurio.io";
const threadA = ThreadId.make("4a1f9c2e-7b3d-4e5f-8a6b-9c0d1e2f3a4b");
const archived = ThreadId.make("9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d");
const tab = "0123456789ABCDEF0123456789ABCDEF";
const route = (path = "") => `${appOrigin}${ThreadTabsRoute.THREAD_TABS_ROUTE}${path}`;
const requestMetadata = {
  deviceType: "desktop" as const,
  os: "macOS",
  browser: "Chrome",
  ipAddress: "192.168.1.23",
};

const authLayer = EnvironmentAuth.layer.pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerEnvironment.layerIdentity),
  Layer.provide(
    Layer.effect(
      ServerConfig.ServerConfig,
      Effect.map(ServerConfig.ServerConfig, (config) => ({ ...config, mode: "web" as const })),
    ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-thread-tabs-" }))),
  ),
);

/** Only the live thread lives; the other was archived. */
const lifecycleLayer = Layer.succeed(
  ThreadLifecycle,
  ThreadLifecycle.of({
    ready: Effect.void,
    events: Stream.never,
    liveThread: (threadId) =>
      Effect.succeed(
        threadId === threadA ? Option.some({ id: threadA, title: "Web" }) : Option.none(),
      ),
    liveThreads: Effect.succeed([{ id: threadA, title: "Web" }]),
  }),
);

/** The real service on a runtime directory of its own, declared as the host would. */
const threadTabsLayer = (runtimeDirectory: string | undefined) =>
  Layer.effectDiscard(
    Effect.flatMap(ThreadTabs.ThreadTabs, (tabs) => tabs.declare(viewOrigin)),
  ).pipe(
    Layer.provideMerge(ThreadTabs.layer),
    Layer.provide(lifecycleLayer),
    Layer.provide(
      Layer.succeed(
        HostProcess.Environment,
        runtimeDirectory === undefined ? {} : { XDG_RUNTIME_DIR: runtimeDirectory },
      ),
    ),
    Layer.provide(
      Layer.succeed(ThreadTabs.ThreadTabsSeams, {
        epoch: "epoch-1",
        bootClock: async () => ({ boot: "6f2c1d0e-1a2b-4c3d-8e4f-5a6b7c8d9e0f", at: 100 }),
        watch: () => ({ retry: () => undefined, stop: () => undefined }),
      }),
    ),
  );

/** A response that is compressed when nothing opts out, to prove the middleware is on. */
const controlRoute = HttpRouter.add("GET", "/control", HttpServerResponse.text("x".repeat(8192)));

const handlerOf = (
  serverAuth: EnvironmentAuth.EnvironmentAuth["Service"],
  threadTabs: Layer.Layer<ThreadTabs.ThreadTabs>,
  pages: EnvironmentBrowser.EnvironmentBrowserPages["Service"] = {
    open: () => Effect.die("unused"),
  },
) =>
  HttpRouter.toWebHandler(
    Layer.mergeAll(ThreadTabsRoute.layer, controlRoute).pipe(
      Layer.provide(layerHttpCompression),
      Layer.provide(Layer.succeed(EnvironmentBrowser.EnvironmentBrowserPages, pages)),
      Layer.provideMerge(threadTabs),
      Layer.provideMerge(Layer.succeed(EnvironmentAuth.EnvironmentAuth, serverAuth)),
      Layer.provideMerge(NodeHttpPlatform.layer),
      Layer.provideMerge(NodeServices.layer),
    ),
    { disableLogger: true },
  );

const withRuntime = <A, E, R>(use: (runtime: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "thread-tabs-route-"))),
    use,
    (runtime) => Effect.promise(() => NodeFSP.rm(runtime, { recursive: true, force: true })),
  );

/** A browser session cookie of the real EnvironmentAuth, with these scopes or the standard ones. */
const sessionCookie = (scopes?: ReadonlyArray<AuthGrantScope>) =>
  Effect.gen(function* () {
    const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const sessions = yield* SessionStore.SessionStore;
    const pairing = yield* serverAuth.issuePairingCredential(
      scopes === undefined ? undefined : { scopes },
    );
    const exchanged = yield* serverAuth.createBrowserSession(pairing.credential, requestMetadata);
    return `${sessions.cookieName}=${exchanged.sessionToken}`;
  });

const post = (path: string, body: unknown, headers: Record<string, string>) =>
  new Request(route(path), {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/** Reads server-sent events off a response body, one at a time; comments are skipped. */
const eventReader = (response: Response) => {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    next: async (): Promise<{ readonly event: string; readonly data: unknown }> => {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (frame.startsWith(":")) continue;
          const event = /^event: (.*)$/m.exec(frame)?.[1] ?? "message";
          const data = /^data: (.*)$/m.exec(frame)?.[1] ?? "null";
          return { event, data: JSON.parse(data) };
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("the stream ended");
        buffer += decoder.decode(value, { stream: true });
      }
    },
    cancel: () => reader.cancel(),
  };
};

// The real clock: the handler's own runtime verifies the sessions minted here by the real one.
it.layer(authLayer.pipe(Layer.provide(NodeServices.layer)), { excludeTestServices: true })(
  "the thread tabs route",
  (it) => {
    it.effect(
      "answers the snapshot, 404 for an unknown or archived thread, and unavailable while off",
      () =>
        withRuntime((runtime) =>
          Effect.gen(function* () {
            const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
            const cookie = yield* sessionCookie();
            const on = handlerOf(serverAuth, threadTabsLayer(runtime));
            const off = handlerOf(serverAuth, threadTabsLayer(undefined));
            yield* Effect.addFinalizer(() =>
              Effect.promise(() => Promise.all([on.dispose(), off.dispose()])),
            );
            yield* Effect.tryPromise(async () => {
              const empty = await on.handler(
                new Request(route(`?threadId=${threadA}`), { headers: { cookie } }),
              );
              expect(empty.status).toBe(200);
              expect(await empty.json()).toEqual({
                available: true,
                epoch: "epoch-1",
                revision: expect.any(Number),
                threadId: threadA,
                strip: `t3-${threadA}`,
                viewOrigin,
                tabs: [],
              });
              const held = await on.handler(
                post(
                  "/hold",
                  { threadId: threadA, tabId: tab.toLowerCase() },
                  { cookie, ...sameOrigin },
                ),
              );
              expect(held.status).toBe(200);
              expect(((await held.json()) as ThreadTabs.ThreadTabsSnapshot).tabs).toEqual([
                { tabId: tab, agent: false, alsoHeldBy: [] },
              ]);
              for (const threadId of [archived, "5c4b3a29-1807-4f6e-9d5c-4b3a2918f7e6"]) {
                const missing = await on.handler(
                  new Request(route(`?threadId=${threadId}`), { headers: { cookie } }),
                );
                expect(missing.status).toBe(404);
                expect(await missing.json()).toEqual({ error: "thread-not-found" });
              }
              const released = await on.handler(
                post("/release", { threadId: threadA, tabId: tab }, { cookie, ...sameOrigin }),
              );
              expect(((await released.json()) as ThreadTabs.ThreadTabsSnapshot).tabs).toEqual([]);
              // No runtime directory: the service is off and says so.
              const unavailable = await off.handler(
                new Request(route(`?threadId=${threadA}`), { headers: { cookie } }),
              );
              expect(await unavailable.json()).toEqual({ available: false });
              const refused = await off.handler(
                post("/hold", { threadId: threadA, tabId: tab }, { cookie, ...sameOrigin }),
              );
              expect(refused.status).toBe(503);
              expect(await refused.json()).toEqual({ error: "unavailable" });
            });
          }),
        ).pipe(Effect.scoped),
    );

    it.effect("authenticates as T3 Code's routes do, with upstream's preview scopes", () =>
      withRuntime((runtime) =>
        Effect.gen(function* () {
          expect(ThreadTabsRoute.threadTabsScopes).toEqual({
            read: requiredScopeForRpcMethod(WS_METHODS.previewList),
            hold: requiredScopeForRpcMethod(WS_METHODS.previewOpen),
            release: requiredScopeForRpcMethod(WS_METHODS.previewClose),
          });
          expect(ThreadTabsRoute.threadTabsScopes).toEqual({
            read: "orchestration:read",
            hold: "preview:operate",
            release: "preview:operate",
          });
          const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
          const cookie = yield* sessionCookie();
          const readOnly = yield* sessionCookie(["orchestration:read"]);
          // What a browser paired before preview:operate existed holds: it reads, but needs to
          // pair again to hold or let go of a tab.
          const pairedEarlier = yield* sessionCookie([
            "orchestration:read",
            "orchestration:operate",
          ]);
          const { handler, dispose } = handlerOf(serverAuth, threadTabsLayer(runtime));
          yield* Effect.addFinalizer(() => Effect.promise(() => dispose()));
          yield* Effect.tryPromise(async () => {
            // A same-origin GET and EventSource send no Origin: they pass.
            const read = await handler(
              new Request(route(`?threadId=${threadA}`), { headers: { cookie } }),
            );
            expect(read.status).toBe(200);
            const events = await handler(
              new Request(route(`/events?threadId=${threadA}`), { headers: { cookie } }),
            );
            expect(events.status).toBe(200);
            expect(events.headers.get("content-type")).toContain("text/event-stream");
            await events.body?.cancel();
            // A cookie-authenticated POST from another origin is refused (upstream's Origin
            // rule); one from the app's own page passes, as one without an Origin does.
            const body = { threadId: threadA, tabId: tab };
            const sibling = "https://sibling.vm-01.example.lazurio.io";
            expect((await handler(post("/hold", body, { cookie, origin: sibling }))).status).toBe(
              401,
            );
            expect((await handler(post("/hold", body, { cookie, ...sameOrigin }))).status).toBe(
              200,
            );
            expect((await handler(post("/release", body, { cookie }))).status).toBe(200);
            // No credential at all.
            expect((await handler(new Request(route(`?threadId=${threadA}`)))).status).toBe(401);
            // Reading is not holding.
            expect(
              (
                await handler(
                  new Request(route(`?threadId=${threadA}`), { headers: { cookie: readOnly } }),
                )
              ).status,
            ).toBe(200);
            expect(
              (await handler(post("/release", body, { cookie: readOnly, ...sameOrigin }))).status,
            ).toBe(403);
            expect(
              (
                await handler(
                  new Request(route(`?threadId=${threadA}`), {
                    headers: { cookie: pairedEarlier },
                  }),
                )
              ).status,
            ).toBe(200);
            expect(
              (await handler(post("/hold", body, { cookie: pairedEarlier, ...sameOrigin }))).status,
            ).toBe(403);
          });
        }),
      ).pipe(Effect.scoped),
    );

    it.effect("streams the snapshot at once and on every change, never compressed", () =>
      withRuntime((runtime) =>
        Effect.gen(function* () {
          const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
          const cookie = yield* sessionCookie();
          const { handler, dispose } = handlerOf(serverAuth, threadTabsLayer(runtime));
          yield* Effect.addFinalizer(() => Effect.promise(() => dispose()));
          yield* Effect.tryPromise(async () => {
            const control = await handler(
              new Request(`${appOrigin}/control`, { headers: { "accept-encoding": "gzip" } }),
            );
            expect(control.headers.get("content-encoding")).toBe("gzip");
            await control.body?.cancel();
            const response = await handler(
              new Request(route(`/events?threadId=${threadA}`), {
                headers: { cookie, "accept-encoding": "gzip, br" },
              }),
            );
            expect(response.status).toBe(200);
            expect(response.headers.get("content-encoding")).toBeNull();
            expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
            expect(response.headers.get("x-accel-buffering")).toBe("no");
            const events = eventReader(response);
            expect(await events.next()).toMatchObject({
              event: "snapshot",
              data: { available: true, threadId: threadA, tabs: [] },
            });
            await handler(
              post("/hold", { threadId: threadA, tabId: tab }, { cookie, ...sameOrigin }),
            );
            expect(await events.next()).toMatchObject({
              event: "snapshot",
              data: { viewOrigin, tabs: [{ tabId: tab }] },
            });
            await events.cancel();
            // An unknown thread is a 404, on which an EventSource stops.
            const unknown = await handler(
              new Request(route(`/events?threadId=${archived}`), { headers: { cookie } }),
            );
            expect(unknown.status).toBe(404);
          });
        }),
      ).pipe(Effect.scoped),
    );
  },
);

/** A service that answers what each test needs, to read the route's own mapping. */
const fakeService = (overrides: Partial<ThreadTabs.ThreadTabs["Service"]>) =>
  Layer.succeed(
    ThreadTabs.ThreadTabs,
    ThreadTabs.ThreadTabs.of({
      read: () =>
        Effect.succeed({
          available: true,
          epoch: "e",
          revision: 1,
          threadId: threadA,
          strip: `t3-${threadA}`,
          viewOrigin,
          tabs: [],
        }),
      hold: () => Effect.die("unused"),
      release: () => Effect.die("unused"),
      events: () => Stream.never,
      declare: () => Effect.void,
      record: () => Effect.void,
      foreign: () => Effect.void,
      ...overrides,
    }),
  );

const bearerAuth = (scopes: ReadonlyArray<AuthEnvironmentScope>) =>
  ({
    authenticateHttpRequest: () =>
      Effect.succeed({
        sessionId: AuthSessionId.make("test"),
        subject: "test",
        method: "bearer-access-token",
        scopes,
      }),
  }) as unknown as EnvironmentAuth.EnvironmentAuth["Service"];

it.effect("validates bodies and maps each refusal to its status", () =>
  Effect.gen(function* () {
    const reasons: Array<ThreadTabs.ThreadTabsErrorReason> = [];
    const { handler, dispose } = handlerOf(
      bearerAuth(["orchestration:read", "preview:operate"]),
      fakeService({
        hold: () => Effect.fail(new ThreadTabs.ThreadTabsError({ reason: reasons.shift()! })),
      }),
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => dispose()));
    yield* Effect.tryPromise(async () => {
      const headers = { authorization: "Bearer token" };
      for (const body of [
        { threadId: threadA, tabId: "nope" },
        { threadId: threadA },
        { tabId: tab },
        { threadId: "", tabId: tab },
        "not json",
      ]) {
        const response = await handler(post("/hold", body, headers));
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "invalid-request" });
      }
      expect((await handler(new Request(route(), { headers }))).status).toBe(400);
      for (const [reason, status] of [
        ["too-many-tabs", 409],
        ["thread-not-found", 404],
        ["holder-unreadable", 503],
        ["hold-failed", 503],
        ["unavailable", 503],
      ] as const) {
        reasons.push(reason);
        const response = await handler(post("/hold", { threadId: threadA, tabId: tab }, headers));
        expect([response.status, await response.json()]).toEqual([status, { error: reason }]);
      }
    });
  }).pipe(Effect.scoped),
);

it.effect(
  "opens a person's page for the thread with the hold scope, and answers with its tab",
  () =>
    Effect.gen(function* () {
      const opened: Array<{ readonly threadId: string; readonly url: string }> = [];
      const answers: Array<Effect.Effect<string, ThreadTabs.ThreadTabsError>> = [
        Effect.succeed(tab),
        Effect.fail(new ThreadTabs.ThreadTabsError({ reason: "unavailable" })),
      ];
      const { handler, dispose } = handlerOf(
        bearerAuth(["orchestration:read", "preview:operate"]),
        fakeService({}),
        {
          open: (threadId, url) => {
            opened.push({ threadId, url });
            return answers.shift()!;
          },
        },
      );
      const { handler: readOnly, dispose: disposeReadOnly } = handlerOf(
        bearerAuth(["orchestration:read"]),
        fakeService({}),
      );
      yield* Effect.addFinalizer(() => Effect.promise(() => dispose()));
      yield* Effect.addFinalizer(() => Effect.promise(() => disposeReadOnly()));
      yield* Effect.tryPromise(async () => {
        const headers = { authorization: "Bearer token" };
        const page = { threadId: threadA, url: "http://localhost:5173" };
        const response = await handler(post("/open", page, headers));
        expect([response.status, await response.json()]).toEqual([200, { tabId: tab }]);
        const refused = await handler(post("/open", page, headers));
        expect([refused.status, await refused.json()]).toEqual([503, { error: "unavailable" }]);
        for (const body of [{ threadId: threadA }, { url: page.url }, "not json"]) {
          expect((await handler(post("/open", body, headers))).status).toBe(400);
        }
        expect((await readOnly(post("/open", page, headers))).status).toBe(403);
        expect(opened).toEqual([page, page]);
      });
    }).pipe(Effect.scoped),
);

it.effect(
  "sends another Environment's tab as a foreign event and ends the stream with the client",
  () =>
    Effect.gen(function* () {
      let ended = () => {};
      const streamEnded = new Promise<void>((resolve) => {
        ended = resolve;
      });
      const foreignView = `https://browser.vm-02.acme.lazurio.io/t/${tab}`;
      const { handler, dispose } = handlerOf(
        bearerAuth(["orchestration:read"]),
        fakeService({
          events: () =>
            Stream.concat(
              Stream.fromIterable<ThreadTabs.ThreadTabsEvent>([
                { type: "snapshot", answer: { available: false } },
                {
                  type: "foreign",
                  tab: { tabId: tab, view: foreignView, revealRequest: { id: "e:1" } },
                },
              ]),
              Stream.never,
            ).pipe(Stream.ensuring(Effect.sync(() => ended()))),
        }),
      );
      yield* Effect.addFinalizer(() => Effect.promise(() => dispose()));
      yield* Effect.tryPromise(async () => {
        const response = await handler(
          new Request(route(`/events?threadId=${threadA}`), {
            headers: { authorization: "Bearer token" },
          }),
        );
        const events = eventReader(response);
        expect(await events.next()).toEqual({ event: "snapshot", data: { available: false } });
        expect(await events.next()).toEqual({
          event: "foreign",
          data: { tabId: tab, view: foreignView, revealRequest: { id: "e:1" } },
        });
        await events.cancel();
        await streamEnded;
      });
    }).pipe(Effect.scoped),
);
