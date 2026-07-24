import { deliverUserNotification } from "../notificationService";
import type { IStorage } from "../storage";

/** D6 — Prompt riders to rebook recurring trips (e.g. weekly church ride). */
export async function processRecurringRideRebooks(storage: IStorage): Promise<number> {
  const due = await storage.getDueRecurringSchedules();
  let sent = 0;
  for (const schedule of due) {
    await deliverUserNotification(schedule.userId, {
      type: "recurring_rebook",
      title: `Your ${schedule.label} ride`,
      body: `Confirm your ${schedule.label} trip for this week? Tap to book the same route.`,
      data: {
        scheduleId: schedule.id,
        label: schedule.label,
        destination: schedule.destination,
      },
      url: `/rider?rebookScheduleId=${schedule.id}`,
    });
    await storage.markRecurringSchedulePrompted(schedule.id);
    sent++;
  }
  return sent;
}
