// Pure helpers for circuit scheduling (docs/CIRCUITS_LAUNCH_PLAN.md).
// Shared by the admin UI (human-readable schedule labels) and the weekly
// run generator (next departure computation). No I/O — unit-testable.

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export interface CircuitScheduleFields {
  dayOfWeek: number; // 0 = Sunday … 6 = Saturday
  departureHour: number; // 0–23
  departureMinute: number; // 0–59
}

/** "Sundays · 9:00 AM" — the label shown on timetables and admin lists. */
export function describeCircuitSchedule(c: CircuitScheduleFields): string {
  const period = c.departureHour < 12 ? "AM" : "PM";
  const hour12 = c.departureHour % 12 === 0 ? 12 : c.departureHour % 12;
  const minute = String(c.departureMinute).padStart(2, "0");
  return `${DAY_NAMES[c.dayOfWeek]}s · ${hour12}:${minute} ${period}`;
}

/**
 * Next departure strictly after `from`. If `from` is exactly at the
 * departure instant, returns the following week's run — a run that is
 * departing right now is no longer bookable.
 */
export function nextRunAt(c: CircuitScheduleFields, from: Date): Date {
  const next = new Date(from);
  next.setHours(c.departureHour, c.departureMinute, 0, 0);
  let daysAhead = (c.dayOfWeek - from.getDay() + 7) % 7;
  if (daysAhead === 0 && next.getTime() <= from.getTime()) {
    daysAhead = 7;
  }
  next.setDate(next.getDate() + daysAhead);
  return next;
}

/** Booking cutoff for a given run: `cutoffHoursBefore` hours before departure. */
export function cutoffFor(runAt: Date, cutoffHoursBefore: number): Date {
  return new Date(runAt.getTime() - cutoffHoursBefore * 3600_000);
}

export interface BookingWindow {
  runAt: Date;
  cutoffAt: Date;
  /** True while seats on the next run can still be booked (cutoff not passed). */
  open: boolean;
}

/**
 * The next bookable run of a circuit as seen at `now`. If `now` is already
 * past this week's cutoff (but before departure), the run is returned with
 * open=false — riders see "booking closed" rather than silently being
 * shown next week's run while this week's hasn't departed yet.
 */
export function bookingWindow(
  c: CircuitScheduleFields & { cutoffHoursBefore: number },
  now: Date,
): BookingWindow {
  const runAt = nextRunAt(c, now);
  const cutoffAt = cutoffFor(runAt, c.cutoffHoursBefore);
  return { runAt, cutoffAt, open: now.getTime() < cutoffAt.getTime() };
}
