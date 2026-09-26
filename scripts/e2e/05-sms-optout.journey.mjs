import crypto from "node:crypto";
import { Session, check, section, FIXTURES } from "./harness.mjs";

/** Twilio inbound webhook: forged rejected, STOP/START recorded and cleared. */
export async function run({ base, db }) {
  const url = `${base}/api/webhooks/twilio/sms`;
  const sign = (params) => crypto.createHmac("sha1", "e2e-auth-token").update(Object.keys(params).sort().reduce((a, k) => a + k + params[k], url), "utf8").digest("base64");
  const post = (params, sig) => fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-Proto": "http", "X-Twilio-Signature": sig ?? sign(params) }, body: new URLSearchParams(params).toString() });
  const PHONE = "+12405550134";
  const optedOut = async () => (await db.query("SELECT 1 FROM sms_opt_outs WHERE phone=$1", [PHONE])).rows.length === 1;
  await db.query("DELETE FROM sms_opt_outs WHERE phone=$1", [PHONE]);

  section("Signature");
  check("forged signature rejected", (await post({ From: PHONE, Body: "STOP" }, "bogus")).status === 403);
  check("nothing recorded from a forged request", !(await optedOut()));
  section("STOP / START");
  const stop = await post({ From: PHONE, Body: "  Stop! " });
  check("STOP accepted with empty TwiML", stop.status === 200 && (await stop.text()).includes("<Response></Response>"));
  check("opt-out persisted under the normalized number", await optedOut());
  check("START accepted", (await post({ From: "(240) 555-0134", Body: "START" })).status === 200);
  check("START cleared the opt-out even in different formatting", !(await optedOut()));

  section("One signed door for keywords and booking commands (corporate audit #335)");
  const legacyUrl = `${base}/api/sms/inbound`;
  const signFor = (u, params) => crypto.createHmac("sha1", "e2e-auth-token").update(Object.keys(params).sort().reduce((a, k) => a + k + params[k], u), "utf8").digest("base64");
  const postTo = (u, params, sig) => fetch(u, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-Proto": "http", "X-Twilio-Signature": sig ?? signFor(u, params) }, body: new URLSearchParams(params).toString() });
  const forgedLegacy = await postTo(legacyUrl, { From: PHONE, Body: "status" }, "bogus");
  check("the legacy inbound route no longer books, cancels or tracks on an unsigned request", forgedLegacy.status === 403, `${forgedLegacy.status}`);
  const unsignedLegacy = await fetch(legacyUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-Proto": "http" }, body: new URLSearchParams({ From: PHONE, Body: "status" }).toString() });
  check("nor with no signature at all", unsignedLegacy.status === 403, `${unsignedLegacy.status}`);
  const signedLegacy = await postTo(legacyUrl, { From: PHONE, Body: "help me" });
  const signedLegacyText = await signedLegacy.text();
  check("signed, it answers the booking agent's reply", signedLegacy.status === 200 && /<Message>/.test(signedLegacyText), `${signedLegacy.status} ${signedLegacyText.slice(0, 80)}`);
  const cmd = await post({ From: PHONE, Body: "status" });
  const cmdText = await cmd.text();
  check("the Twilio-signed webhook answers a booking command in the same conversation", cmd.status === 200 && /<Message>/.test(cmdText), `${cmd.status} ${cmdText.slice(0, 80)}`);
  const forgedCmd = await post({ From: PHONE, Body: "status" }, "bogus");
  check("a forged booking command is rejected before anything is read", forgedCmd.status === 403);
  check("STOP still records the opt-out", (await post({ From: PHONE, Body: "STOP" })).status === 200 && (await optedOut()));
  const silent = await post({ From: PHONE, Body: "status" });
  const silentText = await silent.text();
  check("a number that replied STOP gets no reply to a command, not even from the agent", silent.status === 200 && !/<Message>/.test(silentText), `${silent.status} ${silentText.slice(0, 80)}`);

  section("Every outbound text goes through the opt-out registry");
  // The rider's emergency contact has replied STOP: the test text is refused
  // in words, and an emergency alert records that it could not be texted
  // instead of claiming it went out.
  const rider = new Session(base);
  check("rider logs in", (await rider.login(FIXTURES.rider.email)).status === 200);
  const { rows: [before] } = await db.query("SELECT emergency_contact FROM users WHERE id=$1", [FIXTURES.rider.id]);
  await db.query("UPDATE users SET emergency_contact=$2 WHERE id=$1", [FIXTURES.rider.id, PHONE]);
  const testSms = await rider.req("POST", "/api/emergency/test", { type: "sms" });
  check("a test text to a contact who replied STOP is refused, and says why", testSms.status === 400 && /replied STOP/.test(testSms.json?.message ?? ""), `${testSms.status} ${JSON.stringify(testSms.json?.message)}`);
  const alert = await rider.req("POST", "/api/emergency/start", { incidentType: "other", description: "e2e opt-out check", location: { lat: 38.9, lng: -76.8 } });
  check("an emergency alert still goes to the admins, and records that the contact could not be texted", alert.status === 200 && alert.json?.smsDeliveryStatus === "opted_out", `${alert.status} ${JSON.stringify(alert.json?.smsDeliveryStatus)}`);
  await db.query("UPDATE users SET emergency_contact=$2 WHERE id=$1", [FIXTURES.rider.id, before?.emergency_contact ?? null]);
  await db.query("DELETE FROM sms_opt_outs WHERE phone=$1", [PHONE]);
}
