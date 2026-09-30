import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
const sha256 = (raw) => createHash("sha256").update(raw, "utf8").digest("hex");

export async function run({ base, db, server }) {
  // The email carries the raw token and the row carries only its hash
  // (server/resetTokens.ts), so the journey plants a token it knows the
  // hash of wherever it needs to walk the link, and checks the shape of
  // what the ask itself wrote.
  const plant = async (userId, raw, minutesFromNow = 60) => db.query("UPDATE users SET password_reset_token=$2, password_reset_expiry = NOW() + ($3 || ' minutes')::interval WHERE id=$1", [userId, sha256(raw), String(minutesFromNow)]);
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
  check("and what is stored is its hash, not the token itself", /^[0-9a-f]{64}$/.test(tok?.token ?? ""), tok?.token);
  const RAW = "e2e-raw-token-" + Date.now();
  await plant(u.id, RAW);
  check("a raw token is refused as a stored value would be", (await rider.req("POST", "/api/auth/reset-password", { token: sha256(RAW), newPassword: "Newpassw0rd!" })).status === 400);
  const unknown = await rider.req("POST", "/api/auth/forgot-password", { email: uniqueEmail("nobody") });
  check("an unknown email gets the same answer", unknown.status === 200 && unknown.json?.message === ask.json?.message, JSON.stringify(unknown.json));

  section("The token from the emailed link resets the password");
  const weak = await rider.req("POST", "/api/auth/reset-password", { token: RAW, newPassword: "short" });
  check("a weak password is refused with the requirements named", weak.status === 400 && /Password must contain/.test(weak.json?.message ?? ""), JSON.stringify(weak.json));
  const done = await rider.req("POST", "/api/auth/reset-password", { token: RAW, newPassword: "Newpassw0rd!" });
  check("the reset succeeds", done.status === 200, `${done.status} ${JSON.stringify(done.json)}`);
  const again = await rider.req("POST", "/api/auth/reset-password", { token: RAW, newPassword: "Another0ne!" });
  check("the token is single use", again.status === 400, `${again.status} ${JSON.stringify(again.json)}`);
  check("the old password no longer works", (await rider.login(email, "Uitestpass1!")).status === 401);
  const fresh = await rider.login(email, "Newpassw0rd!");
  check("the new password signs in", fresh.status === 200, `${fresh.status} ${JSON.stringify(fresh.json?.message)}`);

  section("A reset by email clears the lockout and ends other sessions");
  const other = new Session(base); await other.csrf();
  const otherLogin = await other.login(email, "Newpassw0rd!");
  const otherMe = await other.req("GET", "/api/auth/user");
  check("a second device is signed in", otherLogin.status === 200 && otherMe.status === 200, `login ${otherLogin.status} ${JSON.stringify(otherLogin.json?.message)}; me ${otherMe.status}`);
  for (let i = 0; i < 5; i++) await rider.login(email, "WrongPass1!");
  check("five wrong tries lock the account", (await rider.login(email, "Newpassw0rd!")).status === 429);
  await rider.req("POST", "/api/auth/forgot-password", { email });
  const RAW2 = RAW + "-2"; await plant(u.id, RAW2);
  const unlock = await rider.req("POST", "/api/auth/reset-password", { token: RAW2, newPassword: "Unl0cked!Pass" });
  check("the reset succeeds while locked out", unlock.status === 200, `${unlock.status} ${JSON.stringify(unlock.json)}`);
  const inAtOnce = await rider.login(email, "Unl0cked!Pass");
  check("and the new password signs in at once — the lockout is cleared", inAtOnce.status === 200, `${inAtOnce.status} ${JSON.stringify(inAtOnce.json?.message)}`);
  const { rows: [ctr] } = await db.query("SELECT failed_login_attempts, lockout_until FROM users WHERE id=$1", [u.id]);
  check("the counters are reset", ctr.failed_login_attempts === 0 && ctr.lockout_until === null, JSON.stringify(ctr));
  check("the second device's session is ended", (await other.req("GET", "/api/auth/user")).status === 401);

  section("A reset by an admin voids an emailed link still out there");
  await rider.req("POST", "/api/auth/forgot-password", { email });
  const RAW3 = RAW + "-3"; await plant(u.id, RAW3);
  const { rows: [tok3] } = await db.query("SELECT password_reset_token AS token FROM users WHERE id=$1", [u.id]);
  check("a link is out", tok3?.token === sha256(RAW3));
  const adminReset = await admin.req("POST", `/api/admin/users/${u.id}/reset-password`);
  check("the admin resets the password", adminReset.status === 200, `${adminReset.status}`);
  const voided = await rider.req("POST", "/api/auth/reset-password", { token: RAW3, newPassword: "Sneaky0ne!Pass" });
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

  section("The text door reveals nothing about who has a phone on file");
  // Twilio Verify is not configured in the harness, so both answers are the
  // same 503 — the point is that an existing account and an unknown email
  // are told exactly the same thing by this door.
  const smsKnown = await rider.req("POST", "/api/auth/forgot-password-sms", { email });
  const smsUnknown = await rider.req("POST", "/api/auth/forgot-password-sms", { email: uniqueEmail("nobody") });
  check("an account with a phone and an unknown email get the same answer", smsKnown.status === smsUnknown.status && smsKnown.json?.message === smsUnknown.json?.message, `${smsKnown.status}/${smsUnknown.status} ${JSON.stringify(smsKnown.json)} vs ${JSON.stringify(smsUnknown.json)}`);

  section("An expired token is refused");
  const RAW4 = RAW + "-4"; await plant(u.id, RAW4, -1);
  const late = await rider.req("POST", "/api/auth/reset-password", { token: RAW4, newPassword: "Newpassw0rd2!" });
  check("an expired token is refused", late.status === 400, `${late.status} ${JSON.stringify(late.json)}`);
  check("and the password is unchanged", (await rider.login(email, adminReset.json?.temporaryPassword)).status === 200);
}
