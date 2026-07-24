/** Recurring ride templates (D6) — shared by client + server. */

export const RECURRING_RIDE_KINDS = ["solo_schedule", "coworker_group", "circuit"] as const;
export type RecurringRideKind = (typeof RECURRING_RIDE_KINDS)[number];

export interface RecurringRideOptions {
  /** Coworker group: estimated fare string/number from organizer flow */
  estimatedFare?: string | number;
  pickupInstructions?: string;
  visibility?: "open" | "code";
  openToOthers?: boolean;
  driverId?: string | null;
}

export interface RecurringScheduleTime {
  dayOfWeek: number; // 0 = Sunday … 6 = Saturday
  preferredHour: number; // 0–23
  preferredMinute?: number;
}

/**
 * Next weekly occurrence at the preferred local day/time, strictly after `from`.
 * If today matches but the time has passed, jumps to next week.
 */
export function nextWeeklyOccurrence(
  { dayOfWeek, preferredHour, preferredMinute = 0 }: RecurringScheduleTime,
  from: Date = new Date(),
): Date {
  const next = new Date(from);
  next.setHours(preferredHour, preferredMinute, 0, 0);
  let daysAhead = (dayOfWeek - from.getDay() + 7) % 7;
  if (daysAhead === 0 && next.getTime() <= from.getTime()) {
    daysAhead = 7;
  }
  next.setDate(next.getDate() + daysAhead);
  return next;
}

export function dayOfWeekFromDate(d: Date): number {
  return d.getDay();
}

export function hourMinuteFromDate(d: Date): { hour: number; minute: number } {
  return { hour: d.getHours(), minute: d.getMinutes() };
}

export function isRecurringRideKind(value: string): value is RecurringRideKind {
  return (RECURRING_RIDE_KINDS as readonly string[]).includes(value);
}
