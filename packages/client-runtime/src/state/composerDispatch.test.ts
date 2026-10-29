import { describe, expect, it } from "vite-plus/test";

import { resolveComposerDispatchMode } from "./composerDispatch.ts";

describe("resolveComposerDispatchMode", () => {
  it.each([
    { activeTurnDefault: "queue", alternateModifier: false, expected: "queue" },
    { activeTurnDefault: "steer", alternateModifier: true, expected: "queue" },
    { activeTurnDefault: "steer", alternateModifier: false, expected: "auto" },
    { activeTurnDefault: "queue", alternateModifier: true, expected: "auto" },
  ] as const)(
    "sends $expected while the turn starts with $activeTurnDefault (alternate: $alternateModifier)",
    ({ activeTurnDefault, alternateModifier, expected }) => {
      expect(
        resolveComposerDispatchMode({
          running: false,
          turnStarting: true,
          alternateModifier,
          activeTurnDefault,
        }),
      ).toBe(expected);
    },
  );
});
