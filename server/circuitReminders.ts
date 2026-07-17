import { storage } from "./storage";
import { deliverUserNotification } from "./notificationService";
import { sendCircuitReminderEmail } from "./emailService";
import { circuitRemindersDue } from "@shared/circuitSchedule";

/**
 * Circuit run reminders (docs/CIRCUITS_LAUNCH_PLAN.md item 6), called from
 * the per-minute scheduled-ride monitor.
 *
 * - At the booking cutoff: riders get "seat confirmed" (in-app + push +
 *   email); if the run still has no driver, admins are alerted — a run at
 *   cutoff without a committed driver is the reliability red flag the
 *   launch plan calls existential.
 * - ~60 minutes before departure: riders and the claimed driver get a
 *   heads-up.
 *
 * Idempotent across restarts via the cutoff/departure NotifiedAt stamps on
 * the run's ride_group row.
 */
export async function processCircuitReminders(now: Date = new Date()): Promise<void> {
  const groups = await storage.getUpcomingCircuitRunGroups();
  for (const group of groups) {
    if (!group.circuitId || !group.scheduledAt) continue;
    const circuit = await storage.getCircuit(group.circuitId);
    if (!circuit) continue;

    const due = circuitRemindersDue({
      runAt: new Date(group.scheduledAt),
      cutoffHoursBefore: circuit.cutoffHoursBefore,
      cutoffNotifiedAt: group.cutoffNotifiedAt ? new Date(group.cutoffNotifiedAt) : null,
      departureNotifiedAt: group.departureNotifiedAt ? new Date(group.departureNotifiedAt) : null,
      now,
    });
    if (!due.cutoff && !due.departure) continue;

    const rides = (await storage.getRidesInGroup(group.id)).filter(
      (r) => r.status !== "cancelled",
    );
    const runTime = new Date(group.scheduledAt).toLocaleString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const driverUser = group.driverId ? await storage.getUser(group.driverId) : null;
    const driverName = driverUser
      ? `${driverUser.firstName} ${driverUser.lastName?.[0] || ""}.`
      : null;

    if (due.cutoff) {
      // Stamp FIRST so a crash mid-loop can't double-send to riders.
      await storage.updateRideGroup(group.id, { cutoffNotifiedAt: now });

      for (const ride of rides) {
        deliverUserNotification(ride.riderId, {
          type: "circuit_cutoff",
          title: `Seat confirmed: ${circuit.name}`,
          body: driverName
            ? `Booking is closed. ${driverName} is driving your ${runTime} run.`
            : `Booking is closed for your ${runTime} run. Your driver is being confirmed.`,
          url: "/",
        }).catch(console.error);
        storage
          .getUser(ride.riderId)
          .then((rider) => {
            if (rider?.email) {
              return sendCircuitReminderEmail(rider.email, rider.firstName, {
                circuitName: circuit.name,
                runTime,
                pickupAddress: circuit.pickup.address,
                driverName,
              });
            }
          })
          .catch((err) => console.error("circuit cutoff email failed:", err));
      }

      if (!group.driverId && rides.length > 0) {
        const adminIds = await storage.getAdminUserIds();
        for (const adminId of adminIds) {
          deliverUserNotification(adminId, {
            type: "circuit_no_driver",
            title: `No driver: ${circuit.name}`,
            body: `The ${runTime} run hit its booking cutoff with ${rides.length} seat${rides.length === 1 ? "" : "s"} booked and NO driver. Assign one or drive it yourself.`,
            url: "/",
          }).catch(console.error);
        }
        console.warn(
          `[CIRCUITS] run at cutoff with no driver: circuit=${circuit.name} groupId=${group.id} seats=${rides.length}`,
        );
      }
    }

    if (due.departure) {
      await storage.updateRideGroup(group.id, { departureNotifiedAt: now });

      for (const ride of rides) {
        deliverUserNotification(ride.riderId, {
          type: "circuit_departure",
          title: `Departing soon: ${circuit.name}`,
          body: `Your run leaves at ${runTime} from ${circuit.pickup.address}.${driverName ? ` ${driverName} is your driver.` : ""}`,
          url: "/",
        }).catch(console.error);
      }
      if (group.driverId) {
        deliverUserNotification(group.driverId, {
          type: "circuit_departure_driver",
          title: `You drive soon: ${circuit.name}`,
          body: `${rides.length} seat${rides.length === 1 ? "" : "s"} booked. Departs ${runTime} from ${circuit.pickup.address}.`,
          url: "/",
        }).catch(console.error);
      }
    }
  }
}
