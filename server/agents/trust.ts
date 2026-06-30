import { randomBytes } from "crypto";
import {
  buildMatchReason,
  computeTrustScore,
  passesSeparationFilter,
} from "@shared/trustScore";
import type { IStorage } from "../storage";

export interface DriverTrustContext {
  trustScore: number;
  separationDegrees: number;
  rideCount: number;
  isFavorite: boolean;
  matchReason: string;
}

export async function getDriverTrustContext(
  storage: IStorage,
  riderId: string,
  driverId: string,
  driverMeta: { avgRating: number; isVerifiedNeighbor: boolean; hasOwnership?: boolean },
): Promise<DriverTrustContext> {
  const edge = await storage.getTrustEdge(riderId, driverId);
  const isFavorite = await storage.isFavoriteDriver(riderId, driverId);
  const separationDegrees = await storage.getSeparationDegrees(riderId, driverId);
  const rideCount = edge?.rideCount ?? 0;

  const trustScore = computeTrustScore({
    rideCount,
    isFavorite,
    avgRating: driverMeta.avgRating,
    isVerifiedNeighbor: driverMeta.isVerifiedNeighbor,
    hasOwnership: driverMeta.hasOwnership ?? false,
    separationDegrees,
  });

  const matchReason = buildMatchReason({
    trustScore,
    rideCount,
    isFavorite,
    separationDegrees,
    isVerifiedNeighbor: driverMeta.isVerifiedNeighbor,
  });

  return { trustScore, separationDegrees, rideCount, isFavorite, matchReason };
}

export async function filterDriversByTrustPreferences<
  T extends { userId: string; separationDegrees: number; isFavorite?: boolean },
>(storage: IStorage, riderId: string, drivers: T[]): Promise<T[]> {
  const prefs = await storage.getRiderTrustPreferences(riderId);
  let filtered = drivers.filter((d) =>
    passesSeparationFilter(d.separationDegrees, prefs.maxSeparationDegrees),
  );
  if (prefs.preferFavorites) {
    const favorites = filtered.filter((d) => d.isFavorite);
    if (favorites.length > 0) filtered = favorites;
  }
  return filtered;
}

export function generateReferralCode(): string {
  return randomBytes(5).toString("hex").toUpperCase();
}

export async function recordRideTrustEdge(
  storage: IStorage,
  riderId: string,
  driverId: string,
): Promise<void> {
  await storage.upsertTrustEdge(riderId, driverId);
  await storage.createAgentAuditLog({
    agent: "trust",
    action: "edge_strengthened",
    userId: riderId,
    reasoning: `Completed ride with driver ${driverId}`,
    metadata: { driverId },
  });
}
