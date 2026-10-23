/**
 * Lazurio overlay (root decision 0210, evening addendum, point 5; plan DEV-6676): who a session
 * acts as, when it is not only the Environment's user. What Buddy writes or decides in a thread
 * shows „Buddy za <user>“, and what Delegace, the Environment's wake service, posts into Buddy's own
 * thread is not shown there at all (decided 2026-10-22): the record of who acted tells the web.
 *
 * The acting sender is a claim of the session, signed into its token beside the runtime-mode
 * ceiling (`act` in SessionStore.ts). Neither a message nor a session issued without it can claim
 * it. The agent commands issue their sessions with it when their environment names one (below).
 * Issuing a session takes the T3 home, which is the whole Environment's trust (root decision
 * 0172): no mark appears without a session that acts as Buddy or Delegace, and that only Buddy and
 * Delegace run with one is their rules' work, not a mechanism's.
 *
 * The kinds are a closed set without a free label, which would let any session call itself the
 * person. `for` is the person's name as it stands alone ("Tomáš", for "Buddy for Tomáš");
 * `forAccusative` the same name after Czech „za“ ("Tomáše", for „Buddy za Tomáše“).
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
 * Who an agent command acts as, from its environment:
 * - `T3CODE_ACTING_SENDER=buddy` with `T3CODE_ACTING_FOR=<name>` and, optionally,
 *   `T3CODE_ACTING_FOR_ACCUSATIVE=<name after „za“>`;
 * - `T3CODE_ACTING_SENDER=delegace`, which acts for no one by name.
 *
 * Unset (an empty value is unset, as for T3's other variables), the command acts as the
 * Environment's user alone. Anything else is refused, so a misconfigured agent fails loudly
 * instead of acting unmarked.
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
