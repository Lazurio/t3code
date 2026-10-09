import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  PREVIEW_AUTOMATION_OPERATIONS,
  PreviewAutomationExecutionError,
  PreviewAutomationNoAvailableHostError,
  PreviewAutomationTabNotFoundError,
  PreviewAutomationTimeoutError,
  PreviewTabId,
  ProviderInstanceId,
  ThreadId,
  type PreviewAutomationHost,
  type PreviewAutomationHostFocus,
  type PreviewAutomationOperation,
} from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as PreviewAutomationBroker from "../mcp/PreviewAutomationBroker.ts";
import { PreviewStandardToolkitHandlersLive } from "../mcp/toolkits/preview/handlers.ts";
import { PreviewStandardToolkit } from "../mcp/toolkits/preview/tools.ts";
import * as ProcessRunner from "../processRunner.ts";
import { agentBrowserSessionName } from "./agentBrowserSession.ts";
import * as EnvironmentBrowser from "./environmentBrowser.ts";
import type {
  EnvironmentBrowserConnection,
  EnvironmentBrowserTab,
  TabOperation,
} from "./environmentBrowserConnection.ts";

const environmentId = EnvironmentId.make("environment-browser-host-test");
const threadId = ThreadId.make("4a1f9c2e-7b3d-4e5f-8a6b-9c0d1e2f3a4b");
const otherThreadId = ThreadId.make("9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d");
const home = "/home/environment";
const lazurio = `${home}/.local/bin/lazurio`;
// DevTools target ids: 32 hex digits.
const threadWindow = "A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1";
const personTab = "B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2";

