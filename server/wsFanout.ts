/**
 * One person, every open tab (reliability audit 2026-09-29; priority 5).
 *
 * The connection map kept one socket per user, so a second tab (a rider
 * with the app open on a phone and a laptop, a desk with two windows)
 * silently orphaned the first: whatever the server sent went to the last
 * one to join and nobody else. A UserSockets holds every open socket a
 * user has and looks like one socket to the rest of the server — `send`
 * reaches all of them, `readyState` is OPEN while any is — so the fifty
 * places that write `activeConnections.get(id)?.send(...)` need no change.
 */
import type WebSocket from "ws";

const OPEN = 1; // WebSocket.OPEN
const CLOSED = 3; // WebSocket.CLOSED

export class UserSockets {
  private readonly sockets = new Set<WebSocket>();

  add(ws: WebSocket): void { this.sockets.add(ws); }
  delete(ws: WebSocket): boolean { return this.sockets.delete(ws); }
  has(ws: WebSocket): boolean { return this.sockets.has(ws); }
  get size(): number { return this.sockets.size; }

  /** OPEN while any socket is open; CLOSED otherwise. */
  get readyState(): number {
    return Array.from(this.sockets).some((ws) => ws.readyState === OPEN) ? OPEN : CLOSED;
  }

  /** Send to every open socket; a socket that throws is dropped. */
  send(data: string): void {
    for (const ws of Array.from(this.sockets)) {
      if (ws.readyState !== OPEN) continue;
      try { ws.send(data); } catch { this.sockets.delete(ws); }
    }
  }

  close(): void { for (const ws of Array.from(this.sockets)) { try { ws.close(); } catch { /* closing */ } } }
}

/** The map's value for a user, created on first join. */
export function socketsFor(map: Map<string, UserSockets>, userId: string): UserSockets {
  let entry = map.get(userId);
  if (!entry) { entry = new UserSockets(); map.set(userId, entry); }
  return entry;
}
