/**
 * Lazurio overlay (root decision 0210, evening addendum, point 5): who a session acts as, a claim
 * signed into its token (`act` in SessionStore.ts) that no message can make. What Buddy does shows
 * „Buddy za <user>“ and Delegace's wake in Buddy's thread is hidden. The kinds are a closed set, as a
 * free label would let any session call itself the person; `forAccusative` is the name after „za“.
 */
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** One line of a label: no control, format or separator characters, nothing to trim. */
const isLabelLine = Schema.makeFilter(
  (value: string) =>
    value === value.trim() && !/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/u.test(value),
  { expected: "a name on one line, without control or formatting characters" },
);
export const ACTING_SENDER_NAME_MAX_LENGTH = 64;
const SenderName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(ACTING_SENDER_NAME_MAX_LENGTH),
  isLabelLine,
);

export const ActingSender = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("buddy"),
    for: SenderName,
    forAccusative: Schema.optionalKey(SenderName),
  }),
  Schema.Struct({ kind: Schema.Literal("delegace") }),
]);
export type ActingSender = typeof ActingSender.Type;

const decodeSender = Schema.decodeUnknownOption(ActingSender, { onExcessProperty: "error" });

export class ActingSenderEnvironmentError extends Schema.TaggedError<ActingSenderEnvironmentError>()(
  "ActingSenderEnvironmentError",
  { message: Schema.String },
) {}

const refused = (message: string) => Effect.fail(new ActingSenderEnvironmentError({ message }));

const ActingSenderVariables = Config.all({
  sender: Config.String("T3CODE_ACTING_SENDER").pipe(Config.option),
  for: Config.String("T3CODE_ACTING_FOR").pipe(Config.option),
  forAccusative: Config.String("T3CODE_ACTING_FOR_ACCUSATIVE").pipe(Config.option),
});

/**
 * Who an agent command acts as, from its environment: `T3CODE_ACTING_SENDER=buddy` with
 * `T3CODE_ACTING_FOR` (and optionally `T3CODE_ACTING_FOR_ACCUSATIVE`), or `=delegace`. Unset (or
 * empty) it acts as the Environment's user; anything else is refused, so it never acts unmarked.
 */
export const actingSenderFromEnvironment: Effect.Effect<
  Option.Option<ActingSender>,
  ActingSenderEnvironmentError
> = Effect.gen(function* () {
  const variables = yield* ActingSenderVariables.pipe(
    Effect.mapError(
      () =>
        new ActingSenderEnvironmentError({
          message: "T3CODE_ACTING_SENDER and its names could not be read from the environment.",
        }),
    ),
  );
  const named = Option.isSome(variables.for) || Option.isSome(variables.forAccusative);
  if (Option.isNone(variables.sender)) {
    return named
      ? yield* refused(
          "T3CODE_ACTING_FOR and T3CODE_ACTING_FOR_ACCUSATIVE need T3CODE_ACTING_SENDER=buddy.",
        )
      : Option.none();
  }
  const kind = variables.sender.value;
  if (kind === "delegace") {
    if (named)
      return yield* refused(
        "Delegace acts for no one by name: unset T3CODE_ACTING_FOR and T3CODE_ACTING_FOR_ACCUSATIVE.",
      );
    return Option.some({ kind: "delegace" } satisfies ActingSender);
  }
  if (kind !== "buddy") return yield* refused("T3CODE_ACTING_SENDER must be buddy or delegace.");
  if (Option.isNone(variables.for))
    return yield* refused("T3CODE_ACTING_SENDER=buddy needs T3CODE_ACTING_FOR, the user's name.");
  const sender = decodeSender({
    kind,
    for: variables.for.value.trim(),
    ...(Option.isSome(variables.forAccusative)
      ? { forAccusative: variables.forAccusative.value.trim() }
      : {}),
  });
  if (Option.isNone(sender))
    return yield* refused(
      `T3CODE_ACTING_FOR and T3CODE_ACTING_FOR_ACCUSATIVE must each be a name of 1 to ${ACTING_SENDER_NAME_MAX_LENGTH} characters on one line.`,
    );
  return sender;
});
