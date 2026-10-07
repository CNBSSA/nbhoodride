import { describe, expect, it } from "vitest";
import { nextWeeklyOccurrence } from "./recurringRide";
import { zonedParts } from "./weeklyPlan";

describe("nextWeeklyOccurrence (on the rider's Eastern clock)", () => {
  it("returns later today when the time is still ahead", () => {
    const from = new Date("2026-07-24T14:00:00Z"); // Friday 10:00 EDT
    const next = nextWeeklyOccurrence({ dayOfWeek: 5, preferredHour: 23, preferredMinute: 30 }, from);
    expect(next.toISOString()).toBe("2026-07-25T03:30:00.000Z"); // Friday 23:30 EDT
    const p = zonedParts(next);
    expect([p.weekday, p.h, p.min]).toEqual([5, 23, 30]);
  });

  it("skips to next week when today's slot already passed", () => {
    const from = new Date("2026-07-25T03:45:00Z"); // Friday 23:45 EDT (already Saturday in UTC)
    const next = nextWeeklyOccurrence({ dayOfWeek: 5, preferredHour: 23, preferredMinute: 30 }, from);
    expect(next.toISOString()).toBe("2026-08-01T03:30:00.000Z"); // the next Friday 23:30 EDT
  });

  it("books 9 AM Eastern, not 9 AM UTC, on a server that runs on UTC", () => {
    const from = new Date("2026-10-06T07:30:00Z"); // Tuesday 03:30 EDT
    const next = nextWeeklyOccurrence({ dayOfWeek: 3, preferredHour: 9, preferredMinute: 0 }, from);
    expect(next.toISOString()).toBe("2026-10-07T13:00:00.000Z"); // Wednesday 9:00 EDT
  });

  it("keeps the wall-clock time across the change to standard time", () => {
    const from = new Date("2026-10-30T12:00:00Z"); // Friday before DST ends (1 Nov)
    const next = nextWeeklyOccurrence({ dayOfWeek: 1, preferredHour: 9, preferredMinute: 0 }, from);
    expect(next.toISOString()).toBe("2026-11-02T14:00:00.000Z"); // Monday 9:00 EST
  });
});
