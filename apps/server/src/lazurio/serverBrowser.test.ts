import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_BROWSER_PROFILE_ID,
  EnvironmentId,
  PREVIEW_AUTOMATION_SERVER_OPERATIONS,
  SERVER_BROWSER_AUTOMATION_CLIENT_ID,
  type PreviewAutomationHost,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/http";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as PreviewAutomationBroker from "../mcp/PreviewAutomationBroker.ts";
import * as DesktopBrowserChannel from "../preview/DesktopBrowserChannel.ts";
import * as PreviewManager from "../preview/Manager.ts";
import * as PreviewAgentActivity from "../preview/PreviewAgentActivity.ts";
import * as PreviewBrowser from "../preview/PreviewBrowser.ts";
import * as ServerBrowser from "../preview/ServerBrowser.ts";
import { LAZURIO_FOLDER_ENV } from "./lazurioEnvironment.ts";
import * as LazurioServerBrowser from "./serverBrowser.ts";

const environmentId = EnvironmentId.make("environment-server-browser-gate");
const lazurioEnvironment = { [LAZURIO_FOLDER_ENV]: "/home/environment/Lazurio" };

/**
 * Upstream's server browser behind the gate, as server.ts builds it, with what it touches
 * observed: who registers with the preview broker, and whether anything asks for Chromium.
 */
const gatedServerBrowser = (environment: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    // Counted by a memoized sibling layer; Layer.tap is not memoized and would count every use.
    let activityBuilds = 0;
    const activity = Layer.merge(
      PreviewAgentActivity.layer,
      Layer.effectDiscard(
        Effect.sync(() => {
          activityBuilds += 1;
        }),
      ),
    );
    const registrations: Array<PreviewAutomationHost> = [];
    const chromium: Array<string> = [];
    const broker = PreviewAutomationBroker.PreviewAutomationBroker.of({
      connect: (host) =>
        Effect.sync(() => {
          registrations.push(host);
          return Stream.never;
        }),
      focusHost: () => Effect.void,
      respond: () => Effect.void,
      invoke: () => Effect.die("unused"),
    });
    const askedFor = (what: string) =>
      Effect.sync(() => chromium.push(what)).pipe(Effect.andThen(Effect.die(`no ${what}`)));
    // Built in the test's scope, so upstream's fibers run while the test looks.
    const context = yield* Layer.build(
      LazurioServerBrowser.gate(
        ServerBrowser.layer.pipe(
          Layer.provide(
            Layer.merge(
              Layer.succeed(DesktopBrowserChannel.DesktopBrowserChannel, {
                available: false,
                awaitAttached: () => Effect.succeed(false),
                detached: Stream.empty,
                attached: Stream.empty,
                isAttached: () => Effect.succeed(false),
                endpoint: () => Effect.die("no desktop"),
                pointer: () => Effect.void,
                turn: () => Effect.void,
              }),
              activity,
            ),
          ),
        ),
      ).pipe(
        // RunExecutionService's use of the same layer beside the gate.
        Layer.merge(activity),
        Layer.provide(
          Layer.mergeAll(
            PreviewManager.layer,
            Layer.succeed(PreviewAutomationBroker.PreviewAutomationBroker, broker),
            Layer.succeed(ServerEnvironment.ServerEnvironment, {
              getEnvironmentId: Effect.succeed(environmentId),
              getDescriptor: Effect.die("unused descriptor"),
            }),
            Layer.succeed(PreviewBrowser.PreviewBrowser, {
              executable: askedFor("executable"),
              installed: askedFor("installed"),
            }),
          ),
        ),
        Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "lazurio-gate-" })),
      ),
    ).pipe(Effect.provideService(HostProcess.Environment, environment));
    const browser = Context.get(context, ServerBrowser.ServerBrowser);
    // Upstream's server browser registers from a fiber of its own.
    yield* Effect.yieldNow;
    yield* Effect.yieldNow;
    return { browser, registrations, chromium, activityBuilds };
  });

