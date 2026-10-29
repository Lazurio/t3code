import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { vi } from "vite-plus/test";

import * as ProcessRunner from "../processRunner.ts";
import * as ServerEnvironmentLabel from "../environment/ServerEnvironmentLabel.ts";

// A containerised Environment has a generated hostname, so Lazurio's Machines name it explicitly.
const runMock = vi.fn<ProcessRunner.ProcessRunner["Service"]["run"]>();

const layerTest = Layer.merge(
  FileSystem.layerNoop({}),
  Layer.succeed(
    ProcessRunner.ProcessRunner,
    ProcessRunner.ProcessRunner.of({
      run: (input) => runMock(input),
    }),
  ),
);

afterEach(() => {
  runMock.mockReset();
});

describe("resolveServerEnvironmentLabel", () => {
  it.effect("prefers the explicit T3CODE_ENVIRONMENT_LABEL", () =>
    Effect.gen(function* () {
      const result = yield* ServerEnvironmentLabel.resolveServerEnvironmentLabel({
        cwdBaseName: "t3code",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            layerTest,
            Layer.succeed(HostProcess.Platform, "linux"),
            Layer.succeed(HostProcess.Hostname, "buildbox"),
            Layer.succeed(HostProcess.Environment, {
              T3CODE_ENVIRONMENT_LABEL: "  Acme / Management  ",
            }),
          ),
        ),
      );

      expect(result).toBe("Acme / Management");
      expect(runMock).not.toHaveBeenCalled();
    }),
  );
});