const scopeOf = (thread: ThreadId, providerSessionId = `provider-session-${thread}`) => ({
  environmentId,
  threadId: thread,
  providerSessionId,
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["preview"] as const),
  issuedAt: 1,
});
const gate = () => {
  let open = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

interface FakePage {
  url: string | null;
  title: string | null;
  /** What the host did in the page, in order. */
  readonly log: Array<string>;
  /** Each entry holds the next operation: it starts, then waits for `release`. */
  readonly holds: Array<{
    readonly started: ReturnType<typeof gate>;
    readonly release: Promise<void>;
  }>;
}

/** The Environment browser as the host sees it through its connection. */
const makeFakeBrowser = () => {
  const pages = new Map<string, FakePage>();
  const connections: Array<{ readonly end: () => void; readonly closed: Promise<void> }> = [];
  const opened: Array<string | undefined> = [];
  const addPage = (targetId: string, url: string | null = null) => {
    const page: FakePage = { url, title: null, log: [], holds: [] };
    pages.set(targetId, page);
    return page;
  };
  const tabOf = (page: FakePage): EnvironmentBrowserTab => ({
    state: async () => ({ url: page.url, title: page.title, loading: false }),
    navigate: async (url) => {
      page.log.push(`navigate ${url}`);
      page.url = url;
    },
    settle: async () => {
      page.log.push("settle");
    },
    act: async (operation: TabOperation, input: unknown) => {
      const hold = page.holds.shift();
      page.log.push(`${operation} started`);
      if (hold) {
        hold.started.open();
        await hold.release;
      }
      page.log.push(`${operation} done`);
      return operation === "evaluate" ? input : undefined;
    },
  });
  let connectFailure: Error | undefined;
  const connect = async (): Promise<EnvironmentBrowserConnection> => {
    const failure = connectFailure;
    connectFailure = undefined;
    if (failure !== undefined) throw failure;
    let end = () => {};
    const closed = new Promise<void>((resolve) => {
      end = resolve;
    });
    connections.push({ end, closed });
    return {
      tab: async (targetId) => {
        const page = pages.get(targetId);
        return page === undefined ? undefined : tabOf(page);
      },
      openWindow: async (url) => {
        opened.push(url);
        const targetId = `C${opened.length}`.padEnd(32, "C");
        addPage(targetId, url ?? null);
        return targetId;
      },
      closed,
      disconnect: async () => end(),
    };
  };
  const failNextConnect = (error: Error) => {
    connectFailure = error;
  };
  return { pages, connections, opened, addPage, connect, failNextConnect };
};

type CliAnswer =
  | { readonly code: number; readonly stdout: string; readonly stderr?: string }
  | "missing";

const declared: CliAnswer = {
  code: 0,
  stdout: JSON.stringify({
    kind: "browser-link",
    session: null,
    link: "https://browser.example.test/",
  }),
};
const notDeclared: CliAnswer = {
  code: 10,
  stdout: JSON.stringify({ kind: "browser-window", available: false }),
};
const windowAnswer = (targetId: string, created: boolean): CliAnswer => ({
  code: 0,
  stdout: JSON.stringify({
    kind: "browser-window",
    session: agentBrowserSessionName(threadId),
    targetId,
    created,
    link: `https://browser.example.test/t/${targetId}`,
    command: "agent-browser --cdp 9222 --session t3-…",
  }),
});

/**
 * Starts the host against a real broker, a fake `lazurio` and a fake browser. The broker is the
 * real one, observed: the test waits for the host's registration and reads what it reports.
 */
const startHost = (cli: { link: CliAnswer; window?: (args: ReadonlyArray<string>) => CliAnswer }) =>
  Effect.gen(function* () {
    const broker = yield* PreviewAutomationBroker.make;
    const browser = makeFakeBrowser();
    const runs: Array<{ readonly command: string; readonly args: ReadonlyArray<string> }> = [];
    const linkChecked = yield* Deferred.make<void>();
    const registrations: Array<{
      readonly host: PreviewAutomationHost;
      readonly options: PreviewAutomationBroker.PreviewAutomationConnectOptions | undefined;
    }> = [];
    let registered = yield* Deferred.make<void>();
    const reported: Array<PreviewAutomationHostFocus> = [];
    const delivered: Array<PreviewAutomationOperation> = [];
    const deliveryWaiters: Array<{
      readonly operation: PreviewAutomationOperation;
      readonly deferred: Deferred.Deferred<void>;
    }> = [];
    const observed = PreviewAutomationBroker.PreviewAutomationBroker.of({
      ...broker,
      connect: (host, options) =>
        broker.connect(host, options).pipe(
          Effect.map((events) =>
            events.pipe(
              Stream.tap((event) =>
                Effect.gen(function* () {
                  if (event.type === "connected") {
                    registrations.push({ host, options });
                    yield* Deferred.succeed(registered, undefined);
                    return;
                  }
                  delivered.push(event.request.operation);
                  for (const waiter of deliveryWaiters) {
                    if (waiter.operation === event.request.operation) {
                      yield* Deferred.succeed(waiter.deferred, undefined);
                    }
                  }
                }),
              ),
            ),
          ),
        ),
      focusHost: (focus) =>
        Effect.sync(() => reported.push(focus)).pipe(Effect.andThen(broker.focusHost(focus))),
    });
    const runner = ProcessRunner.ProcessRunner.of({
      run: (input) =>
        Effect.gen(function* () {
          runs.push({ command: input.command, args: input.args });
          const answer =
            input.args[1] === "link" ? cli.link : (cli.window?.(input.args) ?? cli.link);
          if (input.args[1] === "link") yield* Deferred.succeed(linkChecked, undefined);
          if (answer === "missing") {
            return yield* new ProcessRunner.ProcessSpawnError({
              command: input.command,
              argumentCount: input.args.length,
              cause: new Error("spawn ENOENT"),
            });
          }
          return {
            stdout: answer.stdout,
            stderr: answer.stderr ?? "",
            code: ChildProcessSpawner.ExitCode(answer.code),
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            stdoutInvalidUtf8: false,
            stderrInvalidUtf8: false,
          };
        }),
    });
    yield* EnvironmentBrowser.make.pipe(
      Effect.provideService(PreviewAutomationBroker.PreviewAutomationBroker, observed),
      Effect.provideService(
        ServerEnvironment.ServerEnvironment,
        ServerEnvironment.ServerEnvironment.of({
          getEnvironmentId: Effect.succeed(environmentId),
          getDescriptor: Effect.die("unused"),
        }),
      ),
      Effect.provideService(ProcessRunner.ProcessRunner, runner),
      Effect.provideService(HostProcessEnvironment, { HOME: home }),
      Effect.provideService(EnvironmentBrowser.EnvironmentBrowserConnect, browser.connect),
    );
    return {
      broker,
      browser,
      runs,
      registrations,
      reported,
      setLink: (answer: CliAnswer) => {
        cli.link = answer;
      },
      /** Settles once the host is registered with the broker (again, after a call to `expectRegistration`). */
      registered: Effect.suspend(() => Deferred.await(registered)),
      expectRegistration: Effect.gen(function* () {
        registered = yield* Deferred.make<void>();
      }),
      linkChecked: Deferred.await(linkChecked),
      /** Settles once the host has received a request for `operation`. */
      delivered: (operation: PreviewAutomationOperation) =>
        Effect.gen(function* () {
          if (delivered.includes(operation)) return;
          const deferred = yield* Deferred.make<void>();
          deliveryWaiters.push({ operation, deferred });
          yield* Deferred.await(deferred);
        }),
    };
  }).pipe(Effect.provide(NodeServices.layer));

const invoke = <A = unknown>(
  broker: PreviewAutomationBroker.PreviewAutomationBroker["Service"],
  operation: PreviewAutomationOperation,
  input: unknown,
  options: {
    readonly tabId?: string;
    readonly thread?: ThreadId;
    readonly timeoutMs?: number;
  } = {},
) =>
  broker.invoke<A>({
    scope: scopeOf(options.thread ?? threadId),
    operation,
    input,
    ...(options.tabId === undefined ? {} : { tabId: PreviewTabId.make(options.tabId) }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });

it.effect.each([
  { name: "exit 10", link: notDeclared },
  { name: "a missing lazurio", link: "missing" as const },
  { name: "a failing lazurio", link: { code: 1, stdout: "", stderr: "lazurio browser failed" } },
  { name: "an unexpected answer", link: { code: 0, stdout: "https://browser.example.test/" } },
])("does not register on $name, and registers once the browser is declared", ({ link }) =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* startHost({ link });
      yield* host.linkChecked;
      yield* Effect.yieldNow;

      expect(yield* invoke<void>(host.broker, "status", {}).pipe(Effect.flip)).toBeInstanceOf(
        PreviewAutomationNoAvailableHostError,
      );
      expect(host.runs).toEqual([{ command: lazurio, args: ["browser", "link", "--json"] }]);

      // A browser declared after T3 started is picked up on the next check.
      host.setLink(declared);
      yield* TestClock.adjust("60 seconds");
      yield* host.registered;
      expect(yield* invoke(host.broker, "status", {})).toEqual({
        available: true,
        visible: false,
        tabId: null,
        url: null,
        title: null,
        loading: false,
      });
      expect(host.registrations).toEqual([
        {
          host: {
            clientId: EnvironmentBrowser.ENVIRONMENT_BROWSER_CLIENT_ID,
            environmentId,
            supportedOperations: [...PREVIEW_AUTOMATION_OPERATIONS],
          },
          options: { preferred: true },
        },
      ]);
      // Status without a tab never reaches for the browser.
      expect(host.browser.connections).toHaveLength(0);
    }),
  ),
);

