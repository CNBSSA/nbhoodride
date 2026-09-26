/**
 * The server prices every booking door (shared/bookingQuote.ts holds the
 * rules; this is the one place a route turns points + the app's claims
 * into the fare, miles and minutes written on the ride).
 */
import type { RoutePoint } from "@shared/routeEstimate";
import { bookingRouteFigures, judgeBookingFare, describeFareGap, type FareJudgement } from "@shared/bookingQuote";
import { vehicleFareMultiplier } from "@shared/vehicleTypes";
import { estimateFare } from "./rideWorkflowService";
import { storage } from "./storage";
import { riderAlert } from "./riderAlerts";

export interface PricedBooking {
  /** Two-decimal string for the ride's estimatedFare (and originalFare where a door records one). */
  fare: string;
  miles: number;
  minutes: number;
  /** Vehicle-class multiplier the quote was priced with. */
  multiplier: number;
  judgement: FareJudgement;
  figuresFrom: "app" | "server";
}

export async function priceBooking(input: {
  door: string;
  userId: string;
  /** Pickup, any stops in order, destination. */
  points: RoutePoint[];
  appFare: unknown;
  appMiles: unknown;
  appMinutes: unknown;
  vehicleType?: string | null;
}): Promise<PricedBooking> {
  const rates = await storage.getPlatformRates();
  const vehicleType = input.vehicleType ?? "standard";
  const figures = bookingRouteFigures(input.points, input.appMiles, input.appMinutes);
  const quote = estimateFare(figures.miles, figures.minutes, { rates, vehicleType }).total;
  const judgement = judgeBookingFare(input.appFare, quote);
  if (judgement.gap !== "matches" && judgement.gap !== "missing") {
    console.log(`[fare] ${input.door} ${vehicleType} request quoted $${judgement.appFare?.toFixed(2)} by the app; server quote $${judgement.fare.toFixed(2)} applied (${judgement.gap}; figures from ${figures.source})`);
  }
  if (judgement.alert && judgement.appFare !== null) {
    riderAlert("fare_mismatch", `${input.userId}:${judgement.appFare.toFixed(2)}`, [
      ["Rider", input.userId],
      ["Door", input.door],
      ["App quoted", `$${judgement.appFare.toFixed(2)}`],
      ["Server quote", `$${judgement.fare.toFixed(2)}`],
      ["Effect", describeFareGap(judgement)],
    ]);
  }
  return {
    fare: judgement.fare.toFixed(2),
    miles: figures.miles,
    minutes: figures.minutes,
    multiplier: vehicleFareMultiplier(vehicleType, rates),
    judgement,
    figuresFrom: figures.source,
  };
}
