/**
 * Standard practice after the handover (decided 2026-09-17): the receiver is
 * texted "delivered" with a link to the proof; proof photos are kept 90 days
 * and the record forever; revoking or suspending an account ends every
 * session it holds at once.
 */
import { Session, check, section, serverLog, deleteRides, deleteOrgs, FIXTURES, PASSWORD, PICKUP, DEST, uniqueEmail } from "./harness.mjs";

export async function run({ base, db, server }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const guest = new Session(base); await guest.csrf();
  const rideIds = [], orgIds = [], userEmails = [];
  const inMin = (m) => new Date(Date.now() + m * 60_000).toISOString();
  try {
    section("Revoking approval ends every session at once");
    const email = uniqueEmail("revoked"); userEmails.push(email);
    const fresh = new Session(base); await fresh.csrf();
    const signup = await fresh.req("POST", "/api/auth/signup", { email, password: PASSWORD, firstName: "Sess", lastName: "Ion", phone: "3015550166", termsAccepted: true, privacyAccepted: true });
    check("a new rider signs up", signup.status === 200, JSON.stringify(signup.json?.message ?? signup.status));
    const { rows: [u] } = await db.query("SELECT id FROM users WHERE email=$1", [email]);
    check("and is approved", (await admin.req("POST", `/api/admin/users/${u.id}/approve`)).status === 200);
    const phoneA = new Session(base); const phoneB = new Session(base);
    check("they sign in on two devices", (await phoneA.login(email)).status === 200 && (await phoneB.login(email)).status === 200);
    check("both devices are live", (await phoneA.req("GET", "/api/auth/user")).status === 200 && (await phoneB.req("GET", "/api/auth/user")).status === 200);
    check("PG Ride revokes their approval", (await admin.req("POST", `/api/admin/users/${u.id}/revoke-approval`)).status === 200);
    check("and both devices are signed out at once — not when their cookies happen to expire", (await phoneA.req("GET", "/api/auth/user")).status === 401 && (await phoneB.req("GET", "/api/auth/user")).status === 401);
    check("re-approved, they can sign in again", (await admin.req("POST", `/api/admin/users/${u.id}/approve`)).status === 200 && (await new Session(base).login(email)).status === 200);

    section("The receiver is told it was delivered, with a link to the proof");
    const shop = await admin.req("POST", "/api/admin/organizations", { name: "Corner Bakery", category: "food" });
    const orgId = shop.json.id; orgIds.push(orgId);
    await admin.req("POST", `/api/admin/organizations/${orgId}/members`, { email: FIXTURES.rider.email, role: "owner" });
    const booked = await rider.req("POST", `/api/org/${orgId}/deliveries`, { parcelSize: "small", pickupContact: { name: "Counter" }, dropContact: { name: "Ngozi", phone: "3015550188" }, readyAt: inMin(90), windowHours: 2, pickup: PICKUP, destination: DEST, handover: "person" });
    check("a parcel is booked", booked.status === 201, JSON.stringify(booked.json?.message ?? booked.status));
    const rideId = booked.json.ride.id; rideIds.push(rideId);
    check("claimed", (await driver.req("POST", `/api/driver/rides/${rideId}/claim`)).status === 200);
    await driver.req("POST", `/api/driver/rides/${rideId}/confirm-scheduled`);
    await db.query("UPDATE rides SET scheduled_at = NOW() - interval '5 minutes' WHERE id=$1", [rideId]);
    check("started", (await driver.req("POST", `/api/driver/rides/${rideId}/start`)).status === 200);
    const up = await driver.req("POST", "/api/objects/upload?store=db", {});
    const objectPath = new URL(up.json?.uploadURL ?? "http://x/").pathname;
    await driver.req("PUT", objectPath, "jpeg-bytes-of-a-door", { "Content-Type": "image/jpeg" });
    const proof = await driver.req("POST", `/api/driver/rides/${rideId}/proof`, { receivedBy: "Ngozi", photoUrl: up.json?.uploadURL });
    check("the handover is recorded with a photo", proof.status === 200 && proof.json?.proof?.photoUrl === objectPath, JSON.stringify(proof.json?.proof));
    check("completed", (await driver.req("POST", `/api/driver/rides/${rideId}/complete`, {})).status === 200);
    await new Promise((r) => setTimeout(r, 400));
    const line = serverLog(server).split("\n").reverse().find((l) => l.includes("[delivered] J-") && l.includes("→")) ?? "";
    check("the receiver's text is logged verbatim: the shop, the time, who received it, the link", /Corner Bakery/.test(line) && /received by Ngozi/.test(line) && /\/delivered\/[0-9a-f]{48}/.test(line) && !/small|box|\$/.test(line.split("→")[1] ?? ""), line.slice(0, 240));
    const token = (line.match(/\/delivered\/([0-9a-f]{48})/) ?? [])[1];
    const view = await guest.req("GET", `/api/delivered/${token}`);
    check("the delivered page shows the shop, the handover and that there is a photo — never the goods", view.status === 200 && view.json?.shopName === "Corner Bakery" && /received by Ngozi/.test(view.json?.handoverText ?? "") && view.json?.hasPhoto === true && !!view.json?.deliveredAt, JSON.stringify(view.json));
    const photo = await fetch(base + `/api/delivered/${token}/photo`, { headers: { "X-Forwarded-Proto": "https" } });
    check("and serves the photo to whoever holds the link", photo.status === 200 && /image\/jpeg/.test(photo.headers.get("content-type") ?? ""), `${photo.status} ${photo.headers.get("content-type")}`);
    check("a made-up link is not valid", (await guest.req("GET", `/api/delivered/${"0".repeat(48)}`)).status === 404);

    section("Photos are kept 90 days; the record stays");
    const { rows: [jobRow] } = await db.query("SELECT id FROM commercial_jobs WHERE ride_id=$1", [rideId]);
    const early = await admin.req("POST", "/api/admin/analytics/retire-proof-photos");
    check("a fresh photo is not touched", early.status === 200 && (await guest.req("GET", `/api/delivered/${token}`)).json?.hasPhoto === true, JSON.stringify(early.json));
    await db.query("UPDATE commercial_jobs SET proof = jsonb_set(proof, '{signedAt}', to_jsonb((NOW() - interval '91 days')::text)) WHERE id=$1", [jobRow.id]);
    const retire = await admin.req("POST", "/api/admin/analytics/retire-proof-photos");
    check("ninety-one days on, the photo is retired", retire.status === 200 && retire.json?.retired >= 1, JSON.stringify(retire.json));
    const objectId = objectPath.split("/").pop();
    const { rows: [gone] } = await db.query("SELECT count(*)::int AS n FROM stored_objects WHERE id=$1", [objectId]);
    const after = await guest.req("GET", `/api/delivered/${token}`);
    check("the stored photo is deleted, the page and the desk say so, and the record of who received it stays", gone?.n === 0 && after.json?.hasPhoto === false && after.json?.photoRetired === true && /received by Ngozi/.test(after.json?.handoverText ?? "") && /retired/.test(after.json?.handoverText ?? ""), JSON.stringify([gone, after.json]));
    check("the photo route says there is none", (await fetch(base + `/api/delivered/${token}/photo`, { headers: { "X-Forwarded-Proto": "https" } })).status === 404);
    check("and the sweep does not run again over it", ((await admin.req("POST", "/api/admin/analytics/retire-proof-photos")).json?.retired ?? 0) === 0);
  } finally {
    await deleteRides(db, rideIds).catch(() => {});
    await deleteOrgs(db, orgIds).catch(() => {});
    for (const e of userEmails) {
      const { rows } = await db.query("SELECT id FROM users WHERE email=$1", [e]).catch(() => ({ rows: [] }));
      for (const r of rows) { await db.query("DELETE FROM sessions WHERE sess->>'userId'=$1", [r.id]).catch(() => {}); await db.query("DELETE FROM wallet_transactions WHERE user_id=$1", [r.id]).catch(() => {}); await db.query("DELETE FROM users WHERE id=$1", [r.id]).catch(() => {}); }
    }
  }
}