it.effect("opens the thread's own window through lazurio and answers with its tab", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* startHost({
        link: declared,
        window: () => {
          // `lazurio browser window` creates the window and binds the thread's session to it.
          host.browser.addPage(threadWindow, "https://example.test/");
          return windowAnswer(threadWindow, true);
        },
      });
      yield* host.registered;

      const status = yield* invoke(host.broker, "open", {
        url: "example.test",
        reuseExistingTab: true,
      });

      expect(status).toEqual({
        available: true,
        visible: true,
        tabId: threadWindow,
        url: "https://example.test/",
        title: null,
        loading: false,
      });
      expect(host.runs.at(-1)).toEqual({
        command: lazurio,
        args: [
          "browser",
          "window",
          "--session",
          agentBrowserSessionName(threadId),
          "--url",
          "https://example.test/",
          "--json",
        ],
      });
      // The window opened at the URL; the host only waits for it to load.
      expect(host.browser.pages.get(threadWindow)?.log).toEqual(["settle"]);
      // The thread's tab is now its current one, and the broker knows this host has it.
      yield* invoke(host.broker, "snapshot", {}, { thread: threadId });
      expect(host.browser.pages.get(threadWindow)?.log).toEqual([
        "settle",
        "snapshot started",
        "snapshot done",
      ]);
      expect(host.reported.at(-1)).toMatchObject({
        clientId: EnvironmentBrowser.ENVIRONMENT_BROWSER_CLIENT_ID,
        focused: false,
        liveTabs: [{ threadId, tabId: threadWindow }],
      });
    }),
  ),
);

