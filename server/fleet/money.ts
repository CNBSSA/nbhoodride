/**
 * Fleet management accounts, slice 4: the fleet's money — the desk's
 * Earnings and Payouts views, the Friday payout, and the operator's records
 * (rules in shared/fleet.ts; the split itself is written by
 * server/fleet/earnings.ts when a ride or fee is credited).
 *
 * A fleet never sees a rider: every query here names its columns, and none
 * of them is a rider's name, phone or address. The owner sees where the
 * fleet is paid; a manager and a viewer see the money but not the account.
 *
 * Tax forms: switching FLEET_ENABLED on in production is gated on Festus's
 * accountant deciding how the fleets' year-end 1099s are filed. Until then
 * this module only keeps the record (fleetYearTotal) the accountant needs.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { fleetCars, fleetEarnings, fleetPayouts, organizations, rides, users, type FleetPayout } from "@shared/schema";
import {
  FLEET_CATEGORY, FLEET_EARNING_KIND_WORDS, FLEET_PAYOUT_STATUS_WORDS, canManageFleetMoney, canSeeFleetDesk, fleetPaydayFor, groupFleetEarnings,
  type FleetEarningKind, type FleetEarningLine,
} from "@shared/fleet";
import { billingWeekWindow, previousBillingWeek, weekKeyOf } from "@shared/billingCycle";
import { paydayLabel } from "@shared/paydayCycle";
import { FleetError, fleetRole } from "./accounts";

const money = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;
const nameOf = (u: { firstName: string | null; lastName: string | null }) => `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "A driver";
const carLabel = (c: { year: number | null; make: string | null; model: string | null; licensePlate: string | null } | null) =>
  c ? `${c.year ?? ""} ${c.make ?? ""} ${c.model ?? ""} (${c.licensePlate ?? ""})`.replace(/\s+/g, " ").trim() : "A car no longer on the desk";

async function deskRole(userId: string, orgId: string) {
  const { org, role } = await fleetRole(userId, orgId);
  if (!canSeeFleetDesk(role)) throw new FleetError("The fleet desk is for the fleet's owner and managers. Your earnings are in the driver app.", 403);
  return { org, role };
}

/**
 * The Earnings view: this week or last (Monday to Monday, Eastern, as the
 * business weeks run), per car and per driver, and every line: when, what,
 * which car, which driver, the fare, the driver's share before the split,
 * the fleet's 25% and the driver's 75%. Nothing about the rider.
 */
export async function fleetEarningsView(userId: string, orgId: string, week: string, now: Date = new Date()) {
  const { role } = await deskRole(userId, orgId);
  const window = week === "last" ? previousBillingWeek(now) : billingWeekWindow(weekKeyOf(now));
  const rows = await db.select({
    kind: fleetEarnings.kind, createdAt: fleetEarnings.createdAt, fleetCarId: fleetEarnings.fleetCarId, driverUserId: fleetEarnings.driverUserId,
    gross: fleetEarnings.gross, fleetShare: fleetEarnings.fleetShare, driverKeeps: fleetEarnings.driverKeeps, payoutId: fleetEarnings.payoutId,
    fare: rides.actualFare,
    firstName: users.firstName, lastName: users.lastName,
    year: fleetCars.year, make: fleetCars.make, model: fleetCars.model, licensePlate: fleetCars.licensePlate,
  }).from(fleetEarnings)
    .innerJoin(rides, eq(rides.id, fleetEarnings.rideId))
    .innerJoin(users, eq(users.id, fleetEarnings.driverUserId))
    .leftJoin(fleetCars, eq(fleetCars.id, fleetEarnings.fleetCarId))
    .where(and(eq(fleetEarnings.organizationId, orgId), gte(fleetEarnings.createdAt, window.start), lt(fleetEarnings.createdAt, window.end)))
    .orderBy(desc(fleetEarnings.createdAt));
  const lines = rows.map((r) => ({
    at: r.createdAt, kind: r.kind, kindText: FLEET_EARNING_KIND_WORDS[r.kind as FleetEarningKind] ?? r.kind,
    fleetCarId: r.fleetCarId, carLabel: carLabel(r.make ? r : null), driverUserId: r.driverUserId, driverName: nameOf(r),
    fare: r.kind === "fare" ? money(r.fare) : 0, gross: money(r.gross), fleetShare: money(r.fleetShare), driverKeeps: money(r.driverKeeps),
    paid: !!r.payoutId,
  }));
  const grouped = groupFleetEarnings(lines as FleetEarningLine[]);
  return { role, week: week === "last" ? "last" : "this", weekKey: window.weekKey, label: window.label, ...grouped, lines };
}

/**
 * The Payouts view: each Friday's payout, what it covered, and whether PG
 * Ride has sent it; plus what is owed and not yet paid. The account it went
 * to is the owner's to see.
 */
