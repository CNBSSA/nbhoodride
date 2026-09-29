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
export async function run({ base, db }) {
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

  section("An expired token is refused");
  await rider.req("POST", "/api/auth/forgot-password", { email });
  await db.query("UPDATE users SET password_reset_expiry = NOW() - interval '1 minute' WHERE id=$1", [u.id]);
  const { rows: [stale] } = await db.query("SELECT password_reset_token AS token FROM users WHERE id=$1", [u.id]);
  const late = await rider.req("POST", "/api/auth/reset-password", { token: stale.token, newPassword: "Newpassw0rd2!" });
  check("an expired token is refused", late.status === 400, `${late.status} ${JSON.stringify(late.json)}`);
  check("and the password is unchanged", (await rider.login(email, "Newpassw0rd!")).status === 200);
}