it.effect(
  "shows the person the thread's tab once preview_open revealed it, never for background work",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const host = yield* startHost({
          link: declared,
          window: () => windowAnswer(threadWindow, false),
        });
        host.browser.addPage(threadWindow, "https://example.test/");
        yield* host.registered;
        const visible = (
          operation: PreviewAutomationOperation,
          input: unknown,
          thread: ThreadId = threadId,
        ) =>
          invoke<{ readonly visible: boolean }>(host.broker, operation, input, { thread }).pipe(
            Effect.map((status) => status.visible),
          );

        // Background automation: open: false, or the deprecated show: false.
        expect(yield* visible("open", { open: false })).toBe(false);
        expect(yield* visible("status", {})).toBe(false);
        expect(yield* visible("open", { show: false })).toBe(false);
        expect(yield* visible("navigate", { url: "https://example.test/hidden" })).toBe(false);

        // Any other preview_open reveals the tab: the person's web T3 opens its right panel on
        // the agent's browser use. The thread's later answers about its tab say so.
        expect(yield* invoke(host.broker, "open", {})).toMatchObject({
          visible: true,
          tabId: threadWindow,
        });
        expect(yield* visible("status", {})).toBe(true);
        expect(yield* visible("navigate", { url: "https://example.test/next" })).toBe(true);
        expect(yield* visible("open", { url: "https://example.test/again" })).toBe(true);
        // open outranks the deprecated show, as in the desktop app.
        expect(yield* visible("open", { open: true, show: false })).toBe(true);
        // Another thread revealed nothing.
        expect(yield* visible("status", {}, otherThreadId)).toBe(false);

        // Background work in the same tab takes it back, until the next reveal.
        expect(yield* visible("open", { open: false })).toBe(false);
        expect(yield* visible("status", {})).toBe(false);
        expect(yield* visible("open", {})).toBe(true);
        // A tab that closed is shown to no one.
        host.browser.pages.delete(threadWindow);
        expect(yield* invoke(host.broker, "status", {})).toMatchObject({
          visible: false,
          tabId: null,
        });
      }),
    ),
);

it.effect("navigates the thread's window when it was open already", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* startHost({
        link: declared,
        window: () => windowAnswer(threadWindow, false),
      });
      host.browser.addPage(threadWindow, "https://before.example.test/");
      yield* host.registered;

      const status = yield* invoke<{ readonly url: string }>(host.broker, "open", {
        url: "https://after.example.test/",
      });

      expect(status.url).toBe("https://after.example.test/");
      expect(host.browser.pages.get(threadWindow)?.log).toEqual([
        "navigate https://after.example.test/",
      ]);
    }),
  ),
);

