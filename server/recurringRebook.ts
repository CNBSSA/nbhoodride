import { bookingWindow } from "@shared/circuitSchedule";
import {
  nextWeeklyOccurrence,
  type RecurringRideKind,
  type RecurringRideOptions,
  isRecurringRideKind,
} from "@shared/recurringRide";
import { isAllowedPickup, PICKUP_OUTSIDE_MD_MESSAGE } from "@shared/serviceArea";
import type { IStorage } from "./storage";
import type { RecurringRideSchedule } from "@shared/schema";

const SCHEDULE_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

async function generateScheduleCode(storage: IStorage): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const suffix = Array.from({ length: 6 }, () =>
      SCHEDULE_CODE_CHARS[Math.floor(Math.random() * SCHEDULE_CODE_CHARS.length)],
    ).join("");
    const code = `PG-${suffix}`;
    const existing = await storage.getRideGroupByCode(code);
    if (!existing) return code;
  }
  throw new Error("Could not generate unique schedule code");
}

export type RecurringRebookResult =
  | {
      ok: true;
      rideKind: RecurringRideKind;
      scheduledAt: string;
      rideId?: string;
      groupId?: string;
      scheduleCode?: string;
      circuitName?: string;
      message: string;
    }
  | { ok: false; status: number; message: string };

export async function executeRecurringRebook(
  storage: IStorage,
  userId: string,
  schedule: RecurringRideSchedule,
): Promise<RecurringRebookResult> {
  if (schedule.userId !== userId) {
    return { ok: false, status: 403, message: "Not your recurring schedule" };
  }
  if (!schedule.isActive) {
    return { ok: false, status: 400, message: "This recurring ride is paused" };
  }

  const kind: RecurringRideKind = isRecurringRideKind(schedule.rideKind ?? "solo_schedule")
    ? (schedule.rideKind as RecurringRideKind)
    : "solo_schedule";
  const options = (schedule.options ?? {}) as RecurringRideOptions;
  const departAt = nextWeeklyOccurrence({
    dayOfWeek: schedule.dayOfWeek,
    preferredHour: schedule.preferredHour,
    preferredMinute: schedule.preferredMinute ?? 0,
  });

  if (kind === "circuit") {
    if (!schedule.circuitId) {
      return { ok: false, status: 400, message: "Shuttle subscription is missing a circuit" };
    }
    const circuit = await storage.getCircuit(schedule.circuitId);
    if (!circuit || !circuit.isActive) {
      return { ok: false, status: 404, message: "Shuttle route is no longer available" };
    }
    const w = bookingWindow(circuit, new Date());
    if (!w.open) {
      return {
        ok: false,
        status: 400,
        message: "Booking for this week's shuttle run is closed until after departure. Open Shuttles to see the next run.",
      };
    }

    let group = await storage.getCircuitRunGroup(circuit.id, w.runAt);
    if (!group) {
      group = await storage.createRideGroup({
        organizerId: userId,
        groupType: "circuit",
        sharedDestination: circuit.destination,
        maxSlots: circuit.seatCount,
        filledSlots: 0,
        status: "open",
        scheduledAt: w.runAt,
        circuitId: circuit.id,
      });
    }

    const rides = await storage.getRidesInGroup(group.id);
    const active = rides.filter((r) => r.status !== "cancelled");
    if (active.some((r) => r.riderId === userId)) {
      return {
        ok: true,
        rideKind: "circuit",
        scheduledAt: w.runAt.toISOString(),
        rideId: active.find((r) => r.riderId === userId)!.id,
        circuitName: circuit.name,
        message: "You already have a seat on this week's shuttle run.",
      };
    }

    const claimedGroup = await storage.claimScheduleSlot(group.id);
    if (!claimedGroup) {
      return { ok: false, status: 409, message: "This shuttle run is full. Try another route or next week." };
    }

    const ride = await storage.createRide({
      riderId: userId,
      driverId: group.driverId || null,
      pickupLocation: circuit.pickup,
      destinationLocation: circuit.destination,
      estimatedFare: circuit.farePerSeat,
      scheduledAt: w.runAt,
      rideType: "circuit",
      groupId: group.id,
      status: "pending",
      paymentMethod: "card",
    } as any);

    return {
      ok: true,
      rideKind: "circuit",
      scheduledAt: w.runAt.toISOString(),
      rideId: ride.id,
      groupId: group.id,
      circuitName: circuit.name,
      message: `Seat booked on ${circuit.name} for this week's run.`,
    };
  }

  const pickup = schedule.pickup;
  const destination = schedule.destination;
  if (!pickup || !destination) {
    return { ok: false, status: 400, message: "Recurring ride is missing pickup or destination" };
  }
  if (!isAllowedPickup(pickup.lat, pickup.lng)) {
    return { ok: false, status: 400, message: PICKUP_OUTSIDE_MD_MESSAGE };
  }

  if (kind === "coworker_group") {
    const estimatedFare = options.estimatedFare ?? "0";
    const scheduleCode = await generateScheduleCode(storage);
    const group = await storage.createRideGroup({
      scheduleCode,
      organizerId: userId,
      groupType: "shared_schedule",
      sharedDestination: destination,
      maxSlots: 3,
      filledSlots: 1,
      status: "open",
      scheduledAt: departAt,
      visibility: options.visibility === "open" ? "open" : "code",
    } as any);

    const ride = await storage.createRide({
      riderId: userId,
      driverId: options.driverId || null,
      pickupLocation: pickup,
      destinationLocation: destination,
      estimatedFare: String(estimatedFare),
      pickupInstructions: options.pickupInstructions,
      scheduledAt: departAt,
      rideType: "shared_schedule",
      groupId: group.id,
      status: "pending",
      paymentMethod: "card",
    } as any);

    return {
      ok: true,
      rideKind: "coworker_group",
      scheduledAt: departAt.toISOString(),
      rideId: ride.id,
      groupId: group.id,
      scheduleCode,
      message: `Weekly coworker ride created — share ${scheduleCode} with your team.`,
    };
  }

  // solo_schedule
  const ride = await storage.createRide({
    riderId: userId,
    driverId: options.driverId || null,
    pickupLocation: pickup,
    destinationLocation: destination,
    estimatedFare: String(options.estimatedFare ?? "0"),
    pickupInstructions: options.pickupInstructions,
    scheduledAt: departAt,
    status: "pending",
    paymentMethod: "card",
  } as any);

  return {
    ok: true,
    rideKind: "solo_schedule",
    scheduledAt: departAt.toISOString(),
    rideId: ride.id,
    message: `Scheduled ride booked for ${departAt.toLocaleString()}.`,
  };
}
