import type { RideMessagePayload } from "@shared/rideChat";
import { buildRideMessageWsPayload } from "@shared/rideChat";

/** What the hub needs of a connection: a socket, or every tab a person has open (server/wsFanout.ts). */
type Sendable = { readyState: number; send: (data: string) => void };

let activeConnections: Map<string, Sendable> | null = null;

export function setRideMessageConnections(map: Map<string, Sendable>) {
  activeConnections = map;
}

export function pushRideMessageToUser(userId: string, message: RideMessagePayload): boolean {
  if (!activeConnections?.has(userId)) return false;
  const ws = activeConnections.get(userId)!;
  if (ws.readyState !== 1) return false;
  ws.send(JSON.stringify(buildRideMessageWsPayload(message)));
  return true;
}
