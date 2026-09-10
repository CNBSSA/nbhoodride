/**
 * Commercial jobs — booking for a client, and listing what an organization
 * has booked.
 *
 * A job is a normal row in `rides` (so drivers claim it from the same board,
 * the sweep pages on it, receipts and completion work unchanged) plus a
 * `commercial_jobs` row that says which organization it belongs to and what
 * it will be billed. The ride's rider is the requester: the member who
 * booked it (or the admin booking on the organization's behalf), so ride
 * updates reach the desk. The passenger is carried by name and phone, the
 * way "ride for a friend" already does.
 *
 * Slice 1 books scheduled jobs only; a facility books ahead, and the
 * ride-now matching engine stays untouched.
 */

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { commercialJobs, organizations, rides, users, type CommercialJob, type Ride } from "@shared/schema";
import { checkScheduleTime } from "@shared/schedulingPolicy";
import { estimateRoute } from "@shared/routeEstimate";
import { DEFAULT_VEHICLE_FARE_MULTIPLIERS, VEHICLE_TYPES } from "@shared/vehicleTypes";
import { jobTotal } from "@shared/commercial";
import { estimateFare, validateRideRequest, type Location } from "../rideWorkflowService";
import type { IStorage } from "../storage";
import { CommercialError, getOrganization } from "./organizations";

export interface BookJobInput {
  organizationId: string;
  /** The user the ride belongs to on the rider side. */
  requesterId: string;
  passengerName: string;
  passengerPhone?: string | null;
  pickup: Location;
  destination: Location;
  scheduledAt: string | Date;
  vehicleType?: string | null;
  notes?: string | null;
  poNumber?: string | null;
}

export interface BookedJob {
  ride: Ride;
  job: CommercialJob;
  pickupCounty: string | null;
}

const isLocation = (v: any): v is Location =>
  !!v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && typeof v.address === "string" && v.address.trim().length > 0;

export async function bookJob(storage: IStorage, input: BookJobInput, now: Date = new Date()): Promise<BookedJob> {
  const org = await getOrganization(input.organizationId);
  if (!org) throw new CommercialError("Organization not found.", 404);
  if (org.status !== "active") throw new CommercialError("This organization is paused; nothing can be booked for it until it is active again.", 409);

  const passengerName = String(input.passengerName ?? "").trim().slice(0, 120);
  if (!passengerName) throw new CommercialError("Who is riding? A passenger name is needed.");
  if (!isLocation(input.pickup) || !isLocation(input.destination)) throw new CommercialError("Pickup and destination need an address with coordinates.");
  if (!input.scheduledAt) throw new CommercialError("Commercial jobs are booked ahead: a pickup time is needed.");
  const schedule = checkScheduleTime(input.scheduledAt, now);
  if (!schedule.valid) throw new CommercialError(schedule.error ?? "That pickup time is not allowed.");
  const vehicleType = (input.vehicleType ?? "standard").toString();
  if (!(VEHICLE_TYPES as readonly string[]).includes(vehicleType)) throw new CommercialError("Vehicle type must be standard, xl, suv or wheelchair.");

  const validation = await validateRideRequest(input.requesterId, input.pickup, input.destination);
  if (!validation.valid) throw new CommercialError(validation.error ?? "That trip cannot be booked.");

  // The live rate card; the defaults fill any multiplier an older row lacks.
  const rates = { xlMultiplier: DEFAULT_VEHICLE_FARE_MULTIPLIERS.xl, suvMultiplier: DEFAULT_VEHICLE_FARE_MULTIPLIERS.suv, ...(await storage.getPlatformRates()) };
  const route = estimateRoute([input.pickup, input.destination]);
  const miles = route.miles > 0 ? route.miles : (validation.distanceMiles ?? 0);
  const minutes = route.minutes > 0 ? route.minutes : (validation.durationMinutes ?? 0);
  const quote = estimateFare(miles, minutes, { rates, vehicleType });

  const ride = await storage.createRide({
    riderId: input.requesterId,
    pickupLocation: input.pickup,
    destinationLocation: input.destination,
    estimatedFare: quote.total.toFixed(2),
    paymentMethod: "invoice",
    status: "pending",
    scheduledAt: new Date(input.scheduledAt),
    pickupCounty: validation.pickupCounty ?? null,
    distance: miles.toFixed(2),
    duration: Math.round(minutes),
    requestedVehicleType: vehicleType,
    vehicleFareMultiplier: ((quote as any).vehicleMultiplier ?? 1).toFixed(2),
    rideType: "commercial",
    bookedForFriend: true,
    passengerName,
    passengerPhone: input.passengerPhone ? String(input.passengerPhone).trim().slice(0, 40) : null,
    pickupInstructions: input.notes ? String(input.notes).trim().slice(0, 500) : null,
  } as any);

  const [job] = await db.insert(commercialJobs).values({
    rideId: ride.id,
    organizationId: org.id,
    requesterId: input.requesterId,
    category: org.category,
    facilityFee: org.facilityFee,
    poNumber: input.poNumber ? String(input.poNumber).trim().slice(0, 60) : null,
    notes: input.notes ? String(input.notes).trim().slice(0, 2000) : null,
  }).returning();

  return { ride, job, pickupCounty: validation.pickupCounty ?? null };
}

