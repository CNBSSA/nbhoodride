/**
 * Ride Workflow Service
 *
 * Implements the complete production-ready ride lifecycle:
 *  1. Ride request validation & fare estimation (service area, distance limits)
 *  2. Automatic driver matching (geolocation, county, rating, ETA)
 *  3. Acceptance timeout & reassignment (60-second window, up to 3 attempts)
 *  4. Pickup/dropoff confirmation flow
 *  5. Cancellation fee logic
 *  6. Shared ride optimization (grouping, discount calculation)
 *  7. Ride history & receipt generation
 *  8. Audit logging for all state transitions
 *  9. Rate limiting for ride requests (max 10/hour per user)
 * 10. Emergency SOS helpers
 */

import { db } from "./db";
import {
  rides,
  users,
  driverProfiles,
  vehicles,
  adminActivityLog,
} from "@shared/schema";
import {
  eq,
  and,
  or,
  inArray,
  gte,
  count,
} from "drizzle-orm";
import { getCountyFromCoords, driverCoversCounty } from "./countyService";

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum straight-line distance (miles) allowed for a single ride */
export const MAX_RIDE_DISTANCE_MILES = 50;

/** Radius (miles) used when searching for nearby drivers */
export const DRIVER_SEARCH_RADIUS_MILES = 5;

/** How long (seconds) a driver has to accept before the ride is reassigned */
export const ACCEPTANCE_TIMEOUT_SECONDS = 60;

/** Maximum number of driver assignment attempts before auto-cancelling */
export const MAX_ASSIGNMENT_ATTEMPTS = 3;

/** Maximum ride requests a single rider may submit per hour */
export const MAX_RIDE_REQUESTS_PER_HOUR = 10;

