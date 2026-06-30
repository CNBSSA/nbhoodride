import { describe, expect, it } from "vitest";
import { buildDriverLocationMessage } from "../server/wsDriverLocation";
import {
  getQuickMessageText,
  isQuickMessageAllowedForRole,
} from "../shared/quickRideMessages";

describe("buildDriverLocationMessage", () => {
  it("includes normalized location and legacy lat/lng", () => {
    const msg = buildDriverLocationMessage({
      rideId: "r1",
      driverId: "d1",
      lat: 38.9,
      lng: -76.8,
    });
    expect(msg.type).toBe("driver_location");
    expect(msg.location).toEqual({ lat: 38.9, lng: -76.8 });
    expect(msg.lat).toBe(38.9);
    expect(msg.driverId).toBe("d1");
  });
});

describe("quickRideMessages", () => {
  it("allows rider messages for rider role only", () => {
    expect(isQuickMessageAllowedForRole("rider_here", "rider")).toBe(true);
    expect(isQuickMessageAllowedForRole("rider_here", "driver")).toBe(false);
    expect(getQuickMessageText("driver_here")).toBe("I'm here");
  });
});
