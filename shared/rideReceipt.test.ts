import { describe, expect, it } from "vitest";
import { buildRideReceipt, formatPaymentMethodLabel, formatReceiptAsText } from "./rideReceipt";

describe("buildRideReceipt", () => {
  it("builds fare breakdown from completed ride", () => {
    const receipt = buildRideReceipt(
      {
        id: "ride-1",
        completedAt: "2026-07-01T14:30:00Z",
        actualFare: "12.50",
        estimatedFare: "12.50",
        tipAmount: "2.00",
        promoDiscountApplied: "5.00",
        sharedFareDiscount: "0",
        distance: "5.2",
        driverTraveledDistance: null,
        duration: 18,
        driverTraveledTime: null,
        paymentMethod: "card",
        paymentStatus: "paid_card",
        pickupLocation: { address: "Greenbelt Metro" },
        destinationLocation: { address: "UMD Campus" },
        riderRating: 5,
        driverRating: 5,
        bookedForFriend: true,
        passengerName: "Maria",
        requestedVehicleType: "xl",
      },
      "James D.",
    );

    expect(receipt.totalCharged).toBe(14.5);
    expect(receipt.promoDiscount).toBe(5);
    expect(receipt.paymentMethodLabel).toBe("Card on file");
    expect(receipt.passengerName).toBe("Maria");
    expect(receipt.requestedVehicleType).toBe("xl");
  });
});

describe("formatPaymentMethodLabel", () => {
  it("does not mention a wallet in card-only mode", () => {
    expect(formatPaymentMethodLabel("card")).toBe("Card on file");
    expect(formatPaymentMethodLabel("card", { walletEnabled: false })).toBe("Card on file");
  });
  it("labels card as the PG Card wallet only when the wallet is enabled", () => {
    expect(formatPaymentMethodLabel("card", { walletEnabled: true })).toBe("PG Card (virtual wallet)");
  });
  it("labels cash as Cash either way", () => {
    expect(formatPaymentMethodLabel("cash")).toBe("Cash");
    expect(formatPaymentMethodLabel("cash", { walletEnabled: true })).toBe("Cash");
  });
});

describe("formatReceiptAsText", () => {
  it("includes ride id and total", () => {
    const receipt = buildRideReceipt(
      {
        id: "abc",
        completedAt: "2026-07-01T12:00:00Z",
        actualFare: "10.00",
        estimatedFare: "10.00",
        tipAmount: "0",
        promoDiscountApplied: "0",
        sharedFareDiscount: "0",
        distance: "3",
        driverTraveledDistance: null,
        duration: 10,
        driverTraveledTime: null,
        paymentMethod: "card",
        paymentStatus: "paid_card",
        pickupLocation: { address: "A" },
        destinationLocation: { address: "B" },
        riderRating: null,
        driverRating: null,
      },
      "Driver",
    );
    const text = formatReceiptAsText(receipt);
    expect(text).toContain("Ride ID: abc");
    expect(text).toContain("Total charged: $10.00");
  });
});
