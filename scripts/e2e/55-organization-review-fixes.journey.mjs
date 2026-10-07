import Stripe from "stripe";
import { Session, check, section, serverLog, connectDb, deleteRides, deleteOrgs, tinyPng, FIXTURES, PASSWORD, PICKUP, DEST } from "./harness.mjs";

/**
 * Code review of the organization doors (2026-10-06). Each section fails on
 * the code before the review:
 *  - O1 a new collection attempt clears the failed attempt's intent id, so an
 *    unanswered attempt is adopted from Stripe's word and never confused
 *    with the failure before it;
 *  - O2 an account PG Ride has not approved (or has paused) cannot invite,
 *    and a link made earlier is not honoured while it is closed;
 *  - O3 an existing account's invitation is accepted only from that
 *    account's own session;
 *  - O4 cancelling a commercial job from the app needs booking rights;
 *  - O5 a standing order is booked as someone still allowed to book, and
 *    when nobody is, ops are paged once per order and date;
 *  - O7 the proof JSON is never written back from a stale read.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);   // owner of the orgs made here
  const driver = new Session(base); await driver.login(FIXTURES.driver.email); // owner of the pending e2e-org-app
  const orgIds = [], rideIds = [], userIds = [];
  const loc = (p) => JSON.stringify(p);
  const tokenOf = (link) => String(link ?? "").split("/org/join/")[1] ?? "";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const logShows = async (re) => { for (let i = 0; i < 75; i++) { if (re.test(serverLog(server))) return true; await sleep(200); } return false; };
  const locker = await connectDb();
  // The refusals below are failed requests on the invitation door, which
  // shares the suite's per-address budget of failed sign-ins; they come from
  // an address of their own so later journeys keep theirs.
  const apart = { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.55" };

  const seedJob = async (orgId, cols) => {
    const { rows: [r] } = await db.query(
      `INSERT INTO rides (rider_id, driver_id, status, pickup_location, destination_location, estimated_fare, actual_fare, payment_method, ride_type, booked_for_friend, passenger_name, scheduled_at, completed_at)
       VALUES ($1,$2,$3,$4,$5,'30.00',$6,'invoice','commercial',true,$7,$8,$9) RETURNING id`,
      [cols.rider ?? FIXTURES.rider.id, cols.driver ? FIXTURES.driver.id : null, cols.status, loc(PICKUP), loc(DEST), cols.actualFare ?? null, cols.passenger ?? "Pat Passenger", cols.at ?? new Date(Date.now() + 6 * 3_600_000), cols.status === "completed" ? new Date() : null]);
    rideIds.push(r.id);
    const { rows: [j] } = await db.query(
      `INSERT INTO commercial_jobs (ride_id, organization_id, requester_id, category, facility_fee, parcel_size, handover, proof)
       VALUES ($1,$2,$3,$4,'0.00',$5,$6,$7) RETURNING id`,
      [r.id, orgId, cols.rider ?? FIXTURES.rider.id, cols.category ?? "business", cols.parcelSize ?? null, cols.handover ?? null, cols.proof ? JSON.stringify(cols.proof) : null]);
    return { rideId: r.id, jobId: j.id };
  };
  const proofOf = async (jobId) => (await db.query("SELECT proof FROM commercial_jobs WHERE id=$1", [jobId])).rows[0]?.proof ?? {};
  /** Hold the job's row lock while `during` runs, then change the proof the way another writer would and let go. */
  const raceOnJob = async (jobId, during, merge) => {
    await locker.query("BEGIN");
    await locker.query("SELECT id FROM commercial_jobs WHERE id=$1 FOR UPDATE", [jobId]);
    const pending = during();
    // Wait until the competing writer is actually queued on the lock (as
    // Postgres reports it), not a fixed time: a slow CI runner may need
    // longer than a laptop. At most 10 seconds, then go on regardless.
    for (let i = 0; i < 50; i++) {
      const { rows: [w] } = await db.query("SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted");
      if (w.n > 0) break;
      await sleep(200);
    }
    await sleep(300);
    await locker.query("UPDATE commercial_jobs SET proof = COALESCE(proof,'{}'::jsonb) || $2::jsonb WHERE id=$1", [jobId, JSON.stringify(merge)]);
    await locker.query("COMMIT");
    return pending;
  };

  try {
    const S = await admin.req("POST", "/api/admin/organizations", { name: "Review Fix Couriers", category: "business" });
    orgIds.push(S.json.id);
    const orgId = S.json.id;
    await admin.req("POST", `/api/admin/organizations/${orgId}/members`, { email: FIXTURES.rider.email, role: "owner" });

    // ── O1 ──
    section("A new collection attempt does not keep the failed attempt's intent");
    await db.query("UPDATE organizations SET stripe_customer_id='cus_e2e_review', default_payment_method_id='pm_e2e_review' WHERE id=$1", [orgId]);
    const { rows: [st] } = await db.query(
      `INSERT INTO commercial_statements (organization_id, period_key, period_label, period_start, period_end, job_count, total, status, attempts, stripe_payment_intent_id, last_error)
       VALUES ($1,'2026-01-05','Jan 5 – Jan 12',NOW() - interval '30 days',NOW() - interval '23 days',1,'50.00','failed',1,'pi_e2e_review_attempt1','Insufficient funds') RETURNING id`, [orgId]);
    const retry = await admin.req("POST", `/api/admin/commercial-statements/${st.id}/charge`);
    const { rows: [open2] } = await db.query("SELECT status, attempts, stripe_payment_intent_id FROM commercial_statements WHERE id=$1", [st.id]);
    check("the retry Stripe never answered is left open on attempt 2 with no intent recorded",
      retry.status === 200 && retry.json?.charged === false && open2.status === "charging" && open2.attempts === 2 && open2.stripe_payment_intent_id === null, JSON.stringify({ reason: retry.json?.reason, open2 }));
    const guest = new Session(base); await guest.csrf();
    const signedPost = (obj) => {
      const payload = JSON.stringify(obj);
      const sig = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_e2e_fake" });
      return guest.req("POST", "/api/webhooks/stripe", payload, { "Content-Type": "application/json", "stripe-signature": sig });
    };
    const piEvent = (type, piId, piStatus, attempt, extra = {}) => ({
      id: `evt_e2e_rev_${piId}_${type}_${Date.now()}`, object: "event", type, created: Math.floor(Date.now() / 1000),
      data: { object: { id: piId, object: "payment_intent", status: piStatus, amount: 5000, currency: "usd", metadata: { statementId: st.id, organizationId: orgId, attempt: String(attempt) }, ...extra } },
    });
    await signedPost(piEvent("payment_intent.payment_failed", "pi_e2e_review_attempt1", "requires_payment_method", 1, { last_payment_error: { message: "late echo of attempt 1" } }));
    const { rows: [afterEcho] } = await db.query("SELECT status, stripe_payment_intent_id FROM commercial_statements WHERE id=$1", [st.id]);
    check("a late failure about attempt 1 does not decide attempt 2", afterEcho.status === "charging" && afterEcho.stripe_payment_intent_id === null, JSON.stringify(afterEcho));
    await signedPost(piEvent("payment_intent.processing", "pi_e2e_review_attempt2", "processing", 2));
    const { rows: [adopted] } = await db.query("SELECT status, stripe_payment_intent_id FROM commercial_statements WHERE id=$1", [st.id]);
    check("Stripe's word about attempt 2 is believed and its intent adopted", adopted.status === "charging" && adopted.stripe_payment_intent_id === "pi_e2e_review_attempt2", JSON.stringify(adopted));
    await signedPost(piEvent("payment_intent.succeeded", "pi_e2e_review_attempt2", "succeeded", 2));
    const { rows: [paid] } = await db.query("SELECT status FROM commercial_statements WHERE id=$1", [st.id]);
    check("and its success pays the statement", paid.status === "paid", JSON.stringify(paid));
    await db.query("UPDATE organizations SET stripe_customer_id=NULL, default_payment_method_id=NULL WHERE id=$1", [orgId]);

    // ── O2 ──
    section("Only an approved, open account invites");
    const pendingInvite = await driver.req("POST", "/api/org/e2e-org-app/members", { email: `e2e-rev-pending-${Date.now()}@example.com`, role: "requester" });
    check("the owner of an account PG Ride has not approved cannot invite anyone", pendingInvite.status === 409 && /not approved/.test(pendingInvite.json?.message ?? ""), `${pendingInvite.status} ${JSON.stringify(pendingInvite.json)}`);
    const { rows: [noInv] } = await db.query("SELECT count(*)::int AS n FROM organization_invitations WHERE organization_id='e2e-org-app'");
    check("and no invitation was written", noInv.n === 0, JSON.stringify(noInv));
    const laterEmail = `e2e-rev-later-${Date.now()}@example.com`;
    const early = await rider.req("POST", `/api/org/${orgId}/members`, { email: laterEmail, role: "requester" });
    check("an open account invites", early.status === 202 && !!tokenOf(early.json?.link), JSON.stringify(early.json?.message ?? early.status));
    check("PG Ride pauses the account", (await admin.req("PATCH", `/api/admin/organizations/${orgId}`, { status: "paused" })).status === 200);
    const stranger = new Session(base); await stranger.csrf();
    const pausedView = await stranger.req("GET", `/api/org/invitations/${tokenOf(early.json?.link)}`);
    check("the link says the account is not open", pausedView.status === 200 && /not open for new members/.test(pausedView.json?.refusal ?? ""), JSON.stringify(pausedView.json));
    const pausedAccept = await stranger.req("POST", `/api/org/invitations/${tokenOf(early.json?.link)}/accept`, { firstName: "Paula", lastName: "Paused", phone: "3015550177", password: "Str0ng!Pass123", termsAccepted: true, privacyAccepted: true }, apart);
    const { rows: [noUser] } = await db.query("SELECT count(*)::int AS n FROM users WHERE email=$1", [laterEmail]);
    check("accepting it while paused is refused and no approved account is created", pausedAccept.status === 409 && noUser.n === 0, `${pausedAccept.status} ${JSON.stringify(pausedAccept.json)} users=${noUser.n}`);
    const pausedInvite = await rider.req("POST", `/api/org/${orgId}/members`, { email: `e2e-rev-p2-${Date.now()}@example.com`, role: "requester" });
    check("nor can a paused account invite", pausedInvite.status === 409 && /paused/.test(pausedInvite.json?.message ?? ""), `${pausedInvite.status} ${JSON.stringify(pausedInvite.json)}`);
    await admin.req("PATCH", `/api/admin/organizations/${orgId}`, { status: "active" });

    // ── O3 ──
    section("An existing account accepts only from its own session");
    // The invitee signed up on their own after the invitation went out.
    const existingEmail = `e2e-rev-existing-${Date.now()}@example.com`;
    const inv3 = await rider.req("POST", `/api/org/${orgId}/members`, { email: existingEmail, role: "requester" });
    const link3 = inv3.json?.link;
    const existingId = `e2e-rev-existing-${Date.now()}`;
    await db.query(`INSERT INTO users (id, email, password, first_name, last_name, is_approved, registration_completed_at)
      SELECT $1, $2, password, 'Erin', 'Existing', true, NOW() FROM users WHERE id=$3`, [existingId, existingEmail, FIXTURES.rider.id]);
    userIds.push(existingId);
    const holder = new Session(base); await holder.csrf();
    const blind = await holder.req("POST", `/api/org/invitations/${tokenOf(link3)}/accept`, {}, apart);
    const memberCount = async () => (await db.query("SELECT count(*)::int AS n FROM organization_members WHERE organization_id=$1 AND user_id=$2", [orgId, existingId])).rows[0].n;
    check("whoever holds the link cannot attach the account; they are told to sign in, the email masked", blind.status === 401 && /^Sign in as e2\*\*\*@example\.com to accept/.test(blind.json?.message ?? "") && await memberCount() === 0, `${blind.status} ${JSON.stringify(blind.json)}`);
    const wrong = await driver.req("POST", `/api/org/invitations/${tokenOf(link3)}/accept`, {}, apart);
    check("signed in as somebody else it is refused too", wrong.status === 403 && await memberCount() === 0, `${wrong.status} ${JSON.stringify(wrong.json)}`);
    const invitee = new Session(base); await invitee.login(existingEmail, PASSWORD);
    const own = await invitee.req("POST", `/api/org/invitations/${tokenOf(link3)}/accept`, {});
    check("signed in as the invited account it is accepted", own.status === 200 && own.json?.existing === true && await memberCount() === 1, `${own.status} ${JSON.stringify(own.json)}`);

    // ── O4 ──
    section("Cancelling a commercial job from the app needs booking rights");
    const job4 = await seedJob(orgId, { status: "pending", passenger: "Cancel Case" });
    await admin.req("POST", `/api/admin/organizations/${orgId}/members`, { email: FIXTURES.rider.email, role: "billing" });
    const refused = await rider.req("POST", `/api/rides/${job4.rideId}/cancel`, { reason: "no longer here" });
    const { rows: [still] } = await db.query("SELECT status FROM rides WHERE id=$1", [job4.rideId]);
    check("a requester who can no longer book for the account cannot cancel its job", refused.status === 403 && still.status === "pending", `${refused.status} ${JSON.stringify(refused.json)} ${still.status}`);
    await admin.req("POST", `/api/admin/organizations/${orgId}/members`, { email: FIXTURES.rider.email, role: "owner" });
    const allowed = await rider.req("POST", `/api/rides/${job4.rideId}/cancel`, { reason: "plans changed" });
    check("with booking rights back, the cancel goes through on the account's terms", allowed.status === 200 && allowed.json?.billedTo === "organization", `${allowed.status} ${JSON.stringify(allowed.json)}`);

    // ── O5 ──
    section("A standing order is booked as someone who may still book");
    const M = await admin.req("POST", "/api/admin/organizations", { name: "Review Fix Dialysis", category: "medical" });
    orgIds.push(M.json.id);
    await admin.req("POST", `/api/admin/organizations/${M.json.id}/members`, { email: FIXTURES.rider.email, role: "owner" });
    await admin.req("POST", `/api/admin/organizations/${M.json.id}/members`, { email: FIXTURES.driver.email, role: "requester" });
    const at = new Date(Date.now() + 4 * 3_600_000);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
    const hour = Number(parts.find((p) => p.type === "hour").value), minute = Number(parts.find((p) => p.type === "minute").value);
    const so = await driver.req("POST", `/api/org/${M.json.id}/standing-orders`, {
      passengerName: "Quinn Confidential", passengerPhone: "2405550191", pickup: PICKUP, destination: DEST,
      days: [0, 1, 2, 3, 4, 5, 6], departureHour: hour, departureMinute: minute, returnMode: "none", vehicleType: "standard",
    });
    check("the requester sets up a standing order", so.status === 201 && so.json?.booked >= 7, JSON.stringify(so.json?.message ?? so.json?.booked));
    const clearJobs = async () => {
      const { rows } = await db.query("SELECT ride_id FROM commercial_jobs WHERE standing_order_id=$1", [so.json.id]);
      await deleteRides(db, rows.map((r) => r.ride_id));
    };
    await clearJobs();
    check("the requester leaves the account", (await admin.req("DELETE", `/api/admin/organizations/${M.json.id}/members/${FIXTURES.driver.id}`)).status === 200);
    const resumed = await rider.req("POST", `/api/org/${M.json.id}/standing-orders/${so.json.id}/resume`);
    const { rows: booked5 } = await db.query("SELECT r.rider_id FROM commercial_jobs cj JOIN rides r ON r.id = cj.ride_id WHERE cj.standing_order_id=$1", [so.json.id]);
    check("the order keeps booking, as the account's owner, and nothing goes to the person who left",
      resumed.status === 200 && booked5.length >= 7 && booked5.every((r) => r.rider_id === FIXTURES.rider.id), JSON.stringify({ booked: resumed.json?.booked, riders: [...new Set(booked5.map((r) => r.rider_id))] }));
    await clearJobs();
    await admin.req("POST", `/api/admin/organizations/${M.json.id}/members`, { email: FIXTURES.rider.email, role: "billing" });
    await admin.req("POST", "/api/admin/analytics/materialize-standing-orders");
    const { rows: [none5] } = await db.query("SELECT count(*)::int AS n FROM commercial_jobs WHERE standing_order_id=$1", [so.json.id]);
    check("with nobody left who may book, nothing is booked", none5.n === 0, JSON.stringify(none5));
    check("and ops are paged, naming the account", await logShows(/Standing order NOT booked[\s\S]{0,200}Review Fix Dialysis/));
    const pages = () => (serverLog(server).match(/Standing order NOT booked[\s\S]{0,200}?Review Fix Dialysis/g) ?? []).length;
    await sleep(4000); // every date's page is written before counting
    const firstCount = pages();
    const pageText = serverLog(server).match(/Standing order NOT booked[\s\S]{0,600}/)?.[0] ?? "";
    check("the page never names the passenger", !/Quinn|2405550191/.test(pageText), pageText.slice(0, 300));
    await admin.req("POST", "/api/admin/analytics/materialize-standing-orders");
    await sleep(4000);
    check("one page per service date, and a second sweep does not page the same dates again", firstCount >= 7 && pages() === firstCount, `${firstCount} → ${pages()}`);
    await db.query("UPDATE commercial_standing_orders SET is_active=false WHERE id=$1", [so.json.id]);

    // ── O7 ──
    section("The proof is never written back from a stale read");
    const up = await driver.req("POST", "/api/objects/upload?store=db", {});
    const photoPath = new URL(up.json?.uploadURL ?? "http://x/").pathname;
    check("the driver uploads a handover photo", (await driver.req("PUT", photoPath, tinyPng(), { "Content-Type": "image/png" })).status === 200, photoPath);
    const signedAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const late = await seedJob(orgId, { status: "completed", driver: true, actualFare: "12.00", parcelSize: "small", handover: "unattended", proof: { signedAt, signedBy: FIXTURES.driver.id, photoPending: true, receivedBy: null, photoUrl: null } });
    const latePost = await raceOnJob(late.jobId, () => driver.req("POST", `/api/driver/rides/${late.rideId}/proof`, { photoUrl: photoPath }), { photoPendingPagedAt: "2026-10-06T00:00:00.000Z" });
    const lateProof = await proofOf(late.jobId);
    check("a late photo and a sweep's stamp written at the same moment both stay", latePost.status === 200 && lateProof.photoUrl === photoPath && lateProof.photoPendingPagedAt === "2026-10-06T00:00:00.000Z", `${latePost.status} ${JSON.stringify(lateProof)}`);

    const stale = await seedJob(orgId, { status: "completed", driver: true, actualFare: "12.00", parcelSize: "small", handover: "unattended", proof: { signedAt: new Date(Date.now() - 25 * 3_600_000).toISOString(), signedBy: FIXTURES.driver.id, photoPending: true } });
    await raceOnJob(stale.jobId, () => admin.req("POST", "/api/admin/analytics/pending-proof-sweep"), { photoPending: false, photoUrl: photoPath });
    const staleProof = await proofOf(stale.jobId);
    check("the pending-photo sweep never erases a photo that arrived while it ran, nor calls it 'never arrived'", staleProof.photoUrl === photoPath && staleProof.photoNeverArrived !== true, JSON.stringify(staleProof));

    const done = await seedJob(orgId, { status: "completed", driver: true, actualFare: "12.00", parcelSize: "small", handover: "person", proof: { signedAt, signedBy: FIXTURES.driver.id, receivedBy: "Front desk", photoPending: false } });
    const completeRetry = await raceOnJob(done.jobId, () => driver.req("POST", `/api/driver/rides/${done.rideId}/complete`, {}), { photoUrl: photoPath });
    let doneProof = {};
    for (let i = 0; i < 20; i++) { doneProof = await proofOf(done.jobId); if (doneProof.deliveredTextedAt) break; await sleep(200); }
    check("the delivered-text stamp is merged in, keeping what was written meanwhile", completeRetry.status === 200 && !!doneProof.deliveredTextedAt && doneProof.photoUrl === photoPath && doneProof.receivedBy === "Front desk", `${completeRetry.status} ${JSON.stringify(doneProof)}`);
  } finally {
    await locker.query("ROLLBACK").catch(() => {});
    await locker.end().catch(() => {});
    await deleteRides(db, rideIds).catch(() => {});
    await db.query("DELETE FROM organization_invitations WHERE organization_id = ANY($1::varchar[])", [orgIds]).catch(() => {});
    await deleteOrgs(db, orgIds).catch(() => {});
    // Accounts this journey made, including any an old build let a closed account's link create.
    const { rows: made } = await db.query("SELECT id FROM users WHERE email LIKE 'e2e-rev-%@example.com'").catch(() => ({ rows: [] }));
    for (const r of made) if (!userIds.includes(r.id)) userIds.push(r.id);
    if (userIds.length) {
      await db.query("DELETE FROM organization_members WHERE user_id = ANY($1::varchar[])", [userIds]).catch(() => {});
      await db.query("DELETE FROM sessions WHERE sess::text LIKE ANY($1::text[])", [userIds.map((u) => `%${u}%`)]).catch(() => {});
      await db.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [userIds]).catch(() => {});
    }
  }
}