export interface JobRow {
  id: string;
  jobNumber: number;
  rideId: string;
  organizationId: string;
  category: string;
  status: string;
  scheduledAt: Date | null;
  createdAt: Date;
  completedAt: Date | null;
  passengerName: string | null;
  passengerPhone: string | null;
  pickup: { lat: number; lng: number; address: string };
  destination: { lat: number; lng: number; address: string };
  vehicleType: string | null;
  estimatedFare: string | null;
  actualFare: string | null;
  facilityFee: string;
  waitFee: string;
  cancellationFee: string;
  poNumber: string | null;
  notes: string | null;
  driverName: string | null;
  /** What the organization is billed for it in its current state. */
  total: number;
}

export interface ListJobsOptions {
  from?: Date;
  to?: Date;
  limit?: number;
}

/** An organization's jobs, newest service time first. Always scoped by organization. */
export async function listJobs(organizationId: string, opts: ListJobsOptions = {}): Promise<JobRow[]> {
  const conds = [eq(commercialJobs.organizationId, organizationId)];
  const serviceAt = sql`COALESCE(${rides.scheduledAt}, ${rides.createdAt})`;
  if (opts.from) conds.push(gte(serviceAt, opts.from));
  if (opts.to) conds.push(lt(serviceAt, opts.to));
  const rows = await db
    .select({ job: commercialJobs, ride: rides, driverFirst: users.firstName, driverLast: users.lastName })
    .from(commercialJobs)
    .innerJoin(rides, eq(rides.id, commercialJobs.rideId))
    .leftJoin(users, eq(users.id, rides.driverId))
    .where(and(...conds))
    .orderBy(desc(serviceAt))
    .limit(Math.min(Math.max(opts.limit ?? 200, 1), 1000));
  return rows.map(({ job, ride, driverFirst, driverLast }) => {
    const cancellationFee = Number(job.cancellationFee) > 0 ? job.cancellationFee : (ride.cancellationFee ?? "0.00");
    const status = ride.status ?? "pending";
    return {
      id: job.id,
      jobNumber: job.jobNumber,
      rideId: ride.id,
      organizationId: job.organizationId,
      category: job.category,
      status,
      scheduledAt: ride.scheduledAt,
      createdAt: ride.createdAt ?? job.createdAt,
      completedAt: ride.completedAt,
      passengerName: ride.passengerName,
      passengerPhone: ride.passengerPhone,
      pickup: ride.pickupLocation,
      destination: ride.destinationLocation,
      vehicleType: ride.requestedVehicleType,
      estimatedFare: ride.estimatedFare,
      actualFare: ride.actualFare,
      facilityFee: job.facilityFee,
      waitFee: job.waitFee,
      cancellationFee,
      poNumber: job.poNumber,
      notes: job.notes,
      driverName: driverFirst ? `${driverFirst} ${(driverLast ?? "").charAt(0)}${driverLast ? "." : ""}`.trim() : null,
      total: jobTotal(status, { fare: ride.actualFare ?? ride.estimatedFare, facilityFee: job.facilityFee, waitFee: job.waitFee, cancellationFee }),
    };
  });
}

/** For paging and notifications: which organization a ride belongs to, if any. */
export async function jobForRide(rideId: string): Promise<{ organizationName: string; jobNumber: number; category: string } | null> {
  const [row] = await db
    .select({ organizationName: organizations.name, jobNumber: commercialJobs.jobNumber, category: commercialJobs.category })
    .from(commercialJobs)
    .innerJoin(organizations, eq(organizations.id, commercialJobs.organizationId))
    .where(eq(commercialJobs.rideId, rideId));
  return row ?? null;
}
