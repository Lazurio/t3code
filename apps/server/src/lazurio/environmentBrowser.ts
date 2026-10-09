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
 * Per thread, the host keeps in memory the tabs it opened or adopted and the current one.
 * preview_open without a tab reuses the current tab while it is open (the tool's contract), and a
 * thread without one gets its own window, the one `lazurio browser window` keeps bound to the
 * thread's agent-browser session, so T3's tools and agent-browser drive the same window and a
 * restarted server finds it again. A tab id from the people's view or another agent hands that
 * tab over. Operations run one at a time per tab; a person working in the same tab at
 * the same time is expected and not locked out. Resizing and color schemes would change what the
 * person sees, and recording is not available, so those are answered with what to do instead.
 * Another Environment's view of a tab (an agent working in that Environment over SSH) is never
 * loaded here: preview_open answers with that tab, which the person's right panel opens as the
 * other Environment's, and says to drive it with agent-browser on that Environment. Any other
 * operation on that tab fails with the same advice.
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
import { lazurioBrowserView, type LazurioBrowserView } from "./browserView.ts";
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

/**
 * `lazurio browser link --json` on an Environment that declares its browser. Its `link` is a new
 * tab of the Environment's own view, so its origin is where this Environment's tabs are viewed.
 */
const decodeBrowserLink = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ kind: Schema.Literal("browser-link"), link: Schema.optional(Schema.Unknown) }),
  ),
);
const viewOriginOf = (link: unknown) => {
  if (typeof link !== "string") return undefined;
  try {
    const url = new URL(link);
    return url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
};
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

/**
 * `visible` says the person is shown the tab. The person's web T3 opens its right panel on the
 * thread's Environment browser when the thread's agent uses the browser
 * (apps/web/src/lazurio/browserUse.ts), so the thread's current tab is shown once preview_open
 * revealed it, while the tab stays open. preview_open reveals unless it asks for background work
 * (`open: false`, or the deprecated `show: false`; `open` wins, as in the desktop app), and the
 * thread's last preview_open decides. The host cannot see the person's screen: a panel the person
 * closed, or a client without the panel, still counts as shown.
 */
const statusOf = (
  targetId: string,
  state: TabState,
  visible: boolean,
): PreviewAutomationStatus => ({
  available: true,
  visible,
  tabId: targetId,
  ...state,
});

/** Whether preview_open shows its tab to the person: unless it asks for background work. */
const reveals = (input: PreviewAutomationOpenInput) => (input.open ?? input.show) !== false;

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

/** The other Environment's browser, as the agent reaches it: the host of its view. */
const browserHostOf = (view: LazurioBrowserView) => view.origin.slice("https://".length);
/** What preview_open of another Environment's view says, so the agent works there instead. */
const foreignAnswer = (view: LazurioBrowserView, visible: boolean) =>
  `Tab ${view.targetId} is in the browser of another Environment (${browserHostOf(view)}), not of this one. ${
    visible
      ? "The person sees it in the right panel."
      : "It joins the person's right panel without coming to the front."
  } This Environment's preview tools cannot drive it: work in it with agent-browser on that Environment, over SSH.`;
// An execution error, so that a preferred host's text reaches the agent (preferredHostErrors.ts).
const foreignTab = (view: LazurioBrowserView) =>
  failure(
    "PreviewAutomationExecutionError",
    `Tab ${view.targetId} is in the browser of another Environment (${browserHostOf(view)}), which this Environment's preview tools cannot drive. Work in it with agent-browser on that Environment, over SSH, or call preview_open without tabId to work in this Environment's browser.`,
  );
const foreignNavigation = (url: string, host: string) =>
  failure(
    "PreviewAutomationExecutionError",
    `${url} is in another Environment's browser (${host}), which this Environment's browser does not load. Show one of its tabs to the person with preview_open of its view link https://${host}/t/<tab id>, and work in it with agent-browser on that Environment, over SSH.`,
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
  /** Whether the thread's last preview_open revealed its tab to the person (statusOf). */
  revealed: boolean;
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

  /** The Environment's declaration of its browser. A missing binary or any other answer is none. */
  const browserDeclaration =
    lazurio === undefined
      ? Effect.succeedNone
      : runner
          .run({
            command: lazurio,
            args: ["browser", "link", "--json"],
            timeout: LINK_CHECK_TIMEOUT,
          })
          .pipe(
            Effect.map((output) =>
              output.code === 0 ? decodeBrowserLink(output.stdout) : Option.none(),
            ),
            Effect.orElseSucceed(() => Option.none()),
          );

  const threads = new Map<ThreadId, ThreadTabs>();
  let hostConnectionId: string | undefined;
  /** The origin of this Environment's own view, from its declaration. */
  let ownViewOrigin: string | undefined;
  /** Tabs of other Environments' browsers that preview_open answered with, by target id. */
  const foreignTabs = new Map<string, LazurioBrowserView>();
  /**
   * Another Environment's view of one remote tab: a Lazurio browser view on another origin than
   * this Environment's. Without a declared origin, every Lazurio browser view is another's.
   */
  /**
   * The host of another Environment's browser that `url` is in, whatever its path, query, fragment
   * or port: `browser.<labels>.lazurio.io` on another host than this Environment's view. This
   * browser never loads such an address, which would sign it in to that Environment's gateway.
   */
  const foreignBrowserHost = (url: string) => {
    let address: URL;
    try {
      address = new URL(url);
    } catch {
      return undefined;
    }
    const own = ownViewOrigin === undefined ? undefined : new URL(ownViewOrigin).hostname;
    return /^browser\.(?:[a-z0-9-]+\.)+lazurio\.io$/.test(address.hostname) &&
      address.hostname !== own
      ? address.hostname
      : undefined;
  };
  const foreignView = (url: string) => {
    const view = lazurioBrowserView(url);
    return view !== null && view.origin !== ownViewOrigin ? view : undefined;
  };
  /** Fails for a tab of another Environment's browser, which this host cannot drive. */
  const notForeign = (targetId: string) =>
    Effect.suspend(() => {
      const view = foreignTabs.get(targetId);
      return view === undefined ? Effect.void : Effect.fail(foreignTab(view));
    });
  /**
   * preview_open of another Environment's view touches neither this browser nor the thread's tabs:
   * it answers with the other tab, which the person's right panel opens as that Environment's.
   */
  const foreignOpen = (view: LazurioBrowserView, visible: boolean) =>
    Effect.sync(() => {
      foreignTabs.set(view.targetId, view);
      return {
        ...statusOf(view.targetId, { url: null, title: null, loading: false }, visible),
        view: view.view,
        message: foreignAnswer(view, visible),
      };
    });

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
  const adopt = (threadId: ThreadId, targetId: string, revealed: boolean) =>
    Effect.suspend(() => {
      const thread = threads.get(threadId) ?? {
        tabs: new Set<string>(),
        current: undefined,
        revealed: false,
      };
      thread.tabs.add(targetId);
      thread.current = targetId;
      thread.revealed = revealed;
      threads.set(threadId, thread);
      return reportLiveTabs;
    });
  /** Whether the person is shown the tab: the thread's current tab, once revealed (statusOf). */
  const shown = (threadId: ThreadId, targetId: string) => {
    const thread = threads.get(threadId);
    return thread?.revealed === true && thread.current === targetId;
  };
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
  /** The tab while its page is open; a closed one leaves every thread that had it. */
  const liveTab = (targetId: string | undefined) =>
    targetId === undefined
      ? Effect.succeed(undefined)
      : Effect.flatMap(tabOf(targetId), (tab) =>
          tab === undefined ? Effect.as(forget(targetId), undefined) : Effect.succeed(targetId),
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
        shown(request.threadId, targetId),
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
      const foreign = url === undefined ? undefined : foreignView(url);
      if (foreign !== undefined) return yield* foreignOpen(foreign, reveals(input));
      const foreignHost = url === undefined ? undefined : foreignBrowserHost(url);
      if (url !== undefined && foreignHost !== undefined) {
        return yield* Effect.fail(foreignNavigation(url, foreignHost));
      }
      // A named tab is handed over. Otherwise the current tab is reused while it is open, and a
      // thread without one gets its own window, which the CLI finds or creates. The broker keeps
      // another Environment's tab from an earlier answer as the current one; this browser's
      // current tab of the thread stands in for it.
      const handedOver = request.tabIdExplicit === true ? request.tabId : undefined;
      if (handedOver !== undefined) yield* notForeign(handedOver);
      const reused =
        request.tabId !== undefined && !foreignTabs.has(request.tabId)
          ? request.tabId
          : threads.get(request.threadId)?.current;
      const current =
        handedOver === undefined && input.reuseExistingTab !== false
          ? yield* liveTab(reused)
          : undefined;
      const { targetId, created } =
        handedOver !== undefined
          ? { targetId: handedOver, created: false }
          : current !== undefined
            ? { targetId: current, created: false }
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
          yield* adopt(request.threadId, targetId, reveals(input));
          const state = yield* Effect.tryPromise({
            try: async () => {
              // A new window opened at the URL; one that was open already goes there now.
              if (url !== undefined && !created) await tab.navigate(url, "load", timeoutMs);
              else if (url !== undefined) await tab.settle(timeoutMs);
              return tab.state();
            },
            catch: toOperationError,
          });
          return statusOf(targetId, state, shown(request.threadId, targetId));
        }),
      );
    });

  const runOperation = (request: PreviewAutomationRequest, answerBy: number) =>
    Effect.gen(function* () {
      const operation = request.operation;
      // Another Environment's tab is never driven from here; open handles the tab it is given.
      const requested = operation === "open" ? undefined : requestTab(request);
      if (requested !== undefined) yield* notForeign(requested);
      switch (operation) {
        case "status":
          return yield* status(request);
        case "open":
          return yield* open(request, answerBy);
        case "navigate": {
          const input = request.input as PreviewAutomationNavigateInput;
          const url = yield* Effect.try({
            try: () => resolveNavigationUrl(input),
            catch: toOperationError,
          });
          // Another Environment's browser in this one would sign it in to that gateway; said first,
          // so that a thread without a tab gets the same advice.
          const foreignHost = foreignBrowserHost(url);
          if (foreignHost !== undefined) {
            return yield* Effect.fail(foreignNavigation(url, foreignHost));
          }
          const targetId = requestTab(request);
          if (targetId === undefined) return yield* Effect.fail(noTab());
          return yield* inTab(targetId, answerBy, async (tab, timeoutMs) => {
            await tab.navigate(url, input.readiness ?? "load", timeoutMs);
            return statusOf(targetId, await tab.state(), shown(request.threadId, targetId));
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
    const declaration = yield* browserDeclaration;
    if (Option.isNone(declaration)) return yield* Effect.sleep(DECLARATION_CHECK_INTERVAL);
    ownViewOrigin = viewOriginOf(declaration.value.link);
    yield* Effect.exit(hostSession);
    yield* Effect.sleep(HOST_RECONNECT_DELAY);
  }).pipe(Effect.forever, Effect.forkIn(hostScope));
});

export const layer = Layer.effectDiscard(make);