it.effect("opens another window with reuseExistingTab false, and makes it the current tab", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* startHost({ link: declared });
      yield* host.registered;

      const status = yield* invoke<{ readonly tabId: string }>(host.broker, "open", {
        url: "localhost:5173",
        reuseExistingTab: false,
      });

      expect(host.browser.opened).toEqual(["http://localhost:5173/"]);
      expect(host.runs.filter((run) => run.args[1] === "window")).toEqual([]);
      yield* invoke(host.broker, "press", { key: "Enter" });
      expect(host.browser.pages.get(status.tabId)?.log).toEqual([
        "settle",
        "press started",
        "press done",
      ]);
    }),
  ),
);

it.effect(
  "reuses the current tab on a later open, and returns to the thread's window once it is gone",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const host = yield* startHost({
          link: declared,
          window: () => {
            host.browser.addPage(threadWindow);
            return windowAnswer(threadWindow, true);
          },
        });
        yield* host.registered;

        // A second window is the current tab now.
        const second = yield* invoke<{ readonly tabId: string }>(host.broker, "open", {
          url: "https://first.example.test/",
          reuseExistingTab: false,
        });
        // preview_open without a tab reuses it, as the tool's contract says, without the CLI.
        const reused = yield* invoke<{ readonly tabId: string }>(host.broker, "open", {
          url: "https://second.example.test/",
        });
        expect(reused.tabId).toBe(second.tabId);
        expect(host.browser.pages.get(second.tabId)?.log).toEqual([
          "settle",
          "navigate https://second.example.test/",
        ]);
        expect(host.runs.filter((run) => run.args[1] === "window")).toEqual([]);

        // Once that window is gone, the thread's own window takes its place.
        host.browser.pages.delete(second.tabId);
        const own = yield* invoke<{ readonly tabId: string }>(host.broker, "open", {});
        expect(own.tabId).toBe(threadWindow);
        expect(host.runs.filter((run) => run.args[1] === "window")).toHaveLength(1);
      }),
    ),
);

it.effect("adopts a tab handed over by its id, and refuses an id that names no tab", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* startHost({ link: declared });
      host.browser.addPage(personTab, "https://person.example.test/");
      yield* host.registered;

      // A person or another thread's agent passed the id of a tab in the people's view.
      const status = yield* invoke<{ readonly tabId: string }>(
        host.broker,
        "open",
        {},
        { tabId: personTab, thread: otherThreadId },
      );
      expect(status.tabId).toBe(personTab);
      yield* invoke(host.broker, "scroll", { deltaY: 100 }, { thread: otherThreadId });
      expect(host.browser.pages.get(personTab)?.log).toEqual(["scroll started", "scroll done"]);
      expect(host.runs.filter((run) => run.args[1] === "window")).toEqual([]);

      const unknown = "0123456789ABCDEF0123456789ABCDEF";
      expect(
        yield* invoke<void>(host.broker, "snapshot", {}, { tabId: unknown }).pipe(Effect.flip),
      ).toBeInstanceOf(PreviewAutomationTabNotFoundError);
      expect(
        yield* invoke<void>(host.broker, "open", {}, { tabId: unknown }).pipe(Effect.flip),
      ).toBeInstanceOf(PreviewAutomationTabNotFoundError);
    }),
  ),
);

// Another Environment's people's view of one of its tabs: an agent here works over SSH in that
// Environment, whose browser this host cannot drive.
const foreignId = "0123456789ABCDEF0123456789ABCDEF";
const foreignView = `https://browser.vm-02.acme.lazurio.io/t/${foreignId}`;

