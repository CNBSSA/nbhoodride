/**
 * Fleet management accounts, slice 4: which rides are fleet rides, and
 * crediting the fleet's 25% once (rules in shared/fleet.ts).
 *
 * This module is the low level the money doors call — storage.completeRide
 * and storage.creditDriverEarningsOnce, the fee doors in server/routes.ts and
 * server/commercial/driverPay.ts — so it imports nothing that imports
 * storage. The desk views, the Friday payout and the admin records are in
 * server/fleet/money.ts.
 *
 * With FLEET_ENABLED off nothing here is consulted for a new ride: no ride is
 * stamped, and every fee is credited exactly as it always was.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { driverProfiles, fleetCars, fleetEarnings, organizations, rides, users, vehicles, walletTransactions } from "@shared/schema";
import { fleetFeeSplit, fleetRideFor, type FleetEarningKind } from "@shared/fleet";
import { featureFlags } from "../featureFlags";

type Executor = Pick<typeof db, "select" | "insert" | "update" | "execute">;

export interface FleetStamp { fleetCarId: string; fleetOrgId: string }

/**
 * Is the driver, right now, driving a fleet's car? The same order riders and
 * dispatch read (storage.getVehiclesByDriverId: own cars first, then a PG
 * Ride rental or fleet copy, oldest first), so the answer is the car the
 * rider was shown. Written out here rather than calling storage, which
 * imports this module.
 */
export async function fleetStampForDriver(driverUserId: string | null | undefined, paymentMethod: string | null | undefined, ex: Executor = db): Promise<FleetStamp | null> {
  if (!featureFlags.fleetEnabled || !driverUserId) return null;
  const [profile] = await ex.select({ id: driverProfiles.id }).from(driverProfiles).where(eq(driverProfiles.userId, driverUserId));
  if (!profile) return null;
  const inOrder = await ex.select({ fleetCarId: vehicles.fleetCarId }).from(vehicles)
    .where(eq(vehicles.driverProfileId, profile.id))
    .orderBy(sql`(${vehicles.rentalCarId} IS NOT NULL OR ${vehicles.fleetCarId} IS NOT NULL)`, vehicles.createdAt);
  const firstFleetCarId = inOrder[0]?.fleetCarId;
  if (!firstFleetCarId) return null;
  const [car] = await ex.select({ id: fleetCars.id, organizationId: fleetCars.organizationId, driverUserId: fleetCars.driverUserId }).from(fleetCars).where(eq(fleetCars.id, firstFleetCarId));
  const [fleet] = car ? await ex.select({ id: organizations.id, category: organizations.category, status: organizations.status }).from(organizations).where(eq(organizations.id, car.organizationId)) : [];
  return fleetRideFor({ enabled: true, driverUserId, paymentMethod, vehiclesInOrder: inOrder, car: car ?? null, fleet: fleet ?? null });
}

/**
 * The fleet a ride's fee is shared with. A ride already stamped keeps its
 * stamp (decided once); otherwise the driver's car is looked at now, when
 * the fee is earned, and the ride is stamped so a retry decides the same.
 */
export async function fleetStampForRide(rideId: string, driverUserId: string): Promise<FleetStamp | null> {
  const [ride] = await db.select({ fleetCarId: rides.fleetCarId, fleetOrgId: rides.fleetOrgId, paymentMethod: rides.paymentMethod }).from(rides).where(eq(rides.id, rideId));
  if (!ride) return null;
  if (ride.fleetCarId && ride.fleetOrgId) return { fleetCarId: ride.fleetCarId, fleetOrgId: ride.fleetOrgId };
  const stamp = await fleetStampForDriver(driverUserId, ride.paymentMethod);
  if (!stamp) return null;
  const [won] = await db.update(rides).set({ fleetCarId: stamp.fleetCarId, fleetOrgId: stamp.fleetOrgId } as any)
    .where(and(eq(rides.id, rideId), isNull(rides.fleetCarId))).returning({ fleetCarId: rides.fleetCarId, fleetOrgId: rides.fleetOrgId });
  if (won) return stamp;
  // Another door stamped it between the read and here: theirs stands.
  const [again] = await db.select({ fleetCarId: rides.fleetCarId, fleetOrgId: rides.fleetOrgId }).from(rides).where(eq(rides.id, rideId));
  return again?.fleetCarId && again.fleetOrgId ? { fleetCarId: again.fleetCarId, fleetOrgId: again.fleetOrgId } : null;
}

/**
 * Write the fleet's row for a ride. Called inside the transaction (and the
 * advisory lock) that credits the driver, so the two are written together or
 * not at all; the unique (ride, kind) index makes a repeat a no-op.
 */
