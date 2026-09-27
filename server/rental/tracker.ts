/**
 * The car tracker that can cut off and restore a rental car's engine.
 *
 * Not connected yet: Festus will name the tracker the cars carry. Until
 * then every call answers "not sent" with the reason, the desk cuts the
 * engine off in the tracker's own app, and PG Ride records that it did.
 * When the tracker is known, its API goes here and nowhere else.
 *
 * A tracker should only ever stop an engine when the car is stationary;
 * that is the tracker's own safety rule and must stay on when this is
 * connected.
 */
import type { RentalCar } from "@shared/schema";

export type TrackerResult = { sent: true } | { sent: false; reason: string };

export function trackerName(): string | null {
  return process.env.CAR_TRACKER_PROVIDER?.trim() || null;
}

const NOT_CONNECTED: TrackerResult = { sent: false, reason: "No tracker is connected to PG Ride yet: cut it off in the tracker's own app" };

export async function cutEngine(_car: RentalCar): Promise<TrackerResult> {
  return NOT_CONNECTED;
}

export async function restoreEngine(_car: RentalCar): Promise<TrackerResult> {
  return { sent: false, reason: "No tracker is connected to PG Ride yet: restore it in the tracker's own app" };
}
