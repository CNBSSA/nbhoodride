/**
 * Scheduling-notice policy, shared by the booking UI and the server.
 *
 * Riders may schedule a ride as little as MIN_SCHEDULE_LEAD_HOURS before
 * pickup (same-day scheduling is allowed) and up to MAX_SCHEDULE_DAYS_AHEAD
 * out. The lead time exists so a driver has runway to claim the ride and
 * get to the pickup; anything sooner belongs in Ride Now.
 */

export const MIN_SCHEDULE_LEAD_HOURS = 3;
export const MAX_SCHEDULE_DAYS_AHEAD = 30;

export const SCHEDULE_TOO_SOON_MESSAGE = `Scheduled rides need at least ${MIN_SCHEDULE_LEAD_HOURS} hours' notice. For a sooner pickup, use Ride Now.`;
export const SCHEDULE_TOO_FAR_MESSAGE = `Scheduled rides can be booked up to ${MAX_SCHEDULE_DAYS_AHEAD} days ahead.`;

export type ScheduleTimeCheck = { valid: true } | { valid: false; error: string };

export function checkScheduleTime(
  scheduledAt: Date | string,
  now: Date = new Date(),
): ScheduleTimeCheck {
  const when = new Date(scheduledAt);
  if (Number.isNaN(when.getTime())) {
    return { valid: false, error: "Invalid scheduled time." };
  }
  const leadMs = when.getTime() - now.getTime();
  if (leadMs < MIN_SCHEDULE_LEAD_HOURS * 3_600_000) {
    return { valid: false, error: SCHEDULE_TOO_SOON_MESSAGE };
  }
  // One day of slack past the calendar cap so a late-evening pickup on the
  // 30th day (selectable in the date picker) isn't rejected.
  if (leadMs > (MAX_SCHEDULE_DAYS_AHEAD + 1) * 24 * 3_600_000) {
    return { valid: false, error: SCHEDULE_TOO_FAR_MESSAGE };
  }
  return { valid: true };
}