it.effect("answers preview_open of another Environment's view without this browser", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* startHost({ link: declared });
      yield* host.registered;

      expect(yield* invoke(host.broker, "open", { url: foreignView })).toEqual({
        available: true,
        visible: true,
        tabId: foreignId,
        url: null,
        title: null,
        loading: false,
        view: foreignView,
        message: `Tab ${foreignId} is in the browser of another Environment (browser.vm-02.acme.lazurio.io), not of this one. The person sees it in the right panel. This Environment's preview tools cannot drive it: work in it with agent-browser on that Environment, over SSH.`,
      });
      // A person's own Environment is another one too; background work is not brought to the
      // front, and a reused or named tab does not change the answer.
      const personalId = "F".repeat(32);
      const personal = `https://browser.jana.lazurio.io/t/${personalId}`;
      expect(
        yield* invoke(host.broker, "open", { url: personal, open: false, reuseExistingTab: false }),
      ).toMatchObject({
        tabId: personalId,
        visible: false,
        view: personal,
        message: expect.stringContaining("without coming to the front"),
      });
      expect(
        yield* invoke(host.broker, "open", { url: foreignView }, { tabId: personalId }),
      ).toMatchObject({ tabId: foreignId, visible: true });

      // Neither this Environment's browser nor its lazurio command was asked.
      expect(host.browser.connections).toHaveLength(0);
      expect(host.runs).toEqual([{ command: lazurio, args: ["browser", "link", "--json"] }]);
    }),
  ),
);

it.effect("refuses to drive another Environment's tab, and preview_open comes back here", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* startHost({
        link: declared,
        window: () => {
          host.browser.addPage(threadWindow, "https://example.test/");
          return windowAnswer(threadWindow, true);
        },
      });
      yield* host.registered;
      yield* invoke(host.broker, "open", { url: foreignView });

      // Named, or as the session's current tab, which the broker took from the answer.
      for (const [operation, input, tabId] of [
        ["snapshot", {}, foreignId],
        ["snapshot", {}, undefined],
        ["click", { locator: "text=Go" }, undefined],
        ["evaluate", { expression: "document.title" }, foreignId],
        ["status", {}, undefined],
        ["navigate", { url: "https://example.test/" }, foreignId],
        ["resize", { mode: "fill" }, undefined],
        ["open", {}, foreignId],
      ] as const) {
        const error = yield* invoke<void>(
          host.broker,
          operation,
          input,
          tabId === undefined ? {} : { tabId },
        ).pipe(Effect.flip);
        expect([operation, tabId, error]).toEqual([
          operation,
          tabId,
          expect.any(PreviewAutomationExecutionError),
        ]);
        expect(error.message).toBe(
          `Preview automation ${operation} failed: Tab ${foreignId} is in the browser of another Environment (browser.vm-02.acme.lazurio.io), which this Environment's preview tools cannot drive. Work in it with agent-browser on that Environment, over SSH, or call preview_open without tabId to work in this Environment's browser.`,
        );
      }
      expect(host.browser.connections).toHaveLength(0);

      // preview_open without a tab works in this Environment's browser again: the thread's window.
      expect(yield* invoke(host.broker, "open", {})).toMatchObject({ tabId: threadWindow });
      yield* invoke(host.broker, "snapshot", {});
      expect(host.browser.pages.get(threadWindow)?.log).toEqual([
        "snapshot started",
        "snapshot done",
      ]);
      // Its tab does not load another Environment's view, which would sign this browser in there.
      const navigation = yield* invoke<void>(host.broker, "navigate", { url: foreignView }).pipe(
        Effect.flip,
      );
      expect(navigation).toBeInstanceOf(PreviewAutomationExecutionError);
      expect(navigation.message).toContain(
        `${foreignView} is in another Environment's browser (browser.vm-02.acme.lazurio.io), which this Environment's browser does not load.`,
      );
      expect(host.browser.pages.get(threadWindow)?.log).toEqual([
        "snapshot started",
        "snapshot done",
      ]);
    }),
  ),
);

