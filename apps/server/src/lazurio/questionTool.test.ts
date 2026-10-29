import { assert, describe, it } from "@effect/vitest";
import { CodexSettings, ProviderInstanceId, ProviderSessionId, ThreadId } from "@t3tools/contracts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as CodexAdapterV2 from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import { buildCodexAdditionalContext } from "../provider/CodexDeveloperInstructions.ts";

const DEFAULT_CODEX_SETTINGS = Schema.decodeSync(CodexSettings)({});

// T3 sends no mode text of its own, so Codex's Default mode, which keeps the tool for optional
// questions and asks required ones in plain text, meets this guidance in the turn's context.
describe("Asking the user", () => {
  const runtime = { model: "gpt-6-astra", reasoningEffort: "medium" };

  it("overrides the mode's own text and asks through request_user_input", () => {
    const context = buildCodexAdditionalContext(runtime);
    const questions = context.lazurio_questions;
    assert.equal(questions?.kind, "application");
    assert.equal(Object.keys(context).at(-1), "lazurio_questions");
    assert.match(questions?.value ?? "", /ask the user through the `request_user_input` tool/);
    assert.match(questions?.value ?? "", /This overrides what your collaboration mode says/);
    assert.match(questions?.value ?? "", /instead of using the tool, use the tool anyway/);
    assert.match(questions?.value ?? "", /cannot safely go on without the answer/);
    assert.match(questions?.value ?? "", /never ask for what you can find out yourself/);
    // Without the tool this turn, the question goes in the message with numbered options.
    assert.match(questions?.value ?? "", /numbered options and say that you are waiting/);
  });

  it("offers the options of the user's own decision without a recommendation", () => {
    const questions = buildCodexAdditionalContext(runtime).lazurio_questions?.value ?? "";
    assert.match(questions, /whether to publish your work/);
    assert.match(questions, /mark no option as recommended/);
  });

  it("goes with every turn, whatever T3 tools the turn has", () => {
    for (const tools of [true, false, { browser: false, device: true }]) {
      assert.isDefined(buildCodexAdditionalContext(runtime, tools).lazurio_questions);
    }
  });

  it.effect("reaches a Default-mode turn with the T3 MCP server attached", () =>
    Effect.gen(function* () {
      const params = yield* CodexAdapterV2.buildCodexTurnStartParams({
        nativeThreadId: "native-question-tool",
        codexInput: [{ type: "text", text: "hand this over" }],
        runtimePolicy: { runtimeMode: "full-access", interactionMode: "default", cwd: null },
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        hasT3Mcp: true,
      });

      assert.equal(params.collaborationMode?.mode, "default");
      assert.include(
        params.additionalContext?.lazurio_questions?.value ?? "",
        "ask the user through the `request_user_input` tool",
      );
      // Codex supplies the mode's own instructions; the guidance above is all T3 adds.
      assert.isUndefined(params.collaborationMode?.settings.developer_instructions);
    }),
  );
});

describe("Codex's question tool in Default mode", () => {
  // The launch arguments follow the switch, so their own `-c` or `--disable` turns it off
  // without a release.
  it.effect("is switched on ahead of the launch arguments of every app-server", () =>
    Effect.gen(function* () {
      const spawnedArgs: Array<ReadonlyArray<string>> = [];
      // The spawn boundary: what the app-server would start with. Refusing keeps it unstarted.
      const spawner = ChildProcessSpawner.make((command) => {
        if (ChildProcess.isStandardCommand(command)) spawnedArgs.push(command.args);
        return Effect.fail(
          PlatformError.systemError({ _tag: "NotFound", module: "ChildProcess", method: "spawn" }),
        );
      });
      const factory = yield* CodexAdapterV2.CodexAppServerClientFactory.pipe(
        Effect.provide(CodexAdapterV2.layerAppServerClientFactory),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(
          ProviderEventLoggers.ProviderEventLoggers,
          ProviderEventLoggers.NoOpProviderEventLoggers,
        ),
      );
      const open = (environment: NodeJS.ProcessEnv) =>
        factory
          .open({
            instanceId: CodexAdapterV2.CODEX_DEFAULT_INSTANCE_ID,
            threadId: ThreadId.make("thread-question-tool"),
            providerSessionId: ProviderSessionId.make("provider-session-question-tool"),
            runtimePolicy: ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
              runtimeMode: "full-access",
              interactionMode: "default",
              cwd: "/workspace",
            }),
            settings: {
              ...DEFAULT_CODEX_SETTINGS,
              launchArgs: " -c features.default_mode_request_user_input=false ",
            },
            environment,
          })
          .pipe(Effect.scoped, Effect.exit);

      yield* open({});
      yield* open({ T3CODE_CODEX_LAUNCH_ARGS: " --disable default_mode_request_user_input " });

      const questionTool = ["-c", "features.default_mode_request_user_input=true"];
      assert.deepEqual(spawnedArgs, [
        [...questionTool, "app-server", "-c", "features.default_mode_request_user_input=false"],
        [...questionTool, "app-server", "--disable", "default_mode_request_user_input"],
      ]);
    }).pipe(Effect.provideService(HostProcess.Platform, "linux")),
  );
});
