import { Session, check, section, FIXTURES, uniqueEmail } from "./harness.mjs";

/** Lockout, admin temporary password, non-admin refused, verification gate gone. */
export async function run({ base, db }) {
  const email = uniqueEmail("locked");
  const rider = new Session(base); await rider.csrf();
  await rider.req("POST", "/api/auth/signup", { email, password: "Uitestpass1!", firstName: "Lock", lastName: "Out", phone: "2405550188", termsAccepted: true, privacyAccepted: true });
  const { rows: [u] } = await db.query("SELECT id FROM users WHERE email=$1", [email]);
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  await admin.req("POST", `/api/admin/users/${u.id}/approve`);

  section("Lockout after repeated wrong passwords");
  for (let i = 0; i < 5; i++) await rider.login(email, "WrongPass1!");
  const locked = await rider.login(email);
  check("locked out with 429 after 5 wrong tries", locked.status === 429, `${locked.status} ${JSON.stringify(locked.json?.message)}`);

  section("Admin temporary password");
  check("a rider cannot reset passwords", [401, 403].includes((await rider.req("POST", `/api/admin/users/${u.id}/reset-password`)).status));
  const reset = await admin.req("POST", `/api/admin/users/${u.id}/reset-password`);
  check("admin gets a temporary password once", reset.status === 200 && /^Ride-\d{4}-Go!$/.test(reset.json?.temporaryPassword), JSON.stringify(reset.json));
  check("old password no longer works", (await rider.login(email, "Uitestpass1!")).status === 401);
  const fresh = await rider.login(email, reset.json.temporaryPassword);
  check("temporary password logs in and lockout is cleared", fresh.status === 200, `${fresh.status} ${JSON.stringify(fresh.json?.message)}`);
  const { rows: [row] } = await db.query("SELECT failed_login_attempts, lockout_until, email_verified_at FROM users WHERE id=$1", [u.id]);
  check("counters reset", row.failed_login_attempts === 0 && row.lockout_until === null);
  check("logged in with NO email verification (gate removed; email_verified_at still null)", row.email_verified_at === null);

  section("Removed endpoints stay removed");
  for (const path of ["/api/auth/verify-email", "/api/auth/resend-verification"]) {
    const r = await rider.req("POST", path, { token: "x", email });
    // No JSON API answers here any more — the request falls through to the SPA shell.
    check(`${path} is not a live API route`, r.json === null, `status ${r.status}, json=${JSON.stringify(r.json)}`);
  }
}
