// Lazurio overlay (LazurioPlatform#1179): a managed Environment whose Buddy folder appears only
// after its server started, as on a move from Buddy GEN3 to GEN4. It runs on its own dev stack,
// since the managed Folder would change every other scenario's server.
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NetService from "@t3tools/shared/Net";
import { expect } from "e2e";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";

import { APP_DIR, T3_HOME } from "../e2e.config.ts";
import { ScenarioError } from "./shell.ts";
import { prepareHome, startWebStack } from "./start-app.ts";
import { runPromise, test, WEB } from "./t3.ts";

const HOME = `${T3_HOME}-buddy-window`;
const FOLDERS = `${T3_HOME}-buddy-window-folders`;
const FOLDER = `${FOLDERS}/Lazurio`;
const BUDDY_FOLDER = `${FOLDERS}/Buddy`;

/** The managed stack, running until interrupted; `ready` gets its origin and pairing path. */
const runManagedStack = Effect.fn("scenario.buddyWindow.stack")(function* (
  ready: (stack: { readonly origin: string; readonly pairingPath: string }) => void,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const hostEnvironment = yield* HostProcess.Environment;
  yield* prepareHome(HOME);
  yield* fs.remove(FOLDERS, { recursive: true, force: true });
  yield* fs.makeDirectory(FOLDER, { recursive: true });
  const webPort = String(yield* (yield* NetService.NetService).reserveLoopbackPort());
  const origin = `http://127.0.0.1:${webPort}`;
  const stack = yield* startWebStack({
    checkout: APP_DIR,
    home: HOME,
    host: "127.0.0.1",
    webPort,
    // Named in full: the shell that runs the scenario may be a managed Environment itself.
    env: {
      PATH: `${path.join(HOME, "bin")}:${hostEnvironment.PATH ?? ""}`,
      HOME: hostEnvironment.HOME,
      ...(hostEnvironment.TMPDIR === undefined ? {} : { TMPDIR: hostEnvironment.TMPDIR }),
      T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "0",
      T3CODE_LAZURIO_FOLDER: FOLDER,
      T3CODE_LAZURIO_BUDDY_FOLDER: BUDDY_FOLDER,
      // This origin is Buddy's window, so the whole page is Buddy's surface.
      T3CODE_LAZURIO_BUDDY_ORIGIN: origin,
    },
    onLine: () => Effect.void,
  }).pipe(Effect.forkScoped);
  // The pairing link is printed after the startup made the Folder's project, and the environment
  // answers through Vite once both servers are up.
  const up = Effect.gen(function* () {
    const pairingPath = yield* fs.readFileString(path.join(HOME, "pairing-path"));
    yield* HttpClient.get(`${origin}/.well-known/t3/environment`).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
    );
    return pairingPath;
  }).pipe(
    Effect.mapError(() => new ScenarioError({ message: "The managed stack is not up yet." })),
    Effect.retry({ schedule: Schedule.spaced("1 second"), times: 300 }),
    Effect.provide(FetchHttpClient.layer),
  );
  const stopped = Fiber.join(stack).pipe(
    Effect.flatMap((code) =>
      Effect.fail(new ScenarioError({ message: `The managed stack exited with ${code}.` })),
    ),
  );
  ready({ origin, pairingPath: yield* Effect.raceFirst(up, stopped) });
  return yield* Fiber.join(stack);
});

function startManagedStack() {
  const started = Promise.withResolvers<{
    readonly origin: string;
    readonly pairingPath: string;
  }>();
  const fiber = Effect.runFork(
    runManagedStack(started.resolve).pipe(
      Effect.scoped,
      Effect.provide([NodeServices.layer, NodeCrypto.layer, NetService.layer]),
    ),
  );
  fiber.addObserver(() => started.reject(new Error("The managed stack stopped.")));
  return { ready: started.promise, stop: () => Effect.runPromise(Fiber.interrupt(fiber)) };
}

test(
  "Buddy's window opens Buddy's thread when the Buddy folder appeared after the server started",
  WEB,
  async ({ app, screen, browser }) => {
    const stack = startManagedStack();
    try {
      const { origin, pairingPath } = await stack.ready;
      await runPromise(
        Effect.flatMap(FileSystem.FileSystem, (fs) => fs.makeDirectory(BUDDY_FOLDER)),
      );

      await app.open(`${origin}${pairingPath}`);
      await expect(browser).not.toHaveURL(/\/pair(?:[?#]|$)/, { timeout: 60_000 });
      const notReady = screen.getByText(
        /^(Buddy is still being set up\.|Buddy se teprve instaluje\.)$/,
      );
      const composer = screen.getByRole("textbox");
      await expect(notReady.or(composer)).toBeVisible({ timeout: 60_000 });
      await app.screenshot("buddy-window");

      await expect(notReady).toBeHidden();
      await expect(composer).toBeVisible();
    } finally {
      await stack.stop();
    }
  },
);
