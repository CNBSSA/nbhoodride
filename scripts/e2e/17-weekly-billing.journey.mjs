import Stripe from "stripe";
import { Session, check, section, serverLog, deleteRides, deleteOrgs, FIXTURES, PICKUP, DEST } from "./harness.mjs";

/**
 * Slice 5: last week's jobs are priced into one statement and collected by
 * bank debit. A week is issued once however often the run fires, every job
 * in it is stamped so it can never be billed twice, an account with nothing
 * on file fails loudly instead of silently, and an account on net terms is
 * issued a statement and never charged.
 *
 * Stripe is unreachable from this sandbox, so what is proven here is the
 * issuing, the idempotency, the refusal and the recording — not a live
 * charge, which the production smoke check covers.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const rideIds = [];
  const orgIds = [];
  const loc = (p) => JSON.stringify(p);

  // Last week's Monday, Eastern, and a moment inside that week.
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday"));
  const thisMonday = new Date(Date.UTC(Number(g("year")), Number(g("month")) - 1, Number(g("day")), 12) - ((dow + 6) % 7) * 86_400_000);
  const lastMonday = new Date(thisMonday.getTime() - 7 * 86_400_000);
  const weekKey = `${lastMonday.getUTCFullYear()}-${String(lastMonday.getUTCMonth() + 1).padStart(2, "0")}-${String(lastMonday.getUTCDate()).padStart(2, "0")}`;
  const insideLastWeek = (dayOffset, hour = 15) => new Date(lastMonday.getTime() + dayOffset * 86_400_000 - 12 * 3_600_000 + hour * 3_600_000);

  const seedJob = async (orgId, cols) => {
    const { rows: [r] } = await db.query(
      `INSERT INTO rides (rider_id, driver_id, status, pickup_location, destination_location, estimated_fare, actual_fare, payment_method, ride_type, booked_for_friend, passenger_name, scheduled_at, cancellation_fee)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'invoice','commercial',true,$8,$9,$10) RETURNING id`,
      [FIXTURES.rider.id, cols.driver ? FIXTURES.driver.id : null, cols.status, loc(PICKUP), loc(DEST), "30.00", cols.actualFare ?? null, cols.passenger, cols.at, cols.cancellationFee ?? "0.00"]);
    rideIds.push(r.id);
    const { rows: [j] } = await db.query(
      `INSERT INTO commercial_jobs (ride_id, organization_id, requester_id, category, facility_fee, wait_fee, cancellation_fee)
       VALUES ($1,$2,$3,'medical','4.00',$4,$5) RETURNING id, job_number`,
      [r.id, orgId, FIXTURES.rider.id, cols.waitFee ?? "0.00", cols.cancellationFee ?? "0.00"]);
    return { rideId: r.id, jobId: j.id };
  };

  try {
    section("A finished week becomes one statement");
    const A = await admin.req("POST", "/api/admin/organizations", { name: "Camp Springs Renal", category: "medical" });
    orgIds.push(A.json.id);
    await admin.req("POST", `/api/admin/organizations/${A.json.id}/members`, { email: FIXTURES.rider.email, role: "owner" });

    const done1 = await seedJob(A.json.id, { status: "completed", driver: true, actualFare: "30.00", passenger: "Ada L.", at: insideLastWeek(1) });
    const done2 = await seedJob(A.json.id, { status: "completed", driver: true, actualFare: "30.00", passenger: "Ada L.", at: insideLastWeek(3), waitFee: "2.50" });
    const cancelled = await seedJob(A.json.id, { status: "cancelled", driver: true, passenger: "Sam D.", at: insideLastWeek(4), cancellationFee: "7.00" });
    // This week's job must not appear on last week's statement.
    const thisWeek = await seedJob(A.json.id, { status: "completed", driver: true, actualFare: "30.00", passenger: "Later", at: new Date(Date.now() - 2 * 3_600_000) });

    const issued = await admin.req("POST", `/api/admin/organizations/${A.json.id}/statements`, { week: weekKey });
    check("last week is issued as one statement", issued.status === 200 && issued.json?.created === true && issued.json?.statement?.periodKey === weekKey, JSON.stringify(issued.json?.message ?? issued.json?.reason));
    const st = issued.json.statement;
    check("it totals fares, facility fees, waiting and the cancellation fee", st.total === "77.50" && st.jobCount === 3, `${st.total} over ${st.jobCount} jobs`);
    check("its label reads as a week", /^[A-Z][a-z]{2} \d+/.test(st.periodLabel) && st.status === "open", `${st.periodLabel} ${st.status}`);
    const { rows: stamped } = await db.query("SELECT id, statement_id, billed_status FROM commercial_jobs WHERE id = ANY($1::varchar[])", [[done1.jobId, done2.jobId, cancelled.jobId]]);
    check("every job in it is stamped with the statement", stamped.length === 3 && stamped.every((j) => j.statement_id === st.id && j.billed_status === "statement"), JSON.stringify(stamped.map((j) => j.billed_status)));
    const { rows: [later] } = await db.query("SELECT statement_id, billed_status FROM commercial_jobs WHERE id=$1", [thisWeek.jobId]);
    check("this week's job is left for next week", later.statement_id === null && later.billed_status === "open", JSON.stringify(later));

    section("A week is issued once, however often the run fires");
    const again = await admin.req("POST", `/api/admin/organizations/${A.json.id}/statements`, { week: weekKey });
    check("issuing the same week again creates nothing", again.status === 200 && again.json?.created === false && again.json?.statement?.id === st.id && /Already issued/.test(again.json?.reason ?? ""), JSON.stringify(again.json?.reason));
    const { rows: [count] } = await db.query("SELECT count(*)::int AS n FROM commercial_statements WHERE organization_id=$1", [A.json.id]);
    check("there is exactly one statement for the week", count.n === 1, `n=${count.n}`);

    section("With nothing on file, collection fails loudly");
    const charge = await admin.req("POST", `/api/admin/commercial-statements/${st.id}/charge`);
    check("the charge is refused and says what the desk must do", charge.status === 200 && charge.json?.charged === false && /no bank account or card on file/i.test(charge.json?.reason ?? ""), JSON.stringify(charge.json?.reason));
    const { rows: [failed] } = await db.query("SELECT status, attempts, last_error, stripe_payment_intent_id FROM commercial_statements WHERE id=$1", [st.id]);
    check("the failure is recorded on the statement with its reason", failed.status === "failed" && failed.attempts === 1 && /bank account or card/i.test(failed.last_error ?? "") && !failed.stripe_payment_intent_id, JSON.stringify(failed));
    await new Promise((r) => setTimeout(r, 300));
    check("the operator is paged about the money, by account and week", /statement charge failed :: Camp Springs Renal/.test(serverLog(server)));
    const { rows: stillStamped } = await db.query("SELECT billed_status FROM commercial_jobs WHERE statement_id=$1", [st.id]);
    check("a failed collection never releases the jobs to be billed again", stillStamped.length === 3 && stillStamped.every((j) => j.billed_status === "statement"), JSON.stringify(stillStamped.map((j) => j.billed_status)));

    section("A debit left in flight is never repeated blind");
    // A statement from before attempts were numbered: a process that died
    // mid-call left it charging, with no intent id and attempts 0, and the
    // idempotency key it was sent under was a constant this code no longer
    // uses. Before minting anything, Stripe is asked whether a debit for the
    // statement already exists on the account; here Stripe is a fake key
    // and cannot be asked, so nothing is charged and the operator is told.
    await db.query("UPDATE organizations SET stripe_customer_id='cus_e2e_legacy', default_payment_method_id='pm_e2e_legacy' WHERE id=$1", [A.json.id]);
    await db.query("UPDATE commercial_statements SET status='charging', attempts=0, stripe_payment_intent_id=NULL, last_error=NULL WHERE id=$1", [st.id]);
    const legacy = await admin.req("POST", `/api/admin/commercial-statements/${st.id}/charge`);
    check("Stripe is asked for an existing debit first, and when it cannot answer nothing is charged", legacy.status === 200 && legacy.json?.charged === false && /Could not ask Stripe whether a debit already exists/.test(legacy.json?.reason ?? ""), `${legacy.status} ${JSON.stringify(legacy.json?.reason)}`);
    const { rows: [legacyRow] } = await db.query("SELECT status, attempts, stripe_payment_intent_id, last_error FROM commercial_statements WHERE id=$1", [st.id]);
    check("the statement stays charging on attempt 0 with no new intent and the reason on it", legacyRow.status === "charging" && legacyRow.attempts === 0 && !legacyRow.stripe_payment_intent_id && /Could not ask Stripe/.test(legacyRow.last_error ?? ""), JSON.stringify(legacyRow));
    await new Promise((r) => setTimeout(r, 300));
    check("and the operator is paged that no debit was raised", /statement charge not attempted :: Camp Springs Renal/.test(serverLog(server)));
    await db.query("UPDATE organizations SET stripe_customer_id=NULL, default_payment_method_id=NULL WHERE id=$1", [A.json.id]);
    await db.query("UPDATE commercial_statements SET status='failed', attempts=1, stripe_payment_intent_id=NULL WHERE id=$1", [st.id]);

    section("The desk sees its statements and how the account pays");
    const list = await rider.req("GET", `/api/org/${A.json.id}/statements`);
    check("the owner sees the week, its total and its state in words", list.status === 200 && list.json?.[0]?.id === st.id && /could not be collected/.test(list.json[0].statusText ?? ""), JSON.stringify(list.json?.[0]?.statusText));
    const detail = await rider.req("GET", `/api/org/${A.json.id}`);
    check("the desk is told there is nothing on file yet", detail.json?.hasPaymentMethod === false && /No bank account or card on file/.test(detail.json?.billingText ?? ""), detail.json?.billingText);
    check("the payment method id itself is never sent to the browser", !("defaultPaymentMethodId" in (detail.json ?? {})));
    const setup = await rider.req("POST", `/api/org/${A.json.id}/billing/setup-intent`);
    check("with the payment provider unreachable, setup says so plainly instead of a server error", setup.status === 503 && /can't reach our payment provider/i.test(setup.json?.message ?? "") && /nothing has been charged/i.test(setup.json?.message ?? ""), `${setup.status} ${JSON.stringify(setup.json?.message)}`);

    section("An account on terms is issued a statement and never charged");
    const B = await admin.req("POST", "/api/admin/organizations", { name: "Bowie Legal Couriers", category: "business", billingMode: "net_terms" });
    orgIds.push(B.json.id);
    await admin.req("PATCH", `/api/admin/organizations/${B.json.id}`, { billingMode: "net_terms" });
    await seedJob(B.json.id, { status: "completed", driver: true, actualFare: "30.00", passenger: "Deed packet", at: insideLastWeek(2) });
    const run = await admin.req("POST", "/api/admin/analytics/weekly-billing", { week: weekKey });
    check("the weekly run issues for every active account", run.status === 200 && run.json?.weekKey === weekKey && run.json?.issued >= 1, JSON.stringify(run.json));
    const skipped = (run.json?.skipped ?? []).find((s) => s.organization === "Bowie Legal Couriers");
    check("the account on terms is issued but not charged, and says why", !!skipped && /net terms/i.test(skipped.reason ?? ""), JSON.stringify(skipped));
    const { rows: [bStmt] } = await db.query("SELECT id, status, total, attempts FROM commercial_statements WHERE organization_id=$1", [B.json.id]);
    check("its statement is open, with nothing attempted", bStmt.status === "open" && bStmt.total === "34.00" && bStmt.attempts === 0, JSON.stringify(bStmt));
    // Not by hand either: the admin's charge button on a net-terms statement
    // says so instead of debiting a bank account the account never agreed to.
    const byHand = await admin.req("POST", `/api/admin/commercial-statements/${bStmt.id}/charge`);
    check("charging it by hand is refused in words, and nothing is attempted", byHand.status === 200 && byHand.json?.charged === false && /net terms/i.test(byHand.json?.reason ?? ""), `${byHand.status} ${JSON.stringify(byHand.json)}`);
    const { rows: [bStill] } = await db.query("SELECT status, attempts FROM commercial_statements WHERE id=$1", [bStmt.id]);
    check("the statement is still open, untouched", bStill.status === "open" && bStill.attempts === 0, JSON.stringify(bStill));

    section("The finances screen says what PG Ride keeps, not only what passed through");
    const fin = await admin.req("GET", `/api/admin/finances?year=${new Date().getFullYear()}`);
    const f = fin.json ?? {};
    check("gross revenue is still there, and beside it PG Ride's share, what was collected, and the drivers' share",
      fin.status === 200 && typeof f.totalRevenue === "number" && typeof f.platformShare === "number" && typeof f.platformShareCollected === "number" && typeof f.driverShare === "number",
      JSON.stringify(Object.keys(f)));
    check("the duplicate fee field is gone; the cancellation total stands on its own", !("feesToDriversAndPool" in f), JSON.stringify(Object.keys(f)));
    check("PG Ride's share is never more than the gross, and collected never more than the share", f.platformShare <= f.totalRevenue + 0.011 && f.platformShareCollected <= f.platformShare + 0.011 && Math.abs((f.platformShare - f.platformShareCollected) - f.platformShareUncollected) < 0.011, JSON.stringify({ share: f.platformShare, collected: f.platformShareCollected, uncollected: f.platformShareUncollected, gross: f.totalRevenue }));

    section("A job finished after its week was issued rolls onto the next statement");
    // A week is issued exactly once. Until 2026-09-16 a job completed on
    // Tuesday for last week's date arrived after last week's statement and
    // was never billed by any week (daily audit, #381). It now rolls onto
    // the next statement, dated as it was.
    const nextMonday = new Date(lastMonday.getTime() + 7 * 86_400_000);
    const nextWeekKey = `${nextMonday.getUTCFullYear()}-${String(nextMonday.getUTCMonth() + 1).padStart(2, "0")}-${String(nextMonday.getUTCDate()).padStart(2, "0")}`;
    const late = await seedJob(A.json.id, { status: "completed", driver: true, actualFare: "30.00", passenger: "Late Larry", at: insideLastWeek(3) });
    const rolled = await admin.req("POST", `/api/admin/organizations/${A.json.id}/statements`, { week: nextWeekKey });
    check("the following week's statement is issued and carries the late job", rolled.status === 200 && rolled.json?.created === true && rolled.json?.statement?.jobCount >= 1, JSON.stringify(rolled.json?.reason ?? rolled.json?.message ?? rolled.status));
    const { rows: [lateRow] } = await db.query("SELECT statement_id, billed_status FROM commercial_jobs WHERE id=$1", [late.jobId]);
    check("and the late job is stamped with it, not left unbilled forever", lateRow?.statement_id === rolled.json?.statement?.id && lateRow?.billed_status === "statement", JSON.stringify(lateRow));

    section("Two issuers at once cannot both take one job");
    // A late job is entitled to any later week's statement. Two weeks issued
    // at the same moment — the Monday sweep and an operator's button — used
    // to both price it and both stamp it, the last write winning, and each
    // statement's total counted it (corporate audit, #381). The jobs are now
    // locked for the transaction, so one issuer takes it and the other no
    // longer sees it.
    const D = await admin.req("POST", "/api/admin/organizations", { name: "Largo Dialysis", category: "medical" });
    orgIds.push(D.json.id);
    const weekAfterKey = (() => { const m = new Date(lastMonday.getTime() + 14 * 86_400_000); return `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}-${String(m.getUTCDate()).padStart(2, "0")}`; })();
    const shared = await seedJob(D.json.id, { status: "completed", driver: true, actualFare: "30.00", passenger: "Only once", at: insideLastWeek(2) });
    const [w1, w2] = await Promise.all([
      admin.req("POST", `/api/admin/organizations/${D.json.id}/statements`, { week: nextWeekKey }),
      admin.req("POST", `/api/admin/organizations/${D.json.id}/statements`, { week: weekAfterKey }),
    ]);
    const issuedBoth = [w1, w2].filter((r) => r.status === 200 && r.json?.created === true);
    const { rows: [sharedRow] } = await db.query("SELECT statement_id FROM commercial_jobs WHERE id=$1", [shared.jobId]);
    check("the job lands on exactly one statement", !!sharedRow.statement_id && issuedBoth.some((r) => r.json.statement.id === sharedRow.statement_id), JSON.stringify({ on: sharedRow.statement_id?.slice(0, 8), issued: issuedBoth.map((r) => r.json.statement.id.slice(0, 8)) }));
    const { rows: dStatements } = await db.query("SELECT id, job_count, total FROM commercial_statements WHERE organization_id=$1", [D.json.id]);
    let reconciled = true;
    for (const st of dStatements) {
      const { rows: [agg] } = await db.query("SELECT count(*)::int AS n FROM commercial_jobs WHERE statement_id=$1", [st.id]);
      if (agg.n !== st.job_count) reconciled = false;
    }
    const totalJobs = dStatements.reduce((n, st) => n + st.job_count, 0);
    check("every statement's job count equals the jobs attached to it, and the job is counted once in all", reconciled && totalJobs === 1, JSON.stringify(dStatements.map((st) => [st.job_count, st.total])));
    const { rows: [dAgg] } = await db.query("SELECT count(*)::int AS n FROM commercial_statements WHERE organization_id=$1 AND job_count = 0", [D.json.id]);
    check("no empty statement was written for the week that lost the race", dAgg.n === 0, `empty=${dAgg.n}`);

    section("Settlement believes only the statement's current attempt");
    // Stripe is a fake key here, so a real debit cannot be raised; the
    // statement is put into the state a raised debit leaves it in, and the
    // signed events Stripe would send are posted to the webhook. What is
    // proven is the correlation (corporate audit, #382): an event about a
    // superseded attempt is ignored whatever it says, an event about the
    // current attempt moves the statement, and a settled statement never
    // moves again.
    const guest = new Session(base);
    const signedPost = (obj) => {
      const payload = JSON.stringify(obj);
      const sig = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_e2e_fake" });
      return guest.req("POST", "/api/webhooks/stripe", payload, { "Content-Type": "application/json", "stripe-signature": sig });
    };
    const piEvent = (type, piId, piStatus, statementId, extra = {}) => ({
      id: `evt_e2e_${piId}_${type}_${Date.now()}`, object: "event", type, created: Math.floor(Date.now() / 1000),
      data: { object: { id: piId, object: "payment_intent", status: piStatus, amount: 7750, currency: "usd", metadata: { statementId, organizationId: A.json.id }, ...extra } },
    });
    // The statement from the first section, put in flight on attempt 2 with a known intent.
    await db.query("UPDATE commercial_statements SET status='charging', attempts=2, stripe_payment_intent_id='pi_e2e_attempt2', last_error=NULL WHERE id=$1", [st.id]);
    const staleOk = await signedPost(piEvent("payment_intent.succeeded", "pi_e2e_attempt1", "succeeded", st.id));
    const { rows: [afterStale] } = await db.query("SELECT status, stripe_payment_intent_id FROM commercial_statements WHERE id=$1", [st.id]);
    check("a success about an earlier attempt is ignored: the statement stays charging on its current one", staleOk.status === 200 && afterStale.status === "charging" && afterStale.stripe_payment_intent_id === "pi_e2e_attempt2", JSON.stringify(afterStale));
    await signedPost(piEvent("payment_intent.processing", "pi_e2e_attempt2", "processing", st.id));
    const { rows: [afterProcessing] } = await db.query("SELECT status FROM commercial_statements WHERE id=$1", [st.id]);
    check("a bank debit entering clearing leaves it charging", afterProcessing.status === "charging", JSON.stringify(afterProcessing));
    await signedPost(piEvent("payment_intent.succeeded", "pi_e2e_attempt2", "succeeded", st.id));
    const { rows: [afterPaid] } = await db.query("SELECT status, paid_at FROM commercial_statements WHERE id=$1", [st.id]);
    const { rows: paidJobs } = await db.query("SELECT billed_status FROM commercial_jobs WHERE statement_id=$1", [st.id]);
    check("a success about the current attempt pays the statement and its jobs", afterPaid.status === "paid" && !!afterPaid.paid_at && paidJobs.length === 3 && paidJobs.every((j) => j.billed_status === "paid"), JSON.stringify({ afterPaid, jobs: paidJobs.map((j) => j.billed_status) }));
    await signedPost(piEvent("payment_intent.payment_failed", "pi_e2e_attempt2", "requires_payment_method", st.id, { last_payment_error: { message: "late failure" } }));
    const { rows: [afterLate] } = await db.query("SELECT status FROM commercial_statements WHERE id=$1", [st.id]);
    check("a failure arriving after it was paid does not unpay it", afterLate.status === "paid", JSON.stringify(afterLate));
    // Another statement: an attempt whose answer never came back, then Stripe's word arrives.
    await db.query("UPDATE commercial_statements SET status='charging', attempts=1, stripe_payment_intent_id=NULL WHERE id=$1", [bStmt.id]);
    await signedPost(piEvent("payment_intent.processing", "pi_e2e_orphan", "processing", bStmt.id));
    const { rows: [adopted] } = await db.query("SELECT status, stripe_payment_intent_id FROM commercial_statements WHERE id=$1", [bStmt.id]);
    check("a statement whose attempt lost its id adopts the intent Stripe names for it", adopted.status === "charging" && adopted.stripe_payment_intent_id === "pi_e2e_orphan", JSON.stringify(adopted));
    await signedPost(piEvent("payment_intent.canceled", "pi_e2e_orphan", "canceled", bStmt.id));
    const { rows: [debitCancelled] } = await db.query("SELECT status, last_error FROM commercial_statements WHERE id=$1", [bStmt.id]);
    check("a cancelled debit is a failure the statement shows, so it can be retried", debitCancelled.status === "failed" && /canceled/i.test(debitCancelled.last_error ?? ""), JSON.stringify(debitCancelled));
    await db.query("UPDATE commercial_statements SET status='open', attempts=0, stripe_payment_intent_id=NULL, last_error=NULL WHERE id=$1", [bStmt.id]);

    section("An empty week is not billed at all");
    const C = await admin.req("POST", "/api/admin/organizations", { name: "Quiet Clinic", category: "medical" });
    orgIds.push(C.json.id);
    const none = await admin.req("POST", `/api/admin/organizations/${C.json.id}/statements`, { week: weekKey });
    check("no jobs means no statement and a reason", none.json?.statement === null && /No billable jobs/.test(none.json?.reason ?? ""), JSON.stringify(none.json?.reason));
    const badWeek = await admin.req("POST", `/api/admin/organizations/${A.json.id}/statements`, { week: "2026-W37" });
    check("a week that is not a Monday date is refused", badWeek.status === 400, JSON.stringify(badWeek.json?.message));
  } finally {
    await deleteRides(db, rideIds).catch(() => {});
    if (orgIds.length) await db.query("DELETE FROM commercial_statements WHERE organization_id = ANY($1::varchar[])", [orgIds]).catch(() => {});
    await deleteOrgs(db, orgIds).catch(() => {});
  }
}
