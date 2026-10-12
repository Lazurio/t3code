import { ModelSelection } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
export const MODEL_RECOMMENDATION_ROUTE = "/api/lazurio/model-recommendation";
export const ModelRecommendationRequest = Schema.Struct({
  folder: Schema.String,
  selection: ModelSelection,
});
