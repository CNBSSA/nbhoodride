/**
 * The weekly payday run.
 *
 * A driver's 85% lands in their balance the moment a job finishes, but
 * until this existed nothing moved it onward: they had to open the app,
 * ask for a payout, and wait for somebody to action it by hand. There was
 * no payday. "Whenever the founder gets to his phone" is a weaker promise
 * than 85% deserves, and it stops working entirely past a few drivers.
 *
 * Every Friday at 9 AM Eastern this sweeps every driver with a balance and
 * a payout method on file, deducts it, and raises one payout request each —
 * exactly the request a driver would have made themselves, so the admin
 * queue, the ledger and the driver's history all behave as they already do.
 *
 * Claimed once per payday through claimWebhookEvent, so a restart, a
 * redeploy or two servers running the sweep cannot pay anyone twice. The
 * deduction and the request are written in one transaction for the same
 * reason: money leaves the balance if and only if a request exists for it.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { driverProfiles, payoutRequests, rentalOwnerProfiles, users } from "@shared/schema";
import { MINIMUM_PAYDAY_AMOUNT, paydayFor, paydayKeyOf, paydayLabel } from "@shared/paydayCycle";
import { opsAlert, formatOpsAlert } from "./telegramOps";
import { featureFlags } from "./featureFlags";
import { runFleetPayday, type FleetPaydayLine } from "./fleet/money";

export interface PaydayLine {
  driverId: string;
  name: string;
  amount: number;
  method: string;
  paid: boolean;
  reason: string;
}

export interface PaydayResult {
  paydayKey: string;
  label: string;
  paid: PaydayLine[];
  skipped: PaydayLine[];
  total: number;
  /**
   * Fleets (Fleet management accounts, slice 4): each fleet's credited,
   * unpaid 25% share, paid to the fleet's own account. Empty while
   * FLEET_ENABLED is off.
   */
  fleets: { paid: FleetPaydayLine[]; skipped: FleetPaydayLine[]; total: number };
}

/**
 * Pay everyone who is owed. `now` decides which payday this is; the caller
 * is responsible for only running it when one is due and for claiming it.
 */
/**
 * Is this person paid through their driver row? Only an approved driver with
 * a payout method on file: the one row that can actually send them money.
 */
function paysAsDriver(userId: ReturnType<typeof sql>) {
  return sql`EXISTS (SELECT 1 FROM driver_profiles dp WHERE dp.user_id = ${userId} AND dp.approval_status = 'approved'
    AND COALESCE(dp.payout_method, '') <> '' AND COALESCE(dp.payout_details, '') <> '')`;
}

