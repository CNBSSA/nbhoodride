import { describe, expect, it } from "vitest";
import { formatPassengerLabel, validateFriendRideInput } from "./rideForFriend";

describe("rideForFriend", () => {
  it("requires passenger name when booking for friend", () => {
    expect(validateFriendRideInput(true, "").valid).toBe(false);
    expect(validateFriendRideInput(true, "Maria").valid).toBe(true);
    expect(validateFriendRideInput(false, "").valid).toBe(true);
  });

  it("formats driver-facing passenger label", () => {
    expect(formatPassengerLabel(true, "Maria", "James")).toBe(
      "Picking up Maria (booked by James)",
    );
    expect(formatPassengerLabel(false, "Maria", "James")).toBeNull();
  });
});
