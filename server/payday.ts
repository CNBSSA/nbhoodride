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
import { driverProfiles, payoutRequests, users } from "@shared/schema";
import { MINIMUM_PAYDAY_AMOUNT, paydayFor, paydayKeyOf, paydayLabel } from "@shared/paydayCycle";
import { opsAlert, formatOpsAlert } from "./telegramOps";

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
}

/**
 * Pay everyone who is owed. `now` decides which payday this is; the caller
 * is responsible for only running it when one is due and for claiming it.
 */
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
    ));

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
    ["Drivers paid", paid.length],
    ["Total", `$${total.toFixed(2)}`],
    ["Waiting on a payout method", noMethod.length > 0 ? noMethod.map((l) => l.name).join(", ") : "nobody"],
    ["Next", paid.length > 0 ? "Send them from Admin → Payout requests" : "Nothing to send"],
  ]));

  return { paydayKey, label, paid, skipped, total };
}

export { MINIMUM_PAYDAY_AMOUNT };
