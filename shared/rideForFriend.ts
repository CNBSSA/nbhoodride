/** Ride-for-a-friend booking helpers (booker pays; passenger rides). */

export interface FriendRidePassenger {
  passengerName: string;
  passengerPhone?: string;
}

export function validateFriendRideInput(
  bookedForFriend: boolean,
  passengerName?: string,
  passengerPhone?: string,
): { valid: boolean; error?: string } {
  if (!bookedForFriend) return { valid: true };
  const name = passengerName?.trim();
  if (!name || name.length < 2) {
    return { valid: false, error: "Passenger name is required for ride-for-a-friend" };
  }
  if (name.length > 80) {
    return { valid: false, error: "Passenger name is too long" };
  }
  if (passengerPhone) {
    const digits = passengerPhone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      return { valid: false, error: "Passenger phone must be 10–15 digits" };
    }
  }
  return { valid: true };
}

export function formatPassengerLabel(
  bookedForFriend: boolean,
  passengerName?: string | null,
  bookerFirstName?: string | null,
): string | null {
  if (!bookedForFriend || !passengerName) return null;
  const booker = bookerFirstName?.trim();
  return booker
    ? `Picking up ${passengerName} (booked by ${booker})`
    : `Picking up ${passengerName}`;
}