export async function fleetPayoutsView(userId: string, orgId: string) {
  const { org, role } = await deskRole(userId, orgId);
  const owner = canManageFleetMoney(role);
  const payouts = await db.select().from(fleetPayouts).where(eq(fleetPayouts.organizationId, orgId)).orderBy(desc(fleetPayouts.createdAt));
  const covered = await coveredBy(payouts.map((p) => p.id));
  const [owed] = await db.select({ amount: sql<string>`COALESCE(SUM(${fleetEarnings.fleetShare}), 0)`, n: sql<number>`count(*)::int` })
    .from(fleetEarnings).where(and(eq(fleetEarnings.organizationId, orgId), isNull(fleetEarnings.payoutId)));
  return {
    role,
    owedNow: { amount: money(owed?.amount), lines: Number(owed?.n ?? 0) },
    payoutOnFile: !!(org.payoutMethod && org.payoutDetails),
    payouts: payouts.map((p) => ({
      id: p.id, paydayKey: p.paydayKey, label: paydayLabel(p.paydayKey), amount: money(p.amount),
      status: p.status, statusText: FLEET_PAYOUT_STATUS_WORDS[p.status] ?? p.status, createdAt: p.createdAt, sentAt: p.sentAt,
      covered: covered.get(p.id) ?? emptyCovered(),
      ...(owner ? { payoutMethod: p.payoutMethod, payoutDetails: p.payoutDetails } : {}),
    })),
  };
}

const emptyCovered = () => ({ rides: 0, fees: 0, from: null as string | null, to: null as string | null, amount: 0 });

