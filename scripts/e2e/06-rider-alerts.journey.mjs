import { Session, check, section, serverLog, deleteRides, FIXTURES, uniqueEmail, PICKUP, DEST } from "./harness.mjs";

/** Every rider-facing failure raises exactly one alert; repeats fold. */
export async function run({ base, db, server }) {
  const email = uniqueEmail("alerts");
  const r = new Session(base); await r.csrf();
  await r.req("POST", "/api/auth/signup", { email, password: "Uitestpass1!", firstName: "Trouble", lastName: "Rider", phone: "2405550199", termsAccepted: true, privacyAccepted: true });
  await r.req("POST", "/api/auth/signup", { email: "not-an-email", password: "x" });
  await r.login(email); await r.login(email); // pending approval ×2 → one alert
  const { rows: [u] } = await db.query("SELECT id FROM users WHERE email=$1", [email]);
  const admin = new Session(base); await admin.login(FIXTURES.admin.email); await admin.req("POST", `/api/admin/users/${u.id}/approve`);
  await r.login(email);
  await r.req("POST", "/api/rides", { pickupLocation: PICKUP, destinationLocation: DEST, estimatedFare: 20, paymentMethod: "card" }); // no card
  await r.req("POST", "/api/client-errors", { kind: "push_subscribe_failed", message: "invalid_key: e2e", page: "/profile" });
  await new Promise((res) => setTimeout(res, 300));
  const log = serverLog(server);
  const n = (kind, key) => (log.match(new RegExp(`\\[rider-alert\\] ${kind} key=${key}`, "g")) || []).length;
  section("One alert per problem");
  check("signup failure alerted", n("signup_failed", "not-an-email") === 1);
  check("pending-approval login alerted once (second attempt folded)", n("login_pending_approval", u.id) === 1);
  check("no-card booking alerted", n("booking_refused", `${u.id}:no_card`) === 1);
  check("push failure alerted", n("push_subscribe_failed", u.id) >= 1);

  // Report Issue: every report from the app was rejected because the sheet
  // sent "fare-dispute" and the schema only knew "fare_dispute". Both must
  // work, a report must alert, and in card-only mode it must reach a human
  // rather than be auto-"resolved" with a credit to a wallet that is off.
  section("Report Issue reaches the founder");
  const loc = (p) => JSON.stringify(p);
  const { rows: [done] } = await db.query(
    `INSERT INTO rides (rider_id, driver_id, status, pickup_location, destination_location, estimated_fare, actual_fare, payment_method, completed_at)
     VALUES ($1, $2, 'completed', $3, $4, 23.21, 23.21, 'cash', NOW()) RETURNING id`,
    [u.id, FIXTURES.driver.id, loc(PICKUP), loc(DEST)]);
  try {
    const legacy = await r.req("POST", "/api/disputes", { rideId: done.id, issueType: "fare-dispute", description: "The quote was $23.21 and I am only paid $7.12" });
    check("report with the app's old issue id is accepted", legacy.status === 200, JSON.stringify(legacy.json?.message ?? legacy.status));
    check("issue type stored in canonical form", legacy.json?.issueType === "fare_dispute", `issueType=${legacy.json?.issueType}`);
    const canonical = await r.req("POST", "/api/disputes", { rideId: done.id, issueType: "wrong_route", description: "Went the long way round" });
    check("report with the canonical issue id is accepted", canonical.status === 200, JSON.stringify(canonical.json?.message ?? canonical.status));
    const bad = await r.req("POST", "/api/disputes", { rideId: done.id, issueType: "nonsense", description: "x" });
    check("unknown issue type is refused with a reason, not a blank failure", bad.status === 400 && /issueType/i.test(bad.json?.message ?? ""), JSON.stringify(bad.json));
    await new Promise((res) => setTimeout(res, 400));
    const log2 = serverLog(server);
    check("each report alerts the founder", (log2.match(/\[rider-alert\] dispute_filed key=/g) || []).length >= 2);
    const mine = await r.req("GET", `/api/disputes/ride/${done.id}`);
    check("reports wait for a human (no phantom wallet credit in card-only mode)", mine.status === 200 && (mine.json ?? []).length === 2 && mine.json.every((d) => d.status === "pending"), JSON.stringify((mine.json ?? []).map((d) => d.status)));
  } finally {
    await deleteRides(db, [done.id]).catch(() => {});
  }
}
