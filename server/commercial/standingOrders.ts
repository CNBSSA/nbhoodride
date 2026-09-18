/**
 * Standing orders — "Monday, Wednesday, Friday at 6:10 AM, with a return
 * at 10:30" — and will-call returns.
 *
 * A standing order is the facility's recurring instruction; the jobs are
 * booked from it a week ahead by a sweep (the same idea as weekly ride
 * plans), one job per order, service date and leg, so the sweep can run
 * every few minutes and never book twice. A will-call order books only the
 * outbound leg; the desk taps "passenger ready" and the return is booked
 * for a few minutes out, with the pickup and destination swapped, and
 * drivers are told at once.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { commercialJobs, commercialStandingOrders, organizations, rides, type CommercialStandingOrder } from "@shared/schema";
import { normalizePlanDays } from "@shared/weeklyPlan";
import { STANDING_ORDER_BOOK_AHEAD_DAYS, isReturnMode, orgTerms, standingOccurrences, validateStandingSchedule, type ReturnMode } from "@shared/commercialTerms";
import { VEHICLE_TYPES } from "@shared/vehicleTypes";
import type { IStorage } from "../storage";
import type { Location } from "../rideWorkflowService";
import { CommercialError, getOrganization } from "./organizations";
import { bookJob, type BookedJob } from "./jobs";
import { bookDelivery } from "./deliveries";
import { categoryMayBook } from "@shared/commercial";
import { DEFAULT_WINDOW_HOURS, SIZE_VEHICLE_HINT, handoverOf, isHandoverKind, isParcelSize } from "@shared/deliveries";

export interface StandingOrderInput {
  organizationId: string;
  createdBy: string;
  passengerName: string;
  passengerPhone?: string | null;
  pickup: Location;
  destination: Location;
  days: number[];
  departureHour: number;
  departureMinute: number;
  returnMode: ReturnMode;
  returnHour?: number | null;
  returnMinute?: number | null;
  vehicleType?: string | null;
  notes?: string | null;
  poNumber?: string | null;
  /** ride (default) | delivery. A standing delivery books a parcel each service day, billed to the account. */
  kind?: string | null;
  parcelSize?: string | null;
  handover?: string | null;
  pickupContact?: { name?: string | null; phone?: string | null; note?: string | null } | null;
  dropContact?: { name?: string | null; phone?: string | null; note?: string | null } | null;
  windowHours?: number | null;
  /** Refused: a standing delivery is account-pays only in this version. */
  payer?: string | null;
}

const contactOf = (c: { name?: string | null; phone?: string | null; note?: string | null } | null | undefined) => {
  const name = String(c?.name ?? "").trim().slice(0, 120);
  if (!name) return null;
  const phone = c?.phone ? String(c.phone).trim().slice(0, 40) : null;
  // A bad number on a standing order would fail the recipient's text every day; refuse it once, here.
  if (phone && phone.replace(/\D/g, "").length < 10) throw new CommercialError("A contact phone must be a 10-digit US number.");
  return { name, phone, note: c?.note ? String(c.note).trim().slice(0, 200) : null };
};

const isLocation = (v: any): v is Location =>
  !!v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && typeof v.address === "string" && v.address.trim().length > 0;

