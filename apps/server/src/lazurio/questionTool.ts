/**
 * Lazurio overlay (root decision 0211): T3's Codex threads ask the user through
 * `request_user_input` in Default mode too. Codex offers it there only with a feature under
 * development, which T3's app-servers turn on (CodexAdapterV2.ts) without writing the user's
 * `config.toml` (0161), and every turn's context says to use it (CodexDeveloperInstructions.ts).
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

In T3 Code, ask the user through the \`request_user_input\` tool whenever you need their answer or decision, not only in your message: a question in prose is easy to miss, and the thread looks busy while it waits. T3 Code shows the question with its options and holds it until the user answers.

This overrides what your collaboration mode says about asking. Where it says to keep \`request_user_input\` for optional questions, or to ask a required question directly in plain text instead of using the tool, use the tool anyway: also when you cannot safely go on without the answer, and when the decision belongs to the user.

- Before you ask, do everything that does not depend on the answer, and never ask for what you can find out yourself.
- Put the context in your message before the question, and offer the options the tool asks for, the recommended one first. When the decision is the user's alone, such as whether to publish your work (merge, send or deploy it), mark no option as recommended and never take the decision for them, also when the question comes back without an answer.
- If \`request_user_input\` is not available to you (it is not listed, or a call says it is unavailable), ask in your message with numbered options and say that you are waiting for the answer and what waits for it.`;

/**
 * The guidance's entry in `turn/start.additionalContext`, which Codex gives every model. T3 sends
 * no mode text of its own, so it has to override Codex's Default-mode text on asking.
 */
export const codexAdditionalContext = {
  lazurio_questions: { kind: "application", value: CODEX_QUESTION_INSTRUCTIONS },
} as const;
