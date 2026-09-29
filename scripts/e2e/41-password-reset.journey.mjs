import { readFileSync } from "node:fs";
import { Session, check, section, FIXTURES, uniqueEmail } from "./harness.mjs";

/**
 * A rider who forgot their password gets back in (reliability audit,
 * 2026-09-29). Two things had made the emailed link useless: the reset
 * page never read `?token=` from it, and the token was written by the email
 * exactly as typed while accounts are stored lowercased, so "Festus@Gmail.com"
 * got the email and then "Invalid or expired reset token". This journey asks
 * with a mixed-case email, takes the token the email would carry from the
 * account row (the harness points email at a closed port, nothing is sent),
 * and walks the reset to a working sign-in; the button audit opens the
 * link itself.
 */
export async function run({ base, db, server }) {
  const email = uniqueEmail("forgot");
  const mixedCase = email.replace(/^([a-z])/, (c) => c.toUpperCase()).replace("@example", "@Example");
  const rider = new Session(base); await rider.csrf();
  await rider.req("POST", "/api/auth/signup", { email, password: "Uitestpass1!", firstName: "For", lastName: "Got", phone: "2405550189", termsAccepted: true, privacyAccepted: true });
  const { rows: [u] } = await db.query("SELECT id, email FROM users WHERE email=$1", [email]);
  check("the account is stored lowercased", u?.email === email.toLowerCase(), JSON.stringify(u));
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  await admin.req("POST", `/api/admin/users/${u.id}/approve`);

  section("Asking with the email in a different case still writes the token to the account");
  const ask = await rider.req("POST", "/api/auth/forgot-password", { email: mixedCase });
  check("the ask is answered the same as any", ask.status === 200 && /If the email exists/.test(ask.json?.message ?? ""), `${ask.status} ${JSON.stringify(ask.json)}`);
  const { rows: [tok] } = await db.query("SELECT password_reset_token AS token, password_reset_expiry AS expiry FROM users WHERE id=$1", [u.id]);
  check("a token is on the account, expiring about an hour out", typeof tok?.token === "string" && tok.token.length >= 20 && tok.expiry && (new Date(tok.expiry) - Date.now()) > 50 * 60 * 1000, JSON.stringify(tok));
  const unknown = await rider.req("POST", "/api/auth/forgot-password", { email: uniqueEmail("nobody") });
  check("an unknown email gets the same answer", unknown.status === 200 && unknown.json?.message === ask.json?.message, JSON.stringify(unknown.json));

  section("The token from the emailed link resets the password");
  const weak = await rider.req("POST", "/api/auth/reset-password", { token: tok.token, newPassword: "short" });
  check("a weak password is refused with the requirements named", weak.status === 400 && /Password must contain/.test(weak.json?.message ?? ""), JSON.stringify(weak.json));
  const done = await rider.req("POST", "/api/auth/reset-password", { token: tok.token, newPassword: "Newpassw0rd!" });
  check("the reset succeeds", done.status === 200, `${done.status} ${JSON.stringify(done.json)}`);
  const again = await rider.req("POST", "/api/auth/reset-password", { token: tok.token, newPassword: "Another0ne!" });
  check("the token is single use", again.status === 400, `${again.status} ${JSON.stringify(again.json)}`);
  check("the old password no longer works", (await rider.login(email, "Uitestpass1!")).status === 401);
  const fresh = await rider.login(email, "Newpassw0rd!");
  check("the new password signs in", fresh.status === 200, `${fresh.status} ${JSON.stringify(fresh.json?.message)}`);

  section("A reset by email clears the lockout and ends other sessions");
  const other = new Session(base); await other.csrf();
  const otherLogin = await other.login(email, "Newpassw0rd!");
  check("a second device is signed in", otherLogin.status === 200 && (await other.req("GET", "/api/auth/user")).status === 200);
  for (let i = 0; i < 5; i++) await rider.login(email, "WrongPass1!");
  check("five wrong tries lock the account", (await rider.login(email, "Newpassw0rd!")).status === 429);
  await rider.req("POST", "/api/auth/forgot-password", { email });
  const { rows: [tok2] } = await db.query("SELECT password_reset_token AS token FROM users WHERE id=$1", [u.id]);
  const unlock = await rider.req("POST", "/api/auth/reset-password", { token: tok2.token, newPassword: "Unl0cked!Pass" });
  check("the reset succeeds while locked out", unlock.status === 200, `${unlock.status} ${JSON.stringify(unlock.json)}`);
  const inAtOnce = await rider.login(email, "Unl0cked!Pass");
  check("and the new password signs in at once — the lockout is cleared", inAtOnce.status === 200, `${inAtOnce.status} ${JSON.stringify(inAtOnce.json?.message)}`);
  const { rows: [ctr] } = await db.query("SELECT failed_login_attempts, lockout_until FROM users WHERE id=$1", [u.id]);
  check("the counters are reset", ctr.failed_login_attempts === 0 && ctr.lockout_until === null, JSON.stringify(ctr));
  check("the second device's session is ended", (await other.req("GET", "/api/auth/user")).status === 401);

  section("A reset by an admin voids an emailed link still out there");
  await rider.req("POST", "/api/auth/forgot-password", { email });
  const { rows: [tok3] } = await db.query("SELECT password_reset_token AS token FROM users WHERE id=$1", [u.id]);
  check("a link is out", typeof tok3?.token === "string");
  const adminReset = await admin.req("POST", `/api/admin/users/${u.id}/reset-password`);
  check("the admin resets the password", adminReset.status === 200, `${adminReset.status}`);
  const voided = await rider.req("POST", "/api/auth/reset-password", { token: tok3.token, newPassword: "Sneaky0ne!Pass" });
  check("the earlier link no longer works", voided.status === 400, `${voided.status} ${JSON.stringify(voided.json)}`);
  check("the admin's temporary password does", (await rider.login(email, adminReset.json?.temporaryPassword)).status === 200);

  section("An email that could not be sent is paged and counted");
  // The harness points SMTP at a closed port, so every send fails: the
  // reset email above must have paged ops and left a reliability event.
  // Each send tries twice, two seconds apart, before it is reported.
  await new Promise((r) => setTimeout(r, 5000));
  const log = readFileSync(server.logPath, "utf8");
  // The log writes each alert on one line, its fields joined by " · ".
  const resetPages = [...log.matchAll(/Email FAILED to send · Email: ([^·\n]*) ·[^\n]*Class: (\w+)/g)].filter((m) => /password/i.test(m[1]));
  check("ops are paged with the email and the reason class", resetPages.length >= 1 && resetPages[0][2] === "connection", `pages=${JSON.stringify(resetPages.map((m) => m[1] + "/" + m[2]))}`);
  const { rows: [ev] } = await db.query("SELECT count(*)::int AS n FROM reliability_events WHERE kind='email_failed' AND page ILIKE '%password%'", []);
  check("every failure is a reliability event the morning review can count (three reset asks)", ev.n >= 3, JSON.stringify(ev));
  check("but ops are paged once an hour for the kind, not once per failure", resetPages.length === 1, `pages=${resetPages.length} events=${ev.n}`);

  section("An expired token is refused");
  await rider.req("POST", "/api/auth/forgot-password", { email });
  await db.query("UPDATE users SET password_reset_expiry = NOW() - interval '1 minute' WHERE id=$1", [u.id]);
  const { rows: [stale] } = await db.query("SELECT password_reset_token AS token FROM users WHERE id=$1", [u.id]);
  const late = await rider.req("POST", "/api/auth/reset-password", { token: stale.token, newPassword: "Newpassw0rd2!" });
  check("an expired token is refused", late.status === 400, `${late.status} ${JSON.stringify(late.json)}`);
  check("and the password is unchanged", (await rider.login(email, adminReset.json?.temporaryPassword)).status === 200);
}
