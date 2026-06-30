import {
  scoreWaypointQuality,
  buildDisengagementMetadata,
  type DisengagementReason,
  type WaypointSample,
} from "@shared/waypointQuality";
import type { IStorage } from "../storage";

/** F1 — Log waypoint quality during active rides (L4 research lane). */
export async function processL4Waypoint(
  storage: IStorage,
  rideId: string,
  driverId: string,
  waypoint: { lat: number; lng: number },
): Promise<void> {
  const ride = await storage.getRide(rideId);
  if (!ride || ride.status !== "in_progress") return;

  const path = (ride.routePath as WaypointSample[] | null) ?? [];
  const prev = path.length >= 2 ? path[path.length - 2] : path.length === 1 ? path[0] : null;
  const curr: WaypointSample = { ...waypoint, timestamp: Date.now() };
  const result = scoreWaypointQuality(prev, curr);

  await storage.createL4ReadinessEvent({
    rideId,
    driverId,
    eventType: result.eventType,
    waypointQuality: result.qualityScore.toFixed(3),
    speedMph: result.speedMph != null ? result.speedMph.toFixed(2) : undefined,
    metadata: result.metadata,
  });

  if (result.speedAnomaly) {
    await storage.createAgentAuditLog({
      agent: "l4_readiness",
      action: "speed_anomaly",
      userId: driverId,
      rideId,
      reasoning: `GPS speed ${result.speedMph} mph exceeds L4 research threshold`,
      metadata: result.metadata,
    });
  }
}

export async function logL4Disengagement(
  storage: IStorage,
  rideId: string,
  driverId: string,
  reason: DisengagementReason,
  note?: string,
): Promise<void> {
  await storage.createL4ReadinessEvent({
    rideId,
    driverId,
    eventType: "disengagement",
    metadata: buildDisengagementMetadata(reason, note),
  });

  await storage.createAgentAuditLog({
    agent: "l4_readiness",
    action: "disengagement",
    userId: driverId,
    rideId,
    reasoning: `Driver logged disengagement: ${reason}`,
    metadata: { reason, note },
  });
}