export async function writeFleetEarning(tx: Executor, row: {
  stamp: FleetStamp; driverUserId: string; rideId: string; kind: FleetEarningKind; gross: number; fleetShare: number; driverKeeps: number;
}): Promise<void> {
  if (!(row.fleetShare > 0)) return;
  await tx.insert(fleetEarnings).values({
    organizationId: row.stamp.fleetOrgId, fleetCarId: row.stamp.fleetCarId, driverUserId: row.driverUserId, rideId: row.rideId, kind: row.kind,
    gross: row.gross.toFixed(2), fleetShare: row.fleetShare.toFixed(2), driverKeeps: row.driverKeeps.toFixed(2),
  }).onConflictDoNothing();
}

/**
 * The fleet's row for a completed ride's fare, from the figures completeRide
 * fixed on the ride (driver_earnings = the driver's 75% + the tip; fleet_share
 * the fleet's 25%). Called from storage.creditDriverEarningsOnce, inside its
 * transaction, right after the driver's credit.
 */
export async function writeFleetFareEarning(tx: Executor, rideId: string, driverUserId: string): Promise<void> {
  const [r] = await tx.select({ fleetCarId: rides.fleetCarId, fleetOrgId: rides.fleetOrgId, fleetShare: rides.fleetShare, driverEarnings: rides.driverEarnings, tipAmount: rides.tipAmount })
    .from(rides).where(eq(rides.id, rideId));
  if (!r?.fleetCarId || !r.fleetOrgId) return;
  const fleetShare = Number(r.fleetShare ?? 0);
  if (!(fleetShare > 0)) return;
  const driverKeeps = Math.round((Number(r.driverEarnings ?? 0) - Number(r.tipAmount ?? 0)) * 100) / 100;
  await writeFleetEarning(tx, {
    stamp: { fleetCarId: r.fleetCarId, fleetOrgId: r.fleetOrgId }, driverUserId, rideId, kind: "fare",
    gross: Math.round((driverKeeps + fleetShare) * 100) / 100, fleetShare, driverKeeps,
  });
}

/** What the fee doors need from storage; passed in so this module never imports it. */
export interface FeeCreditStorage {
  addVirtualCardBalance(userId: string, amount: number, reason?: string, rideId?: string): Promise<unknown>;
}

/**
 * Credit a driver their cut of a fee (waiting, a late cancel, a no-show).
 * In their own car — or with fleets switched off — the whole cut is the
 * driver's. In a fleet's car the cut is shared 25/75: the driver is
 * credited their 75% and the fleet's 25% is written to fleet_earnings.
 * Either way it is one transaction under a lock on (reason, ride), checked
 * against the ledger first, so a retried fee is credited (and shared) once.
 * `storage` is no longer used; it stays so no caller changes.
 * Returns what the driver was credited.
 */
export async function creditDriverCutOnce(storage: FeeCreditStorage, input: {
  rideId: string; driverUserId: string; amount: number; reason: string; kind: FleetEarningKind;
}): Promise<{ driverCredited: number; fleetShare: number }> {
  const { rideId, driverUserId, amount, reason, kind } = input;
  if (!(amount > 0)) return { driverCredited: 0, fleetShare: 0 };
  const stamp = featureFlags.fleetEnabled ? await fleetStampForRide(rideId, driverUserId) : null;
  // In their own car the cut is credited whole — and now once, under the same
  // lock and ledger check as a fleet car's (code review 2026-10-06). It used
  // to be a bare credit, so a fee door that ran twice for one ride (a double
  // tapped no-show) paid the driver twice.
  const split = stamp ? fleetFeeSplit(amount) : { gross: amount, fleetShare: 0, driverKeeps: amount };
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${reason}:${rideId}`}))`);
    const already = await tx.select({ id: walletTransactions.id }).from(walletTransactions)
      .where(and(eq(walletTransactions.rideId, rideId), eq(walletTransactions.reason, reason))).limit(1);
    if (already.length) return { driverCredited: 0, fleetShare: 0 };
    if (split.driverKeeps > 0) {
      const [u] = await tx.update(users).set({
        virtualCardBalance: sql`(CAST(COALESCE(${users.virtualCardBalance}, '0') AS DECIMAL(10,2)) + ${split.driverKeeps})`,
        updatedAt: new Date(),
      }).where(eq(users.id, driverUserId)).returning({ balance: users.virtualCardBalance });
      if (!u) throw new Error("Driver not found");
      await tx.insert(walletTransactions).values({
        userId: driverUserId, amount: split.driverKeeps.toFixed(2), balanceAfter: parseFloat(u.balance || "0").toFixed(2), reason, rideId,
      });
    }
    if (!stamp) return { driverCredited: split.driverKeeps, fleetShare: 0 };
    await writeFleetEarning(tx, { stamp, driverUserId, rideId, kind, gross: split.gross, fleetShare: split.fleetShare, driverKeeps: split.driverKeeps });
    console.log(`[fleet] ${kind} shared :: ride ${rideId.slice(0, 8)} | driver $${split.driverKeeps.toFixed(2)} | fleet $${split.fleetShare.toFixed(2)} of $${split.gross.toFixed(2)}`);
    return { driverCredited: split.driverKeeps, fleetShare: split.fleetShare };
  });
}
