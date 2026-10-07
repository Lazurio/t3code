/**
 * Lazurio overlay (root decision 0191, plan DEV-6646): T3's own browser tools (preview_open,
 * preview_snapshot, preview_click, …) drive the Environment browser, the one Chromium of a Lazurio
 * Environment. The agents of every thread already work there through agent-browser, each thread in
 * a window of its own, and people watch and co-control the same tabs in the right panel's Browser.
 * Without this host, an agent in web T3 gets "No preview automation host" or, worse, a desktop
 * app's preview on another machine.
 *
 * The host registers with the preview broker as a preferred host and advertises every operation,
 * while the Environment declares its browser (`lazurio browser link --json`), asking again every
 * minute while it is not registered. A tab is a DevTools target id of the Environment browser.
 * Per thread, the host keeps in memory the tabs it opened or adopted and the current one:
 * preview_open without a tab is the thread's own window, the one `lazurio browser window` keeps
 * bound to the thread's agent-browser session, so T3's tools and agent-browser drive the same
 * window and a restarted server finds it again. A tab id from the people's view or another agent
 * hands that tab over. Operations run one at a time per tab; a person working in the same tab at
 * the same time is expected and not locked out. Resizing and color schemes would change what the
 * person sees, and recording is not available, so those are answered with what to do instead.
 */

import {
  PREVIEW_AUTOMATION_OPERATIONS,
  PreviewTabId,
  type PreviewAutomationNavigateInput,
  type PreviewAutomationOpenInput,
  type PreviewAutomationOperation,
  type PreviewAutomationRequest,
  type PreviewAutomationStatus,
  type ThreadId,
} from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import { normalizePreviewUrl } from "@t3tools/shared/preview";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as PreviewAutomationBroker from "../mcp/PreviewAutomationBroker.ts";
import * as ProcessRunner from "../processRunner.ts";
import { agentBrowserSessionName } from "./agentBrowserSession.ts";
import {
  connectEnvironmentBrowser,
  type EnvironmentBrowserConnection,
  type EnvironmentBrowserTab,
  type TabState,
} from "./environmentBrowserConnection.ts";
import {
  resolveNavigationUrl,
  ServerBrowserOperationError,
  toOperationError,
} from "./environmentBrowserPage.ts";

export const ENVIRONMENT_BROWSER_CLIENT_ID = "lazurio-environment-browser";

/** Injectable so tests can substitute a fake browser; the default is the Environment's own. */
export const EnvironmentBrowserConnect = Context.Reference<
  () => Promise<EnvironmentBrowserConnection>
>("server/lazurio/EnvironmentBrowserConnect", {
  defaultValue: () => () => connectEnvironmentBrowser(),
});

/** How often an Environment without a declared browser is asked again. */
const DECLARATION_CHECK_INTERVAL = Duration.seconds(60);
/** Upstream's pause before a host registers again after the broker ended its stream. */
const HOST_RECONNECT_DELAY = Duration.seconds(1);
const LINK_CHECK_TIMEOUT = Duration.seconds(10);

/** `lazurio browser link --json` on an Environment that declares its browser. */
const decodeBrowserLink = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ kind: Schema.Literal("browser-link") })),
);
/** `lazurio browser window --json`: the thread's window and whether this call created it. */
const decodeBrowserWindow = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      kind: Schema.Literal("browser-window"),
      targetId: PreviewTabId,
      created: Schema.Boolean,
    }),
  ),
);

/** Operations that would change the person's view of the tab, or that this host lacks. */
const UNSUPPORTED: Partial<Record<PreviewAutomationOperation, string>> = {
  resize:
    "The Environment browser's window keeps the size of the person's view, and resizing it would change what they see. Ask the person to resize their view, or check other sizes in a separate headless browser from the shell.",
  setColorScheme:
    "The Environment browser shows the person's own color scheme, and emulating another would change what they see in the same tab. Check the other scheme in a separate headless browser from the shell.",
  recordingStart:
    "The Environment browser does not record video. Take screenshots with preview_snapshot (save=true) instead.",
  recordingStop:
    "The Environment browser does not record video. Take screenshots with preview_snapshot (save=true) instead.",
};

/**
 * The broker drops a host that leaves a request unanswered past its timeout, and every thread's
 * pending requests fail with it. So the host answers first: a slow operation is answered with a
 * timeout shortly before the broker would give up, and runs on to its end in the tab.
 */
const answerBudgetMs = (timeoutMs: number) =>
  timeoutMs - Math.min(1_000, Math.ceil(timeoutMs / 10));

const NO_TAB: PreviewAutomationStatus = {
  available: true,
  visible: false,
  tabId: null,
  url: null,
  title: null,
  loading: false,
};

