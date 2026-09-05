import { beforeEach, describe, expect, it } from "vitest";
import { DEDUP_WINDOW_SECONDS, _resetRiderAlertState, shouldSend } from "./riderAlerts";

describe("riderAlerts de-duplication", () => {
  beforeEach(() => _resetRiderAlertState());

  it("sends the first occurrence with no suppressed count", () => {
    expect(shouldSend("login_pending_approval", "u1", 1_000_000)).toBe(0);
  });

  it("folds repeats of the same kind+key inside the window", () => {
    expect(shouldSend("login_pending_approval", "u1", 1_000_000)).toBe(0);
    expect(shouldSend("login_pending_approval", "u1", 1_000_000 + 60_000)).toBeNull();
    expect(shouldSend("login_pending_approval", "u1", 1_000_000 + 120_000)).toBeNull();
  });

  it("sends again after the window, reporting how many were folded", () => {
    const t0 = 1_000_000;
    shouldSend("booking_refused", "u1", t0);
    shouldSend("booking_refused", "u1", t0 + 1000);
    shouldSend("booking_refused", "u1", t0 + 2000);
    expect(shouldSend("booking_refused", "u1", t0 + DEDUP_WINDOW_SECONDS * 1000)).toBe(2);
  });

  it("does not fold across different riders or different kinds", () => {
    expect(shouldSend("booking_refused", "u1", 5)).toBe(0);
    expect(shouldSend("booking_refused", "u2", 6)).toBe(0);
    expect(shouldSend("no_driver_found", "u1", 7)).toBe(0);
  });
});
