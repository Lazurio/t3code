import { assert, describe, it } from "@effect/vitest";
import { MessageId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { buddyDaysOf, timeZoneOf } from "./buddySurfaceDays.ts";

const message = (id: string, iso: string, text: string) => ({
  id: MessageId.make(id),
  role: "user" as const,
  text,
  createdAt: DateTime.makeUnsafe(iso),
  createdBy: "user" as const,
  creationSource: "web" as const,
});
/** A message an agent sent from outside any thread, as Delegace sends its wake. */
const agentMessage = (id: string, iso: string, text: string) => ({
  ...message(id, iso, text),
  createdBy: "agent" as const,
  creationSource: "mcp" as const,
});

describe("the days of Buddy's conversation", () => {
  it("are the person's local days, newest first, each with its first message", () => {
    const messages = [
      message("m1", "2026-10-21T08:00:00.000Z", "Dobré ráno.\nCo dnes?"),
      // 00:30 on 22 October in Prague, still 21 October in UTC.
      message(
        "m2",
        "2026-10-21T22:30:00.000Z",
        "Ještě něco [Kontext stránky](t3-context://v1/lazurio-page/p-1) prosím",
      ),
      message("m3", "2026-10-22T09:00:00.000Z", "Druhá zpráva dne."),
    ];
    assert.deepStrictEqual(buddyDaysOf(messages, "Europe/Prague", null), [
      { day: "2026-10-22", firstMessageId: "m2", preview: "Ještě něco prosím", messages: 2 },
      { day: "2026-10-21", firstMessageId: "m1", preview: "Dobré ráno.", messages: 1 },
    ]);
    assert.deepStrictEqual(
      buddyDaysOf(messages, "UTC", null).map((day) => [day.day, day.messages]),
      [
        ["2026-10-22", 1],
        ["2026-10-21", 2],
      ],
    );
  });

  it("caps a long first line and keeps an empty message's day", () => {
    const [day] = buddyDaysOf(
      [message("m1", "2026-10-22T09:00:00.000Z", `\n\n${"a".repeat(200)}`)],
      "UTC",
      null,
    );
    assert.strictEqual(day?.preview.length, 120);
    assert.isTrue(day?.preview.endsWith("…"));
    assert.strictEqual(
      buddyDaysOf([message("m2", "2026-10-22T09:00:00.000Z", "")], "UTC", null)[0]?.preview,
      "",
    );
  });

  it("leave out Delegace's wake: a day opens with the person's first message, a wake-only day is none", () => {
    const messages = [
      agentMessage("wake-1", "2026-10-21T07:00:00.000Z", "Delegace: úkol 4711 doběhl."),
      message("m1", "2026-10-21T08:00:00.000Z", "Díky, co z toho plyne?"),
      agentMessage("buddy-1", "2026-10-21T09:00:00.000Z", "Napsal jsem Aleně."),
      agentMessage("wake-2", "2026-10-22T07:00:00.000Z", "Delegace: úkol 4712 doběhl."),
    ];
    const record = {
      at: Date.parse("2026-10-23T00:00:00.000Z"),
      senders: new Map([
        ["message:wake-1", { kind: "delegace" }],
        ["message:buddy-1", { kind: "buddy" }],
        ["message:wake-2", { kind: "delegace" }],
      ]),
    };
    assert.deepStrictEqual(buddyDaysOf(messages, "UTC", record), [
      { day: "2026-10-21", firstMessageId: "m1", preview: "Díky, co z toho plyne?", messages: 2 },
    ]);
  });

  it("leave out an agent's message the record has not answered yet, as the timeline holds it back", () => {
    const messages = [agentMessage("late", "2026-10-22T07:00:00.000Z", "Delegace: hotovo.")];
    const before = { at: Date.parse("2026-10-22T06:59:00.000Z"), senders: new Map() };
    assert.deepStrictEqual(buddyDaysOf(messages, "UTC", before), []);
    // Without a record every message shows, as the web shows it then.
    assert.strictEqual(buddyDaysOf(messages, "UTC", null)[0]?.firstMessageId, "late");
  });

  it("counts a zone the runtime does not know as UTC", () => {
    assert.strictEqual(timeZoneOf("Europe/Prague"), "Europe/Prague");
    assert.strictEqual(timeZoneOf("Mars/Olympus"), "UTC");
    assert.strictEqual(timeZoneOf(null), "UTC");
  });
});
