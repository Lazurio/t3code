import { assert, describe, it } from "@effect/vitest";
import { MessageId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { buddyDaysOf, timeZoneOf } from "./buddySurfaceDays.ts";

const message = (id: string, iso: string, text: string) => ({
  id: MessageId.make(id),
  text,
  createdAt: DateTime.makeUnsafe(iso),
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
    assert.deepStrictEqual(buddyDaysOf(messages, "Europe/Prague"), [
      { day: "2026-10-22", firstMessageId: "m2", preview: "Ještě něco prosím", messages: 2 },
      { day: "2026-10-21", firstMessageId: "m1", preview: "Dobré ráno.", messages: 1 },
    ]);
    assert.deepStrictEqual(
      buddyDaysOf(messages, "UTC").map((day) => [day.day, day.messages]),
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
    );
    assert.strictEqual(day?.preview.length, 120);
    assert.isTrue(day?.preview.endsWith("…"));
    assert.strictEqual(
      buddyDaysOf([message("m2", "2026-10-22T09:00:00.000Z", "")], "UTC")[0]?.preview,
      "",
    );
  });

  it("counts a zone the runtime does not know as UTC", () => {
    assert.strictEqual(timeZoneOf("Europe/Prague"), "Europe/Prague");
    assert.strictEqual(timeZoneOf("Mars/Olympus"), "UTC");
    assert.strictEqual(timeZoneOf(null), "UTC");
  });
});
