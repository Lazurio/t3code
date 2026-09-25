import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { resolveNewestReleaseVersion } from "./releaseIndex.ts";

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
