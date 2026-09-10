/**
 * Booking a delivery — a commercial job with no passenger.
 *
 * The same spine as every other job: a row in `rides` so drivers claim it
 * from one board and the sweep pages on it, plus the `commercial_jobs` row
 * carrying the parcel, the two contacts and the window. What differs is the
 * tariff (shared/deliveries.ts: a flat fare covering the first few miles,
 * then a rate per mile) and that the "passenger" on the ride is the person
 * receiving the parcel, so the driver's card says who to hand it to.
 *
 * The handover is recorded through the same proof the facility signature
 * uses; a delivery additionally wants a photo.
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { commercialJobs, organizations } from "@shared/schema";
import { estimateRoute } from "@shared/routeEstimate";
import {
  SIZE_VEHICLE_HINT, deliveryFare, describeParcel, describeWindow, isParcelSize,
  validateDelivery, type Contact, type DeliveryInput,
} from "@shared/deliveries";
import { requiredBadge } from "@shared/driverBadges";
import type { IStorage } from "../storage";
import type { Location } from "../rideWorkflowService";
import { CommercialError, getOrganization } from "./organizations";
import { bookJob, type BookedJob } from "./jobs";

export interface BookDeliveryInput extends DeliveryInput {
  organizationId: string;
  requesterId: string;
  pickup: Location;
  destination: Location;
  vehicleType?: string | null;
  notes?: string | null;
  poNumber?: string | null;
}

const contact = (c: Contact | undefined | null): Contact | null => {
  const name = String(c?.name ?? "").trim().slice(0, 120);
  if (!name) return null;
  return {
    name,
    phone: c?.phone ? String(c.phone).trim().slice(0, 40) : null,
    note: c?.note ? String(c.note).trim().slice(0, 200) : null,
  };
};

export async function bookDelivery(storage: IStorage, input: BookDeliveryInput, now: Date = new Date()): Promise<BookedJob> {
  const org = await getOrganization(input.organizationId);
  if (!org) throw new CommercialError("Organization not found.", 404);
  if (requiredBadge(org.category) !== "delivery") {
    throw new CommercialError("This account books rides, not deliveries. A delivery account is a business or food account.", 409);
  }
  const checked = validateDelivery(input, now);
  if (!checked.valid) throw new CommercialError(checked.error);
  const pickupContact = contact(input.pickupContact);
  const dropContact = contact(input.dropContact);
  if (!pickupContact || !dropContact) throw new CommercialError("Both ends of the handover need a name.");

  const size = String(input.parcelSize);
  const vehicleType = input.vehicleType ?? (isParcelSize(size) ? SIZE_VEHICLE_HINT[size] : "standard");
  const route = estimateRoute([input.pickup, input.destination]);
  const fare = deliveryFare(route.miles);

  const booked = await bookJob(storage, {
    organizationId: org.id,
    requesterId: input.requesterId,
    // Nobody rides: the "passenger" is who receives the parcel, so the
    // driver's card and every notification name the right person.
    passengerName: dropContact.name,
    passengerPhone: dropContact.phone,
    pickup: input.pickup,
    destination: input.destination,
    scheduledAt: checked.window.start,
    vehicleType,
    notes: [describeParcel(size, dropContact.name), input.notes].filter(Boolean).join(" — ").slice(0, 500),
    poNumber: input.poNumber,
    allowShortLead: true,
    fareOverride: fare,
  }, now);

  const [job] = await db.update(commercialJobs).set({
    parcelSize: size,
    pickupContact,
    dropContact,
    windowStart: checked.window.start,
    windowEnd: checked.window.end,
  }).where(eq(commercialJobs.id, booked.job.id)).returning();

  console.log(`[commercial] delivery booked :: ${org.name} | job ${job.jobNumber} | ${describeParcel(size, dropContact.name)} | ${describeWindow(checked.window)} | $${fare.toFixed(2)}`);
  return { ...booked, job };
}

/** What the desk and the driver are told about a delivery job. */
export function deliverySummary(job: { parcelSize?: string | null; dropContact?: Contact | null; windowStart?: Date | string | null; windowEnd?: Date | string | null }): string | null {
  if (!job.parcelSize) return null;
  const parts = [describeParcel(job.parcelSize, job.dropContact?.name)];
  if (job.windowStart && job.windowEnd) parts.push(describeWindow({ start: job.windowStart, end: job.windowEnd }));
  return parts.join(" · ");
}

/** Every organization that books deliveries, for the desk's account picker. */
export async function deliveryOrganizations(): Promise<Array<{ id: string; name: string; category: string }>> {
  const rows = await db.select({ id: organizations.id, name: organizations.name, category: organizations.category })
    .from(organizations).where(eq(organizations.status, "active"));
  return rows.filter((o) => requiredBadge(o.category) === "delivery");
}
