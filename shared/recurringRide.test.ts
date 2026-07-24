import { describe, expect, it } from "vitest";
import { nextWeeklyOccurrence } from "./recurringRide";

describe("nextWeeklyOccurrence", () => {
  it("returns later today when time is still ahead", () => {
    const from = new Date("2026-07-24T10:00:00"); // Friday
    const next = nextWeeklyOccurrence(
      { dayOfWeek: 5, preferredHour: 23, preferredMinute: 30 },
      from,
    );
    expect(next.getDay()).toBe(5);
    expect(next.getHours()).toBe(23);
    expect(next.getMinutes()).toBe(30);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });

  it("skips to next week when today's slot already passed", () => {
    const from = new Date("2026-07-24T23:45:00"); // Friday night
    const next = nextWeeklyOccurrence(
      { dayOfWeek: 5, preferredHour: 23, preferredMinute: 30 },
      from,
    );
    expect(next.getDate()).toBe(from.getDate() + 7);
  });
});
