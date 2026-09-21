import { describe, expect, it } from "vitest";
import { DEFAULT_RIDE_PREFERENCES, ridePreferencesOrDefaults } from "./ridePreferences";

describe("ridePreferencesOrDefaults", () => {
  it("turns the null of an unauthorised request into a new rider's preferences", () => {
    // This is the crash: the app-wide language provider takes null for an
    // answer, both readers share the cache entry, and Profile read that null.
    expect(ridePreferencesOrDefaults(null)).toEqual(DEFAULT_RIDE_PREFERENCES);
    expect(ridePreferencesOrDefaults(null).calmRideMode).toBe("off");
  });

  it("does the same for nothing at all, and for something that is not preferences", () => {
    expect(ridePreferencesOrDefaults(undefined)).toEqual(DEFAULT_RIDE_PREFERENCES);
    expect(ridePreferencesOrDefaults("nonsense" as any)).toEqual(DEFAULT_RIDE_PREFERENCES);
    expect(ridePreferencesOrDefaults(0 as any)).toEqual(DEFAULT_RIDE_PREFERENCES);
  });

  it("keeps what the rider actually chose", () => {
    expect(ridePreferencesOrDefaults({ calmRideMode: "full", preferredLanguage: "es", minimizeNotifications: true }))
      .toEqual({ calmRideMode: "full", preferredLanguage: "es", minimizeNotifications: true });
  });

  it("fills in only the parts that are missing or the wrong shape", () => {
    expect(ridePreferencesOrDefaults({ preferredLanguage: "fr" })).toEqual({ ...DEFAULT_RIDE_PREFERENCES, preferredLanguage: "fr" });
    expect(ridePreferencesOrDefaults({ calmRideMode: "" })).toEqual(DEFAULT_RIDE_PREFERENCES);
    expect(ridePreferencesOrDefaults({ minimizeNotifications: null as any })).toEqual(DEFAULT_RIDE_PREFERENCES);
  });

  it("never hands back the shared default object itself, so a caller cannot edit it", () => {
    const first = ridePreferencesOrDefaults(null);
    first.calmRideMode = "full";
    expect(DEFAULT_RIDE_PREFERENCES.calmRideMode).toBe("off");
    expect(ridePreferencesOrDefaults(null).calmRideMode).toBe("off");
  });
});
