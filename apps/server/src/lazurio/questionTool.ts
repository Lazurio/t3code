/**
 * Lazurio overlay (root decision 0211, plan DEV-6676): agents ask people through the question
 * tool of their harness, not only in prose, where a question is easy to miss and the thread looks
 * busy while it waits. T3 Code shows a tool's question in the thread with its options and holds it
 * until the person answers; Claude's `AskUserQuestion` is there in every mode already.
 *
 * Codex offers `request_user_input` in Plan mode, and in Default mode only with its feature
 * `default_mode_request_user_input` (under development and off by default since Codex 0.106.0).
 * Two seams make T3's Codex threads ask with it, without writing the user's `config.toml` (root
 * decision 0161):
 *
 * - `CODEX_APP_SERVER_ARGS` lead every `codex app-server` T3 starts for its threads
 *   (CodexAdapterV2.ts) and turn the feature on. The launch arguments from the settings or
 *   `T3CODE_CODEX_LAUNCH_ARGS` follow, so their own `-c` or `--disable` still wins: the way to turn
 *   it off without a release.
 * - `codexAdditionalContext` tells the agent when and how to ask (CodexDeveloperInstructions.ts).
 *   It goes in T3's context of the turn and not in the collaboration mode: Codex drops T3's mode
 *   text for a model whose catalog ships its own, as GPT-6 models do, and their text keeps the tool
 *   for optional questions and has the agent go on when a question comes back without answers.
 */

/** Codex's feature that offers `request_user_input` in Default mode too, not only in Plan mode. */
export const DEFAULT_MODE_REQUEST_USER_INPUT = "default_mode_request_user_input";

/**
 * `-c` rather than `--enable`: a Codex that does not know the feature only warns (unless the
 * launch arguments add `--strict-config`), where `--enable` refuses to start, and a later `-c` in
 * the launch arguments can turn it off as well as `--disable`.
 */
export const CODEX_APP_SERVER_ARGS = ["-c", `features.${DEFAULT_MODE_REQUEST_USER_INPUT}=true`];

const CODEX_QUESTION_INSTRUCTIONS = `## Asking the user

In T3 Code, ask the user through the \`request_user_input\` tool whenever you need their answer or decision, not only in your message: a question in prose is easy to miss, and the thread looks busy while it waits. T3 Code shows the question with its options and holds it until the user answers, so use the tool also when you cannot safely go on without the answer or when the decision belongs to the user, not only for optional questions.

- Before you ask, do everything that does not depend on the answer, and never ask for what you can find out yourself.
- Put the context in your message before the question, and offer the options the tool asks for, the recommended one first. When the decision is the user's alone, such as whether to publish your work (merge, send or deploy it), mark no option as recommended and never take the decision for them, also when the question comes back without an answer.
- If \`request_user_input\` is not available to you (it is not listed, or a call says it is unavailable), ask in your message with numbered options and say that you are waiting for the answer and what waits for it.`;

/** The guidance's entry in `turn/start.additionalContext`, which Codex gives every model. */
export const codexAdditionalContext = {
  lazurio_questions: { kind: "application", value: CODEX_QUESTION_INSTRUCTIONS },
} as const;
