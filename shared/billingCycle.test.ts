import { describe, expect, it } from "vitest";
import { MINIMUM_CHARGE, autoCharges, billingRunDue, billingWeekWindow, describeBillingStatus, previousBillingWeek, weekCharge, weekKeyOf } from "./billingCycle";
import type { StatementLine } from "./commercial";

describe("the billing week", () => {
  it("runs Monday to Monday, Eastern, named by its Monday", () => {
    // Wed 9 Sep 2026 is in the week that began Mon 7 Sep.
    expect(weekKeyOf(new Date("2026-09-09T15:00:00Z"))).toBe("2026-09-07");
    // Sunday belongs to the week that began the Monday before it.
    expect(weekKeyOf(new Date("2026-09-13T20:00:00Z"))).toBe("2026-09-07");
    // Monday itself starts a new week, in Eastern terms.
    expect(weekKeyOf(new Date("2026-09-14T05:00:00Z"))).toBe("2026-09-14");
    // 04:00 UTC on Monday is still Sunday evening in Eastern time.
    expect(weekKeyOf(new Date("2026-09-14T03:00:00Z"))).toBe("2026-09-07");
  });

  it("a window spans seven days and reads plainly", () => {
    const w = billingWeekWindow("2026-09-07");
    expect(w.label).toBe("Sep 7–13, 2026");
    expect(w.start.toISOString()).toBe("2026-09-07T04:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-09-14T04:00:00.000Z");
    expect(w.end.getTime() - w.start.getTime()).toBe(7 * 86_400_000);
  });

  it("a week that crosses a month or a year says both", () => {
    expect(billingWeekWindow("2026-09-28").label).toBe("Sep 28 – Oct 4, 2026");
    expect(billingWeekWindow("2026-12-28").label).toBe("Dec 28 – Jan 3, 2027");
  });

  it("survives the autumn clock change", () => {
    // The week of 26 Oct 2026 contains the end of daylight saving; it is still
    // seven calendar days, and 25 hours longer in real time.
    const w = billingWeekWindow("2026-10-26");
    expect(w.start.toISOString()).toBe("2026-10-26T04:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("rejects nonsense", () => {
    expect(() => billingWeekWindow("2026-W37")).toThrow();
    expect(() => billingWeekWindow("not-a-date")).toThrow();
  });

  it("the previous week is the finished one", () => {
    expect(previousBillingWeek(new Date("2026-09-14T14:00:00Z")).weekKey).toBe("2026-09-07");
    expect(previousBillingWeek(new Date("2026-09-09T14:00:00Z")).weekKey).toBe("2026-08-31");
  });
});

describe("when the run happens", () => {
  it("Monday from 9 AM Eastern, and no other time", () => {
    expect(billingRunDue(new Date("2026-09-14T13:00:00Z"))).toBe(true); // Mon 9:00 EDT
    expect(billingRunDue(new Date("2026-09-14T12:30:00Z"))).toBe(false); // Mon 8:30 EDT
    expect(billingRunDue(new Date("2026-09-15T13:00:00Z"))).toBe(false); // Tuesday
    expect(billingRunDue(new Date("2026-09-13T13:00:00Z"))).toBe(false); // Sunday
  });
  it("weekly debit charges itself; net terms never does", () => {
    expect(autoCharges("weekly_debit")).toBe(true);
    expect(autoCharges(undefined)).toBe(true);
    expect(autoCharges("net_terms")).toBe(false);
  });
});

const line = (over: Partial<StatementLine> = {}): StatementLine => ({
  jobNumber: 1, at: "2026-09-08T14:00:00.000Z", passenger: "Ada L.", from: "Bowie, MD", to: "Largo, MD",
  status: "completed", fare: "30.00", facilityFee: "4.00", waitFee: "0.00", ...over,
});

describe("what a week comes to", () => {
  it("sums the week and says what it is for", () => {
    const c = weekCharge([line(), line({ jobNumber: 2, waitFee: "2.50" }), line({ jobNumber: 3, status: "cancelled", cancellationFee: "7.00" })]);
    expect(c.amount).toBe(77.5);
    expect(c.chargeable).toBe(true);
    expect(c.reason).toBe("2 completed, 1 cancelled");
  });
  it("an empty week is not charged", () => {
    const c = weekCharge([]);
    expect(c.chargeable).toBe(false);
    expect(c.amount).toBe(0);
    expect(c.reason).toContain("No billable jobs");
  });
  it("a week under the minimum is carried, not charged", () => {
    const c = weekCharge([line({ status: "cancelled", cancellationFee: "0.00" })]);
    expect(c.chargeable).toBe(false);
    expect(c.reason).toContain(MINIMUM_CHARGE.toFixed(2));
  });
});

describe("what the desk is told", () => {
  it("each state in plain words", () => {
    expect(describeBillingStatus("paid", 77.5, "Sep 7–13, 2026")).toBe("$77.50 for Sep 7–13, 2026, paid");
    expect(describeBillingStatus("failed", "12", "Sep 7–13, 2026")).toContain("could not be collected");
    expect(describeBillingStatus("open", 5, "Sep 7–13, 2026")).toContain("not yet collected");
    expect(describeBillingStatus("charging", 5, "x")).toContain("in progress");
  });
});
