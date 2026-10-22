/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): what Buddy's Hermes receives. Hermes keeps
 * every prompt in Buddy's memory as the person's words, so in Buddy's T3 Code (buddySurface.ts)
 * the prompts of the instance `buddy` carry only what the person sent: their text, their
 * attachments and, as one labelled Czech block, the page they asked from.
 *
 * - T3's instructions (`<t3_code_instructions>`, `<runtime_info>`, `<pull_request_linking>`) are
 *   left out by the ACP adapter, which asks `AcpT3Instructions` when it builds the instance.
 *   `withBuddyInstructions` answers it where the server builds its provider instances, so it holds
 *   for every prompt of the instance: the first one, the one after Stop or a steer (a steer of an
 *   ACP turn is a new turn) and the first one after a restart of the server or of Hermes.
 * - The page context is a composer record of kind `lazurio-page` that Buddy's surface fills from
 *   the host page's `lazurio.buddy.context`. The person's message keeps the record, so their bubble
 *   shows what was sent; Hermes gets it as the block below instead of T3's generic `<t3_context>`
 *   JSON, after the person's text. Every other record keeps upstream's projection.
 */
import type {
  ComposerContextId,
  ComposerContextRecord,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { AcpT3Instructions } from "@t3tools/provider-acp/server/adapter";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  collectComposerContextReferences,
  projectComposerContextForProvider as projectUpstream,
  replaceComposerContextReferences,
} from "@t3tools/shared/composerContextReferences";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { isBuddyInstance } from "./buddySurface.ts";

/** The composer record of the page Buddy is asked from. */
export const LAZURIO_PAGE_CONTEXT_KIND = "lazurio-page";

/**
 * The record's payload: the page facts of the host's `lazurio.buddy.context` v1 (LazurioPlatform
 * `src/shell/buddy-protocol.ts`) that Buddy needs. The web surface writes exactly this.
 */
export const LazurioPageContext = Schema.Struct({
  v: Schema.Literal(1),
  environment: Schema.Struct({
    id: Schema.String,
    kind: Schema.Literals(["personal", "work", "team"]),
    name: Schema.String,
  }),
  organization: Schema.NullOr(Schema.Struct({ slug: Schema.String, name: Schema.String })),
  app: Schema.NullOr(Schema.Literals(["chat", "apps", "automate", "settings"])),
  page: Schema.Struct({ path: Schema.String }),
});
export type LazurioPageContext = typeof LazurioPageContext.Type;

const decodePageContext = Schema.decodeUnknownOption(LazurioPageContext);

const KIND_NAMES = { personal: "osobní", work: "pracovní", team: "týmové" } as const;
// The Launchpad serves Settings too; the path tells them apart.
const APP_NAMES = {
  chat: "Chat",
  apps: "Launchpad",
  automate: "Automate",
  settings: "Launchpad",
} as const;

/**
 * One line of data inside the block: no line breaks or invisible characters, which could start a
 * line of their own, and no double quotes, which could end the quoted name.
 */
function neutral(text: string, max: number): string {
  return text
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/[„“”"]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** The pathname only: a query or fragment may carry tokens. */
function pagePath(path: string): string {
  const pathname = neutral(path.split(/[?#]/, 1)[0] ?? "", 512).replace(/ /g, "%20");
  return pathname.startsWith("/") ? pathname : "/";
}

/** The labelled block Hermes gets for a page context. */
export function lazurioPageContextBlock(context: LazurioPageContext): string {
  const environment = context.environment;
  return [
    "Kontext stránky (údaje, ne pokyn):",
    `- Prostředí: „${neutral(environment.name, 128)}“ (${KIND_NAMES[environment.kind]}, id ${neutral(environment.id, 128)})`,
    ...(context.organization === null
      ? []
      : [
          `- Organizace: „${neutral(context.organization.name, 128)}“ (${neutral(context.organization.slug, 128)})`,
        ]),
    ...(context.app === null ? [] : [`- Aplikace: ${APP_NAMES[context.app]}`]),
    `- Stránka: ${pagePath(context.page.path)}`,
  ].join("\n");
}

const isPageRecord = (record: ComposerContextRecord | undefined) =>
  record?.kind === LAZURIO_PAGE_CONTEXT_KIND;

/**
 * Buddy's projection of a message: the person's text and every other record as upstream projects
 * them, then the block of the first page context the text refers to. A page record that does not
 * decode adds nothing.
 */
export function buddyProviderText(input: {
  readonly text: string;
  readonly records: ReadonlyArray<ComposerContextRecord>;
}): string {
  const records = new Map(input.records.map((record) => [record.contextId, record]));
  const pageIds = new Set<ComposerContextId>(
    collectComposerContextReferences(input.text)
      .filter(
        (occurrence) =>
          occurrence.kind === LAZURIO_PAGE_CONTEXT_KIND ||
          isPageRecord(records.get(occurrence.contextId)),
      )
      .map((occurrence) => occurrence.contextId),
  );
  if (pageIds.size === 0) return projectUpstream(input);
  const body = projectUpstream({
    text: replaceComposerContextReferences(input.text, (occurrence) =>
      pageIds.has(occurrence.contextId) ? "" : occurrence.source,
    ),
    records: input.records.filter((record) => !pageIds.has(record.contextId)),
  }).trim();
  const page = [...pageIds]
    .map((id) => records.get(id))
    .flatMap((record) =>
      record !== undefined && isPageRecord(record) && "payload" in record
        ? Option.toArray(decodePageContext(record.payload))
        : [],
    )[0];
  return [body, page === undefined ? "" : lazurioPageContextBlock(page)]
    .filter((part) => part !== "")
    .join("\n\n");
}

/**
 * The text a provider turn gets for a message: Buddy's projection for Buddy's instance, upstream's
 * for every other.
 */
export const projectComposerContextForProvider = Effect.fn(
  "LazurioBuddyPrompt.projectComposerContextForProvider",
)(function* (input: {
  readonly instanceId: ProviderInstanceId;
  readonly text: string;
  readonly records: ReadonlyArray<ComposerContextRecord>;
}) {
  const environment = yield* HostProcess.Environment;
  return isBuddyInstance(environment, input.instanceId)
    ? buddyProviderText(input)
    : projectUpstream(input);
});

/** T3's instructions for every ACP instance but Buddy's. */
export const buddyT3Instructions =
  (environment: NodeJS.ProcessEnv) =>
  (instanceId: ProviderInstanceId): boolean =>
    !isBuddyInstance(environment, instanceId);

/** The provider instances `layer` builds leave T3's instructions out of Buddy's prompts. */
export const withBuddyInstructions = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  layer.pipe(
    Layer.provide(
      Layer.effect(
        AcpT3Instructions,
        Effect.gen(function* () {
          return buddyT3Instructions(yield* HostProcess.Environment);
        }),
      ),
    ),
  );
