import { describe, expect, it } from "vitest";
import {
  GROUP_RATE_POLICY_SENTENCE,
  GROUP_REQUOTE_FREE_CANCEL_MINUTES,
  freeCancelWindowOpen,
  groupRateHolds,
  seatChangeNotice,
} from "./groupRatePolicy";

describe("group rate policy", () => {
  it("the rate holds at two or more seats, not one", () => {
    expect(groupRateHolds(3)).toBe(true);
    expect(groupRateHolds(2)).toBe(true);
    expect(groupRateHolds(1)).toBe(false);
    expect(groupRateHolds(0)).toBe(false);
  });

  it("the free-cancel window is open until its timestamp and closed after", () => {
    const now = new Date("2026-09-08T15:00:00Z");
    expect(freeCancelWindowOpen({ freeCancelUntil: new Date("2026-09-08T15:29:00Z") }, now)).toBe(true);
    expect(freeCancelWindowOpen({ freeCancelUntil: "2026-09-08T14:59:00Z" }, now)).toBe(false);
    expect(freeCancelWindowOpen({ freeCancelUntil: null }, now)).toBe(false);
    expect(freeCancelWindowOpen({}, now)).toBe(false);
  });

  it("tells the last rider they were re-quoted and can cancel free", () => {
    const n = seatChangeNotice({ remaining: 1, requoted: true, fare: 20 });
    expect(n.title).toBe("Your coworker group is down to you");
    expect(n.body).toContain("$20.00");
    expect(n.body).toContain(`${GROUP_REQUOTE_FREE_CANCEL_MINUTES} minutes`);
  });

  it("tells the last rider their fare is locked when the driver already confirmed", () => {
    const n = seatChangeNotice({ remaining: 1, requoted: false, fare: 14, locked: true });
    expect(n.body).toContain("driver has already confirmed");
    expect(n.body).toContain("$14.00");
  });

  it("tells remaining riders their fare is unchanged while the group still qualifies", () => {
    const n = seatChangeNotice({ remaining: 2, requoted: false, fare: "14.00" });
    expect(n.body).toBe("2 riders still in the group. Your fare is unchanged at $14.00.");
  });

  it("the published sentence states the rule, the window and the lock", () => {
    expect(GROUP_RATE_POLICY_SENTENCE).toContain("at least 2 seats");
    expect(GROUP_RATE_POLICY_SENTENCE).toContain("re-quoted at the solo fare");
    expect(GROUP_RATE_POLICY_SENTENCE).toContain("30 minutes");
    expect(GROUP_RATE_POLICY_SENTENCE).toContain("once the driver has confirmed, every fare is locked");
  });
});
