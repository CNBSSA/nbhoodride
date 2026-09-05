import crypto from "node:crypto";
import { check, section } from "./harness.mjs";

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
}
