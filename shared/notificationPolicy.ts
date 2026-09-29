/**
 * Which notifications a quiet preference may silence (reliability audit,
 * 2026-09-29; Festus's priority 1 after it).
 *
 * A rider can turn on calm ride mode or "minimize notifications" to be left
 * alone. Until now that silenced every push, and no ride event passed the
 * bypass flag, so a rider in calm mode with the app in the background learned
 * that their driver had cancelled, or was standing outside, only when they
 * opened the app again. Being left alone means no chatter — it never meant
 * not being told that the ride they are waiting for has changed under them.
 *
 * The rule: a notification about a ride the person holds right now, a
 * message from the other party on it, or money they have to act on always
 * goes through. Everything else — credits, groups forming, announcements —
 * respects the preference. It lives here so the list is one place, tested,
 * and every send site gets the same answer without passing a flag.
 */

/** Notification types that reach a person whatever their quiet preference. */
export const RIDE_CRITICAL_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  // What happened to the ride they are on or waiting for
  "ride-accepted",
  "driver-arrived",
  "ride-started",
  "ride-completed",
  "ride-cancelled",
  "ride-no-show",
  "ride-reminder",
  // The other party is talking to them about it
  "ride_message",
  // A driver's own work: an offer, a claim to confirm, a claim taken away
  "new-ride-request",
  "confirm-claimed-ride",
  "scheduled-ride-released",
  "scheduled-ride-no-driver",
  "scheduled-ride-at-risk",
  "group_seat_released",
  // Money they must act on
  "payment-action-needed",
  // Safety, already exempt before this rule existed
  "sos",
  "emergency",
]);

/** May a quiet preference silence the push for this notification type? */
export function quietMaySilence(type: string): boolean {
  return !RIDE_CRITICAL_NOTIFICATION_TYPES.has(type);
}
