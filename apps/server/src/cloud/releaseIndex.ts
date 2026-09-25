import {
  CLI_RELEASE_INDEX_PAGE_SIZE,
  CLI_RELEASE_REPOSITORY_ENV,
  cliReleaseChannelOf,
  cliReleaseIndexPageUrl,
  cliReleaseRepository,
  newestCliReleaseVersion,
  type CliReleaseChannel,
} from "@t3tools/shared/cliRelease";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { compareExactServiceVersions, isExactServiceVersion } from "./serviceProtocol.ts";

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
// Enough to walk past a long run of nightlies without hammering the API; a
// bounded walk of at most this many requests per lookup.
const RELEASE_INDEX_MAX_PAGES = 10;

/**
 * Asks GitHub for the newest published version on a channel. The index is
 * ordered by publish time, not version, so every page up to the last one (or
 * the page bound) is read and the highest version wins. Tags that are not
 * exact SemVer are dropped first: the launcher would refuse to install them.
 */
export const resolveNewestReleaseVersion = Effect.fn("cloud.release_index.resolve_newest")(
  function* (channel: CliReleaseChannel, repository?: string | undefined) {
    const httpClient = yield* HttpClient.HttpClient;
    const source = cliReleaseRepository(repository);
    const installable: Array<(typeof ReleaseIndex.Type)[number]> = [];
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
      installable.push(
        ...releases.filter(
          (release) =>
            release.tag_name.startsWith("v") && isExactServiceVersion(release.tag_name.slice(1)),
        ),
      );
      if (releases.length < CLI_RELEASE_INDEX_PAGE_SIZE) break;
    }
    const version = newestCliReleaseVersion(installable, channel);
    if (version !== undefined) return version;
    return yield* new ReleaseIndexError({
      reason: `No published ${channel} release was found in ${source}.`,
    });
  },
);

/** Opts a managed server out of checking for updates, for hosts without GitHub access. */
const SERVER_UPDATE_CHECK_ENABLED_ENV = "T3CODE_UPDATE_CHECK_ENABLED";
const SERVER_UPDATE_CHECK_INTERVAL = Duration.hours(6);

/**
 * The newest release on `currentVersion`'s channel in the release repository
 * when it is strictly newer than `currentVersion`, else undefined. Uses the
 * same precedence the service launcher enforces, so an advertised version is
 * one the launcher will accept.
 */
export const checkServerUpdate = Effect.fn("cloud.release_index.check_server_update")(function* (
  currentVersion: string,
  repository?: string | undefined,
) {
  const newest = yield* resolveNewestReleaseVersion(
    cliReleaseChannelOf(currentVersion),
    repository,
  );
  return compareExactServiceVersions(newest, currentVersion) > 0 ? newest : undefined;
});

/**
 * Keeps the answer of {@link checkServerUpdate} current for the lifetime of
 * the scope: checked at startup and then every few hours, retrying a failed
 * check with backoff and keeping the previous answer meanwhile.
 *
 * Only a server that can install the answer checks: one managed by the boot
 * service launcher, unless the operator turned the check off. Preview builds
 * never check, since preview is never offered as an update.
 */
export const watchAvailableServerUpdate = Effect.fn("cloud.release_index.watch_server_update")(
  function* (input: { readonly managed: boolean; readonly currentVersion: string }) {
    const available = yield* SubscriptionRef.make<string | undefined>(undefined);
    // Eligibility first: a server that never checks must not fail on the flag.
    if (!input.managed || cliReleaseChannelOf(input.currentVersion) === "preview") {
      return available;
    }
    const enabled = yield* Config.boolean(SERVER_UPDATE_CHECK_ENABLED_ENV).pipe(
      Config.withDefault(true),
    );
    if (!enabled) return available;

    const repository = Option.getOrUndefined(
      yield* Config.string(CLI_RELEASE_REPOSITORY_ENV).pipe(Config.option),
    );
    yield* checkServerUpdate(input.currentVersion, repository).pipe(
      Effect.flatMap((version) => SubscriptionRef.set(available, version)),
      Effect.tapError((error) =>
        Effect.logWarning("Could not check for a server update", { reason: error.reason }),
      ),
      Effect.retry({
        schedule: Schedule.exponential("1 minute").pipe(
          Schedule.modifyDelay(({ duration }) =>
            Effect.succeed(Duration.min(duration, SERVER_UPDATE_CHECK_INTERVAL)),
          ),
        ),
      }),
      Effect.repeat(Schedule.spaced(SERVER_UPDATE_CHECK_INTERVAL)),
      Effect.forkScoped,
    );
    return available;
  },
);