export async function createStandingOrder(input: StandingOrderInput): Promise<CommercialStandingOrder> {
  const org = await getOrganization(input.organizationId);
  if (!org) throw new CommercialError("Organization not found.", 404);
  if (org.status !== "active") throw new CommercialError("This organization is paused.", 409);
  // A standing delivery: the "passenger" is who receives the parcel, there
  // is no return leg, and the account pays (a recurring recipient-pays job
  // would text the recipient every day — not in this version).
  const kind = input.kind === "delivery" ? "delivery" : "ride";
  let parcel: { parcelSize: string; handover: string; pickupContact: NonNullable<ReturnType<typeof contactOf>>; dropContact: NonNullable<ReturnType<typeof contactOf>>; windowHours: number } | null = null;
  if (kind === "delivery") {
    if (!categoryMayBook(org.category, "delivery")) throw new CommercialError("This account books rides, not deliveries. A delivery account is a business or food account.", 409);
    if (input.payer === "recipient") throw new CommercialError("A standing delivery is billed to your account. Book a one-off delivery for the recipient to pay.");
    if (!isParcelSize(input.parcelSize)) throw new CommercialError("Pick what is being sent: envelope, small, medium or large.");
    if (input.handover != null && !isHandoverKind(input.handover)) throw new CommercialError("How does it change hands? Hand to the person, leave with reception, or leave at the door.");
    const pickupContact = contactOf(input.pickupContact), dropContact = contactOf(input.dropContact);
    if (!pickupContact) throw new CommercialError("Who hands the parcel over? A pickup contact is needed.");
    if (!dropContact) throw new CommercialError("Who receives it? A drop contact is needed.");
    const windowHours = Number(input.windowHours ?? DEFAULT_WINDOW_HOURS);
    if (!Number.isFinite(windowHours) || windowHours < 1 || windowHours > 12) throw new CommercialError("The window must be between 1 and 12 hours.");
    parcel = { parcelSize: String(input.parcelSize), handover: handoverOf(input.handover), pickupContact, dropContact, windowHours };
  }
  const passengerName = parcel ? parcel.dropContact.name : String(input.passengerName ?? "").trim().slice(0, 120);
  if (!passengerName) throw new CommercialError("Who rides? A passenger name is needed.");
  if (!isLocation(input.pickup) || !isLocation(input.destination)) throw new CommercialError("Pickup and destination need an address with coordinates.");
  const schedule = { days: normalizePlanDays(input.days), departureHour: Number(input.departureHour), departureMinute: Number(input.departureMinute), returnMode: parcel ? "none" as ReturnMode : input.returnMode, returnHour: parcel ? null : input.returnHour ?? null, returnMinute: parcel ? null : input.returnMinute ?? null };
  const v = validateStandingSchedule(schedule);
  if (!v.valid) throw new CommercialError(v.error);
  const vehicleType = (input.vehicleType ?? "standard").toString();
  if (!(VEHICLE_TYPES as readonly string[]).includes(vehicleType)) throw new CommercialError("Vehicle type must be standard, xl, suv or wheelchair.");
  const [row] = await db.insert(commercialStandingOrders).values({
    organizationId: org.id,
    createdBy: input.createdBy,
    passengerName,
    passengerPhone: input.passengerPhone ? String(input.passengerPhone).trim().slice(0, 40) : null,
    pickup: input.pickup,
    destination: input.destination,
    days: schedule.days,
    departureHour: schedule.departureHour,
    departureMinute: schedule.departureMinute,
    returnMode: schedule.returnMode,
    returnHour: schedule.returnMode === "fixed" ? Number(schedule.returnHour) : null,
    returnMinute: schedule.returnMode === "fixed" ? Number(schedule.returnMinute) : null,
    vehicleType: parcel && !input.vehicleType ? SIZE_VEHICLE_HINT[parcel.parcelSize as keyof typeof SIZE_VEHICLE_HINT] ?? vehicleType : vehicleType,
    notes: input.notes ? String(input.notes).trim().slice(0, 2000) : null,
    poNumber: input.poNumber ? String(input.poNumber).trim().slice(0, 60) : null,
    kind,
    parcelSize: parcel?.parcelSize ?? null,
    handover: parcel?.handover ?? null,
    pickupContact: parcel ? { ...parcel.pickupContact, phone: parcel.pickupContact.phone ?? undefined, note: parcel.pickupContact.note ?? undefined } : null,
    dropContact: parcel ? { ...parcel.dropContact, phone: parcel.dropContact.phone ?? undefined, note: parcel.dropContact.note ?? undefined } : null,
    windowHours: parcel?.windowHours ?? null,
  }).returning();
  return row;
}

export async function listStandingOrders(organizationId: string): Promise<CommercialStandingOrder[]> {
  return db.select().from(commercialStandingOrders)
    .where(eq(commercialStandingOrders.organizationId, organizationId))
    .orderBy(desc(commercialStandingOrders.isActive), commercialStandingOrders.departureHour, commercialStandingOrders.departureMinute);
}

export async function setStandingOrderActive(organizationId: string, id: string, active: boolean): Promise<CommercialStandingOrder> {
  const [row] = await db.update(commercialStandingOrders)
    .set({ isActive: active, pausedAt: active ? null : new Date(), updatedAt: new Date() })
    .where(and(eq(commercialStandingOrders.id, id), eq(commercialStandingOrders.organizationId, organizationId)))
    .returning();
  if (!row) throw new CommercialError("Standing order not found.", 404);
  return row;
}

/**
 * Book every job a standing order is due between now and the horizon that
 * is not booked yet. Safe to call from any number of sweeps: the
 * (order, service date, leg) unique index makes a duplicate a no-op.
 */