// A fragment never reaches the gateway, and a query, another path or a port is still that
// Environment's browser: preview_open and preview_navigate fail closed for any of them, before
// this browser or its lazurio command is asked (only the exact view of one tab is answered).
it.effect("fails closed for any other address in another Environment's browser", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* startHost({ link: declared });
      yield* host.registered;
      for (const address of [
        `${foreignView}#view`,
        `${foreignView}?source=agent`,
        "https://browser.vm-02.acme.lazurio.io/",
        `https://browser.vm-02.acme.lazurio.io:8443/t/${foreignId}`,
        `https://BROWSER.vm-02.acme.lazurio.io/t/${foreignId}/live`,
      ]) {
        for (const operation of ["open", "navigate"] as const) {
          const error = yield* invoke<void>(host.broker, operation, { url: address }).pipe(
            Effect.flip,
          );
          expect([operation, address, error]).toEqual([
            operation,
            address,
            expect.any(PreviewAutomationExecutionError),
          ]);
          expect(error.message).toContain(
            "in another Environment's browser (browser.vm-02.acme.lazurio.io), which this Environment's browser does not load",
          );
        }
      }
      expect(host.browser.connections).toHaveLength(0);
      expect(host.runs).toEqual([{ command: lazurio, args: ["browser", "link", "--json"] }]);
    }),
  ),
);

/** An Environment that declares its own view on a Lazurio origin. */
const declaredOnLazurio: CliAnswer = {
  code: 0,
  stdout: JSON.stringify({
    kind: "browser-link",
    session: null,
    link: "https://browser.vm-01.acme.lazurio.io/",
  }),
};

it.effect("opens a view of this Environment's own browser here, as before", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const ownView = `https://browser.vm-01.acme.lazurio.io/t/${personTab}`;
      const host = yield* startHost({
        link: declaredOnLazurio,
        window: () => {
          host.browser.addPage(threadWindow, ownView);
          return windowAnswer(threadWindow, true);
        },
      });
      yield* host.registered;

      const answer = yield* invoke(host.broker, "open", { url: ownView });
      expect(answer).toMatchObject({ tabId: threadWindow, url: ownView });
      expect(answer).not.toHaveProperty("message");
      expect(host.runs.filter((run) => run.args[1] === "window")).toHaveLength(1);
    }),
  ),
);

it.effect("hands the agent the other Environment's view and what to do there", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* startHost({ link: declared });
      yield* host.registered;
      const toolkit = yield* PreviewStandardToolkit.pipe(
        Effect.provide(PreviewStandardToolkitHandlersLive),
      );

      // What the MCP server sends as the tool's structured content and text (McpServer.toolkit).
      const { encodedResult } = yield* toolkit
        .handle("preview_open", { url: foreignView })
        .pipe(
          Stream.unwrap,
          Stream.run(Sink.last()),
          Effect.flatMap(Effect.fromOption),
          Effect.provideService(McpInvocationContext.McpInvocationContext, scopeOf(threadId)),
          Effect.provideService(PreviewAutomationBroker.PreviewAutomationBroker, host.broker),
        );

      expect(encodedResult).toMatchObject({
        tabId: foreignId,
        visible: true,
        view: foreignView,
        message: expect.stringContaining("work in it with agent-browser on that Environment"),
      });
    }),
  ),
);

it.effect("asks for preview_open when the thread has no tab", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* startHost({ link: declared });
      yield* host.registered;

      const error = yield* invoke<void>(host.broker, "click", { x: 1, y: 1 }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(PreviewAutomationTabNotFoundError);
      expect(error.message).toContain("Call preview_open first.");
    }),
  ),
);

it.effect.each([
  { operation: "resize", alternative: "person's view" },
  { operation: "setColorScheme", alternative: "headless browser" },
  { operation: "recordingStart", alternative: "preview_snapshot" },
  { operation: "recordingStop", alternative: "preview_snapshot" },
] as const)("answers $operation with what to do instead", ({ operation, alternative }) =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* startHost({ link: declared });
      yield* host.registered;

      const error = yield* invoke<void>(host.broker, operation, {}).pipe(Effect.flip);

      expect(error).toBeInstanceOf(PreviewAutomationExecutionError);
      expect(error.message).toContain(alternative);
    }),
  ),
);

