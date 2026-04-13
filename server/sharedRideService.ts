/**
 * Shared Ride Matching Service
 *
 * When a rider opts into a shared ride, this service tries to find another
 * pending shared ride going to a similar destination.  If a match is found,
 * both rides are linked to a SharedRideGroup and each rider pays 70 % of
 * what they would have paid alone (30 % off).
 *
 * Matching criteria:
 *  – The candidate ride must also have wantsSharedRide = true
 *  – It must still be in "pending" status (not yet accepted)
 *  – The pickup must be within PICKUP_RADIUS_MILES of the new ride's pickup
 *  – The destination must be within DEST_RADIUS_MILES of the new ride's destination
 *  – It was created in the last WINDOW_MINUTES minutes
 *  – It is not already part of a group (no sharedRideGroupId)
 */

import { db } from "./db";
import { rides, sharedRideGroups } from "@shared/schema";
import { eq, and, isNull, ne, sql, desc } from "drizzle-orm";

const PICKUP_RADIUS_MILES = 0.75;
const DEST_RADIUS_MILES   = 1.5;
const WINDOW_MINUTES      = 10;
const DISCOUNT_PCT        = 0.30;

/** Haversine distance in miles between two lat/lng pairs */
function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const toRad = (deg: number) => (deg * Math.PI) / 180;

export interface MatchResult {
  matched: boolean;
  groupId?: string;
  partnerRideId?: string;
  discountAmount?: number;
}

/**
 * Try to match the newly created ride (newRideId) with an existing pending
 * shared ride.  Applies the 30 % discount to both if matched.
 */
export async function tryMatchSharedRide(newRideId: string): Promise<MatchResult> {
  // Load the new ride
  const [newRide] = await db.select().from(rides).where(eq(rides.id, newRideId));
  if (!newRide || !newRide.wantsSharedRide) return { matched: false };

  const { pickupLocation, destinationLocation, estimatedFare } = newRide;
  if (!pickupLocation || !destinationLocation || !estimatedFare) return { matched: false };

  const cutoff = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);

  // Fetch all pending shared rides that aren't already in a group
  const candidates = await db
    .select()
    .from(rides)
    .where(
      and(
        eq(rides.status, "pending"),
        eq(rides.wantsSharedRide, true),
        isNull(rides.sharedRideGroupId),
        ne(rides.id, newRideId),
        sql`${rides.createdAt} >= ${cutoff}`
      )
    );

  // Find the best match
  let bestMatch: (typeof candidates)[0] | null = null;
  let bestScore = Infinity;

  for (const candidate of candidates) {
    if (!candidate.pickupLocation || !candidate.destinationLocation) continue;

    const pickupDist = haversineMiles(
      pickupLocation.lat, pickupLocation.lng,
      candidate.pickupLocation.lat, candidate.pickupLocation.lng
    );
    const destDist = haversineMiles(
      destinationLocation.lat, destinationLocation.lng,
      candidate.destinationLocation.lat, candidate.destinationLocation.lng
    );

    if (pickupDist <= PICKUP_RADIUS_MILES && destDist <= DEST_RADIUS_MILES) {
      const score = pickupDist + destDist;
      if (score < bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
    }
  }

  if (!bestMatch) return { matched: false };

  // Create a shared ride group
  const destLabel = destinationLocation.address?.split(",")[0] || "Shared Destination";
  const [group] = await db
    .insert(sharedRideGroups)
    .values({
      scheduledAt: new Date(),
      destinationLabel: destLabel,
      destinationLat: String(destinationLocation.lat),
      destinationLng: String(destinationLocation.lng),
      radiusMiles: String(DEST_RADIUS_MILES),
      maxRiders: 4,
      riderCount: 2,
      status: "matched",
      discountPct: 30,
      createdBy: newRide.riderId,
    })
    .returning();

  // Apply 30 % discount to both rides
  const newFare   = parseFloat(estimatedFare) * (1 - DISCOUNT_PCT);
  const matchFare = parseFloat(bestMatch.estimatedFare || "0") * (1 - DISCOUNT_PCT);
  const newDiscount   = parseFloat(estimatedFare) - newFare;
  const matchDiscount = parseFloat(bestMatch.estimatedFare || "0") - matchFare;

  await Promise.all([
    db.update(rides)
      .set({ sharedRideGroupId: group.id, estimatedFare: newFare.toFixed(2), sharedFareDiscount: newDiscount.toFixed(2) })
      .where(eq(rides.id, newRideId)),
    db.update(rides)
      .set({ sharedRideGroupId: group.id, estimatedFare: matchFare.toFixed(2), sharedFareDiscount: matchDiscount.toFixed(2) })
      .where(eq(rides.id, bestMatch.id)),
  ]);

  return {
    matched: true,
    groupId: group.id,
    partnerRideId: bestMatch.id,
    discountAmount: newDiscount,
  };
}

/**
 * Get all rides in a shared group, with basic rider info.
 */
export async function getSharedGroupRides(groupId: string) {
  return await db.select().from(rides).where(eq(rides.sharedRideGroupId, groupId));
}

/**
 * Get the shared-group context for a given rider's current active ride.
 * Returns null if the rider has no active shared ride.
 */
export async function getMyActiveSharedGroup(userId: string) {
  const [activeRide] = await db
    .select()
    .from(rides)
    .where(
      and(
        eq(rides.riderId, userId),
        ne(rides.status, "completed"),
        ne(rides.status, "cancelled")
      )
    )
    .orderBy(desc(rides.createdAt))
    .limit(1);

  if (!activeRide?.sharedRideGroupId) return null;

  const groupRides = await getSharedGroupRides(activeRide.sharedRideGroupId);
  const coRiders = groupRides
    .filter((r) => r.riderId !== userId)
    .map((r) => ({ rideId: r.id, pickupAddress: r.pickupLocation?.address }));

  return {
    groupId: activeRide.sharedRideGroupId,
    totalRiders: groupRides.length,
    coRiders,
    discountAmount: activeRide.sharedFareDiscount,
    estimatedFare: activeRide.estimatedFare,
  };
}