export async function runWeeklyPayday(now: Date = new Date()): Promise<PaydayResult> {
  const paydayKey = paydayKeyOf(now);
  const label = paydayLabel(paydayKey);

  // Every driver carrying a balance. Suspended drivers are left alone: their
  // money is still theirs, but a payout is a decision for the operator.
  const rows = await db
    .select({
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      balance: users.virtualCardBalance,
      method: driverProfiles.payoutMethod,
      details: driverProfiles.payoutDetails,
      suspended: driverProfiles.isSuspended,
    })
    .from(driverProfiles)
    .innerJoin(users, eq(users.id, driverProfiles.userId))
    .where(and(
      // NULL is not suspended. The column is nullable, and `= false` would
      // silently drop a NULL row: such a driver would go unpaid AND be
      // absent from the skipped list, so nobody would know. No code writes
      // NULL today; this makes sure a future one cannot hide money.
      sql`COALESCE(${driverProfiles.isSuspended}, false) = false`,
      sql`CAST(COALESCE(${users.virtualCardBalance}, '0') AS DECIMAL(10,2)) > 0`,
      // A car owner is paid through the driver row only when that row can
      // actually pay them; otherwise through the owner row below (code review 2026-10-06).
      sql`NOT (EXISTS (SELECT 1 FROM rental_owner_profiles rop WHERE rop.user_id = ${users.id}) AND NOT ${paysAsDriver(sql`${users.id}`)})`,
    ));

  // Private car owners are paid weekly too (Festus, 2026-09-27): everyone
  // with a car owner's payout method and a balance. A driver who also owns a
  // listed car is paid once, through the driver row above (the balance is
  // one balance), but only when that row can pay: an approved driver with a
  // payout method. Before (code review 2026-10-06) ANY driver profile —
  // an application still pending, one with no payout method — sent an
  // owner's earnings to a driver row that skipped them, and they were never
  // paid at all.
  // An owner is paid only what their cars earned and has not been paid yet
  // — never a refund or credit that happens to sit in the same balance.
  const ownerOwed = sql<string>`GREATEST(0, LEAST(
      CAST(COALESCE(${users.virtualCardBalance}, '0') AS DECIMAL(10,2)),
      COALESCE((SELECT SUM(CAST(wt.amount AS DECIMAL(10,2))) FROM wallet_transactions wt WHERE wt.user_id = ${users.id} AND wt.reason = 'rental_owner_earnings'), 0)
      - COALESCE((SELECT SUM(CAST(pr.amount AS DECIMAL(10,2))) FROM payout_requests pr WHERE pr.driver_id = ${users.id}), 0)
    ))`;
  const owners = await db
    .select({
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      balance: ownerOwed,
      method: rentalOwnerProfiles.payoutMethod,
      details: rentalOwnerProfiles.payoutDetails,
      suspended: sql<boolean>`COALESCE(${users.isSuspended}, false)`,
    })
    .from(rentalOwnerProfiles)
    .innerJoin(users, eq(users.id, rentalOwnerProfiles.userId))
    .where(and(
      sql`NOT ${paysAsDriver(sql`${users.id}`)}`,
      sql`COALESCE(${users.isSuspended}, false) = false`,
      sql`${ownerOwed} > 0`,
    ));
  // One row per person, whatever the two queries say: nobody is paid twice in one payday.
  const seen = new Set(rows.map((r) => r.userId));
  rows.push(...owners.filter((o) => !seen.has(o.userId)));

  const paid: PaydayLine[] = [];
  const skipped: PaydayLine[] = [];

  for (const r of rows) {
    const name = `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || r.userId;
    const hasMethod = !!(r.method && r.details);
    const decision = paydayFor(r.balance, hasMethod);
    const line: PaydayLine = {
      driverId: r.userId, name, amount: decision.amount,
      method: r.method ?? "—", paid: false, reason: decision.reason,
    };

    if (!decision.pay) { skipped.push(line); continue; }

    try {
      // Deduct and record together: money never leaves a balance without a
      // request to account for it, and a failure here leaves both untouched.
      await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(users)
          .set({
            virtualCardBalance: sql`(CAST(COALESCE(${users.virtualCardBalance}, '0') AS DECIMAL(10,2)) - ${decision.amount})`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(users.id, r.userId),
            // Re-check inside the transaction: a driver who withdrew by hand
            // between the read and here must not be overdrawn.
            sql`CAST(COALESCE(${users.virtualCardBalance}, '0') AS DECIMAL(10,2)) >= ${decision.amount}`,
          ))
          .returning({ id: users.id });
        if (!updated) throw new Error("balance changed before payday could take it");

        await tx.insert(payoutRequests).values({
          driverId: r.userId,
          amount: decision.amount.toFixed(2),
          payoutMethod: r.method!,
          payoutDetails: r.details!,
        });
      });
      line.paid = true;
      paid.push(line);
    } catch (err) {
      line.reason = `Not paid: ${err instanceof Error ? err.message : String(err)}`;
      skipped.push(line);
      console.error(`[payday] ${name} not paid:`, err instanceof Error ? err.message : err);
    }
  }

  const total = Math.round(paid.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  console.log(`[payday] ${label} :: ${paid.length} paid $${total.toFixed(2)}, ${skipped.length} skipped`);

  // Fleets are paid after drivers and car owners, from what the rides in
  // their cars credited them (server/fleet/money.ts). A failure here never
  // undoes anyone's payout above; it is named in the alert.
  let fleets: PaydayResult["fleets"] = { paid: [], skipped: [], total: 0 };
  if (featureFlags.fleetEnabled) {
    try {
      const f = await runFleetPayday(paydayKey);
      fleets = { ...f, total: Math.round(f.paid.reduce((s, l) => s + l.amount, 0) * 100) / 100 };
    } catch (err) {
      console.error("[payday] fleets not paid:", err);
      fleets.skipped.push({ organizationId: "—", name: "Every fleet", amount: 0, method: "—", paid: false, reason: `Not paid: ${err instanceof Error ? err.message : String(err)}` });
    }
    console.log(`[payday] ${label} :: fleets paid ${fleets.paid.length} ($${fleets.total.toFixed(2)})` +
      `${fleets.paid.length ? " :: " + fleets.paid.map((l) => `${l.name} $${l.amount.toFixed(2)} ${l.method}`).join("; ") : ""}` +
      `${fleets.skipped.length ? ` :: fleets skipped ${fleets.skipped.map((l) => `${l.name} (${l.reason})`).join("; ")}` : ""}`);
  }

  // The operator has to actually send these, so tell them, and name anyone
  // who is owed money but has nowhere for it to go.
  const noMethod = skipped.filter((l) => /payout method/i.test(l.reason));

  // Mirrored to the server log as well as the ops chat. opsAlert only writes
  // to the log when the SEND fails, so a payday whose Telegram message went
  // out would leave no local record of who was paid — which is not something
  // to discover while reconciling a driver's missing money.
  console.log(
    `[payday] ${label} :: paid ${paid.length} ($${total.toFixed(2)})` +
    `${paid.length ? " :: " + paid.map((l) => `${l.name} $${l.amount.toFixed(2)} ${l.method}`).join("; ") : ""}` +
    `${skipped.length ? ` :: skipped ${skipped.map((l) => `${l.name} (${l.reason})`).join("; ")}` : ""}` +
    `${noMethod.length ? ` :: Waiting on a payout method: ${noMethod.map((l) => l.name).join(", ")}` : ""}`);

  opsAlert(formatOpsAlert(`💰 Payday — ${label}`, [
    ["Drivers and car owners paid", paid.length],
    ["Total", `$${total.toFixed(2)}`],
    ["Waiting on a payout method", noMethod.length > 0 ? noMethod.map((l) => l.name).join(", ") : "nobody"],
    ["Next", paid.length > 0 ? "Send them from Admin → Payout requests" : "Nothing to send"],
    ...(featureFlags.fleetEnabled ? [
      ["Fleets paid", fleets.paid.length > 0 ? `${fleets.paid.length} ($${fleets.total.toFixed(2)}): send from Admin → Organizations → the fleet → Payouts` : "none"] as [string, string],
      ["Fleets skipped", fleets.skipped.length > 0 ? fleets.skipped.map((l) => `${l.name} (${l.reason})`).join(", ") : "nobody"] as [string, string],
    ] : []),
  ]));

  return { paydayKey, label, paid, skipped, total, fleets };
}

export { MINIMUM_PAYDAY_AMOUNT };
