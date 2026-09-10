import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORG_TERMS,
  describeTerms,
  orgTerms,
  organizationCancellationFee,
  sanitizeTermsPatch,
  standingOccurrences,
  validateStandingSchedule,
  waitingCharge,
} from "./commercialTerms";

const now = new Date("2026-09-14T12:00:00Z"); // Mon 8:00 AM EDT

describe("orgTerms", () => {
  it("fills gaps from the defaults and clamps nonsense", () => {
    expect(orgTerms(null)).toEqual(DEFAULT_ORG_TERMS);
    expect(orgTerms({ lateCancelFee: "12", waitFreeMinutes: 15 })).toEqual({ ...DEFAULT_ORG_TERMS, lateCancelFee: 12, waitFreeMinutes: 15 });
    expect(orgTerms({ lateCancelFee: -5, waitFeePerMinute: 99, willCallLeadMinutes: 1 })).toEqual({ ...DEFAULT_ORG_TERMS, lateCancelFee: 0, waitFeePerMinute: 5, willCallLeadMinutes: 10 });
  });
  it("a patch keeps only known keys", () => {
    expect(sanitizeTermsPatch({ noShowFee: 15, bogus: 1 })).toEqual({ noShowFee: 15 });
  });
  it("describes itself in one sentence", () => {
    expect(describeTerms(DEFAULT_ORG_TERMS)).toBe("Cancel free up to 2 hours before pickup, or any time before a driver is assigned; $7.00 after that. No-show $10.00. Waiting is free for 10 minutes, then $0.50 a minute. A will-call return is dispatched at least 20 minutes out.");
  });
});

describe("organizationCancellationFee", () => {
  const t = DEFAULT_ORG_TERMS;
  it("costs nothing while no driver holds the job", () => {
    expect(organizationCancellationFee({ scheduledAt: new Date(now.getTime() + 30 * 60_000), driverId: null }, t, now).fee).toBe(0);
  });
  it("costs nothing at or beyond the free window, the late fee inside it", () => {
    expect(organizationCancellationFee({ scheduledAt: new Date(now.getTime() + 2 * 3_600_000), driverId: "d" }, t, now).fee).toBe(0);
    expect(organizationCancellationFee({ scheduledAt: new Date(now.getTime() + 119 * 60_000), driverId: "d" }, t, now).fee).toBe(7);
    expect(organizationCancellationFee({ scheduledAt: new Date(now.getTime() + 119 * 60_000), driverId: "d" }, { ...t, lateCancelFee: 12.5 }, now).fee).toBe(12.5);
  });
});

describe("waitingCharge", () => {
  const t = DEFAULT_ORG_TERMS;
  const arrived = new Date("2026-09-14T12:00:00Z");
  it("the first ten minutes are free, then fifty cents a minute", () => {
    expect(waitingCharge({ arrivedAt: arrived, startedAt: new Date(arrived.getTime() + 8 * 60_000) }, t)).toEqual({ waitMinutes: 8, waitFee: 0, billableMinutes: 0 });
    expect(waitingCharge({ arrivedAt: arrived, startedAt: new Date(arrived.getTime() + 25 * 60_000) }, t)).toEqual({ waitMinutes: 25, waitFee: 7.5, billableMinutes: 15 });
  });
  it("no stamps, no charge", () => {
    expect(waitingCharge({ arrivedAt: null, startedAt: arrived }, t).waitFee).toBe(0);
    expect(waitingCharge({ arrivedAt: arrived, startedAt: arrived }, t).waitFee).toBe(0);
  });
});

describe("standing orders", () => {
  it("validates days, times and the return", () => {
    expect(validateStandingSchedule({ days: [], departureHour: 6, departureMinute: 10, returnMode: "none" })).toMatchObject({ valid: false });
    expect(validateStandingSchedule({ days: [1, 3, 5], departureHour: 6, departureMinute: 10, returnMode: "fixed", returnHour: 5, returnMinute: 0 })).toMatchObject({ valid: false });
    expect(validateStandingSchedule({ days: [1, 3, 5], departureHour: 6, departureMinute: 10, returnMode: "fixed", returnHour: 10, returnMinute: 30 })).toEqual({ valid: true });
    expect(validateStandingSchedule({ days: [1], departureHour: 6, departureMinute: 10, returnMode: "will_call" })).toEqual({ valid: true });
  });
  it("Mon/Wed/Fri at 6:10 AM with a 10:30 return: a week ahead, Eastern, both legs, in order", () => {
    const occ = standingOccurrences({ days: [1, 3, 5], departureHour: 6, departureMinute: 10, returnMode: "fixed", returnHour: 10, returnMinute: 30 }, now, 7);
    // From Monday 8:00 AM: Monday's 6:10 has passed and its 10:30 is under 3h
    // away, so Wed and Fri both legs, then next Monday's 6:10 — its 10:30
    // return falls past the seven-day horizon (Monday 8:00 AM) and is booked
    // by a later sweep.
    expect(occ.map((o) => `${o.serviceDate} ${o.leg}`)).toEqual([
      "2026-09-16 out", "2026-09-16 return", "2026-09-18 out", "2026-09-18 return", "2026-09-21 out",
    ]);
    expect(occ[0].at.toISOString()).toBe("2026-09-16T10:10:00.000Z");
    expect(occ[1].at.toISOString()).toBe("2026-09-16T14:30:00.000Z");
  });
  it("a will-call order books only the outbound leg", () => {
    const occ = standingOccurrences({ days: [2], departureHour: 9, departureMinute: 0, returnMode: "will_call" }, now, 7);
    expect(occ.every((o) => o.leg === "out")).toBe(true);
    expect(occ.length).toBe(1);
  });
});
