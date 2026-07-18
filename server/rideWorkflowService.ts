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
  sql,
} from "drizzle-orm";
import { getCountyFromCoords, driverCoversCounty } from "./countyService";
import { storage } from "./storage";
import { getDriverTrustContext, filterDriversByTrustPreferences } from "./agents/trust";
import { rankDriversByTrustAndEta } from "@shared/trustScore";
import { normalizeVehicleType, vehicleTypeMatches } from "@shared/vehicleTypes";

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
  trustScore?: number;
  separationDegrees?: number;
  matchReason?: string;
  isFavorite?: boolean;
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
  excludeDriverIds: string[] = [],
  options?: { riderId?: string; requestedVehicleType?: string | null },
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

  const requestedType = options?.requestedVehicleType
    ? normalizeVehicleType(options.requestedVehicleType)
    : undefined;
  const vehicleFiltered = requestedType
    ? available.filter((d) =>
        d.vehicles.some((v) => v && vehicleTypeMatches(requestedType, v.vehicleType)),
      )
    : available;

  if (vehicleFiltered.length === 0) return null;

  // Default location for drivers without GPS
  const PG_CENTER = { lat: 38.9073, lng: -76.7781 };

  // Compute distance to pickup for each driver
  const withDistance = vehicleFiltered.map((d) => {
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
  let pool = nearby.length > 0 ? nearby : withDistance;

  if (options?.riderId) {
    const enriched = await Promise.all(
      pool.map(async (d) => {
        const profile = vehicleFiltered.find((a) => a.profile.userId === d.userId)?.profile;
        const trust = await getDriverTrustContext(storage, options.riderId!, d.userId, {
          avgRating: parseFloat(d.rating),
          isVerifiedNeighbor: profile?.isVerifiedNeighbor ?? false,
        });
        return { ...d, ...trust, separationDegrees: trust.separationDegrees };
      }),
    );
    pool = await filterDriversByTrustPreferences(storage, options.riderId, enriched);
    if (pool.length === 0) return null;
    pool = rankDriversByTrustAndEta(
      pool.map((d) => ({
        ...d,
        isOnline: d.isOnline ?? false,
        trustScore: (d as { trustScore?: number }).trustScore ?? 0,
      })),
    ) as typeof pool;
  } else {
    pool.sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      if (a.distanceMiles !== b.distanceMiles)
        return a.distanceMiles - b.distanceMiles;
      return parseFloat(b.rating) - parseFloat(a.rating);
    });
  }

  // Reliability penalty box: drivers with repeated recent cancellations only
  // match when nobody cleaner is realistically available. Stable ordering —
  // the ranking above is preserved within each tier — with availability
  // outranking the box: an online boxed driver still beats an offline clean
  // one (offline drivers were never excluded from matching, only ranked
  // down, and they'd just time out and bounce the ride anyway).
  if (pool.length > 1) {
    const strikes = await getDriverStrikesBatch(pool.map((d) => d.userId));
    const tier = (d: { userId: string; isOnline?: boolean | null }) =>
      (d.isOnline ? 0 : 2) + ((strikes.get(d.userId) ?? 0) >= DRIVER_DEPRIORITIZED_STRIKES ? 1 : 0);
    pool = pool
      .map((d, i) => ({ d, i }))
      .sort((a, b) => tier(a.d) - tier(b.d) || a.i - b.i)
      .map((x) => x.d);
  }

  const best = pool[0] as typeof pool[0] & {
    trustScore?: number;
    separationDegrees?: number;
    matchReason?: string;
    isFavorite?: boolean;
  };
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
    trustScore: best.trustScore,
    separationDegrees: best.separationDegrees,
    matchReason: best.matchReason,
    isFavorite: best.isFavorite,
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
            cancelledBy: "system",
            cancelledByRole: "system",
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
      const [rideRow] = await db
        .select({ riderId: rides.riderId, requestedVehicleType: rides.requestedVehicleType })
        .from(rides)
        .where(eq(rides.id, rideId));
      const nextDriver = await findBestDriver(
        pickupLocation,
        pickupCounty,
        triedDrivers,
        rideRow?.riderId
          ? {
              riderId: rideRow.riderId,
              requestedVehicleType: rideRow.requestedVehicleType ?? undefined,
            }
          : undefined,
      );

      if (!nextDriver) {
        // No more drivers available — cancel
        await db
          .update(rides)
          .set({
            status: "cancelled",
            cancellationReason: "No available drivers in your area",
            cancelledBy: "system",
            cancelledByRole: "system",
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
 * Exported so decline/driver-cancel reassignment never hands a ride back to
 * a driver who already said no to it.
 */
export async function getTriedDriversForRide(rideId: string): Promise<string[]> {
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

/** Cancellation & no-show policy constants (docs: cancellation policy memo). */
export const CANCELLATION_FEE_MID = 3.5;      // driver committed ≥3 min ago
export const CANCELLATION_FEE_LATE = 5.0;     // driver committed ≥5 min ago
export const CANCELLATION_FEE_ARRIVED = 7.0;  // driver already waiting at pickup
export const RIDER_NO_SHOW_FEE = 8.0;         // full wait window burned at pickup
export const NO_SHOW_WAIT_MINUTES = 5;        // driver must wait this long after arrival
export const SCHEDULED_FREE_CANCEL_HOURS = 2; // scheduled rides cancel free outside this window
export const FAIRNESS_FUND_RATE = 0.2;        // slice of every fee routed to the community pool
export const GOODWILL_CREDIT = 5.0;           // rider credit when a driver cancels after arriving

/**
 * Reliability consequences (rolling 30-day window, both roles).
 * "Reduced" standing changes behavior; "review" additionally raises an
 * admin safety alert the moment the threshold is crossed.
 */
export const RELIABILITY_WINDOW_DAYS = 30;
export const RIDER_REDUCED_LATE_CANCELS = 3;  // grace window removed at this many fee'd cancels
export const RIDER_REDUCED_NO_SHOWS = 1;      // ...or this many no-shows
export const RIDER_REVIEW_LATE_CANCELS = 5;   // admin review alert
export const RIDER_REVIEW_NO_SHOWS = 2;
export const DRIVER_DEPRIORITIZED_STRIKES = 3; // penalty box in driver matching
export const DRIVER_REVIEW_STRIKES = 5;        // admin review alert

export type ReliabilityStanding = "good" | "reduced" | "under_review";

export function riderStanding(stats: { lateCancellations: number; noShows: number }): ReliabilityStanding {
  if (stats.lateCancellations >= RIDER_REVIEW_LATE_CANCELS || stats.noShows >= RIDER_REVIEW_NO_SHOWS) return "under_review";
  if (stats.lateCancellations >= RIDER_REDUCED_LATE_CANCELS || stats.noShows >= RIDER_REDUCED_NO_SHOWS) return "reduced";
  return "good";
}

export function driverStanding(stats: { cancellations: number }): ReliabilityStanding {
  if (stats.cancellations >= DRIVER_REVIEW_STRIKES) return "under_review";
  if (stats.cancellations >= DRIVER_DEPRIORITIZED_STRIKES) return "reduced";
  return "good";
}

export interface CancellationFeeResult {
  fee: number;
  reason: string;
}

/**
 * Calculate the rider's cancellation fee from server-held facts only.
 *
 * Previous version trusted driverTraveledDistance/Time from the cancelling
 * client's request body — trivially spoofable in either direction. This one
 * uses acceptedAt (server-stamped at accept) as the measure of how long the
 * driver has been committed, plus the ride status itself:
 *
 *   pending                      → free (nobody committed)
 *   scheduled, >2h to departure  → free (driver hasn't meaningfully started)
 *   accepted <3 min ago          → free (grace window)
 *   accepted 3–5 min ago         → $3.50
 *   accepted ≥5 min ago          → $5.00
 *   driver_arriving              → $7.00 (driver is physically waiting)
 *
 * Driver-initiated and admin/system cancellations never use this ladder —
 * the rider owes $0 in those paths regardless.
 */
export function calculateCancellationFee(
  ride: {
    status?: string | null;
    acceptedAt?: Date | string | null;
    scheduledAt?: Date | string | null;
  },
  now: Date = new Date(),
  options?: {
    /**
     * Reliability consequence: riders in "reduced" standing (repeated late
     * cancellations / a no-show in the rolling window) lose the free
     * post-accept grace window — the fee ladder starts at accept. The
     * scheduled >2h window stays free regardless (that's a scheduling
     * policy, not a grace period), as does pending (nobody committed).
     */
    graceWindowRemoved?: boolean;
  }
): CancellationFeeResult {
  const status = ride.status ?? "pending";

  if (status !== "accepted" && status !== "driver_arriving") {
    return { fee: 0, reason: "No fee — no driver committed to this ride yet" };
  }

  // Scheduled rides: free cancellation while departure is still far away,
  // even after a driver has confirmed — nobody is en route days in advance.
  if (ride.scheduledAt) {
    const hoursOut = (new Date(ride.scheduledAt).getTime() - now.getTime()) / 3_600_000;
    if (hoursOut > SCHEDULED_FREE_CANCEL_HOURS) {
      return { fee: 0, reason: `No fee — scheduled ride is more than ${SCHEDULED_FREE_CANCEL_HOURS}h away` };
    }
  }

  if (status === "driver_arriving") {
    return {
      fee: CANCELLATION_FEE_ARRIVED,
      reason: "Driver has already arrived and is waiting at the pickup point",
    };
  }

  const acceptedAt = ride.acceptedAt ? new Date(ride.acceptedAt).getTime() : null;
  const minutesCommitted = acceptedAt ? (now.getTime() - acceptedAt) / 60_000 : 0;

  if (minutesCommitted >= 5) {
    return { fee: CANCELLATION_FEE_LATE, reason: `Driver has been en route for ${Math.floor(minutesCommitted)} min` };
  }
  if (minutesCommitted >= 3) {
    return { fee: CANCELLATION_FEE_MID, reason: `Driver has been en route for ${Math.floor(minutesCommitted)} min` };
  }
  if (options?.graceWindowRemoved) {
    return {
      fee: CANCELLATION_FEE_MID,
      reason: "Due to recent cancellations on your account, the free cancellation window doesn't apply",
    };
  }
  return { fee: 0, reason: "No fee — cancelled within the grace window after acceptance" };
}

/**
 * Rolling-window driver strike counts, batched for matching. Strikes live in
 * the ride audit log (driver_cancelled_ride events) because a driver-cancel
 * usually requeues the ride — the ride row can't attribute it.
 */
export async function getDriverStrikesBatch(driverIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (driverIds.length === 0) return out;
  const since = new Date(Date.now() - RELIABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  try {
    // IN-list rather than = ANY(param): the sql template serializes a JS
    // array as JSON, which ANY() rejects (42809).
    const idList = sql.join(driverIds.map((id) => sql`${id}`), sql`, `);
    const rows = await db.execute(sql`
      SELECT details->>'actorId' AS driver_id, count(*) AS n
      FROM admin_activity_log
      WHERE action = 'ride_audit'
        AND details->>'event' = 'driver_cancelled_ride'
        AND details->>'actorId' IN (${idList})
        AND created_at >= ${since}
      GROUP BY details->>'actorId'
    `);
    for (const row of (rows.rows ?? []) as Array<{ driver_id: string; n: string }>) {
      out.set(row.driver_id, Number(row.n));
    }
  } catch (err) {
    console.error("[reliability] strike batch lookup failed (treating all as clean):", err);
  }
  return out;
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

export type { RideReceipt } from "@shared/rideReceipt";
export { buildRideReceipt } from "@shared/rideReceipt";

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
