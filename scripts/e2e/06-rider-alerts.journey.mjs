import { Session, check, section, serverLog, FIXTURES, uniqueEmail, PICKUP, DEST } from "./harness.mjs";

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
}