/** Maryland bounding box — rough check before Nominatim reverse-geocode */
const MD_BOUNDS = {
  latMin: 37.9,
  latMax: 39.75,
  lngMin: -79.5,
  lngMax: -74.98,
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface Location {
  lat: number;
  lng: number;
  address: string;
}

export interface FareEstimate {
  baseFare: number;
  timeCharge: number;
  distanceCharge: number;
  surgeAdjustment: number;
  subtotal: number;
  total: number;
  promoDiscount: number;
  sharedDiscount: number;
  totalAfterDiscounts: number;
  distanceMiles: number;
  durationMinutes: number;
  formula: string;
}

export interface DriverMatch {
  userId: string;
  driverProfileId: string;
  distanceMiles: number;
  etaMinutes: number;
  rating: string;
  firstName: string | null;
  lastName: string | null;
  vehicle: string | null;
  licensePlate: string | null;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  pickupCounty?: string | null;
  destinationCounty?: string | null;
  distanceMiles?: number;
  durationMinutes?: number;
}

export interface RideAuditEntry {
  rideId: string;
  event: string;
  actorId?: string;
  details?: Record<string, any>;
}

// ── Haversine helper ─────────────────────────────────────────────────────────

export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── 1. Validation ────────────────────────────────────────────────────────────

/**
 * Validate a ride request before creating it.
 * Checks:
 *  - Coordinates are finite numbers
 *  - Both points are within Maryland bounding box
 *  - Distance does not exceed MAX_RIDE_DISTANCE_MILES
 *  - Rider has not exceeded MAX_RIDE_REQUESTS_PER_HOUR
 */
export async function validateRideRequest(
  riderId: string,
  pickup: Location,
  destination: Location
): Promise<ValidationResult> {
  // Coordinate sanity
  if (
    !Number.isFinite(pickup.lat) ||
    !Number.isFinite(pickup.lng) ||
    !Number.isFinite(destination.lat) ||
    !Number.isFinite(destination.lng)
  ) {
    return { valid: false, error: "Invalid coordinates provided" };
  }

  // Maryland bounding box check
  const inMd = (lat: number, lng: number) =>
    lat >= MD_BOUNDS.latMin &&
    lat <= MD_BOUNDS.latMax &&
    lng >= MD_BOUNDS.lngMin &&
    lng <= MD_BOUNDS.lngMax;

  if (!inMd(pickup.lat, pickup.lng)) {
    return {
      valid: false,
      error: "Pickup location is outside the Maryland service area",
    };
  }
  if (!inMd(destination.lat, destination.lng)) {
    return {
      valid: false,
      error: "Destination is outside the Maryland service area",
    };
  }

  // Distance limit
  const distanceMiles = haversineMiles(
    pickup.lat,
    pickup.lng,
    destination.lat,
    destination.lng
  );
  if (distanceMiles > MAX_RIDE_DISTANCE_MILES) {
    return {
      valid: false,
      error: `Ride distance (${distanceMiles.toFixed(1)} mi) exceeds the ${MAX_RIDE_DISTANCE_MILES}-mile limit`,
    };
  }

  // Rate limit: max 10 ride requests per hour per rider
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [{ recentCount }] = await db
    .select({ recentCount: count() })
    .from(rides)
    .where(
      and(
        eq(rides.riderId, riderId),
        gte(rides.createdAt, oneHourAgo)
      )
    );

  if (recentCount >= MAX_RIDE_REQUESTS_PER_HOUR) {
    return {
      valid: false,
      error: `You have reached the maximum of ${MAX_RIDE_REQUESTS_PER_HOUR} ride requests per hour. Please try again later.`,
    };
  }

  // Reverse-geocode counties (best-effort, non-blocking)
  let pickupCounty: string | null = null;
  let destinationCounty: string | null = null;
  try {
    [pickupCounty, destinationCounty] = await Promise.all([
      getCountyFromCoords(pickup.lat, pickup.lng),
      getCountyFromCoords(destination.lat, destination.lng),
    ]);
  } catch {
    // County detection is best-effort
  }

  // Estimate road distance (straight-line × 1.3 road factor)
  const roadMiles = distanceMiles * 1.3;
  const durationMinutes = Math.max(5, Math.round((roadMiles / 25) * 60));

  return {
    valid: true,
    pickupCounty,
    destinationCounty,
    distanceMiles: Math.round(roadMiles * 100) / 100,
    durationMinutes,
  };
}

// ── 2. Fare Estimation ───────────────────────────────────────────────────────

const SUGGESTED_RATES = {
  minimumFare: 7.65,
  baseFare: 4.0,
  perMinuteRate: 0.29,
  perMileRate: 0.9,
  surgeAdjustment: 0,
};

/**
 * Calculate a full fare estimate including promo and shared discounts.
 */
export function estimateFare(
  distanceMiles: number,
  durationMinutes: number,
  options: {
    rates?: typeof SUGGESTED_RATES;
    promoRidesRemaining?: number;
    wantsSharedRide?: boolean;
    sharedDiscountPct?: number;
  } = {}
): FareEstimate {
  const rates = options.rates ?? SUGGESTED_RATES;
  const baseFare = rates.baseFare;
  const timeCharge = rates.perMinuteRate * durationMinutes;
  const distanceCharge = rates.perMileRate * distanceMiles;
  const surgeAdjustment = rates.surgeAdjustment;
  const subtotal = baseFare + timeCharge + distanceCharge + surgeAdjustment;
  const total = Math.max(rates.minimumFare, Math.min(100, subtotal));

  const promoDiscount =
    (options.promoRidesRemaining ?? 0) > 0 ? Math.min(5, total) : 0;

  const sharedDiscountPct = options.wantsSharedRide
    ? (options.sharedDiscountPct ?? 30)
    : 0;
  const sharedDiscount = (total * sharedDiscountPct) / 100;

  const totalAfterDiscounts = Math.max(
    0,
    total - promoDiscount - sharedDiscount
  );

  return {
    baseFare: round2(baseFare),
    timeCharge: round2(timeCharge),
    distanceCharge: round2(distanceCharge),
    surgeAdjustment: round2(surgeAdjustment),
    subtotal: round2(subtotal),
    total: round2(total),
    promoDiscount: round2(promoDiscount),
    sharedDiscount: round2(sharedDiscount),
    totalAfterDiscounts: round2(totalAfterDiscounts),
    distanceMiles: round2(distanceMiles),
    durationMinutes,
    formula: `Base $${rates.baseFare.toFixed(2)} + ($${rates.perMinuteRate}/min × ${durationMinutes} min) + ($${rates.perMileRate}/mi × ${distanceMiles.toFixed(2)} mi)`,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── 3. Automatic Driver Matching ─────────────────────────────────────────────

/**
 * Find the best available driver for a ride.
 *
 * Ranking criteria (in order):
 *  1. Online status (online drivers first)
 *  2. Distance to pickup (closest first)
 *  3. Rating (highest first)
 *
 * Filters:
 *  - Not suspended
 *  - Not currently on an active pre-start ride (accepted / driver_arriving)
 *  - Covers the pickup county
 *  - Within DRIVER_SEARCH_RADIUS_MILES (falls back to all available if none nearby)
 */
export async function findBestDriver(
  pickupLocation: Location,
  pickupCounty: string | null,
  excludeDriverIds: string[] = []
): Promise<DriverMatch | null> {
  // Fetch all non-suspended drivers with their user and vehicle info
  const results = await db
    .select()
    .from(driverProfiles)
    .innerJoin(users, eq(driverProfiles.userId, users.id))
    .leftJoin(vehicles, eq(vehicles.driverProfileId, driverProfiles.id))
    .where(
      and(
        eq(driverProfiles.isSuspended, false),
        eq(users.isSuspended, false)
      )
    );

  // Build driver map (deduplicate by driverProfileId)
  const driversMap = new Map<
    string,
    {
      profile: typeof results[0]["driver_profiles"];
      user: typeof results[0]["users"];
      vehicles: (typeof results[0]["vehicles"])[];
    }
  >();
  for (const row of results) {
    const id = row.driver_profiles.id;
    if (!driversMap.has(id)) {
      driversMap.set(id, {
        profile: row.driver_profiles,
        user: row.users,
        vehicles: [],
      });
    }
    if (row.vehicles) {
      driversMap.get(id)!.vehicles.push(row.vehicles);
    }
  }

  const allDrivers = Array.from(driversMap.values());

  // Exclude already-tried drivers
  const candidates = allDrivers.filter(
    (d) => !excludeDriverIds.includes(d.profile.userId)
  );

  // Filter by county preference
  const countyFiltered = candidates.filter((d) =>
    driverCoversCounty(d.profile.acceptedCounties ?? [], pickupCounty)
  );

  // Filter out drivers with active pre-start rides
  const driverUserIds = countyFiltered.map((d) => d.profile.userId);
  let busyDriverIds = new Set<string>();
  if (driverUserIds.length > 0) {
    const activeRides = await db
      .select({ driverId: rides.driverId })
      .from(rides)
      .where(
        and(
          inArray(rides.driverId, driverUserIds),
          or(
            eq(rides.status, "accepted"),
            eq(rides.status, "driver_arriving")
          )
        )
      );
    busyDriverIds = new Set(
      activeRides.map((r) => r.driverId).filter(Boolean) as string[]
    );
  }

  const available = countyFiltered.filter(
    (d) => !busyDriverIds.has(d.profile.userId)
  );

  if (available.length === 0) return null;

  // Default location for drivers without GPS
  const PG_CENTER = { lat: 38.9073, lng: -76.7781 };

  // Compute distance to pickup for each driver
  const withDistance = available.map((d) => {
    const loc = (d.profile.currentLocation as { lat: number; lng: number } | null) ?? PG_CENTER;
    const distanceMiles = haversineMiles(
      pickupLocation.lat,
      pickupLocation.lng,
      loc.lat,
      loc.lng
    );
    const etaMinutes = Math.max(2, Math.round((distanceMiles * 1.3) / 25 * 60));
    const vehicle = d.vehicles[0]
      ? `${d.vehicles[0].year} ${d.vehicles[0].make} ${d.vehicles[0].model} - ${d.vehicles[0].color}`
      : null;
    return {
      userId: d.profile.userId,
      driverProfileId: d.profile.id,
      distanceMiles,
      etaMinutes,
      rating: d.user.rating ?? "5.00",
      firstName: d.user.firstName,
      lastName: d.user.lastName,
      vehicle,
      licensePlate: d.vehicles[0]?.licensePlate ?? null,
      isOnline: d.profile.isOnline,
    };
  });

  // Prefer drivers within search radius; fall back to all available
  const nearby = withDistance.filter(
    (d) => d.distanceMiles <= DRIVER_SEARCH_RADIUS_MILES
  );
  const pool = nearby.length > 0 ? nearby : withDistance;

  // Sort: online first, then by distance, then by rating (desc)
  pool.sort((a, b) => {
    if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
    if (a.distanceMiles !== b.distanceMiles)
      return a.distanceMiles - b.distanceMiles;
    return parseFloat(b.rating) - parseFloat(a.rating);
  });

  const best = pool[0];
  return {
    userId: best.userId,
    driverProfileId: best.driverProfileId,
    distanceMiles: round2(best.distanceMiles),
    etaMinutes: best.etaMinutes,
    rating: best.rating,
    firstName: best.firstName,
    lastName: best.lastName,
    vehicle: best.vehicle,
    licensePlate: best.licensePlate,
  };
}

// ── 4. Acceptance Timeout & Reassignment ─────────────────────────────────────

/**
 * In-memory map of pending acceptance timeouts.
 * Key: rideId, Value: NodeJS.Timeout handle
 */
const acceptanceTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Start a 60-second acceptance timer for a ride.
 * If the driver does not accept within the window, the ride is reassigned
 * to the next best driver (up to MAX_ASSIGNMENT_ATTEMPTS).
 *
 * @param rideId        The ride to monitor
 * @param driverId      The driver currently assigned
 * @param pickupLocation Pickup coordinates for re-matching
 * @param pickupCounty  County for driver filtering
 * @param attemptNumber Current attempt number (1-based)
 * @param onReassign    Callback invoked with the new driverId when reassigned
 * @param onCancel      Callback invoked when all attempts exhausted
 */
export function startAcceptanceTimer(
  rideId: string,
  driverId: string,
  pickupLocation: Location,
  pickupCounty: string | null,
  attemptNumber: number,
  onReassign: (newDriverId: string, etaMinutes: number) => void,
  onCancel: () => void
): void {
  // Clear any existing timer for this ride
  clearAcceptanceTimer(rideId);

  const handle = setTimeout(async () => {
    acceptanceTimeouts.delete(rideId);

    try {
      // Check if the ride was already accepted (race condition guard)
      const [ride] = await db
        .select({ status: rides.status, driverId: rides.driverId })
        .from(rides)
        .where(eq(rides.id, rideId));

      if (!ride || ride.status !== "pending") {
        // Already accepted or cancelled — nothing to do
        return;
      }

      await logRideAudit({
        rideId,
        event: "acceptance_timeout",
        actorId: driverId,
        details: { attemptNumber, timeoutSeconds: ACCEPTANCE_TIMEOUT_SECONDS },
      });

      if (attemptNumber >= MAX_ASSIGNMENT_ATTEMPTS) {
        // Auto-cancel after exhausting all attempts
        await db
          .update(rides)
          .set({
            status: "cancelled",
            cancellationReason: "No driver accepted the ride after multiple attempts",
            updatedAt: new Date(),
          })
          .where(and(eq(rides.id, rideId), eq(rides.status, "pending")));

        await logRideAudit({
          rideId,
          event: "auto_cancelled_no_driver",
          details: { attempts: attemptNumber },
        });

        onCancel();
        return;
      }

      // Find next best driver (exclude all previously tried drivers)
      const triedDrivers = await getTriedDriversForRide(rideId);
      const nextDriver = await findBestDriver(
        pickupLocation,
        pickupCounty,
        triedDrivers
      );

      if (!nextDriver) {
        // No more drivers available — cancel
        await db
          .update(rides)
          .set({
            status: "cancelled",
            cancellationReason: "No available drivers in your area",
            updatedAt: new Date(),
          })
          .where(and(eq(rides.id, rideId), eq(rides.status, "pending")));

        await logRideAudit({
          rideId,
          event: "auto_cancelled_no_drivers_available",
          details: { attempts: attemptNumber },
        });

        onCancel();
        return;
      }

      // Reassign to next driver
      await db
        .update(rides)
        .set({ driverId: nextDriver.userId, updatedAt: new Date() })
        .where(and(eq(rides.id, rideId), eq(rides.status, "pending")));

      await logRideAudit({
        rideId,
        event: "reassigned_to_driver",
        actorId: nextDriver.userId,
        details: {
          previousDriverId: driverId,
          attemptNumber: attemptNumber + 1,
          etaMinutes: nextDriver.etaMinutes,
        },
      });

      // Start a new timer for the reassigned driver
      startAcceptanceTimer(
        rideId,
        nextDriver.userId,
        pickupLocation,
        pickupCounty,
        attemptNumber + 1,
        onReassign,
        onCancel
      );

      onReassign(nextDriver.userId, nextDriver.etaMinutes);
    } catch (err) {
      console.error(`[AcceptanceTimer] Error processing timeout for ride ${rideId}:`, err);
    }
  }, ACCEPTANCE_TIMEOUT_SECONDS * 1000);

  acceptanceTimeouts.set(rideId, handle);
}

/** Cancel the acceptance timer for a ride (e.g., when driver accepts). */
export function clearAcceptanceTimer(rideId: string): void {
  const handle = acceptanceTimeouts.get(rideId);
  if (handle) {
    clearTimeout(handle);
    acceptanceTimeouts.delete(rideId);
  }
}

/**
 * Track which drivers have been tried for a ride by reading the audit log.
 * Falls back to just the current driverId if audit log is unavailable.
 */
async function getTriedDriversForRide(rideId: string): Promise<string[]> {
  try {
    const entries = await db
      .select({ details: adminActivityLog.details })
      .from(adminActivityLog)
      .where(
        and(
          eq(adminActivityLog.targetId, rideId),
          eq(adminActivityLog.action, "ride_audit")
        )
      );

    const tried = new Set<string>();
    for (const entry of entries) {
      const d = entry.details as Record<string, any> | null;
      if (d?.actorId) tried.add(d.actorId);
      if (d?.previousDriverId) tried.add(d.previousDriverId);
    }
    return Array.from(tried);
  } catch {
    return [];
  }
}

// ── 5. Pickup / Dropoff Confirmation ─────────────────────────────────────────

/**
 * Confirm driver has arrived at pickup (geofence check: within 0.25 miles).
 * Returns true if within geofence, false otherwise.
 */
export function isWithinPickupGeofence(
  driverLat: number,
  driverLng: number,
  pickupLat: number,
  pickupLng: number,
  radiusMiles = 0.25
): boolean {
  const dist = haversineMiles(driverLat, driverLng, pickupLat, pickupLng);
  return dist <= radiusMiles;
}

// ── 6. Cancellation Fee Calculation ──────────────────────────────────────────

export interface CancellationFeeResult {
  fee: number;
  reason: string;
}

/**
 * Calculate the cancellation fee based on driver travel distance and time.
 * Only applies when the ride has been accepted and driver has traveled.
 */
export function calculateCancellationFee(
  rideStatus: string,
  driverTraveledDistance: number,
  driverTraveledTime: number
): CancellationFeeResult {
  if (rideStatus !== "accepted" && rideStatus !== "driver_arriving") {
    return { fee: 0, reason: "No fee — ride not yet accepted" };
  }

  if (driverTraveledDistance >= 3 && driverTraveledTime >= 5) {
    return {
      fee: 5.0,
      reason: `Driver traveled ${driverTraveledDistance.toFixed(1)} mi in ${driverTraveledTime} min`,
    };
  }
  if (driverTraveledDistance >= 1.5 && driverTraveledTime >= 3) {
    return {
      fee: 3.5,
      reason: `Driver traveled ${driverTraveledDistance.toFixed(1)} mi in ${driverTraveledTime} min`,
    };
  }

  return { fee: 0, reason: "Driver had not traveled far enough to incur a fee" };
}

// ── 7. Shared Ride Optimization ───────────────────────────────────────────────

export interface SharedRideGroup {
  groupId: string;
  rideIds: string[];
  pickupOrder: string[]; // rideIds in optimal pickup order
  totalRiders: number;
  discountPct: number;
}

/**
 * Determine the optimal pickup order for a shared ride group.
 * Uses a nearest-neighbour heuristic starting from the first pickup.
 */
export function optimizePickupOrder(
  ridePickups: Array<{ rideId: string; lat: number; lng: number }>
): string[] {
  if (ridePickups.length <= 1) return ridePickups.map((r) => r.rideId);

  const remaining = [...ridePickups];
  const ordered: string[] = [];
  let current = remaining.shift()!;
  ordered.push(current.rideId);

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMiles(
        current.lat,
        current.lng,
        remaining[i].lat,
        remaining[i].lng
      );
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    current = remaining.splice(bestIdx, 1)[0];
    ordered.push(current.rideId);
  }

  return ordered;
}

/**
 * Calculate the shared ride discount percentage based on group size.
 * 2 riders → 30%, 3 riders → 35%, 4+ riders → 40%
 */
export function getSharedDiscountPct(riderCount: number): number {
  if (riderCount >= 4) return 40;
  if (riderCount >= 3) return 35;
  if (riderCount >= 2) return 30;
  return 0;
}

// ── 8. Ride History & Receipt ─────────────────────────────────────────────────

export interface RideReceipt {
  rideId: string;
  date: string;
  driverName: string;
  pickupAddress: string;
  destinationAddress: string;
  distanceMiles: number | null;
  durationMinutes: number | null;
  baseFare: number;
  timeCharge: number;
  distanceCharge: number;
  promoDiscount: number;
  sharedDiscount: number;
  tip: number;
  totalCharged: number;
  paymentMethod: string;
  paymentStatus: string;
  riderRating: number | null;
  driverRating: number | null;
}

/**
 * Build a structured receipt object from a completed ride row.
 */
export function buildRideReceipt(
  ride: {
    id: string;
    completedAt: Date | null;
    actualFare: string | null;
    estimatedFare: string | null;
    tipAmount: string | null;
    promoDiscountApplied: string | null;
    sharedFareDiscount: string | null;
    distance: string | null;
    driverTraveledDistance: string | null;
    duration: number | null;
    driverTraveledTime: number | null;
    paymentMethod: string | null;
    paymentStatus: string | null;
    pickupLocation: { address: string } | null;
    destinationLocation: { address: string } | null;
    riderRating: number | null;
    driverRating: number | null;
  },
  driverName: string
): RideReceipt {
  const fare = parseFloat(ride.actualFare ?? ride.estimatedFare ?? "0");
  const tip = parseFloat(ride.tipAmount ?? "0");
  const promoDiscount = parseFloat(ride.promoDiscountApplied ?? "0");
  const sharedDiscount = parseFloat(ride.sharedFareDiscount ?? "0");
  const totalCharged = Math.max(0, fare + tip);

  const distanceMiles = ride.driverTraveledDistance
    ? parseFloat(ride.driverTraveledDistance)
    : ride.distance
    ? parseFloat(ride.distance)
    : null;

  const durationMinutes =
    ride.driverTraveledTime ?? ride.duration ?? null;

  // Reconstruct fare components from the total (approximate)
  const RATES = SUGGESTED_RATES;
  const timeCharge = durationMinutes
    ? round2(RATES.perMinuteRate * durationMinutes)
    : 0;
  const distanceCharge = distanceMiles
    ? round2(RATES.perMileRate * distanceMiles)
    : 0;

  return {
    rideId: ride.id,
    date: ride.completedAt
      ? new Date(ride.completedAt).toLocaleString("en-US", {
          timeZone: "America/New_York",
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "Unknown",
    driverName,
    pickupAddress: ride.pickupLocation?.address ?? "Pickup location",
    destinationAddress: ride.destinationLocation?.address ?? "Destination",
    distanceMiles,
    durationMinutes,
    baseFare: RATES.baseFare,
    timeCharge,
    distanceCharge,
    promoDiscount: round2(promoDiscount),
    sharedDiscount: round2(sharedDiscount),
    tip: round2(tip),
    totalCharged: round2(totalCharged),
    paymentMethod: ride.paymentMethod ?? "card",
    paymentStatus: ride.paymentStatus ?? "unknown",
    riderRating: ride.riderRating,
    driverRating: ride.driverRating,
  };
}

// ── 9. Audit Logging ──────────────────────────────────────────────────────────

/**
 * Log a ride state transition or significant event to the admin activity log.
 * Non-blocking — errors are swallowed so they never interrupt the ride flow.
 */
export async function logRideAudit(entry: RideAuditEntry): Promise<void> {
  try {
    await db.insert(adminActivityLog).values({
      adminId: entry.actorId ?? "system",
      action: "ride_audit",
      targetType: "ride",
      targetId: entry.rideId,
      details: {
        event: entry.event,
        actorId: entry.actorId,
        timestamp: new Date().toISOString(),
        ...entry.details,
      },
    });
  } catch (err) {
    console.error("[RideAudit] Failed to log audit entry:", err);
  }
}

// ── 10. Emergency SOS helpers ─────────────────────────────────────────────────

/**
 * Build the SMS body for an emergency alert.
 */
export function buildEmergencySmsBody(
  userName: string,
  description: string,
  location: { lat: number; lng: number } | null,
  shareUrl: string
): string {
  const locationText = location
    ? `Location: https://maps.google.com/?q=${location.lat},${location.lng}`
    : "Location: Not available";

  return (
    `🚨 EMERGENCY ALERT from ${userName}\n\n` +
    `${description}\n\n` +
    `${locationText}\n\n` +
    `Live tracking: ${shareUrl}\n\n` +
    `Reply STOP to opt out.`
  );
}

// ── 11. Service area check ────────────────────────────────────────────────────

/**
 * Quick bounding-box check — returns true if the coordinate is within Maryland.
 */
export function isInMarylandBounds(lat: number, lng: number): boolean {
  return (
    lat >= MD_BOUNDS.latMin &&
    lat <= MD_BOUNDS.latMax &&
    lng >= MD_BOUNDS.lngMin &&
    lng <= MD_BOUNDS.lngMax
  );
}
