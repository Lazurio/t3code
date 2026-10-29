import { ClientSettingsSchema, type ClientSettings } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/**
 * The Admin's decision of 2026-10-28 (Lazurio/t3code#140): a `queue` saved before the
 * v0.1.3 line becomes `steer` once. Every write on the line stores the marker next to
 * the settings, so a `queue` chosen afterwards sticks.
 */
export const StoredClientSettingsSchema = Schema.Struct({
  ...ClientSettingsSchema.fields,
  lazurioFollowUpSteer: Schema.optionalKey(Schema.Literal(true)),
});
type StoredClientSettings = typeof StoredClientSettingsSchema.Type;

export function withFollowUpSteerMarker(settings: ClientSettings): StoredClientSettings {
  return { ...settings, lazurioFollowUpSteer: true };
}

export function migrateFollowUpToSteerOnce(stored: StoredClientSettings): {
  readonly settings: ClientSettings;
  readonly migrated: boolean;
} {
  const { lazurioFollowUpSteer, ...settings } = stored;
  if (lazurioFollowUpSteer === true || settings.followUpBehavior !== "queue") {
    return { settings, migrated: false };
  }
  return { settings: { ...settings, followUpBehavior: "steer" }, migrated: true };
}
