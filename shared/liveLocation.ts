/**
 * Live driver position: the figures both apps and the server agree on
 * (reliability audit 2026-09-29; Festus's priority 2: "the rider's map never
 * freezes silently").
 *
 * Until now the driver's position travelled over the WebSocket only, the
 * rider's screen learned of it over the WebSocket only, the socket had no
 * heartbeat (a half-open one counted as delivered), and the app reconnected
 * on a fixed 3-second beat. So a dropped socket froze the rider's map, and
 * the driver's stored position stopped moving — which is what the T-10
 * ride-risk page reads, so it paged ops for a driver who was driving.
 *
 * Now the driver app posts over HTTP whenever the socket is down, the
 * active-ride payload carries the driver's last position so the rider's
 * 5-second poll keeps the map moving, the server pings every socket and
 * drops one that does not answer, and the app backs off with jitter.
 */

/** After this long without a position the rider's screen says "location paused". */
export const DRIVER_LOCATION_STALE_MS = 45_000;

/** The driver app sends a position at most this often, over either channel. */
export const DRIVER_LOCATION_SEND_EVERY_MS = 5_000;

/** The server pings every open socket this often and drops one that missed the last ping. */
export const WS_HEARTBEAT_MS = 30_000;

/** Reconnect delays: 3 s, 6 s, 12 s, 24 s, then 30 s, each with up to 30% jitter. */
export const WS_RECONNECT_BASE_MS = 3_000;
export const WS_RECONNECT_MAX_MS = 30_000;

/** Delay before reconnect attempt `attempt` (1 = first), with `jitter` in [0, 1). */
export function reconnectDelayMs(attempt: number, jitter = Math.random()): number {
  const n = Math.max(1, Math.floor(attempt));
  const base = Math.min(WS_RECONNECT_MAX_MS, WS_RECONNECT_BASE_MS * 2 ** (n - 1));
  const j = Math.min(0.999, Math.max(0, jitter));
  return Math.round(base * (1 + 0.3 * j));
}

/** Is a position stamped at `at` still fresh at `now`? */
export function positionIsFresh(at: Date | string | number | null | undefined, now: number, staleMs = DRIVER_LOCATION_STALE_MS): boolean {
  if (at === null || at === undefined) return false;
  const t = typeof at === "number" ? at : new Date(at).getTime();
  if (Number.isNaN(t)) return false;
  return now - t < staleMs;
}
