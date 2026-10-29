import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderAuthState,
  type ChatGptHandoffInput,
  type ChatGptTransferredProfile,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import type { ProviderInstance } from "@t3tools/provider-core/server/driver";

import * as ServerConfig from "../config.ts";
import * as ProviderAuthService from "../provider/ProviderAuthService.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderSignIn from "./providerSignIn.ts";

const codex = ProviderInstanceId.make("codex_personal");
const claude = ProviderInstanceId.make("claudeAgent");
const state = { phase: "waiting" } as unknown as ProviderAuthState;
const profile = {} as ChatGptTransferredProfile;

/** Upstream's auth service as far as these tests reach it: it records what reached it. */
const makeUpstream = () => {
  const reached: string[] = [];
  const record = (call: string) =>
    Effect.sync(() => {
      reached.push(call);
      return state;
    });
  const layer = Layer.succeed(ProviderAuthService.ProviderAuthService, {
    reconnectProfile: ({ instanceId }) => record(`reconnect ${instanceId}`).pipe(Effect.as(null)),
    importProfile: ({ instanceId }) => record(`import ${instanceId}`),
    start: ({ instanceId }) => record(`start ${instanceId}`),
    complete: ({ instanceId }) => record(`complete ${instanceId}`),
    respond: ({ instanceId }) => record(`respond ${instanceId}`),
    cancel: ({ instanceId }) => record(`cancel ${instanceId}`),
    logout: ({ instanceId }) => record(`logout ${instanceId}`),
    subscribe: () => Stream.empty,
    tryHandlePromptCommand: () => Effect.succeed(false),
  });
  return { reached, layer };
};

const registryLayer = Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
  getInstance: (instanceId) =>
    Effect.succeed(
      instanceId === codex
        ? ({ instanceId, driverKind: ProviderDriverKind.make("codex") } as ProviderInstance)
        : instanceId === claude
          ? ({ instanceId, driverKind: ProviderDriverKind.make("claudeAgent") } as ProviderInstance)
          : undefined,
    ),
  listInstances: Effect.succeed([]),
  listUnavailable: Effect.succeed([]),
  streamChanges: Stream.empty,
  subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), (pubsub) => PubSub.subscribe(pubsub)),
});

const configLayer = (lazurioFolder: string | undefined) =>
  Layer.effect(
    ServerConfig.ServerConfig,
    Effect.map(ServerConfig.ServerConfig, (config) =>
      lazurioFolder === undefined ? config : { ...config, lazurioFolder },
    ),
  ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-provider-sign-in-" })));

const authWith = (lazurioFolder: string | undefined) => {
  const upstream = makeUpstream();
  const layer = ProviderSignIn.guard(upstream.layer).pipe(
    Layer.provide(registryLayer),
    Layer.provide(configLayer(lazurioFolder)),
    Layer.provide(NodeServices.layer),
  );
  return { reached: upstream.reached, layer };
};

it.effect("a Lazurio Environment never starts or imports T3's own Codex sign-in", () => {
  const { reached, layer } = authWith("/home/person/Lazurio");
  return Effect.gen(function* () {
    const auth = yield* ProviderAuthService.ProviderAuthService;
    const started = yield* auth.start({ instanceId: codex }, "owner").pipe(Effect.flip);
    assert.strictEqual(started._tag, "ProviderSetupError");
    assert.strictEqual(started.operation, "start");
    assert.strictEqual(started.detail, ProviderSignIn.LAZURIO_CODEX_SIGN_IN);
    const imported = yield* auth.importProfile({ instanceId: codex, profile }).pipe(Effect.flip);
    assert.strictEqual(imported.operation, "import");
    // The export only feeds a handoff, which a Lazurio Environment's Codex never takes.
    const exported = yield* auth
      .reconnectProfile({ instanceId: codex, methodId: "chatgpt" })
      .pipe(Effect.flip);
    assert.strictEqual(exported.operation, "export");
    assert.deepStrictEqual(reached, []);

    // Everything else stays upstream's: signing out, cancelling and other providers.
    yield* auth.logout({ instanceId: codex });
    yield* auth.cancel({ instanceId: codex, flowId: "flow" }, "owner");
    yield* auth.start({ instanceId: claude }, "owner");
    assert.deepStrictEqual(reached, [`logout ${codex}`, `cancel ${codex}`, `start ${claude}`]);
  }).pipe(Effect.provide(layer));
});

it.effect("without T3CODE_LAZURIO_FOLDER the sign-in is upstream's", () => {
  const { reached, layer } = authWith(undefined);
  return Effect.gen(function* () {
    const auth = yield* ProviderAuthService.ProviderAuthService;
    yield* auth.start({ instanceId: codex }, "owner");
    yield* auth.importProfile({ instanceId: codex, profile });
    yield* auth.reconnectProfile({ instanceId: codex, methodId: "chatgpt" });
    assert.deepStrictEqual(reached, [`start ${codex}`, `import ${codex}`, `reconnect ${codex}`]);
  }).pipe(Effect.provide(layer));
});

const handoffInput = (instanceId: ProviderInstanceId): ChatGptHandoffInput => ({
  instanceId,
  environmentId: EnvironmentId.make("environment-peer"),
  attemptId: "attempt-1",
  returnUrl: "http://127.0.0.1:3773/settings/providers",
  profile: null,
});

it.effect("a Lazurio Environment runs no ChatGPT handoff, for any instance", () =>
  Effect.gen(function* () {
    const started: string[] = [];
    const upstream = (instanceId: ProviderInstanceId) => () => {
      started.push(instanceId);
      return Stream.make("upstream");
    };
    const lazurio = { lazurioFolder: "/home/person/Lazurio" };
    for (const instanceId of [codex, claude, ProviderInstanceId.make("codex_on_a_peer")]) {
      const refused = yield* Stream.runCollect(
        ProviderSignIn.handoff(lazurio, handoffInput(instanceId), upstream(instanceId)),
      ).pipe(Effect.flip);
      assert.strictEqual(refused._tag, "ProviderSetupError");
      assert.strictEqual(refused.operation, "handoff");
      assert.strictEqual(refused.detail, ProviderSignIn.LAZURIO_CHATGPT_HANDOFF);
    }
    assert.deepStrictEqual(started, []);

    // Without T3CODE_LAZURIO_FOLDER the handoff is upstream's.
    const handed = yield* Stream.runCollect(
      ProviderSignIn.handoff({}, handoffInput(codex), upstream(codex)),
    );
    assert.deepStrictEqual(Array.from(handed), ["upstream"]);
    assert.deepStrictEqual(started, [codex]);
  }),
);
