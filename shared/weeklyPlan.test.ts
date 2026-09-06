import { describe, expect, it } from "vitest";
import {
  describePlanDays,
  describePlanTime,
  nextPlanOccurrence,
  normalizePlanDays,
  planFare,
  planOccurrences,
  validatePlanSchedule,
  weeklyTotal,
  zonedDateTime,
} from "./weeklyPlan";

const ET = "America/New_York";
const weekdays530pm = { days: [1, 2, 3, 4, 5], departureHour: 17, departureMinute: 30, timezone: ET };

describe("planFare", () => {
  it("takes 10% off the one-off quote, to the cent, and reconciles", () => {
    expect(planFare(23.21)).toEqual({ perRide: 20.89, savings: 2.32 });
    expect(planFare(7.65)).toEqual({ perRide: 6.89, savings: 0.76 });
    expect(weeklyTotal(20.89, 5)).toBe(104.45);
  });
  it("never goes negative on junk", () => {
    expect(planFare(-3)).toEqual({ perRide: 0, savings: 0 });
    expect(planFare(NaN)).toEqual({ perRide: 0, savings: 0 });
  });
});

describe("day handling", () => {
  it("normalizes, sorts and de-duplicates days", () => {
    expect(normalizePlanDays([5, "1", 1, 9, -1, 3.5])).toEqual([1, 5]);
    expect(normalizePlanDays("nope")).toEqual([]);
  });
  it("describes common patterns", () => {
    expect(describePlanDays([1, 2, 3, 4, 5])).toBe("Mon–Fri");
    expect(describePlanDays([1, 3, 5])).toBe("Mon, Wed, Fri");
    expect(describePlanDays([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(describePlanTime(17, 30)).toBe("5:30 PM");
    expect(describePlanTime(0, 5)).toBe("12:05 AM");
  });
  it("rejects an empty or malformed schedule with a reason", () => {
    expect(validatePlanSchedule({ days: [], departureHour: 9, departureMinute: 0 })).toMatchObject({ valid: false });
    expect(validatePlanSchedule({ days: [1], departureHour: 24, departureMinute: 0 })).toMatchObject({ valid: false });
    expect(validatePlanSchedule(weekdays530pm)).toEqual({ valid: true });
  });
});

describe("zonedDateTime", () => {
  it("resolves Eastern wall-clock times on both sides of DST", () => {
    // EDT (UTC-4): 5:30 PM ET = 21:30Z
    expect(zonedDateTime(2026, 9, 8, 17, 30, ET).toISOString()).toBe("2026-09-08T21:30:00.000Z");
    // EST (UTC-5): 5:30 PM ET = 22:30Z
    expect(zonedDateTime(2026, 12, 8, 17, 30, ET).toISOString()).toBe("2026-12-08T22:30:00.000Z");
  });
});

describe("planOccurrences", () => {
  it("books Monday to Friday at 5:30 PM Eastern for the coming week, skipping the weekend", () => {
    // Sunday Sept 6 2026, 10:00 ET (14:00Z)
    const from = new Date("2026-09-06T14:00:00Z");
    const until = new Date(from.getTime() + 7 * 86_400_000);
    const got = planOccurrences(weekdays530pm, from, until).map((d) => d.toISOString());
    expect(got).toEqual([
      "2026-09-07T21:30:00.000Z", // Mon
      "2026-09-08T21:30:00.000Z",
      "2026-09-09T21:30:00.000Z",
      "2026-09-10T21:30:00.000Z",
      "2026-09-11T21:30:00.000Z", // Fri
    ]);
  });
  it("skips today's departure when it is inside the 3-hour lead time", () => {
    // Monday Sept 7 2026, 3:00 PM ET — 5:30 PM is only 2.5h away
    const from = new Date("2026-09-07T19:00:00Z");
    const until = new Date(from.getTime() + 7 * 86_400_000);
    const got = planOccurrences(weekdays530pm, from, until).map((d) => d.toISOString());
    expect(got[0]).toBe("2026-09-08T21:30:00.000Z");
    expect(got).toHaveLength(4); // Tue–Fri; next Monday's 5:30 PM is past the 7-day window
    expect(got[3]).toBe("2026-09-11T21:30:00.000Z");
  });
  it("keeps 5:30 PM on the rider's clock across the DST change", () => {
    // Sat Oct 31 2026 → DST ends Sun Nov 1 2026
    const from = new Date("2026-10-31T12:00:00Z");
    const until = new Date(from.getTime() + 7 * 86_400_000);
    const got = planOccurrences(weekdays530pm, from, until).map((d) => d.toISOString());
    expect(got[0]).toBe("2026-11-02T22:30:00.000Z"); // Mon, now EST
  });
  it("nextPlanOccurrence is the first booked ride", () => {
    const from = new Date("2026-09-06T14:00:00Z");
    expect(nextPlanOccurrence(weekdays530pm, from)?.toISOString()).toBe("2026-09-07T21:30:00.000Z");
    expect(nextPlanOccurrence({ ...weekdays530pm, days: [] }, from)).toBeUndefined();
  });
});
