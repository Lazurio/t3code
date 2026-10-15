import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderAuthState,
  type ChatGptTransferredProfile,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import { ProviderAuthService } from "../provider/Services/ProviderAuthService.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
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
  const layer = Layer.succeed(ProviderAuthService, {
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

const registryLayer = Layer.succeed(ProviderInstanceRegistry, {
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
    const auth = yield* ProviderAuthService;
    const started = yield* auth.start({ instanceId: codex }, "owner").pipe(Effect.flip);
    assert.strictEqual(started._tag, "ProviderSetupError");
    assert.strictEqual(started.operation, "start");
    assert.strictEqual(started.detail, ProviderSignIn.LAZURIO_CODEX_SIGN_IN);
    const imported = yield* auth.importProfile({ instanceId: codex, profile }).pipe(Effect.flip);
    assert.strictEqual(imported.operation, "import");
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
    const auth = yield* ProviderAuthService;
    yield* auth.start({ instanceId: codex }, "owner");
    yield* auth.importProfile({ instanceId: codex, profile });
    assert.deepStrictEqual(reached, [`start ${codex}`, `import ${codex}`]);
  }).pipe(Effect.provide(layer));
});
