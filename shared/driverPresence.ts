/**
 * A driver's socket going quiet is not the driver going away (reliability
 * audit, 2026-09-29).
 *
 * Until now the server released every scheduled ride a driver had claimed
 * for the next two hours the moment their WebSocket closed, and told the
 * rider "your driver went offline". The app closes that socket on every
 * navigation away from the home screen, on a refresh, and whenever iOS
 * backgrounds it, then reconnects three seconds later to find the ride gone.
 * The driver was never told.
 *
 * Now a close only notes the time (`driver_profiles.presence_dropped_at`),
 * a re-join clears it, and the minute sweep releases the rides only once
 * the driver has been gone for the whole grace and still has no socket.
 * When it does release them, the driver and ops are told as well as the
 * rider. The rule lives here so the figure can be changed in one place.
 */

/** How long a driver may be without a socket before their claims are released. */
export const DRIVER_DROP_GRACE_MS = 5 * 60 * 1000;

/** Only claims this close to their pickup are released; a ride tomorrow keeps its driver. */
export const DRIVER_DROP_WINDOW_MINUTES = 120;

/** Has this drop outlasted the grace? `droppedAt` null means the driver is (or came) back. */
export function dropHasExpired(droppedAt: Date | string | null | undefined, now: Date, graceMs = DRIVER_DROP_GRACE_MS): boolean {
  if (!droppedAt) return false;
  const at = droppedAt instanceof Date ? droppedAt.getTime() : new Date(droppedAt).getTime();
  if (Number.isNaN(at)) return false;
  return now.getTime() - at >= graceMs;
}

/** The words each party is given when a claim is released. */
export const DRIVER_DROP_WORDS = {
  rider: "Your driver went offline. We're finding you a new one right away.",
  driverTitle: "Your scheduled ride was released",
  driver: (pickupAddress: string, minutesGone: number) =>
    `You were offline for ${minutesGone} minutes, so your scheduled pickup at ${pickupAddress || "the pickup"} was offered to other drivers. Open PG Ride to claim rides again.`,
};
