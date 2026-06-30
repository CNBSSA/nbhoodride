import { randomBytes } from "crypto";
import type { RideSurfaceSpec } from "@shared/genui/schema";
import { rideSurfaceSpecSchema } from "@shared/genui/schema";
import { parseMobilityUtterance, type ParsedMobilityIntent } from "@shared/mobilityIntent";
import type { IStorage } from "../storage";
import type { Ride } from "@shared/schema";

export { parseMobilityUtterance };

export function buildRideSurfaceSpec(ride: Ride, extras?: { driverName?: string; etaMinutes?: number }): RideSurfaceSpec {
  const status = ride.status || "pending";
  const fare = ride.actualFare || ride.estimatedFare || "0";
  const nodes: RideSurfaceSpec["nodes"] = [];

  if (status === "pending") {
    nodes.push(
      { type: "badge", text: "Finding driver", tone: "warning" },
      { type: "text", text: "We're matching you with a verified neighbor driver.", variant: "muted" },
    );
  } else if (status === "accepted" || status === "driver_arriving") {
    nodes.push(
      { type: "heading", text: extras?.driverName ? `${extras.driverName} is on the way` : "Driver on the way" },
      { type: "metric", label: "ETA", value: extras?.etaMinutes != null ? `~${extras.etaMinutes} min` : "Soon" },
      { type: "metric", label: "Fare est.", value: `$${parseFloat(fare.toString()).toFixed(2)}` },
      { type: "button", action: "open_sos", label: "SOS", variant: "destructive" },
    );
  } else if (status === "in_progress") {
    nodes.push(
      { type: "heading", text: "Ride in progress" },
      { type: "metric", label: "Fare", value: `$${parseFloat(fare.toString()).toFixed(2)}` },
      { type: "text", text: ride.destinationLocation && typeof ride.destinationLocation === "object"
        ? (ride.destinationLocation as { address?: string }).address || "En route"
        : "En route", variant: "muted" },
      { type: "button", action: "open_sos", label: "SOS", variant: "destructive" },
    );
  } else if (status === "completed") {
    nodes.push(
      { type: "badge", text: "Complete", tone: "success" },
      { type: "metric", label: "Total", value: `$${parseFloat(fare.toString()).toFixed(2)}` },
      { type: "button", action: "rate_ride", label: "Rate ride", variant: "secondary" },
    );
  } else {
    nodes.push({ type: "text", text: `Status: ${status}`, variant: "muted" });
  }

  return rideSurfaceSpecSchema.parse({
    version: 1,
    title: "Your ride",
    nodes,
  });
}

export async function recordMobilityIntent(
  storage: IStorage,
  userId: string,
  parsed: ParsedMobilityIntent,
): Promise<ParsedMobilityIntent> {
  await storage.createMobilityIntent({
    userId,
    intentType: parsed.intentType,
    utterance: parsed.utterance,
    payload: {
      confidence: parsed.confidence,
      destinationAddress: parsed.destinationAddress,
      label: parsed.label,
    },
  });
  await storage.createAgentAuditLog({
    agent: "orchestrator",
    action: "intent_parsed",
    userId,
    reasoning: `${parsed.intentType} (${Math.round(parsed.confidence * 100)}%)`,
    metadata: { utterance: parsed.utterance },
  });
  return parsed;
}

export async function resolveIntentDestination(
  storage: IStorage,
  userId: string,
  parsed: ParsedMobilityIntent,
): Promise<{ destinationAddress?: string; pickup?: { lat: number; lng: number; address: string }; destination?: { lat: number; lng: number; address: string } }> {
  if (parsed.intentType === "repeat_last") {
    const last = await storage.getLastCompletedRideForUser(userId);
    if (last?.destinationLocation && last?.pickupLocation) {
      return {
        destinationAddress: (last.destinationLocation as { address?: string }).address,
        pickup: last.pickupLocation as { lat: number; lng: number; address: string },
        destination: last.destinationLocation as { lat: number; lng: number; address: string },
      };
    }
  }

  if (parsed.intentType === "ride_home") {
    const home = await storage.getRideTemplateByLabel(userId, "home");
    if (home?.destination) {
      return {
        destinationAddress: home.destination.address,
        destination: home.destination,
        pickup: home.pickup ?? undefined,
      };
    }
    const last = await storage.getLastCompletedRideForUser(userId);
    if (last?.pickupLocation) {
      const pickup = last.pickupLocation as { lat: number; lng: number; address: string };
      return { destinationAddress: pickup.address, destination: pickup };
    }
  }

  if (parsed.destinationAddress) {
    return { destinationAddress: parsed.destinationAddress };
  }

  return {};
}

export function createGuardianShareToken(): string {
  return randomBytes(16).toString("hex");
}

export async function cacheRideSurface(
  storage: IStorage,
  ride: Ride,
  extras?: { driverName?: string; etaMinutes?: number },
): Promise<RideSurfaceSpec> {
  const spec = buildRideSurfaceSpec(ride, extras);
  await storage.upsertRideSurfaceCache(ride.id, spec);
  return spec;
}
