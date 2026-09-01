import { describe, expect, it } from "vitest";
import {
  checkScheduleTime,
  MIN_SCHEDULE_LEAD_HOURS,
  SCHEDULE_TOO_FAR_MESSAGE,
  SCHEDULE_TOO_SOON_MESSAGE,
} from "./schedulingPolicy";

const now = new Date("2026-09-01T12:00:00Z");
const hoursFromNow = (h: number) => new Date(now.getTime() + h * 3_600_000);

describe("checkScheduleTime", () => {
  it("accepts a pickup exactly at the minimum lead time", () => {
    expect(checkScheduleTime(hoursFromNow(MIN_SCHEDULE_LEAD_HOURS), now)).toEqual({ valid: true });
  });

  it("accepts a same-day pickup with more than the minimum notice", () => {
    expect(checkScheduleTime(hoursFromNow(5), now)).toEqual({ valid: true });
  });

  it("rejects a pickup with too little notice", () => {
    const res = checkScheduleTime(hoursFromNow(MIN_SCHEDULE_LEAD_HOURS - 0.5), now);
    expect(res).toEqual({ valid: false, error: SCHEDULE_TOO_SOON_MESSAGE });
  });

  it("rejects a pickup in the past", () => {
    const res = checkScheduleTime(hoursFromNow(-1), now);
    expect(res).toEqual({ valid: false, error: SCHEDULE_TOO_SOON_MESSAGE });
  });

  it("accepts an ISO-string time", () => {
    expect(checkScheduleTime(hoursFromNow(26).toISOString(), now)).toEqual({ valid: true });
  });

  it("accepts a late pickup on the last selectable calendar day", () => {
    expect(checkScheduleTime(hoursFromNow(30 * 24 + 11), now)).toEqual({ valid: true });
  });

  it("rejects a pickup beyond the booking horizon", () => {
    const res = checkScheduleTime(hoursFromNow(32 * 24), now);
    expect(res).toEqual({ valid: false, error: SCHEDULE_TOO_FAR_MESSAGE });
  });

  it("rejects an unparseable time", () => {
    expect(checkScheduleTime("not-a-date", now)).toEqual({ valid: false, error: "Invalid scheduled time." });
  });
});
