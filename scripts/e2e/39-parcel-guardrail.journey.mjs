import { createHmac } from "node:crypto";
import { Session, check, section, FIXTURES } from "./harness.mjs";

/**
 * The consumer parcel guardrail (Festus 2026-09-28, from the product
 * feedback: "typing 'send a package' just becomes a ride request; if
 * consumers shouldn't send parcels, don't let the UI promise it").
 *
 * PG Ride carries parcels for businesses only. A rider's parcel ask, in the
 * "Where should we take you?" box, in a text to the SMS agent or to the
 * assistant, is answered with the one honest answer and the business door
 * (shared/parcelAsk.ts), and nothing books from it; a ride is still a ride.
 */
export async function run({ base, db }) {
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const PHONE = "+12405550199";
  const sign = (url, params) => {
    const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
    return createHmac("sha1", "e2e-auth-token").update(data).digest("base64");
  };
  const text = async (body) => {
    const url = `${base}/api/webhooks/twilio/sms`;
    const params = { From: PHONE, Body: body };
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": sign(url, params), "X-Forwarded-Proto": "http" }, body: new URLSearchParams(params) });
    return { status: res.status, text: await res.text() };
  };
  let convoId = null;

  try {
    section("The intent box answers a parcel ask instead of booking a ride to it");
    const parcel = await rider.req("POST", "/api/mobility/intent", { utterance: "Send a package to 123 Main St" });
    check("'send a package to 123 Main St' is a parcel ask, with no destination to book", parcel.status === 200 && parcel.json?.parsed?.intentType === "parcel" && !parcel.json?.destinationAddress && !parcel.json?.destination, JSON.stringify(parcel.json));
    check("and carries the answer and the business door", /for businesses/.test(`${parcel.json?.refusal?.title ?? ""} ${parcel.json?.refusal?.message ?? ""}`) && parcel.json?.refusal?.path === "/org/apply", JSON.stringify(parcel.json?.refusal));
    const bare = await rider.req("POST", "/api/mobility/intent", { utterance: "send a package" });
    check("'send a package' alone is the same, not a ride to 'send a package'", bare.json?.parsed?.intentType === "parcel", JSON.stringify(bare.json?.parsed));
    const ride = await rider.req("POST", "/api/mobility/intent", { utterance: "take me to 123 Main St" });
    check("a ride is still a ride", ride.json?.parsed?.intentType === "ride_to" && ride.json?.destinationAddress === "123 Main St", JSON.stringify(ride.json?.parsed));
    const dropMe = await rider.req("POST", "/api/mobility/intent", { utterance: "drop me off at the mall" });
    check("'drop me off' is a person, not a parcel", dropMe.json?.parsed?.intentType !== "parcel", JSON.stringify(dropMe.json?.parsed));
    const { rows: [recorded] } = await db.query("SELECT intent_type FROM mobility_intents WHERE user_id=$1 ORDER BY created_at DESC LIMIT 4", [FIXTURES.rider.id]).catch(() => ({ rows: [null] }));
    check("the ask is recorded as what it was", !recorded || ["parcel", "ride_to", "book_ride"].includes(recorded.intent_type), JSON.stringify(recorded));

    section("A text asking to send a parcel is answered, never booked");
    await db.query("DELETE FROM sms_opt_outs WHERE phone=$1", [PHONE]).catch(() => {});
    const sms = await text("send a package to 123 Main St");
    check("the SMS agent answers with the business door", sms.status === 200 && /for businesses/.test(sms.text) && /\/org\/apply/.test(sms.text), sms.text.slice(0, 200));
    const smsRide = await text("RIDE deliver a parcel to 5 Oak St");
    check("even when it starts with RIDE", /for businesses/.test(smsRide.text) && !/Reply YES/.test(smsRide.text), smsRide.text.slice(0, 200));
    const smsPlain = await text("RIDE 5 Oak St");
    check("a plain RIDE text still books", /Reply YES/i.test(smsPlain.text) || /Book to/.test(smsPlain.text), smsPlain.text.slice(0, 200));

    section("The assistant gives the same answer, before any model is asked");
    const convo = await rider.req("POST", "/api/ai/conversations", { title: "Parcel" });
    convoId = convo.json?.id ?? null;
    check("a conversation opens", convo.status === 200 && !!convoId, JSON.stringify(convo.json?.message ?? convo.status));
    // The reply streams as server-sent events, so read it raw with the rider's own session.
    const csrf = rider.jar.get("csrf_token");
    const res = await fetch(`${base}/api/ai/conversations/${convoId}/messages`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https", Cookie: rider.cookieHeader(), ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}) }, body: JSON.stringify({ content: "Can you deliver a package to my sister in Largo?" }) });
    const body = await res.text();
    check("the answer is the parcel answer with the business door, streamed like any reply", res.status === 200 && /for businesses/.test(body) && /\/org\/apply/.test(body) && /"done":true/.test(body), body.slice(0, 300));
    const msgs = await rider.req("GET", `/api/ai/conversations/${convoId}/messages`);
    check("and it is kept in the conversation", (msgs.json ?? []).some((m) => m.role === "assistant" && /for businesses/.test(m.content)), JSON.stringify((msgs.json ?? []).map((m) => m.role)));
  } finally {
    if (convoId) await rider.req("DELETE", `/api/ai/conversations/${convoId}`).catch(() => {});
    await db.query("DELETE FROM sms_booking_sessions WHERE phone LIKE '%2405550199'").catch(() => {});
  }
}
