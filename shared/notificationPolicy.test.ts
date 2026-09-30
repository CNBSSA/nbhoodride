import { describe, it, expect } from "vitest";
import { quietMaySilence, RIDE_CRITICAL_NOTIFICATION_TYPES } from "./notificationPolicy";

describe("what a quiet preference may silence", () => {
  it("never the ride the person is on, a message about it, or money to act on", () => {
    for (const t of ["ride-cancelled", "driver-arrived", "ride-no-show", "ride_message", "ride-accepted", "ride-started", "payment-action-needed", "new-ride-request", "scheduled-ride-released", "sos"]) {
      expect(quietMaySilence(t), t).toBe(false);
    }
  });
  it("credits, groups forming and announcements", () => {
    for (const t of ["referral_credit", "open-group-joined", "circuit_run_claimed", "announcement", "promo", "unknown-type"]) {
      expect(quietMaySilence(t), t).toBe(true);
    }
  });
  it("the list is what the server sends, spelled as the server spells it", () => {
    expect(RIDE_CRITICAL_NOTIFICATION_TYPES.has("ride-cancelled")).toBe(true);
    expect(RIDE_CRITICAL_NOTIFICATION_TYPES.has("ride_cancelled")).toBe(false);
  });
});
