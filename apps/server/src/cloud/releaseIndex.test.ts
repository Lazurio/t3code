import { expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import {
  checkServerUpdate,
  resolveNewestReleaseVersion,
  watchAvailableServerUpdate,
} from "./releaseIndex.ts";

// Serves one page of GitHub's list-releases response per repository and
// records every URL asked for.
const releaseIndexClient = (
  pages: Record<string, ReadonlyArray<{ tag_name: string; draft?: boolean }>>,
  requested: string[] = [],
) =>
  HttpClient.make((request) =>
    Effect.sync(() => {
      requested.push(request.url);
      const url = new URL(request.url);
      const repository = /^\/repos\/([^/]+\/[^/]+)\/releases$/.exec(url.pathname)?.[1] ?? "";
      const releases = url.searchParams.get("page") === "1" ? (pages[repository] ?? []) : [];
      return HttpClientResponse.fromWeb(request, Response.json(releases));
    }),
  );

const acmeReleases = {
  "acme/t3code": [
    { tag_name: "v0.0.42-acme.1" },
    { tag_name: "v0.0.42-acme.3", draft: true },
    { tag_name: "v0.0.42-acme.2" },
    { tag_name: "v0.0.41-acme.7" },
  ],
};

const withEnv = (env: Record<string, string>) =>
  Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })));

it.effect("lists releases from the configured repository", () =>
  Effect.gen(function* () {
    const requested: string[] = [];
    const version = yield* resolveNewestReleaseVersion("stable", "acme/t3code").pipe(
      Effect.provideService(HttpClient.HttpClient, releaseIndexClient(acmeReleases, requested)),
    );
    expect(version).toBe("0.0.42-acme.2");
    expect(requested).toEqual([
      "https://api.github.com/repos/acme/t3code/releases?per_page=100&page=1",
    ]);

    const error = yield* resolveNewestReleaseVersion("nightly", "acme/t3code").pipe(
      Effect.provideService(HttpClient.HttpClient, releaseIndexClient(acmeReleases)),
      Effect.flip,
    );
    expect(error.message).toBe("No published nightly release was found in acme/t3code.");
  }),
);

it.effect("offers only a release newer than the running version", () =>
  Effect.gen(function* () {
    const check = (currentVersion: string) =>
      checkServerUpdate(currentVersion, "acme/t3code").pipe(
        Effect.provideService(HttpClient.HttpClient, releaseIndexClient(acmeReleases)),
      );
    expect(yield* check("0.0.42-acme.1")).toBe("0.0.42-acme.2");
    expect(yield* check("0.0.41")).toBe("0.0.42-acme.2");
    expect(yield* check("0.0.42-acme.2")).toBeUndefined();
    // A stable release outranks its prereleases, so nothing here is newer.
    expect(yield* check("0.0.42")).toBeUndefined();
  }),
);

it.effect("a managed server advertises the newer release on its channel", () =>
  Effect.gen(function* () {
    const available = yield* watchAvailableServerUpdate({
      managed: true,
      currentVersion: "0.0.42-acme.1",
    }).pipe(
      Effect.provideService(HttpClient.HttpClient, releaseIndexClient(acmeReleases)),
      withEnv({ T3CODE_RELEASE_REPOSITORY: "acme/t3code" }),
    );
    const version = yield* SubscriptionRef.changes(available).pipe(
      Stream.filter((value) => value !== undefined),
      Stream.runHead,
    );
    expect(version._tag === "Some" ? version.value : undefined).toBe("0.0.42-acme.2");
  }),
);

it.effect.each([
  { name: "an unmanaged server", managed: false, currentVersion: "0.0.1", env: {} },
  {
    name: "a server with the check turned off",
    managed: true,
    currentVersion: "0.0.1",
    env: { T3CODE_UPDATE_CHECK_ENABLED: "false" },
  },
  {
    name: "a preview build",
    managed: true,
    currentVersion: "0.0.1-preview.20260911.4",
    env: {},
  },
])("$name never checks", ({ managed, currentVersion, env }) =>
  Effect.gen(function* () {
    const available = yield* watchAvailableServerUpdate({ managed, currentVersion }).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die("unexpected update check")),
      ),
      withEnv(env),
    );
    expect(yield* SubscriptionRef.get(available)).toBeUndefined();
  }),
);