it.effect("runs one operation at a time in a tab and lets other tabs work meanwhile", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* startHost({ link: declared });
      const busy = host.browser.addPage(threadWindow);
      const other = host.browser.addPage(personTab);
      yield* host.registered;
      const click = { started: gate(), release: gate() };
      busy.holds.push({ started: click.started, release: click.release.promise });

      const first = yield* invoke(
        host.broker,
        "click",
        { x: 1, y: 1 },
        { tabId: threadWindow },
      ).pipe(Effect.forkScoped);
      yield* Effect.promise(() => click.started.promise);
      const second = yield* invoke(
        host.broker,
        "type",
        { text: "queued" },
        { tabId: threadWindow, thread: otherThreadId },
      ).pipe(Effect.forkScoped);
      // The host has the type request before another tab's work starts and ends.
      yield* host.delivered("type");
      yield* invoke(host.broker, "press", { key: "Tab" }, { tabId: personTab });

      expect(other.log).toEqual(["press started", "press done"]);
      expect(busy.log).toEqual(["click started"]);
      click.release.open();
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      expect(busy.log).toEqual(["click started", "click done", "type started", "type done"]);
    }),
  ),
);

it.effect("connects again after the browser connection ended", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* startHost({ link: declared });
      host.browser.addPage(personTab);
      yield* host.registered;
      yield* invoke(host.broker, "evaluate", { expression: "1" }, { tabId: personTab });
      expect(host.browser.connections).toHaveLength(1);

      // The Environment browser restarted, or its DevTools connection dropped.
      const [first] = host.browser.connections;
      first!.end();
      yield* Effect.promise(() => first!.closed);

      expect(
        yield* invoke(host.broker, "evaluate", { expression: "2" }, { tabId: personTab }),
      ).toEqual({ expression: "2" });
      expect(host.browser.connections).toHaveLength(2);
    }),
  ),
);

it.effect("says why the Environment browser does not answer", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* startHost({ link: declared });
      host.browser.failNextConnect(new Error("connect ECONNREFUSED 127.0.0.1:9222\nCall log: …"));
      yield* host.registered;

      const error = yield* invoke<void>(host.broker, "snapshot", {}, { tabId: personTab }).pipe(
        Effect.flip,
      );

      expect(error).toBeInstanceOf(PreviewAutomationExecutionError);
      expect(error.message).toBe(
        "Preview automation snapshot failed: The Environment browser does not answer on its DevTools port (connect ECONNREFUSED 127.0.0.1:9222). Run lazurio doctor.",
      );
      // The next operation tries again.
      host.browser.addPage(personTab);
      yield* invoke(host.broker, "snapshot", {}, { tabId: personTab });
      expect(host.browser.connections).toHaveLength(1);
    }),
  ),
);

it.effect("answers a slow operation with a timeout before the broker gives up on the host", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* startHost({ link: declared });
      const page = host.browser.addPage(personTab);
      yield* host.registered;
      const stuck = { started: gate(), release: gate() };
      page.holds.push({ started: stuck.started, release: stuck.release.promise });

      const slow = yield* invoke<void>(
        host.broker,
        "waitFor",
        { text: "never" },
        { tabId: personTab, timeoutMs: 2_000 },
      ).pipe(Effect.flip, Effect.forkScoped);
      yield* Effect.promise(() => stuck.started.promise);
      yield* TestClock.adjust("1800 millis");

      const timeout = yield* Fiber.join(slow);
      expect(timeout).toBeInstanceOf(PreviewAutomationTimeoutError);
      // The host answered: a timeout of the broker's own carries no remote tag and drops the host.
      expect(timeout).toMatchObject({ remoteTag: "PreviewAutomationTimeoutError" });
      expect(yield* invoke(host.broker, "status", {})).toMatchObject({ available: true });
      stuck.release.open();
    }),
  ),
);
