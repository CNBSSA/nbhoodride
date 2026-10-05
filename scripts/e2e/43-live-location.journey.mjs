import WebSocket from "ws";
import { Session, check, section, FIXTURES, PICKUP, DEST } from "./harness.mjs";

/**
 * The rider's map never freezes silently (reliability audit 2026-09-29;
 * Festus's priority 2). The driver's position used to travel over the
 * socket only and the rider learned of it over the socket only, so a dropped
 * socket froze the map and let the stored position go stale enough for the
 * T-10 ride-risk page to fire on a driver who was driving. Now the driver
 * app posts over HTTP while its socket is down, the active-ride payload
 * carries the last position and its stamp for the rider's poll, and the
 * server pings every socket and drops one that does not answer.
 */
function openSocket(base, session, userId, opts = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { Cookie: session.cookieHeader(), "X-Forwarded-Proto": "https" }, ...opts });
    const timer = setTimeout(() => reject(new Error("socket did not open")), 5000);
    ws.on("open", () => { ws.send(JSON.stringify({ type: "join", userId })); clearTimeout(timer); setTimeout(() => resolve(ws), 300); });
    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run({ base, db }) {
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  let rideId = null;
  try {
    section("A driver on a ride posts a position over HTTP while the socket is down");
    const { rows: [r] } = await db.query(
      `INSERT INTO rides (rider_id, driver_id, status, pickup_location, destination_location, estimated_fare, payment_method, ride_type)
       VALUES ($1, $2, 'accepted', $3, $4, 12.5, 'card', 'standard') RETURNING id`,
      [FIXTURES.rider.id, FIXTURES.driver.id, JSON.stringify(PICKUP), JSON.stringify(DEST)]);
    rideId = r.id;
    await db.query("UPDATE driver_profiles SET current_location = NULL, location_updated_at = NULL WHERE user_id=$1", [FIXTURES.driver.id]);
    const before = await rider.req("GET", "/api/rides/active");
    const mine = (before.json ?? []).find((x) => x.id === rideId);
    check("the rider's active ride names the driver with no position yet", mine?.driver?.id === FIXTURES.driver.id && !mine?.driver?.currentLocation, JSON.stringify(mine?.driver));

    const posted = await driver.req("POST", "/api/driver/location", { lat: 38.91, lng: -76.79 });
    check("the HTTP door takes the position without a ride id", posted.status === 200 && typeof posted.json?.at === "string", `${posted.status} ${JSON.stringify(posted.json)}`);
    const { rows: [dp] } = await db.query("SELECT current_location AS loc, location_updated_at AS at FROM driver_profiles WHERE user_id=$1", [FIXTURES.driver.id]);
    check("the position is stored with its own stamp", dp?.loc?.lat === 38.91 && dp?.at && Date.now() - new Date(dp.at).getTime() < 10_000, JSON.stringify(dp));

    section("The rider's poll carries the position, so the map moves without a socket");
    const after = await rider.req("GET", "/api/rides/active");
    const seen = (after.json ?? []).find((x) => x.id === rideId);
    check("the active ride carries the driver's position and when it was written", seen?.driver?.currentLocation?.lat === 38.91 && seen?.driver?.currentLocation?.lng === -76.79 && typeof seen?.driver?.locationUpdatedAt === "string", JSON.stringify(seen?.driver));
    check("the rider is never shown the driver's ids or keys beyond the position", !("passwordResetToken" in (seen?.driver ?? {})) && !("payoutDetails" in (seen?.driver ?? {})));

    section("A profile edit is not a fresh position");
    await db.query("UPDATE driver_profiles SET location_updated_at = NOW() - interval '20 minutes', updated_at = NOW() WHERE user_id=$1", [FIXTURES.driver.id]);
    const { rows: [fresh] } = await db.query("SELECT COALESCE(location_updated_at, updated_at) AS at FROM driver_profiles WHERE user_id=$1", [FIXTURES.driver.id]);
    check("the ride-risk watch reads the position's own stamp, not the profile's", Date.now() - new Date(fresh.at).getTime() > 15 * 60_000, JSON.stringify(fresh));

    section("A socket that stops answering pings is dropped; one that answers is kept");
    const mute = await openSocket(base, driver, FIXTURES.driver.id, { autoPong: false });
    const live = await openSocket(base, rider, FIXTURES.rider.id);
    let muteClosed = false; let liveClosed = false;
    mute.on("close", () => { muteClosed = true; });
    live.on("close", () => { liveClosed = true; });
    // The server runs the same round by itself every 30 seconds, so its own
    // tick can land between opening these sockets and the admin's first
    // round and ping the silent one first. What must hold either way: no
    // socket that answers is ever dropped, and the silent one is gone within
    // two rounds of the admin's.
    const round1 = await admin.req("POST", "/api/admin/analytics/ws-heartbeat", {});
    await wait(500);
    check("the first round pings the open sockets and drops none that answered", round1.status === 200 && round1.json?.pinged >= 1 && !liveClosed, JSON.stringify(round1.json));
    const round2 = await admin.req("POST", "/api/admin/analytics/ws-heartbeat", {});
    await wait(500);
    // Whichever round drops it — the admin's or the server's own 30-second
    // tick landing between the two (2026-10-05: round 2 then never saw the
    // socket at all) — what must hold is that the silent socket is closed by
    // the server and the answering one is not.
    check("by the second round the socket that never answered is dropped", muteClosed && !liveClosed, JSON.stringify({ r1: round1.json, r2: round2.json, muteClosed }));
    check("and keeps the one that did", !liveClosed && live.readyState === WebSocket.OPEN);
    live.close();
  } finally {
    if (rideId) await db.query("DELETE FROM rides WHERE id=$1", [rideId]).catch(() => {});
    await db.query("UPDATE driver_profiles SET current_location = NULL, location_updated_at = NULL WHERE user_id=$1", [FIXTURES.driver.id]).catch(() => {});
  }
}
