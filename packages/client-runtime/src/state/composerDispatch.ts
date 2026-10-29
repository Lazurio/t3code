export type ComposerDispatchMode = "auto" | "queue" | "steer" | "restart";
export type ActiveTurnComposerAction = Exclude<ComposerDispatchMode, "auto">;

interface ComposerDispatchInput {
  readonly running: boolean;
  readonly alternateModifier: boolean;
  readonly activeTurnDefault?: ActiveTurnComposerAction;
  /** False while the active turn cannot take steering input, such as during compaction. */
  readonly canSteer?: boolean;
  /** True while the active turn is still starting; automatic input steers in once it runs. */
  readonly turnStarting?: boolean;
}

export function resolveComposerDispatchMode(input: ComposerDispatchInput): ComposerDispatchMode {
  if (input.running) return activeTurnAction(input);
  // Lazurio: a starting turn takes "auto" input as a steer, so honor a Queue choice (Lazurio/t3code#170).
  return input.turnStarting === true && activeTurnAction(input) === "queue" ? "queue" : "auto";
}

function activeTurnAction(input: ComposerDispatchInput): ActiveTurnComposerAction {
  if (input.canSteer === false) return "queue";
  const defaultAction = input.activeTurnDefault ?? "steer";
  if (input.alternateModifier) return defaultAction === "queue" ? "steer" : "queue";
  return defaultAction;
}

export function alternateComposerDispatchAction(
  activeTurnDefault?: ActiveTurnComposerAction,
): ActiveTurnComposerAction {
  return resolveComposerDispatchMode({
    running: true,
    alternateModifier: true,
    ...(activeTurnDefault === undefined ? {} : { activeTurnDefault }),
  }) as ActiveTurnComposerAction;
}