async function coveredBy(payoutIds: string[]) {
  const out = new Map<string, ReturnType<typeof emptyCovered>>();
  if (!payoutIds.length) return out;
  const rows = await db.select({
    payoutId: fleetEarnings.payoutId,
    rides: sql<number>`count(*) filter (where ${fleetEarnings.kind} = 'fare')::int`,
    fees: sql<number>`count(*) filter (where ${fleetEarnings.kind} <> 'fare')::int`,
    // As ISO instants: created_at is stored in UTC without a zone.
    from: sql<string>`to_char(min(${fleetEarnings.createdAt}), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`, to: sql<string>`to_char(max(${fleetEarnings.createdAt}), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
    amount: sql<string>`COALESCE(SUM(${fleetEarnings.fleetShare}), 0)`,
  }).from(fleetEarnings).where(inArray(fleetEarnings.payoutId, payoutIds)).groupBy(fleetEarnings.payoutId);
  for (const r of rows) out.set(r.payoutId!, { rides: Number(r.rides), fees: Number(r.fees), from: r.from, to: r.to, amount: money(r.amount) });
  return out;
}

// ── The Friday payout ────────────────────────────────────────────────────────

export interface FleetPaydayLine { organizationId: string; name: string; amount: number; method: string; paid: boolean; reason: string; payoutId?: string }

/**
 * Pay every fleet what it is owed, as part of the weekly payday
 * (server/payday.ts, after drivers and car owners). For each fleet: lock its
 * unpaid rows, total them, and — when the fleet is open, has an account on
 * file and is owed at least the minimum — write one fleet_payouts row for
 * the total and stamp exactly those rows with it, in one transaction. A
 * fleet is paid at most once per Friday (unique organization + payday), and
 * a row is paid at most once (it is stamped only while payout_id is null).
 * Like a driver's payout request, the operator then sends the money and
 * marks it sent.
 */
export async function runFleetPayday(paydayKey: string): Promise<{ paid: FleetPaydayLine[]; skipped: FleetPaydayLine[] }> {
  const owed = await db.select({
    orgId: organizations.id, name: organizations.name, status: organizations.status,
    method: organizations.payoutMethod, details: organizations.payoutDetails,
    amount: sql<string>`SUM(${fleetEarnings.fleetShare})`,
  }).from(fleetEarnings)
    .innerJoin(organizations, eq(organizations.id, fleetEarnings.organizationId))
    .where(and(isNull(fleetEarnings.payoutId), eq(organizations.category, FLEET_CATEGORY)))
    .groupBy(organizations.id, organizations.name, organizations.status, organizations.payoutMethod, organizations.payoutDetails)
    .orderBy(asc(organizations.name));
  const paid: FleetPaydayLine[] = [];
  const skipped: FleetPaydayLine[] = [];
  for (const f of owed) {
    const decision = fleetPaydayFor({ owed: f.amount, status: f.status, payoutMethod: f.method, payoutDetails: f.details });
    const line: FleetPaydayLine = { organizationId: f.orgId, name: f.name, amount: decision.amount || money(f.amount), method: f.method ?? "—", paid: false, reason: decision.reason };
    if (!decision.pay) { skipped.push(line); continue; }
    try {
      const result = await db.transaction(async (tx) => {
        const rows = await tx.select({ id: fleetEarnings.id, fleetShare: fleetEarnings.fleetShare }).from(fleetEarnings)
          .where(and(eq(fleetEarnings.organizationId, f.orgId), isNull(fleetEarnings.payoutId)))
          .orderBy(asc(fleetEarnings.id)).for("update");
        const total = Math.round(rows.reduce((s, r) => s + Math.round(Number(r.fleetShare) * 100), 0)) / 100;
        const again = fleetPaydayFor({ owed: total, status: f.status, payoutMethod: f.method, payoutDetails: f.details });
        if (!again.pay) return { skippedReason: again.reason, amount: total };
        const [payout] = await tx.insert(fleetPayouts).values({
          organizationId: f.orgId, paydayKey, amount: total.toFixed(2), payoutMethod: f.method!, payoutDetails: f.details!,
        }).onConflictDoNothing().returning();
        if (!payout) return { skippedReason: "Already paid this Friday", amount: total };
        await tx.update(fleetEarnings).set({ payoutId: payout.id })
          .where(and(inArray(fleetEarnings.id, rows.map((r) => r.id)), isNull(fleetEarnings.payoutId)));
        return { payout, amount: total };
      });
      line.amount = result.amount;
      if ("payout" in result && result.payout) { line.paid = true; line.payoutId = result.payout.id; line.reason = "Paid on the weekly run"; paid.push(line); }
      else { line.reason = result.skippedReason ?? "Not paid"; skipped.push(line); }
    } catch (err) {
      line.reason = `Not paid: ${err instanceof Error ? err.message : String(err)}`;
      skipped.push(line);
      console.error(`[payday] fleet ${f.name} not paid:`, err instanceof Error ? err.message : err);
    }
  }
  return { paid, skipped };
}

// ── The operator ─────────────────────────────────────────────────────────────

async function loadFleetForAdmin(orgId: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org || org.category !== FLEET_CATEGORY) throw new FleetError("Fleet not found.", 404);
  return org;
}

/** Admin → Organizations → the fleet → Payouts: every Friday's payout, with where it goes. */
export async function listFleetPayoutsForAdmin(orgId: string) {
  await loadFleetForAdmin(orgId);
  const payouts = await db.select().from(fleetPayouts).where(eq(fleetPayouts.organizationId, orgId)).orderBy(desc(fleetPayouts.createdAt));
  const covered = await coveredBy(payouts.map((p) => p.id));
  const [owed] = await db.select({ amount: sql<string>`COALESCE(SUM(${fleetEarnings.fleetShare}), 0)` })
    .from(fleetEarnings).where(and(eq(fleetEarnings.organizationId, orgId), isNull(fleetEarnings.payoutId)));
  return {
    owedNow: money(owed?.amount),
    payouts: payouts.map((p) => ({ ...p, amount: money(p.amount), label: paydayLabel(p.paydayKey), statusText: FLEET_PAYOUT_STATUS_WORDS[p.status] ?? p.status, covered: covered.get(p.id) ?? emptyCovered() })),
  };
}

/** The operator has sent the money: requested → sent, once. */
export async function markFleetPayoutSent(payoutId: string, adminId: string): Promise<FleetPayout> {
  const [row] = await db.update(fleetPayouts).set({ status: "sent", sentAt: new Date(), sentBy: adminId })
    .where(and(eq(fleetPayouts.id, payoutId), eq(fleetPayouts.status, "requested"))).returning();
  if (row) { console.log(`[fleet] payout sent :: ${row.organizationId} | ${row.paydayKey} | $${money(row.amount).toFixed(2)}`); return row; }
  const [existing] = await db.select().from(fleetPayouts).where(eq(fleetPayouts.id, payoutId));
  if (!existing) throw new FleetError("Payout not found.", 404);
  throw new FleetError("This payout is already marked sent.", 409);
}

/**
 * The record the accountant files a fleet's year-end information return
 * from (1099 support, records only — no form is generated): the business's
 * legal name and full EIN, and what PG Ride sent it in the calendar year
 * (payouts marked sent, by the date they were sent), with what was
 * requested and not yet sent beside it. Admin only.
 */
export async function fleetYearTotal(orgId: string, year: number) {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new FleetError("Give a calendar year, like 2026.");
  const org = await loadFleetForAdmin(orgId);
  // The calendar year in Eastern time, the business's books. sent_at is
  // stored in UTC.
  const [sent] = await db.select({ amount: sql<string>`COALESCE(SUM(${fleetPayouts.amount}), 0)`, n: sql<number>`count(*)::int` }).from(fleetPayouts)
    .where(and(eq(fleetPayouts.organizationId, orgId), eq(fleetPayouts.status, "sent"),
      sql`EXTRACT(YEAR FROM (${fleetPayouts.sentAt} AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')) = ${year}`));
  const [waiting] = await db.select({ amount: sql<string>`COALESCE(SUM(${fleetPayouts.amount}), 0)`, n: sql<number>`count(*)::int` }).from(fleetPayouts)
    .where(and(eq(fleetPayouts.organizationId, orgId), eq(fleetPayouts.status, "requested")));
  return {
    organizationId: org.id, name: org.name, year,
    legalName: org.fleetDetails?.legalName ?? "", ein: org.fleetDetails?.ein ?? "", businessType: org.fleetDetails?.businessType ?? "",
    paidTotal: money(sent?.amount), payoutsSent: Number(sent?.n ?? 0),
    requestedNotSent: money(waiting?.amount), payoutsWaiting: Number(waiting?.n ?? 0),
    note: "Paid means sent by PG Ride in the calendar year (Eastern). How the year-end form is filed is the accountant's to settle before fleet money moves in production.",
  };
}
