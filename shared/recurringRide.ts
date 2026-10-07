/** Recurring ride templates (D6) — shared by client + server. */
import { PLAN_TIMEZONE, zonedDateTime, zonedParts } from "./weeklyPlan";

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
 * Next weekly occurrence at the preferred day and time ON THE RIDER'S CLOCK
 * (Eastern — the app saves the day and hour from the rider's own device),
 * strictly after `from`. If today matches but the time has passed, jumps to
 * next week. Until 2026-10-06 this used the clock of whatever ran it, and the
 * server runs on UTC: a "Wednesday 9 AM" ride was booked for 5 AM Eastern.
 */
export function nextWeeklyOccurrence(
  { dayOfWeek, preferredHour, preferredMinute = 0 }: RecurringScheduleTime,
  from: Date = new Date(),
  timeZone: string = PLAN_TIMEZONE,
): Date {
  const today = zonedParts(from, timeZone);
  for (let ahead = 0; ahead <= 7; ahead++) {
    // Walk calendar days in the zone (noon UTC of the zone's date avoids
    // any DST edge when stepping days).
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + ahead, 12));
    const weekday = day.getUTCDay();
    if (weekday !== dayOfWeek) continue;
    const at = zonedDateTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), preferredHour, preferredMinute, timeZone);
    if (at.getTime() > from.getTime()) return at;
  }
  // Only reached when today is the day and its time has passed: a week on.
  const day = new Date(Date.UTC(today.y, today.m - 1, today.d + 7, 12));
  return zonedDateTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), preferredHour, preferredMinute, timeZone);
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
