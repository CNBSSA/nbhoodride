import type WebSocket from "ws";
import type { RideMessagePayload } from "@shared/rideChat";
import { buildRideMessageWsPayload } from "@shared/rideChat";

let activeConnections: Map<string, WebSocket> | null = null;

export function setRideMessageConnections(map: Map<string, WebSocket>) {
  activeConnections = map;
}

export function pushRideMessageToUser(userId: string, message: RideMessagePayload): boolean {
  if (!activeConnections?.has(userId)) return false;
  const ws = activeConnections.get(userId)!;
  if (ws.readyState !== 1) return false;
  ws.send(JSON.stringify(buildRideMessageWsPayload(message)));
  return true;
}