/** Whether the person watches the tab is the people's view's to know, so never claimed. */
const statusOf = (targetId: string, state: TabState): PreviewAutomationStatus => ({
  available: true,
  visible: false,
  tabId: targetId,
  ...state,
});

const failure = (tag: string, message: string) => new ServerBrowserOperationError(tag, message);
const noTab = () =>
  failure(
    "PreviewAutomationTabNotFoundError",
    "This thread has no tab in the Environment browser. Call preview_open first.",
  );
const missingTab = (targetId: string) =>
  failure(
    "PreviewAutomationTabNotFoundError",
    `The Environment browser has no tab ${targetId}. Call preview_open, or pass the id of an open tab.`,
  );
const responseError = (error: ServerBrowserOperationError) => ({
  _tag: error.tag,
  message: error.message,
  ...(error.detail === undefined ? {} : { detail: error.detail }),
});

interface ThreadTabs {
  /** Tabs the thread opened or adopted, reported to the broker as its live tabs. */
  readonly tabs: Set<string>;
  current: string | undefined;
}

export const make = Effect.gen(function* () {
  const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const runner = yield* ProcessRunner.ProcessRunner;
  const path = yield* Path.Path;
  const connect = yield* EnvironmentBrowserConnect;
  const home = (yield* HostProcessEnvironment).HOME;
  const hostScope = yield* Effect.scope;
  const environmentId = yield* environment.getEnvironmentId;
  // The Platform CLI by its absolute path: the T3 service's PATH may lack ~/.local/bin.
  const lazurio =
    home === undefined || home === "" ? undefined : path.join(home, ".local", "bin", "lazurio");

  /** Whether the Environment declares its browser. A missing binary or any other answer is no. */
  const browserDeclared =
    lazurio === undefined
      ? Effect.succeed(false)
      : runner
          .run({
            command: lazurio,
            args: ["browser", "link", "--json"],
            timeout: LINK_CHECK_TIMEOUT,
          })
          .pipe(
            Effect.map(
              (output) => output.code === 0 && Option.isSome(decodeBrowserLink(output.stdout)),
            ),
            Effect.orElseSucceed(() => false),
          );

  const threads = new Map<ThreadId, ThreadTabs>();
  let hostConnectionId: string | undefined;

  /** Like upstream's server host: explicit-tab routing finds the host that has the tab. */
  const reportLiveTabs = Effect.suspend(() =>
    hostConnectionId === undefined
      ? Effect.void
      : broker.focusHost({
          clientId: ENVIRONMENT_BROWSER_CLIENT_ID,
          environmentId,
          connectionId: hostConnectionId,
          focused: false,
          liveTabs: [...threads].flatMap(([threadId, thread]) =>
            [...thread.tabs].map((tabId) => ({ threadId, tabId })),
          ),
        }),
  );
  const adopt = (threadId: ThreadId, targetId: string) =>
    Effect.suspend(() => {
      const thread = threads.get(threadId) ?? { tabs: new Set<string>(), current: undefined };
      thread.tabs.add(targetId);
      thread.current = targetId;
      threads.set(threadId, thread);
      return reportLiveTabs;
    });
  /** A tab whose page is gone leaves every thread that had it. */
  const forget = (targetId: string) =>
    Effect.suspend(() => {
      let changed = false;
      for (const thread of threads.values()) {
        changed = thread.tabs.delete(targetId) || changed;
        if (thread.current === targetId) thread.current = undefined;
      }
      return changed ? reportLiveTabs : Effect.void;
    });
  const requestTab = (request: PreviewAutomationRequest) =>
    request.tabId ?? threads.get(request.threadId)?.current;

  // One connection for the server's lifetime, made on first use and again after it ends.
  let browser: Promise<EnvironmentBrowserConnection> | undefined;
  const sharedBrowser = () => {
    if (!browser) {
      const connecting: Promise<EnvironmentBrowserConnection> = connect().then((connection) => {
        void connection.closed.then(() => {
          if (browser === connecting) browser = undefined;
        });
        return connection;
      });
      browser = connecting;
      void connecting.catch(() => {
        if (browser === connecting) browser = undefined;
      });
    }
    return browser;
  };
  const browserConnection = Effect.tryPromise({
    try: sharedBrowser,
    // Playwright's first line tells a stopped browser from a broken install.
    catch: (cause) =>
      failure(
        "PreviewAutomationExecutionError",
        `The Environment browser does not answer on its DevTools port (${toOperationError(cause).message}). Run lazurio doctor.`,
      ),
  });
  const tabOf = (targetId: string) =>
    Effect.flatMap(browserConnection, (connection) =>
      Effect.tryPromise({ try: () => connection.tab(targetId), catch: toOperationError }),
    );

  const tabLocks = new Map<string, Semaphore.Semaphore>();
  /** One operation at a time per tab, in the order they arrive. */
  const oneAtATime =
    (targetId: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.suspend(() => {
        let lock = tabLocks.get(targetId);
        if (lock === undefined) {
          lock = Semaphore.makeUnsafe(1);
          tabLocks.set(targetId, lock);
        }
        return lock.withPermits(1)(effect);
      });
  /** The time left to answer in. None means the request was answered already, as timed out. */
  const timeLeft = (answerBy: number) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      now < answerBy
        ? Effect.succeed(answerBy - now)
        : Effect.fail(
            failure(
              "PreviewAutomationTimeoutError",
              "The request's time ran out while another operation ran in the tab.",
            ),
          ),
    );
  /** Runs `run` in the tab when the tab's earlier operations are done. */
  const inTab = <A>(
    targetId: string,
    answerBy: number,
    run: (tab: EnvironmentBrowserTab, timeoutMs: number) => Promise<A>,
  ) =>
    oneAtATime(targetId)(
      Effect.gen(function* () {
        const timeoutMs = yield* timeLeft(answerBy);
        const tab = yield* tabOf(targetId);
        if (tab === undefined) {
          yield* forget(targetId);
          return yield* Effect.fail(missingTab(targetId));
        }
        return yield* Effect.tryPromise({
          try: () => run(tab, timeoutMs),
          catch: toOperationError,
        });
      }),
    );

  const status = (request: PreviewAutomationRequest) =>
    Effect.gen(function* () {
      const targetId = requestTab(request);
      if (targetId === undefined) return NO_TAB;
      const tab = yield* tabOf(targetId);
      if (tab === undefined) {
        yield* forget(targetId);
        // The thread's own tab that closed leaves it with none; a named tab must exist.
        if (request.tabIdExplicit === true) return yield* Effect.fail(missingTab(targetId));
        return NO_TAB;
      }
      return statusOf(
        targetId,
        yield* Effect.tryPromise({ try: () => tab.state(), catch: toOperationError }),
      );
    });

  /** The thread's own window: the one `lazurio browser window` binds to its agent-browser session. */
  const threadWindow = (threadId: ThreadId, url: string | undefined, answerBy: number) =>
    Effect.gen(function* () {
      if (lazurio === undefined) {
        return yield* Effect.fail(
          failure("PreviewAutomationExecutionError", "The Environment has no lazurio command."),
        );
      }
      const output = yield* runner
        .run({
          command: lazurio,
          args: [
            "browser",
            "window",
            "--session",
            agentBrowserSessionName(threadId),
            ...(url === undefined ? [] : ["--url", url]),
            "--json",
          ],
          timeout: Duration.millis(yield* timeLeft(answerBy)),
        })
        .pipe(
          Effect.mapError((error) =>
            failure(
              error._tag === "ProcessTimeoutError"
                ? "PreviewAutomationTimeoutError"
                : "PreviewAutomationExecutionError",
              `lazurio browser window did not finish: ${error.message}`,
            ),
          ),
        );
      const window = output.code === 0 ? decodeBrowserWindow(output.stdout) : Option.none();
      if (Option.isSome(window)) return window.value;
      // The CLI says what went wrong, in the Operator's language, on its first line.
      const reason = output.stderr.trim().split("\n")[0]?.slice(0, 300);
      return yield* Effect.fail(
        failure(
          "PreviewAutomationExecutionError",
          reason || `lazurio browser window failed with exit code ${output.code}.`,
        ),
      );
    });

  const newWindow = (url: string | undefined) =>
    Effect.flatMap(browserConnection, (connection) =>
      Effect.tryPromise({ try: () => connection.openWindow(url), catch: toOperationError }),
    );

  const open = (request: PreviewAutomationRequest, answerBy: number) =>
    Effect.gen(function* () {
      const input = request.input as PreviewAutomationOpenInput;
      const url =
        input.url === undefined
          ? undefined
          : yield* Effect.try({
              try: () => normalizePreviewUrl(input.url!),
              catch: toOperationError,
            });
      // A named tab is handed over; the thread's own window is the CLI's to find or create.
      const handedOver = request.tabIdExplicit === true ? request.tabId : undefined;
      const { targetId, created } =
        handedOver !== undefined
          ? { targetId: handedOver, created: false }
          : input.reuseExistingTab === false
            ? { targetId: yield* newWindow(url), created: true }
            : yield* threadWindow(request.threadId, url, answerBy);
      return yield* oneAtATime(targetId)(
        Effect.gen(function* () {
          const timeoutMs = yield* timeLeft(answerBy);
          const tab = yield* tabOf(targetId);
          if (tab === undefined) {
            yield* forget(targetId);
            return yield* Effect.fail(
              handedOver !== undefined
                ? missingTab(targetId)
                : failure(
                    "PreviewAutomationExecutionError",
                    "The Environment browser did not show the window it opened. Run lazurio doctor.",
                  ),
            );
          }
          yield* adopt(request.threadId, targetId);
          const state = yield* Effect.tryPromise({
            try: async () => {
              // A new window opened at the URL; one that was open already goes there now.
              if (url !== undefined && !created) await tab.navigate(url, "load", timeoutMs);
              else if (url !== undefined) await tab.settle(timeoutMs);
              return tab.state();
            },
            catch: toOperationError,
          });
          return statusOf(targetId, state);
        }),
      );
    });

  const runOperation = (request: PreviewAutomationRequest, answerBy: number) =>
    Effect.gen(function* () {
      const operation = request.operation;
      switch (operation) {
        case "status":
          return yield* status(request);
        case "open":
          return yield* open(request, answerBy);
        case "navigate": {
          const targetId = requestTab(request);
          if (targetId === undefined) return yield* Effect.fail(noTab());
          const input = request.input as PreviewAutomationNavigateInput;
          const url = yield* Effect.try({
            try: () => resolveNavigationUrl(input),
            catch: toOperationError,
          });
          return yield* inTab(targetId, answerBy, async (tab, timeoutMs) => {
            await tab.navigate(url, input.readiness ?? "load", timeoutMs);
            return statusOf(targetId, await tab.state());
          });
        }
        case "snapshot":
        case "click":
        case "type":
        case "press":
        case "scroll":
        case "evaluate":
        case "waitFor": {
          const targetId = requestTab(request);
          if (targetId === undefined) return yield* Effect.fail(noTab());
          return yield* inTab(targetId, answerBy, (tab, timeoutMs) =>
            tab.act(operation, request.input, timeoutMs),
          );
        }
        default:
          return yield* Effect.fail(
            failure(
              "PreviewAutomationExecutionError",
              UNSUPPORTED[operation] ?? `The Environment browser does not support ${operation}.`,
            ),
          );
      }
    });

  const handleRequest = (connectionId: string, request: PreviewAutomationRequest) =>
    Effect.gen(function* () {
      const budget = answerBudgetMs(request.timeoutMs);
      const answerBy = (yield* Clock.currentTimeMillis) + budget;
      // Forked into the host's scope, so an operation answered as timed out still finishes
      // before the next one in its tab starts.
      const running = yield* Effect.forkIn(runOperation(request, answerBy), hostScope);
      const exit = yield* Fiber.await(running).pipe(Effect.timeoutOption(budget));
      const outcome = Option.match(exit, {
        onNone: () => ({
          ok: false as const,
          error: responseError(
            failure(
              "PreviewAutomationTimeoutError",
              `The Environment browser did not finish ${request.operation} in ${budget} ms.`,
            ),
          ),
        }),
        onSome: (done) =>
          Exit.isSuccess(done)
            ? { ok: true as const, result: done.value }
            : {
                ok: false as const,
                error: responseError(toOperationError(Cause.squash(done.cause))),
              },
      });
      yield* broker.respond({
        clientId: ENVIRONMENT_BROWSER_CLIENT_ID,
        connectionId,
        requestId: request.requestId,
        ...outcome,
      });
    }).pipe(Effect.ignore);

  const hostSession = broker
    .connect(
      {
        clientId: ENVIRONMENT_BROWSER_CLIENT_ID,
        environmentId,
        supportedOperations: [...PREVIEW_AUTOMATION_OPERATIONS],
      },
      // Before any desktop: a thread's tools stay in the Environment browser.
      { preferred: true },
    )
    .pipe(
      Effect.flatMap((events) =>
        events.pipe(
          Stream.runForEach((event) => {
            if (event.type === "connected") {
              return Effect.sync(() => {
                hostConnectionId = event.connectionId;
              }).pipe(
                Effect.andThen(reportLiveTabs),
                Effect.andThen(Effect.logInfo("T3's browser tools drive the Environment browser")),
              );
            }
            return handleRequest(event.connectionId, event.request).pipe(
              Effect.forkIn(hostScope),
              Effect.asVoid,
            );
          }),
        ),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          hostConnectionId = undefined;
        }),
      ),
    );

  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      const connection = await browser?.catch(() => undefined);
      await connection?.disconnect();
    }),
  );
  // Registered while the Environment declares its browser. The broker ends a host's stream when
  // a request goes unanswered; the host then registers again.
  yield* Effect.gen(function* () {
    if (!(yield* browserDeclared)) return yield* Effect.sleep(DECLARATION_CHECK_INTERVAL);
    yield* Effect.exit(hostSession);
    yield* Effect.sleep(HOST_RECONNECT_DELAY);
  }).pipe(Effect.forever, Effect.forkIn(hostScope));
});

export const layer = Layer.effectDiscard(make);
