import type { ClientSettings } from "@t3tools/contracts";

import { getLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";
import {
  migrateFollowUpToSteerOnce,
  StoredClientSettingsSchema,
  withFollowUpSteerMarker,
} from "./lazurio/followUpSteerMigration";

const CLIENT_SETTINGS_STORAGE_KEY = "t3code:client-settings:v1";

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

export function readBrowserClientSettings(): ClientSettings | null {
  if (!hasWindow()) {
    return null;
  }

  const stored = getLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, StoredClientSettingsSchema);
  if (stored === null) {
    return null;
  }
  const { settings, migrated } = migrateFollowUpToSteerOnce(stored);
  if (migrated) {
    try {
      writeBrowserClientSettings(settings);
    } catch {
      // Unwritten, the migration only runs again on the next read.
    }
  }
  return settings;
}

export function writeBrowserClientSettings(settings: ClientSettings): void {
  if (!hasWindow()) {
    return;
  }

  setLocalStorageItem(
    CLIENT_SETTINGS_STORAGE_KEY,
    withFollowUpSteerMarker(settings),
    StoredClientSettingsSchema,
  );
}
