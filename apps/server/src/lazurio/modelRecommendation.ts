/**
 * Lazurio overlay (LazurioPlatform F51): the Platform recommends Chat's model, T3 keeps the
 * person's preference. `lazurioManagedModelSelection` records the last default this wrote, so a
 * default the person set differs from it and stays, while an unset default or the previous
 * recommendation follows the new one.
 */
import { ModelSelection, type ServerSettings } from "@t3tools/contracts";
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";

export const MODEL_RECOMMENDATION_ROUTE = "/api/lazurio/model-recommendation";
export const ModelRecommendationRequest = Schema.Struct({
  folder: Schema.String,
  selection: ModelSelection,
});

/** The settings with the recommended model applied where the person chose none of their own. */
export function reconcileRecommendedModel(
  current: ServerSettings,
  selection: NonNullable<ServerSettings["defaultModelSelection"]>,
): ServerSettings {
  return current.defaultModelSelection === null ||
    Equal.equals(current.defaultModelSelection, current.lazurioManagedModelSelection)
    ? { ...current, defaultModelSelection: selection, lazurioManagedModelSelection: selection }
    : current;
}
