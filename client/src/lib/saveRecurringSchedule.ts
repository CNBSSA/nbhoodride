import { apiRequest } from "@/lib/queryClient";
import {
  dayOfWeekFromDate,
  hourMinuteFromDate,
  type RecurringRideKind,
  type RecurringRideOptions,
} from "@shared/recurringRide";

export interface SaveRecurringScheduleInput {
  label: string;
  rideKind: RecurringRideKind;
  /** Departure instant used to derive weekly day/time */
  departureAt: Date;
  pickup?: { lat: number; lng: number; address: string };
  destination?: { lat: number; lng: number; address: string };
  circuitId?: string;
  options?: RecurringRideOptions;
}

export async function saveRecurringSchedule(input: SaveRecurringScheduleInput) {
  const { hour, minute } = hourMinuteFromDate(input.departureAt);
  const res = await apiRequest("POST", "/api/rider/recurring-schedules", {
    label: input.label,
    rideKind: input.rideKind,
    pickup: input.pickup,
    destination: input.destination,
    circuitId: input.circuitId,
    dayOfWeek: dayOfWeekFromDate(input.departureAt),
    preferredHour: hour,
    preferredMinute: minute,
    options: input.options ?? {},
  });
  return res.json();
}

export async function rebookRecurringSchedule(scheduleId: string) {
  const res = await apiRequest("POST", `/api/rider/recurring-schedules/${scheduleId}/rebook`);
  return res.json();
}
