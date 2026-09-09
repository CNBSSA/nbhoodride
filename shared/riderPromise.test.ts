import { describe, expect, it } from "vitest";
import {
  describeAppHealth,
  formatRiderPromiseReview,
  isReviewDue,
  localDayKey,
  reviewVerdict,
  reviewWindow,
  type RiderPromiseMetrics,
} from "./riderPromise";

const quietAhead = { unclaimedNext24h: 0, unclaimedInDangerWindow: 0, unclaimedPlanRides: 0, activePlans: 0 };
const healthy = { appErrors: 0, crashes: 0, serverErrors: 0, peopleAffected: 0 };
const base: RiderPromiseMetrics = {
  booked: 4, delivered: 4, failed: 0, riderCancelled: 0, strandings: 0, nearMisses: 0,
  fareDeviations: [], latePickups: 0, worstLateMinutes: 0, ahead: quietAhead,
  appHealth: healthy, pagedAhead: { paged: 0, delivered: 0 },
};

describe("reviewWindow", () => {
  it("at 4:00 AM Eastern looks back on the previous Eastern day (EDT)", () => {
    // 2026-09-07 04:00 EDT = 08:00Z
    const w = reviewWindow(new Date("2026-09-07T08:00:00Z"));
    expect(w.dayKey).toBe("2026-09-06");
    expect(w.dayLabel).toBe("Sun, Sep 6");
    expect(w.start.toISOString()).toBe("2026-09-06T04:00:00.000Z"); // Sep 6 00:00 EDT
    expect(w.end.toISOString()).toBe("2026-09-07T04:00:00.000Z");
  });
  it("handles the DST change day (Nov 1 2026, 25 hours long)", () => {
    // 2026-11-02 04:00 EST = 09:00Z
    const w = reviewWindow(new Date("2026-11-02T09:00:00Z"));
    expect(w.dayKey).toBe("2026-11-01");
    expect(w.start.toISOString()).toBe("2026-11-01T04:00:00.000Z"); // Nov 1 00:00 EDT
    expect(w.end.toISOString()).toBe("2026-11-02T05:00:00.000Z"); // Nov 2 00:00 EST
  });
  it("just before Eastern midnight still reviews the day before yesterday's boundary correctly", () => {
    // 2026-09-06 23:30 EDT = 2026-09-07 03:30Z → local day is still Sep 6
    const now = new Date("2026-09-07T03:30:00Z");
    expect(localDayKey(now)).toBe("2026-09-06");
    expect(reviewWindow(now).dayKey).toBe("2026-09-05");
  });
});

describe("isReviewDue", () => {
  it("is due from 4:00 AM Eastern, not before", () => {
    expect(isReviewDue(new Date("2026-09-07T07:59:00Z"))).toBe(false); // 3:59 EDT
    expect(isReviewDue(new Date("2026-09-07T08:00:00Z"))).toBe(true); // 4:00 EDT
    expect(isReviewDue(new Date("2026-09-07T20:00:00Z"))).toBe(true); // 4:00 PM — still today, still due
  });
});

describe("verdict and message", () => {
  const window = reviewWindow(new Date("2026-09-07T08:00:00Z"));

  it("every promise kept", () => {
    expect(reviewVerdict(base)).toBe("kept");
    const text = formatRiderPromiseReview(window, base);
    expect(text).toContain("🚦 Rider Promise Review — Sun, Sep 6");
    expect(text).toContain("🟢 Every promise kept.");
    expect(text).toContain("Rides: 4 booked · 4 delivered · 0 failed · 0 cancelled by rider");
    expect(text).toContain("every charge matched its quote");
    expect(text).toContain("every pickup within 5 min");
    expect(text).toContain("App health: no errors reached anyone");
    expect(text).toContain("Paged ahead: no ride needed a page before departure");
  });

  it("an app error on a day every ride was delivered is amber, not green", () => {
    const m = { ...base, appHealth: { appErrors: 2, crashes: 1, serverErrors: 1, peopleAffected: 2 }, pagedAhead: { paged: 1, delivered: 1 } };
    expect(reviewVerdict(m)).toBe("kept");
    const text = formatRiderPromiseReview(window, m);
    expect(text).toContain("🟡 Every ride promise kept, but 3 app errors reached people.");
    expect(text).toContain("App health: 2 app errors (1 crash), 1 server error · 2 people affected");
    expect(text).toContain("Paged ahead: 1 ride flagged before departure, 1 still delivered");
    expect(describeAppHealth({ appErrors: 1, crashes: 0, serverErrors: 0, peopleAffected: 0 })).toBe("1 app error · nobody signed in was affected");
  });

  it("a quiet day is not a green day", () => {
    const m = { ...base, booked: 0, delivered: 0 };
    expect(reviewVerdict(m)).toBe("quiet");
    expect(formatRiderPromiseReview(window, m)).toContain("⚪ No rides. Nothing to judge.");
  });

  it("a stranding or a fare mismatch is a broken promise, listed by ride", () => {
    const m: RiderPromiseMetrics = {
      ...base, booked: 5, delivered: 3, failed: 1, strandings: 1, nearMisses: 1,
      fareDeviations: [{ rideId: "abcdef1234567890", quoted: 23.21, charged: 7.12 }],
      latePickups: 1, worstLateMinutes: 12,
      ahead: { unclaimedNext24h: 3, unclaimedInDangerWindow: 1, unclaimedPlanRides: 2, activePlans: 1 },
    };
    expect(reviewVerdict(m)).toBe("broken");
    const text = formatRiderPromiseReview(window, m);
    expect(text).toContain("🔴 3 promises broken.");
    expect(text).toContain("Strandings: 1 (1 near-miss: no driver at T-5, driver still came)");
    expect(text).toContain("ride abcdef12: quoted $23.21, charged $7.12");
    expect(text).toContain("1 late pickup, worst 12 min");
    expect(text).toContain("3 scheduled rides still need a driver — 1 inside 12h ⚠️");
    expect(text).toContain("1 weekly plan active, 2 plan rides unclaimed");
    expect(text.length).toBeLessThan(4096);
  });

  it("rider cancellations never count against the promise", () => {
    const m = { ...base, booked: 6, delivered: 4, riderCancelled: 2 };
    expect(reviewVerdict(m)).toBe("kept");
  });
});
