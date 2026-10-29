import { OrchestrationMessageContext } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { pageRecordOf, withPageRecord, withPageReference } from "./buddySurfacePage";
import type { BuddyContext } from "./buddySurfaceProtocol";

const context = (overrides: Partial<BuddyContext> = {}): BuddyContext => ({
  lang: "cs",
  theme: "light",
  environment: { id: "example-person", kind: "personal", name: "Example Person" },
  organization: null,
  app: "apps",
  page: { path: "/apps" },
  guide: null,
  ...overrides,
});

const encodeContext = Schema.encodeUnknownSync(OrchestrationMessageContext);
const decodeContext = Schema.decodeUnknownSync(OrchestrationMessageContext);

describe("the page Buddy is asked from", () => {
  it("is one record per page, with the facts Buddy's T3 Code reads", () => {
    const record = pageRecordOf(context());
    expect(record).toMatchObject({
      version: 1,
      kind: "lazurio-page",
      label: "Apps /apps",
      payload: {
        v: 1,
        environment: { id: "example-person", kind: "personal", name: "Example Person" },
        organization: null,
        app: "apps",
        page: { path: "/apps" },
      },
    });
    expect(pageRecordOf(context())?.contextId).toBe(record?.contextId);
    expect(pageRecordOf(context({ page: { path: "/apps/chat" } }))?.contextId).not.toBe(
      record?.contextId,
    );
    expect(pageRecordOf(context({ app: null, lang: "en" }))?.label).toBe("Example Person /apps");
    expect(pageRecordOf(context({ environment: null }))).toBeNull();
  });

  it("travels with a message the person wrote, and is a valid message context", () => {
    const record = pageRecordOf(context());
    const text = withPageReference("Co tu vidím?", record);
    expect(text).toMatch(/^Co tu vidím\? \[Apps \/apps\]\(t3-context:\/\/v1\/lazurio-page\//);
    const sent = withPageRecord(undefined, record, text);
    expect(sent?.records).toEqual([record]);
    // The wire schema keeps it as a context record of its own kind.
    expect(decodeContext(encodeContext(sent)).records).toEqual([record]);
    // Once per message, even when asked twice.
    expect(withPageRecord(sent, record, text)).toBe(sent);
  });

  it("stays out of an empty message and of a message that does not refer to it", () => {
    const record = pageRecordOf(context());
    expect(withPageReference("  ", record)).toBe("  ");
    expect(withPageReference("Ahoj", null)).toBe("Ahoj");
    expect(withPageRecord(undefined, record, "Ahoj")).toBeUndefined();
    expect(withPageRecord(undefined, null, "Ahoj")).toBeUndefined();
  });
});
