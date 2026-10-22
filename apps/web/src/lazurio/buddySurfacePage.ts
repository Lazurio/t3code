/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): the page Buddy is asked from, as a composer
 * record. Buddy's surface keeps the last valid page context its host sent (buddySurfaceFrame.ts)
 * and shows it as a chip above the composer, which the person can remove. While the chip is there,
 * a message the person writes carries the page as a record of kind `lazurio-page` with a reference
 * in its text. Buddy's T3 Code turns that into one labelled Czech block for Hermes, in place of
 * T3's generic context (apps/server/src/lazurio/buddyPrompt.ts reads exactly this payload). Pure:
 * no DOM.
 */
import type { OrchestrationMessageContext, UnknownContextRecord } from "@t3tools/contracts";
import {
  collectComposerContextReferences,
  sanitizeComposerContextLabel,
  toKindScopedComposerContextId,
} from "@t3tools/shared/composerContextReferences";

import { ensureInlineContextReferences } from "~/lib/composerContextReferences";
import type { BuddyContext } from "./buddySurfaceProtocol";

export const LAZURIO_PAGE_KIND = "lazurio-page";

const APP_NAMES = {
  cs: { chat: "Chat", apps: "Apps", automate: "Automate", settings: "Nastavení" },
  en: { chat: "Chat", apps: "Apps", automate: "Automate", settings: "Settings" },
} as const;

/** 32-bit FNV-1a, as eight hex digits: a short id that stays the same for the same page. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The record of the page in `context`: the same page gives the same record, so a message refers to
 * it by a stable id. None without an Environment, which a valid context always names.
 */
export function pageRecordOf(context: BuddyContext): UnknownContextRecord | null {
  const { environment, organization, app, page } = context;
  if (environment === null) return null;
  const facts = [
    environment.id,
    environment.kind,
    environment.name,
    organization?.slug ?? "",
    organization?.name ?? "",
    app ?? "",
    page.path,
  ];
  const place = app === null ? environment.name : APP_NAMES[context.lang][app];
  return {
    version: 1,
    kind: LAZURIO_PAGE_KIND,
    contextId: toKindScopedComposerContextId(LAZURIO_PAGE_KIND, fnv1a(facts.join("\u0000"))),
    label: sanitizeComposerContextLabel(`${place} ${page.path}`, LAZURIO_PAGE_KIND),
    payload: { v: 1, environment, organization, app, page },
  };
}

/** The prompt with a reference to the page, unless the person wrote nothing to send it with. */
export function withPageReference(prompt: string, record: UnknownContextRecord | null): string {
  if (record === null || prompt.trim() === "") return prompt;
  return ensureInlineContextReferences(prompt, [
    { kind: record.kind, contextId: record.contextId, label: record.label },
  ]);
}

/** The message's context with the page's record, when its text refers to the page. */
export function withPageRecord(
  context: OrchestrationMessageContext | undefined,
  record: UnknownContextRecord | null,
  text: string,
): OrchestrationMessageContext | undefined {
  if (record === null) return context;
  const referred = collectComposerContextReferences(text).some(
    (occurrence) => occurrence.contextId === record.contextId,
  );
  const records = context?.records ?? [];
  if (!referred || records.some((existing) => existing.contextId === record.contextId))
    return context;
  return { version: 1, records: [...records, record] };
}
