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
import {
  buildCodexAdditionalContext,
  buildCodexDeveloperInstructions,
} from "../provider/CodexDeveloperInstructions.ts";

const DEFAULT_CODEX_SETTINGS = Schema.decodeSync(CodexSettings)({});

// The guidance travels in the turn's context, which reaches every model: a model whose catalog
// ships its own mode text, as GPT-6 models do, never sees T3's developer instructions.
describe("Asking the user", () => {
  const runtime = { model: "gpt-6-astra", reasoningEffort: "medium" };

  it("steers Default mode to request_user_input instead of a plain-text question", () => {
    const defaultMode = buildCodexDeveloperInstructions("default");
    assert.notMatch(defaultMode, /plain-text question/);
    assert.notMatch(defaultMode, /Never write a multiple choice question/);

    const questions = buildCodexAdditionalContext(runtime).lazurio_questions;
    assert.equal(questions?.kind, "application");
    // Also for a question the agent cannot continue without, not only optional ones.
    assert.match(questions?.value ?? "", /ask the user through the `request_user_input` tool/);
    assert.match(questions?.value ?? "", /not only for optional questions/);
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

  it("keeps Plan mode's own guidance on questions", () => {
    assert.match(
      buildCodexDeveloperInstructions("plan"),
      /Strongly prefer using the `request_user_input` tool to ask any questions\./,
    );
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
      assert.notInclude(
        params.collaborationMode?.settings.developer_instructions ?? "",
        "plain-text question",
      );
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