export async function materializeStandingOrder(storage: IStorage, order: CommercialStandingOrder, now: Date = new Date(), notify?: (b: BookedJob) => void): Promise<number> {
  if (!order.isActive) return 0;
  const existing = await db.select({ serviceDate: commercialJobs.serviceDate, leg: commercialJobs.leg })
    .from(commercialJobs).where(eq(commercialJobs.standingOrderId, order.id));
  const have = new Set(existing.map((e) => `${e.serviceDate}:${e.leg}`));
  const due = standingOccurrences(
    { days: order.days ?? [], departureHour: order.departureHour, departureMinute: order.departureMinute, returnMode: (isReturnMode(order.returnMode) ? order.returnMode : "none"), returnHour: order.returnHour, returnMinute: order.returnMinute },
    now, STANDING_ORDER_BOOK_AHEAD_DAYS,
  );
  let booked = 0;
  for (const occ of due) {
    if (have.has(`${occ.serviceDate}:${occ.leg}`)) continue;
    const outbound = occ.leg === "out";
    try {
      if (order.kind === "delivery" && order.parcelSize) {
        const b = await bookDelivery(storage, {
          organizationId: order.organizationId,
          requesterId: order.createdBy,
          parcelSize: order.parcelSize,
          handover: order.handover,
          pickupContact: order.pickupContact ?? { name: "Pickup" },
          dropContact: order.dropContact ?? { name: order.passengerName },
          readyAt: occ.at,
          windowHours: order.windowHours ?? DEFAULT_WINDOW_HOURS,
          pickup: order.pickup,
          destination: order.destination,
          vehicleType: order.vehicleType,
          notes: order.notes,
          poNumber: order.poNumber,
          askRecipient: false,
        }, now, { orderId: order.id, serviceDate: occ.serviceDate, leg: "out" });
        booked += 1;
        notify?.(b);
        continue;
      }
      const b = await bookJob(storage, {
        organizationId: order.organizationId,
        requesterId: order.createdBy,
        passengerName: order.passengerName,
        passengerPhone: order.passengerPhone,
        pickup: outbound ? order.pickup : order.destination,
        destination: outbound ? order.destination : order.pickup,
        scheduledAt: occ.at,
        vehicleType: order.vehicleType,
        notes: order.notes,
        poNumber: order.poNumber,
        standing: { orderId: order.id, serviceDate: occ.serviceDate, leg: occ.leg },
      }, now);
      booked += 1;
      notify?.(b);
    } catch (err: any) {
      // 23505 = another sweep booked the same (order, date, leg) first.
      if (err?.code === "23505" || err?.cause?.code === "23505") continue;
      console.error(`[commercial] standing order ${order.id} ${occ.serviceDate} ${occ.leg} not booked:`, err?.message ?? err);
    }
  }
  return booked;
}

export async function materializeAllStandingOrders(storage: IStorage, now: Date = new Date(), notify?: (b: BookedJob) => void): Promise<{ orders: number; booked: number }> {
  const active = await db.select({ order: commercialStandingOrders })
    .from(commercialStandingOrders)
    .innerJoin(organizations, eq(organizations.id, commercialStandingOrders.organizationId))
    .where(and(eq(commercialStandingOrders.isActive, true), eq(organizations.status, "active")));
  let booked = 0;
  for (const { order } of active) booked += await materializeStandingOrder(storage, order, now, notify);
  return { orders: active.length, booked };
}

/**
 * "Passenger ready": book the return of an outbound job now. The pickup is
 * where the outbound job dropped them; the return is dispatched at least the
 * organization's will-call lead out, skipping the three-hour booking rule.
 */
export async function bookWillCallReturn(storage: IStorage, organizationId: string, jobId: string, actorUserId: string, readyInMinutes: number | undefined, now: Date = new Date()): Promise<BookedJob> {
  const [row] = await db.select({ job: commercialJobs, ride: rides, org: organizations })
    .from(commercialJobs)
    .innerJoin(rides, eq(rides.id, commercialJobs.rideId))
    .innerJoin(organizations, eq(organizations.id, commercialJobs.organizationId))
    .where(and(eq(commercialJobs.id, jobId), eq(commercialJobs.organizationId, organizationId)));
  if (!row) throw new CommercialError("Job not found.", 404);
  if (row.job.leg === "return") throw new CommercialError("This is already a return trip.", 409);
  if (row.ride.status === "cancelled" || row.ride.status === "no_show") throw new CommercialError("That trip was cancelled; book a new job instead.", 409);
  const [already] = await db.select({ id: commercialJobs.id }).from(commercialJobs).where(eq(commercialJobs.returnOf, jobId));
  if (row.job.parcelSize) throw new CommercialError("A parcel has no return leg.", 409);
  if (already) throw new CommercialError("A return is already booked for this trip.", 409);
  const terms = orgTerms(row.org.terms);
  const lead = Math.max(terms.willCallLeadMinutes, Math.round(Number(readyInMinutes) || 0));
  const at = new Date(now.getTime() + lead * 60_000);
  return bookJob(storage, {
    organizationId,
    requesterId: actorUserId,
    passengerName: row.ride.passengerName ?? "Passenger",
    passengerPhone: row.ride.passengerPhone,
    pickup: row.ride.destinationLocation,
    destination: row.ride.pickupLocation,
    scheduledAt: at,
    vehicleType: row.ride.requestedVehicleType,
    notes: row.job.notes,
    poNumber: row.job.poNumber,
    standing: row.job.standingOrderId ? { orderId: row.job.standingOrderId, serviceDate: row.job.serviceDate ?? undefined, leg: "return" } : undefined,
    returnOf: jobId,
    allowShortLead: true,
  }, now);
}

/** How many jobs a standing order has produced, for the portal's list. */
export async function standingOrderJobCounts(organizationId: string): Promise<Record<string, number>> {
  const rows = await db.select({ id: commercialJobs.standingOrderId, n: sql<number>`count(*)::int` })
    .from(commercialJobs)
    .where(and(eq(commercialJobs.organizationId, organizationId), sql`${commercialJobs.standingOrderId} IS NOT NULL`))
    .groupBy(commercialJobs.standingOrderId);
  const out: Record<string, number> = {};
  for (const r of rows) if (r.id) out[r.id] = Number(r.n);
  return out;
}
