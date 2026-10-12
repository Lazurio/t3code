import type { FirstRunDecision } from "../onboarding/firstRun.logic";

export function managedFirstRunDecision(input: {
  hydrated: boolean;
  live: boolean;
  projectReady: boolean;
  completed: boolean;
}): { decision: FirstRunDecision; persistCompletion: boolean } {
  return {
    decision:
      !input.hydrated || !input.live || !input.projectReady
        ? "pending"
        : input.completed
          ? "app"
          : "wizard",
    persistCompletion: false,
  };
}
