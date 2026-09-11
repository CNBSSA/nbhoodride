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
    const { rows: [bStmt] } = await db.query("SELECT status, total, attempts FROM commercial_statements WHERE organization_id=$1", [B.json.id]);
    check("its statement is open, with nothing attempted", bStmt.status === "open" && bStmt.total === "34.00" && bStmt.attempts === 0, JSON.stringify(bStmt));

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
