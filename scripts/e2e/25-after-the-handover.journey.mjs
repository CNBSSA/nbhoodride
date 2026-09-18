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
    const phoneC = new Session(base); await phoneC.login(email);
    const stringFlag = await admin.req("PATCH", `/api/admin/users/${u.id}`, { isSuspended: "true" });
    check("a suspension sent as a string still ends the sessions (post-implementation audit)", stringFlag.status === 200 && (await phoneC.req("GET", "/api/auth/user")).status === 401, `patch=${stringFlag.status}`);
    await admin.req("PATCH", `/api/admin/users/${u.id}`, { isSuspended: false, isApproved: true });

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
    check("and serves the photo to whoever holds the link, never as a page", photo.status === 200 && /image\/jpeg/.test(photo.headers.get("content-type") ?? "") && photo.headers.get("x-content-type-options") === "nosniff" && /sandbox/.test(photo.headers.get("content-security-policy") ?? ""), `${photo.status} ${photo.headers.get("content-type")} ${photo.headers.get("content-security-policy")}`);
    // A second parcel ended early is a completion too, and the receiver is told once.
    const second = await rider.req("POST", `/api/org/${orgId}/deliveries`, { parcelSize: "small", pickupContact: { name: "Counter" }, dropContact: { name: "Ada", phone: "3015550189" }, readyAt: inMin(95), windowHours: 2, pickup: PICKUP, destination: DEST, handover: "person" });
    const secondRide = second.json.ride.id; rideIds.push(secondRide);
    await driver.req("POST", `/api/driver/rides/${secondRide}/claim`); await driver.req("POST", `/api/driver/rides/${secondRide}/confirm-scheduled`);
    await db.query("UPDATE rides SET scheduled_at = NOW() - interval '5 minutes' WHERE id=$1", [secondRide]);
    await driver.req("POST", `/api/driver/rides/${secondRide}/start`);
    const reuse = await driver.req("POST", `/api/driver/rides/${secondRide}/proof`, { receivedBy: "Ada", photoUrl: up.json?.uploadURL });
    check("a photo that already proves another job is refused for this one", reuse.status === 400 && /already the proof/.test(reuse.json?.message ?? ""), JSON.stringify(reuse.json));
    const upSvg = await driver.req("POST", "/api/objects/upload?store=db", {});
    const svgPath = new URL(upSvg.json?.uploadURL ?? "http://x/").pathname;
    await driver.req("PUT", svgPath, "<svg onload='alert(1)'/>", { "Content-Type": "image/svg+xml" });
    const svg = await driver.req("POST", `/api/driver/rides/${secondRide}/proof`, { receivedBy: "Ada", photoUrl: svgPath });
    check("an SVG is not a photo", svg.status === 400 && /JPEG, PNG/.test(svg.json?.message ?? ""), JSON.stringify(svg.json));
    await driver.req("POST", `/api/driver/rides/${secondRide}/proof`, { receivedBy: "Ada" });
    const early = await driver.req("POST", `/api/rides/${secondRide}/cancel`, { reason: "ended early after the handover" });
    await new Promise((r) => setTimeout(r, 400));
    const earlyLines = serverLog(server).split("\n").filter((l) => l.includes("[delivered] J-") && l.includes("→") && /received by Ada/.test(l));
    check("ending the run early after the handover completes it and tells the receiver, once", early.status === 200 && earlyLines.length === 1, `status=${early.status} texts=${earlyLines.length}`);
    // An early end is a completion: the organization is billed the metered
    // fare, so the driver is paid their share of it now, as on Complete.
    const { rows: [earlyRow] } = await db.query("SELECT driver_earnings FROM rides WHERE id=$1", [secondRide]);
    const { rows: earlyPaid } = await db.query("SELECT amount FROM wallet_transactions WHERE ride_id=$1 AND reason='ride_earnings'", [secondRide]);
    check("the driver is paid for a run ended early, exactly as for one completed", earlyPaid.length === 1 && Number(earlyRow?.driver_earnings) > 0 && earlyPaid[0].amount === earlyRow.driver_earnings, JSON.stringify({ earlyPaid, earlyRow }));
    const again = await driver.req("POST", `/api/driver/rides/${secondRide}/complete`, {});
    await new Promise((r) => setTimeout(r, 300));
    check("a retry of Complete on the finished job does not text again", again.status === 200 && serverLog(server).split("\n").filter((l) => l.includes("[delivered] J-") && l.includes("→") && /received by Ada/.test(l)).length === 1);
    const { rows: stillOnce } = await db.query("SELECT amount FROM wallet_transactions WHERE ride_id=$1 AND reason='ride_earnings'", [secondRide]);
    check("and does not pay the driver twice", stillOnce.length === 1);
    check("a made-up link is not valid", (await guest.req("GET", `/api/delivered/${"0".repeat(48)}`)).status === 404);

    section("Photos are kept 90 days; the record stays");
    const { rows: [jobRow] } = await db.query("SELECT id FROM commercial_jobs WHERE ride_id=$1", [rideId]);
    const earlySweep = await admin.req("POST", "/api/admin/analytics/retire-proof-photos");
    check("a fresh photo is not touched", earlySweep.status === 200 && (await guest.req("GET", `/api/delivered/${token}`)).json?.hasPhoto === true, JSON.stringify(earlySweep.json));
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
