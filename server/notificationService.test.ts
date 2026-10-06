import { describe, it, expect, vi, beforeEach } from "vitest";

const store = {
  createInAppNotification: vi.fn(async (row: any) => ({ id: "n1", ...row })),
  getUserRidePreferences: vi.fn(async () => ({ calmRideMode: "gentle", minimizeNotifications: true, preferredLanguage: "en" })),
  getPushSubscriptionsByUser: vi.fn(async () => [{ endpoint: "https://push.example/abc", keys: {} }]),
  deletePushSubscription: vi.fn(async () => {}),
};
vi.mock("./storage", () => ({ storage: store }));
const sendPush = vi.fn(async () => {});
vi.mock("./pushService", () => ({ sendPushToSubscriptions: (...args: any[]) => sendPush(...args) }));

const { deliverUserNotification } = await import("./notificationService");
const flush = () => new Promise((r) => setTimeout(r, 0));

// Reliability audit 2026-09-29: calm mode silenced every push, including the
// driver cancelling or standing outside. The in-app row is always written;
// what the preference decides is only the push, and only for routine kinds.
describe("a rider who asked for quiet", () => {
  beforeEach(() => { sendPush.mockClear(); store.createInAppNotification.mockClear(); });

  it("is still pushed when their driver cancels, arrives, or writes to them", async () => {
    for (const type of ["ride-cancelled", "driver-arrived", "ride-no-show", "ride_message"]) {
      sendPush.mockClear();
      await deliverUserNotification("rider-1", { type, title: "t", body: "b" });
      await flush();
      expect(sendPush, type).toHaveBeenCalledTimes(1);
    }
  });

  it("is not pushed for a referral credit or a group forming", async () => {
    for (const type of ["referral_credit", "open-group-joined", "circuit_run_claimed"]) {
      sendPush.mockClear();
      const row = await deliverUserNotification("rider-1", { type, title: "t", body: "b" });
      await flush();
      expect(sendPush, type).not.toHaveBeenCalled();
      expect(row.type).toBe(type); // the in-app row is still there to read later
    }
  });

  it("an explicit flag still overrides the policy either way", async () => {
    await deliverUserNotification("rider-1", { type: "referral_credit", title: "t", body: "b", bypassQuietPreferences: true });
    await flush();
    expect(sendPush).toHaveBeenCalledTimes(1);
    sendPush.mockClear();
    await deliverUserNotification("rider-1", { type: "ride-cancelled", title: "t", body: "b", bypassQuietPreferences: false });
    await flush();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("a rider with no quiet preference is pushed for everything", async () => {
    store.getUserRidePreferences.mockResolvedValueOnce({ calmRideMode: "off", minimizeNotifications: false, preferredLanguage: "en" } as any);
    await deliverUserNotification("rider-2", { type: "referral_credit", title: "t", body: "b" });
    await flush();
    expect(sendPush).toHaveBeenCalledTimes(1);
  });
});
