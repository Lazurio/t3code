import * as NodeAssert from "node:assert/strict";

import { describe, it } from "vite-plus/test";

import {
  buildCodexAdditionalContext,
  buildCodexDeveloperInstructions,
} from "./CodexDeveloperInstructions.ts";

describe("buildCodexDeveloperInstructions", () => {
  it("appends runtime info after the mode instructions", () => {
    const instructions = runtimeInstructions({
      model: "gpt-5.3-codex",
      reasoningEffort: "high",
    });

    NodeAssert.match(
      buildCodexDeveloperInstructions("default"),
      /^<collaboration_mode># Collaboration Mode: Default/,
    );
    NodeAssert.match(instructions, /T3 Code/);
    NodeAssert.match(instructions, /Codex harness/);
    NodeAssert.match(instructions, /as gpt-5\.3-codex with high reasoning effort/);
  });

  it("describes Markdown media support in the runtime context in both modes", () => {
    {
      const instructions = runtimeInstructions({
        model: "gpt-5.3-codex",
        reasoningEffort: "high",
      });
      NodeAssert.match(
        instructions,
        /<runtime_info>.*embed images and videos.*Markdown.*<\/runtime_info>/,
      );
    }
  });

  it("includes runtime info alongside plan mode instructions", () => {
    const instructions = runtimeInstructions({
      model: "gpt-5.3-codex",
      reasoningEffort: "medium",
    });

    NodeAssert.match(buildCodexDeveloperInstructions("plan"), /^<collaboration_mode># Plan Mode/);
    NodeAssert.match(instructions, /as gpt-5\.3-codex with medium reasoning effort/);
  });

  it("varies with the model and effort of each turn", () => {
    const first = runtimeInstructions({
      model: "gpt-5.3-codex",
      reasoningEffort: "medium",
    });
    const second = runtimeInstructions({
      model: "gpt-5.4",
      reasoningEffort: "high",
    });

    NodeAssert.notEqual(first, second);
  });

  it("flattens multiline metadata into single-line runtime info", () => {
    const instructions = runtimeInstructions({
      model: "gpt\n5.3\ncodex",
      reasoningEffort: " high\neffort ",
    });

    NodeAssert.match(instructions, /as gpt 5\.3 codex with high effort reasoning effort/);
    NodeAssert.doesNotMatch(instructions, /<runtime_info>[^<]*\n/);
  });
});

describe("T3 browser developer instructions", () => {
  const runtime = { model: "gpt-5.3-codex", reasoningEffort: "high" };

  it("prefers the product-native preview tools in both collaboration modes", () => {
    {
      const instructions = toolInstructions(runtime, true);
      NodeAssert.match(instructions, /t3-code/);
      NodeAssert.match(instructions, /preview_status/);
      NodeAssert.match(instructions, /preview_open/);
      NodeAssert.match(instructions, /Do not switch to global browser skills/);
    }
  });

  it("omits the browser block entirely when the preview tools are not attached", () => {
    for (const mode of ["default", "plan"] as const) {
      const instructions = toolInstructions(runtime, false);
      NodeAssert.doesNotMatch(instructions, /preview_status/);
      NodeAssert.doesNotMatch(instructions, /preview_open/);
      NodeAssert.doesNotMatch(instructions, /T3 Code collaborative browser/);
      // Steering away from other browser automation must go with the tools;
      // keeping it would leave the model talked out of its only option.
      NodeAssert.doesNotMatch(instructions, /Do not switch to global browser skills/);
      // The rest of the collaboration mode is untouched.
      NodeAssert.match(buildCodexDeveloperInstructions(mode), /<collaboration_mode>/);
      NodeAssert.match(buildCodexDeveloperInstructions(mode), /<\/collaboration_mode>/);
    }
  });

  it("tracks the turn's MCP configuration rather than defaulting to on", () => {
    NodeAssert.match(toolInstructions(runtime, true), /preview_open/);
    NodeAssert.doesNotMatch(toolInstructions(runtime, false), /preview_open/);
  });
});

// Lazurio overlay (root decision 0211): agents ask the user through request_user_input. The
// guidance travels in the turn's context, which reaches every model: a model whose catalog ships
// its own mode text, as GPT-6 models do, never sees T3's developer instructions.
describe("Asking the user", () => {
  const runtime = { model: "gpt-6-astra", reasoningEffort: "medium" };

  it("steers Default mode to request_user_input instead of a plain-text question", () => {
    const defaultMode = buildCodexDeveloperInstructions("default");
    NodeAssert.doesNotMatch(defaultMode, /plain-text question/);
    NodeAssert.doesNotMatch(defaultMode, /Never write a multiple choice question/);

    const questions = buildCodexAdditionalContext(runtime).lazurio_questions;
    NodeAssert.equal(questions?.kind, "application");
    // Also for a question the agent cannot continue without, not only optional ones.
    NodeAssert.match(questions?.value ?? "", /ask the user through the `request_user_input` tool/);
    NodeAssert.match(questions?.value ?? "", /not only for optional questions/);
    NodeAssert.match(questions?.value ?? "", /never ask for what you can find out yourself/);
    // Without the tool this turn, the question goes in the message with numbered options.
    NodeAssert.match(questions?.value ?? "", /numbered options and say that you are waiting/);
  });

  it("offers the options of the user's own decision without a recommendation", () => {
    const questions = buildCodexAdditionalContext(runtime).lazurio_questions?.value ?? "";
    NodeAssert.match(questions, /whether to publish your work/);
    NodeAssert.match(questions, /mark no option as recommended/);
  });

  it("goes with every turn, whatever T3 tools the turn has", () => {
    for (const tools of [true, false, { browser: false, device: true }]) {
      NodeAssert.ok(buildCodexAdditionalContext(runtime, tools).lazurio_questions);
    }
  });

  it("keeps Plan mode's own guidance on questions", () => {
    NodeAssert.match(
      buildCodexDeveloperInstructions("plan"),
      /Strongly prefer using the `request_user_input` tool to ask any questions\./,
    );
  });
});

function runtimeInstructions(runtime: Parameters<typeof buildCodexAdditionalContext>[0]) {
  return buildCodexAdditionalContext(runtime).t3_code_runtime!.value;
}
function toolInstructions(
  runtime: Parameters<typeof buildCodexAdditionalContext>[0],
  available: boolean,
) {
  return buildCodexAdditionalContext(runtime, available).t3_code_tools?.value ?? "";
}
