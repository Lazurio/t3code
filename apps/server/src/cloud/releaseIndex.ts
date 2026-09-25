import {
  cliReleaseIndexPageUrl,
  cliReleaseRepository,
  newestCliReleaseVersion,
  type CliReleaseChannel,
} from "@t3tools/shared/cliRelease";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

export class ReleaseIndexError extends Schema.TaggedError<ReleaseIndexError>()(
  "ReleaseIndexError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

const ReleaseIndex = Schema.Array(
  Schema.Struct({
    tag_name: Schema.String,
    draft: Schema.optional(Schema.Boolean),
  }),
);
const decodeReleaseIndex = Schema.decodeUnknownEffect(Schema.fromJsonString(ReleaseIndex));

const RELEASE_INDEX_TIMEOUT = Duration.seconds(30);
// Enough to walk past a long run of nightlies without hammering the API when
// a channel genuinely has nothing published.
const RELEASE_INDEX_MAX_PAGES = 10;

/** Asks GitHub for the newest published version on a channel, page by page. */
export const resolveNewestReleaseVersion = Effect.fn("cloud.release_index.resolve_newest")(
  function* (channel: CliReleaseChannel, repository?: string | undefined) {
    const httpClient = yield* HttpClient.HttpClient;
    const source = cliReleaseRepository(repository);
    for (let page = 1; page <= RELEASE_INDEX_MAX_PAGES; page += 1) {
      const body = yield* httpClient
        .execute(
          HttpClientRequest.get(cliReleaseIndexPageUrl(page, repository)).pipe(
            HttpClientRequest.setHeader("Accept", "application/vnd.github+json"),
          ),
        )
        .pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap((response) => response.text),
          Effect.mapError(
            () => new ReleaseIndexError({ reason: `Could not list t3 releases in ${source}.` }),
          ),
          Effect.timeoutOrElse({
            duration: RELEASE_INDEX_TIMEOUT,
            orElse: () =>
              Effect.fail(
                new ReleaseIndexError({ reason: `Timed out listing t3 releases in ${source}.` }),
              ),
          }),
        );
      const releases = yield* decodeReleaseIndex(body).pipe(
        Effect.mapError(
          () =>
            new ReleaseIndexError({
              reason: `The t3 release index of ${source} had an unexpected shape.`,
            }),
        ),
      );
      const version = newestCliReleaseVersion(releases, channel);
      if (version !== undefined) return version;
      if (releases.length === 0) break;
    }
    return yield* new ReleaseIndexError({
      reason: `No published ${channel} release was found in ${source}.`,
    });
  },
);
