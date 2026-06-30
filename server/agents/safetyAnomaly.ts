import { deviationMilesFromSegment, isRouteDeviation } from "@shared/routeDeviation";
import type { IStorage } from "../storage";

const recentChecks = new Map<string, number>();
const COOLDOWN_MS = 120_000;

/** D7 — Detect route deviation during active rides. */
export async function checkRouteDeviationForRide(
  storage: IStorage,
  rideId: string,
  driverLat: number,
  driverLng: number,
): Promise<{ anomaly: boolean; deviationMiles?: number }> {
  const ride = await storage.getRide(rideId);
  if (!ride || !ride.status || !["accepted", "in_progress", "arrived"].includes(ride.status)) {
    return { anomaly: false };
  }

  const pickup = ride.pickupLocation as { lat: number; lng: number } | undefined;
  const dest = ride.destinationLocation as { lat: number; lng: number } | undefined;
  if (!pickup?.lat || !dest?.lat) return { anomaly: false };

  const deviation = deviationMilesFromSegment(
    { lat: driverLat, lng: driverLng },
    pickup,
    dest,
  );
  if (!isRouteDeviation(deviation)) {
    return { anomaly: false, deviationMiles: deviation };
  }

  const key = `${rideId}:route_deviation`;
  const last = recentChecks.get(key) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) {
    return { anomaly: true, deviationMiles: deviation };
  }
  recentChecks.set(key, Date.now());

  await storage.createSafetyAlert({
    alertType: "route_deviation",
    severity: "medium",
    targetUserId: ride.riderId,
    title: "Unusual route detected",
    description: `Driver is ~${deviation.toFixed(1)} mi off expected corridor`,
    data: { rideId, deviationMiles: deviation, driverLat, driverLng },
  });

  await storage.createPlatformInsight({
    insightType: "safety_anomaly",
    category: "safety",
    title: "Route deviation flagged",
    description: `Ride ${rideId}: ${deviation.toFixed(1)} mi off corridor`,
    severity: "warning",
    data: { rideId, deviationMiles: deviation },
  });

  await storage.createAgentAuditLog({
    agent: "safety",
    action: "route_deviation",
    userId: ride.riderId,
    rideId,
    reasoning: `Deviation ${deviation.toFixed(2)} mi from pickup→destination segment`,
    metadata: { deviationMiles: deviation },
  });

  return { anomaly: true, deviationMiles: deviation };
}