describe("upstream's server browser", () => {
  it.effect("is never built on a Lazurio Environment: no host, no Chromium, no tabs", () =>
    Effect.gen(function* () {
      const { browser, registrations, chromium } = yield* gatedServerBrowser(lazurioEnvironment);

      // The Environment browser host is the only one to take upstream's client id there.
      assert.deepStrictEqual(registrations, []);
      assert.deepStrictEqual(chromium, []);
      const viewer = yield* browser
        .attachViewer({
          threadId: "thread-1",
          tabId: "tab-1",
          maxWidth: 1280,
          maxHeight: 800,
          quality: 70,
          canOperate: true,
        })
        .pipe(Effect.flip, Effect.scoped);
      assert.instanceOf(viewer, ServerBrowser.ServerBrowserTabNotFoundError);
      assert.isTrue(
        Option.isNone(
          yield* browser.openDownload({ threadId: "thread-1", tabId: "tab-1", downloadId: "d" }),
        ),
      );
      assert.isFalse(
        yield* browser.answerFileChooser({
          threadId: "thread-1",
          tabId: "tab-1",
          chooserId: "c",
          files: [],
        }),
      );
      // Every WebSocket session takes a profile reporter (ws.ts); there it reports to nothing.
      const reportProfiles = yield* browser.profileReporter;
      yield* reportProfiles({ profiles: [], defaultProfileId: DEFAULT_BROWSER_PROFILE_ID });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("registers as before elsewhere", () =>
    Effect.gen(function* () {
      const { registrations, activityBuilds } = yield* gatedServerBrowser({});

      // One agent-activity instance, shared with RunExecutionService by layer memoization.
      assert.strictEqual(activityBuilds, 1);
      assert.deepStrictEqual(registrations, [
        {
          clientId: SERVER_BROWSER_AUTOMATION_CLIENT_ID,
          environmentId,
          supportedOperations: [...PREVIEW_AUTOMATION_SERVER_OPERATIONS],
        },
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

/** The descriptor clients read the Environment's capabilities from. */
const descriptorOn = (environment: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
    return yield* serverEnvironment.getDescriptor;
  }).pipe(
    Effect.provide(
      ServerEnvironment.layer.pipe(
        Layer.provide(
          Layer.succeed(
            ServerSecretStore.ServerSecretStore,
            ServerSecretStore.ServerSecretStore.of({
              get: () => Effect.succeedNone,
              set: () => Effect.void,
              create: () => Effect.void,
              getOrCreateRandom: () => Effect.succeed(new Uint8Array()),
              remove: () => Effect.void,
            }),
          ),
        ),
        Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "lazurio-descriptor-" })),
        // An unmanaged server never checks its release channel.
        Layer.provide(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die("an unmanaged server checked for updates")),
          ),
        ),
      ),
    ),
    Effect.provideService(HostProcess.Arguments, ["node", "/nowhere/t3/dist/bin.mjs"]),
    Effect.provideService(HostProcess.IsExecutable, false),
    Effect.provideService(HostProcess.Platform, "linux"),
    Effect.provideService(HostProcess.Environment, environment),
  );

describe("the environment descriptor", () => {
  it.effect(
    "offers no server browser and no triage on a Lazurio Environment, and does elsewhere",
    () =>
      Effect.gen(function* () {
        const lazurio = yield* descriptorOn(lazurioEnvironment);
        const elsewhere = yield* descriptorOn({});

        assert.notProperty(lazurio.capabilities, "serverBrowser");
        assert.isTrue(elsewhere.capabilities.serverBrowser);
        // Triage compares against upstream's source (Lazurio/t3code#147).
        assert.notProperty(lazurio.capabilities, "triage");
        assert.isTrue(elsewhere.capabilities.triage);
        // Nothing else about the Environment changes.
        const {
          serverBrowser: _serverBrowser,
          triage: _triage,
          ...others
        } = elsewhere.capabilities;
        assert.deepStrictEqual(lazurio.capabilities, others);
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});
