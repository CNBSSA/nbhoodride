/** Structured ride receipt (shared by API + download). */

export const RECEIPT_FARE_RATES = {
  minimumFare: 7.65,
  baseFare: 4.0,
  perMinuteRate: 0.29,
  perMileRate: 0.9,
} as const;

export interface RideReceipt {
  rideId: string;
  date: string;
  driverName: string;
  pickupAddress: string;
  destinationAddress: string;
  distanceMiles: number | null;
  durationMinutes: number | null;
  baseFare: number;
  timeCharge: number;
  distanceCharge: number;
  subtotal: number;
  promoDiscount: number;
  sharedDiscount: number;
  tip: number;
  totalCharged: number;
  paymentMethod: string;
  paymentMethodLabel: string;
  paymentStatus: string;
  riderRating: number | null;
  driverRating: number | null;
  bookedForFriend?: boolean;
  passengerName?: string | null;
  requestedVehicleType?: string | null;
}

export interface RideReceiptInput {
  id: string;
  completedAt: Date | string | null;
  actualFare: string | null;
  estimatedFare: string | null;
  tipAmount: string | null;
  promoDiscountApplied: string | null;
  sharedFareDiscount: string | null;
  distance: string | null;
  driverTraveledDistance: string | null;
  duration: number | null;
  driverTraveledTime: number | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  pickupLocation: { address: string } | null;
  destinationLocation: { address: string } | null;
  riderRating: number | null;
  driverRating: number | null;
  bookedForFriend?: boolean | null;
  passengerName?: string | null;
  requestedVehicleType?: string | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatPaymentMethodLabel(method: string | null | undefined): string {
  if (method === "card") return "PG Card (virtual wallet)";
  if (method === "cash") return "Cash";
  return method ?? "PG Card";
}

/** Build a structured receipt from a completed ride row. */
export function buildRideReceipt(ride: RideReceiptInput, driverName: string): RideReceipt {
  const fare = parseFloat(ride.actualFare ?? ride.estimatedFare ?? "0");
  const tip = parseFloat(ride.tipAmount ?? "0");
  const promoDiscount = parseFloat(ride.promoDiscountApplied ?? "0");
  const sharedDiscount = parseFloat(ride.sharedFareDiscount ?? "0");
  const totalCharged = Math.max(0, fare + tip);

  const distanceMiles = ride.driverTraveledDistance
    ? parseFloat(ride.driverTraveledDistance)
    : ride.distance
      ? parseFloat(ride.distance)
      : null;

  const durationMinutes = ride.driverTraveledTime ?? ride.duration ?? null;

  const timeCharge = durationMinutes
    ? round2(RECEIPT_FARE_RATES.perMinuteRate * durationMinutes)
    : 0;
  const distanceCharge = distanceMiles
    ? round2(RECEIPT_FARE_RATES.perMileRate * distanceMiles)
    : 0;
  const subtotal = round2(RECEIPT_FARE_RATES.baseFare + timeCharge + distanceCharge);

  const completedAt = ride.completedAt ? new Date(ride.completedAt) : null;

  return {
    rideId: ride.id,
    date: completedAt
      ? completedAt.toLocaleString("en-US", {
          timeZone: "America/New_York",
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "Unknown",
    driverName,
    pickupAddress: ride.pickupLocation?.address ?? "Pickup location",
    destinationAddress: ride.destinationLocation?.address ?? "Destination",
    distanceMiles,
    durationMinutes,
    baseFare: RECEIPT_FARE_RATES.baseFare,
    timeCharge,
    distanceCharge,
    subtotal,
    promoDiscount: round2(promoDiscount),
    sharedDiscount: round2(sharedDiscount),
    tip: round2(tip),
    totalCharged: round2(totalCharged),
    paymentMethod: ride.paymentMethod ?? "card",
    paymentMethodLabel: formatPaymentMethodLabel(ride.paymentMethod),
    paymentStatus: ride.paymentStatus ?? "unknown",
    riderRating: ride.riderRating,
    driverRating: ride.driverRating,
    bookedForFriend: ride.bookedForFriend ?? false,
    passengerName: ride.passengerName,
    requestedVehicleType: ride.requestedVehicleType,
  };
}

/** Plain-text receipt for download / email fallback. */
export function formatReceiptAsText(receipt: RideReceipt): string {
  const lines = [
    "PG Ride — Trip Receipt",
    "========================",
    `Ride ID: ${receipt.rideId}`,
    `Date: ${receipt.date}`,
    `Driver: ${receipt.driverName}`,
    "",
    `From: ${receipt.pickupAddress}`,
    `To: ${receipt.destinationAddress}`,
  ];
  if (receipt.bookedForFriend && receipt.passengerName) {
    lines.push(`Passenger: ${receipt.passengerName} (booked by you)`);
  }
  if (receipt.requestedVehicleType && receipt.requestedVehicleType !== "standard") {
    lines.push(`Vehicle type: ${receipt.requestedVehicleType}`);
  }
  lines.push(
    "",
    `Distance: ${receipt.distanceMiles ?? "—"} mi`,
    `Duration: ${receipt.durationMinutes ?? "—"} min`,
    "",
    `Base fare: $${receipt.baseFare.toFixed(2)}`,
    `Time: $${receipt.timeCharge.toFixed(2)}`,
    `Distance: $${receipt.distanceCharge.toFixed(2)}`,
    `Subtotal: $${receipt.subtotal.toFixed(2)}`,
  );
  if (receipt.promoDiscount > 0) {
    lines.push(`Promo credit: -$${receipt.promoDiscount.toFixed(2)}`);
  }
  if (receipt.sharedDiscount > 0) {
    lines.push(`Shared ride savings: -$${receipt.sharedDiscount.toFixed(2)}`);
  }
  if (receipt.tip > 0) {
    lines.push(`Tip: $${receipt.tip.toFixed(2)}`);
  }
  lines.push(
    `Total charged: $${receipt.totalCharged.toFixed(2)}`,
    `Payment: ${receipt.paymentMethodLabel}`,
    `Status: ${receipt.paymentStatus}`,
    "",
    "Thank you for riding with PG Ride.",
    "Community-owned. No surge pricing.",
  );
  return lines.join("\n");
}
