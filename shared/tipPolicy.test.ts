import { describe, expect, it } from "vitest";
import { TIP_MAX, TIP_MIN, TIP_PRESETS, TIP_WINDOW_DAYS, describeTipRefusal, normalizeTip, tipRefusal } from "./tipPolicy";

const now = new Date("2026-09-18T12:00:00Z");
const ride = { status: "completed", paymentMethod: "card", paymentStatus: "paid_card", completedAt: "2026-09-17T12:00:00Z", tipAmount: "0.00", driverId: "d1", refundedAmount: null };

describe("tipRefusal", () => {
  it("allows a completed card ride within the window, tipped once", () => {
    expect(tipRefusal(ride, now)).toBeNull();
  });
  it("refuses what it should, with words", () => {
    expect(tipRefusal({ ...ride, status: "in_progress" }, now)).toBe("not_completed");
    expect(tipRefusal({ ...ride, paymentMethod: "cash" }, now)).toBe("not_card");
    expect(tipRefusal({ ...ride, paymentMethod: "invoice" }, now)).toBe("not_card");
    expect(tipRefusal({ ...ride, driverId: null }, now)).toBe("no_driver");
    expect(tipRefusal({ ...ride, paymentStatus: "settlement_failed" }, now)).toBe("not_settled");
    expect(tipRefusal({ ...ride, paymentStatus: "disputed" }, now)).toBe("not_settled");
    expect(tipRefusal({ ...ride, paymentStatus: "authorized" }, now)).toBe("not_settled");
    expect(tipRefusal({ ...ride, refundedAmount: "5.00" }, now)).toBe("refunded");
    expect(tipRefusal({ ...ride, tipAmount: "5.00" }, now)).toBe("already_tipped");
    expect(tipRefusal({ ...ride, tipAmount: 2 }, now)).toBe("already_tipped");
    expect(tipRefusal({ ...ride, completedAt: "2026-09-01T12:00:00Z" }, now)).toBe("window_closed");
    expect(tipRefusal({ ...ride, completedAt: null }, now)).toBe("window_closed");
    for (const why of ["not_completed", "not_card", "no_driver", "not_settled", "refunded", "already_tipped", "window_closed"] as const) {
      expect(describeTipRefusal(why).length).toBeGreaterThan(10);
    }
  });
  it("the window is a week, to the day", () => {
    expect(TIP_WINDOW_DAYS).toBe(7);
    const edge = new Date(new Date(ride.completedAt).getTime() + 7 * 86_400_000);
    expect(tipRefusal(ride, edge)).toBeNull();
    expect(tipRefusal(ride, new Date(edge.getTime() + 1000))).toBe("window_closed");
  });
});

describe("normalizeTip", () => {
  it("takes presets and any whole-cent amount in range", () => {
    for (const p of TIP_PRESETS) expect(normalizeTip(p)).toBe(p);
    expect(normalizeTip("4.5")).toBe(4.5);
    expect(normalizeTip(TIP_MIN)).toBe(1);
    expect(normalizeTip(TIP_MAX)).toBe(100);
    expect(normalizeTip(2.999)).toBe(3);
  });
  it("refuses nothing, too little, too much and nonsense", () => {
    expect(normalizeTip(0)).toBeNull();
    expect(normalizeTip(0.99)).toBeNull();
    expect(normalizeTip(100.01)).toBeNull();
    expect(normalizeTip(-5)).toBeNull();
    expect(normalizeTip("abc")).toBeNull();
    expect(normalizeTip(undefined)).toBeNull();
    expect(normalizeTip(Infinity)).toBeNull();
  });
});
