import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { Session, check, section, FIXTURES } from "./harness.mjs";

/**
 * A driver's socket going quiet is not the driver going away (reliability
 * audit, 2026-09-29). Before: any close of the driver's WebSocket within two
 * hours of a claimed scheduled ride released it at once and told the rider
 * "your driver went offline" — and the app closes that socket on every
 * navigation, refresh and iOS background. Now a close starts a clock, a
 * re-join stops it, and only a driver still gone after the grace loses the
 * ride — with the driver and ops told, not only the rider.
 */
const PICKUP = { lat: 38.9, lng: -76.85, address: "12 Oak St, Bowie, MD" };
const DEST = { lat: 38.95, lng: -76.9, address: "9 Elm St, Laurel, MD" };

function openSocket(base, session, userId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { Cookie: session.cookieHeader(), "X-Forwarded-Proto": "https" } });
    const timer = setTimeout(() => reject(new Error("socket did not open")), 5000);
    ws.on("open", () => { ws.send(JSON.stringify({ type: "join", userId })); clearTimeout(timer); setTimeout(() => resolve(ws), 300); });
    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}
const closed = (ws) => new Promise((r) => { ws.once("close", () => setTimeout(r, 300)); ws.close(); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run({ base, db, server }) {
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const dropped = () => db.query("SELECT presence_dropped_at AS at FROM driver_profiles WHERE user_id=$1", [FIXTURES.driver.id]).then((r) => r.rows[0]?.at ?? null);
  const rideRow = (id) => db.query("SELECT status, driver_id FROM rides WHERE id=$1", [id]).then((r) => r.rows[0]);
  let rideId = null;
  try {
    await db.query("UPDATE driver_profiles SET presence_dropped_at = NULL WHERE user_id=$1", [FIXTURES.driver.id]);
    section("A driver holds a scheduled ride an hour out");
    // Booking needs 3 hours' notice; the release window is the next 2 hours,
    // so book 4 hours out and then bring the pickup to an hour out.
    const booked = await rider.req("POST", "/api/rides", { pickupLocation: PICKUP, destinationLocation: DEST, estimatedFare: 20, paymentMethod: "card", scheduledAt: new Date(Date.now() + 4 * 60 * 60e3).toISOString() });
    rideId = booked.json?.id ?? null;
    check("the ride is booked", (booked.status === 201 || booked.status === 200) && !!rideId, `${booked.status} ${JSON.stringify(booked.json?.message)}`);
    const claim = await driver.req("POST", `/api/driver/rides/${rideId}/claim`, {});
    check("the driver claims it", claim.status === 200 && (await rideRow(rideId))?.driver_id === FIXTURES.driver.id, `${claim.status} ${JSON.stringify(claim.json?.message)}`);
    await db.query("UPDATE rides SET scheduled_at = NOW() + interval '60 minutes' WHERE id=$1", [rideId]);

    section("Closing the socket starts a clock and releases nothing");
    const ws1 = await openSocket(base, driver, FIXTURES.driver.id);
    check("a join clears any old drop", (await dropped()) === null);
    await closed(ws1);
    const at1 = await dropped();
    check("the close is noted on the driver", at1 !== null, String(at1));
    const still = await rideRow(rideId);
    check("the ride is still the driver's", still?.driver_id === FIXTURES.driver.id && ["pending", "accepted"].includes(still?.status), JSON.stringify(still));
    const early = await admin.req("POST", "/api/admin/analytics/driver-drop-sweep", {});
    check("the sweep inside the grace releases nothing", early.status === 200 && early.json?.released?.length === 0, JSON.stringify(early.json));
    check("and the ride is still the driver's", (await rideRow(rideId))?.driver_id === FIXTURES.driver.id);

    section("Coming back stops the clock");
    const ws2 = await openSocket(base, driver, FIXTURES.driver.id);
    check("a re-join clears the drop", (await dropped()) === null);
    await db.query("UPDATE driver_profiles SET presence_dropped_at = NOW() - interval '10 minutes' WHERE user_id=$1", [FIXTURES.driver.id]);
    const raced = await admin.req("POST", "/api/admin/analytics/driver-drop-sweep", {});
    check("a stale drop on a driver with a live socket is cleared, not acted on", raced.json?.cleared?.includes(FIXTURES.driver.id) && raced.json?.released?.length === 0 && (await dropped()) === null, JSON.stringify(raced.json));
    check("the ride is still the driver's", (await rideRow(rideId))?.driver_id === FIXTURES.driver.id);
    await closed(ws2);

    section("Gone past the grace, the ride is released and everyone is told");
    await db.query("UPDATE driver_profiles SET presence_dropped_at = NOW() - interval '6 minutes' WHERE user_id=$1", [FIXTURES.driver.id]);
    const { rows: [before] } = await db.query("SELECT count(*)::int AS n FROM in_app_notifications WHERE user_id=$1 AND type='scheduled-ride-released'", [FIXTURES.driver.id]).catch(() => ({ rows: [{ n: 0 }] }));
    const late = await admin.req("POST", "/api/admin/analytics/driver-drop-sweep", {});
    check("the sweep releases the ride", late.status === 200 && late.json?.released?.includes(rideId), JSON.stringify(late.json));
    const freed = await rideRow(rideId);
    check("the ride is open again for other drivers", freed?.driver_id === null && freed?.status === "pending", JSON.stringify(freed));
    check("the clock is cleared so the driver is not paged again every minute", (await dropped()) === null);
    await wait(300);
    const { rows: [after] } = await db.query("SELECT count(*)::int AS n, max(body) AS body FROM in_app_notifications WHERE user_id=$1 AND type='scheduled-ride-released'", [FIXTURES.driver.id]).catch(() => ({ rows: [{ n: 0 }] }));
    check("the driver is told, naming the pickup and how long they were gone", after.n === before.n + 1 && /12 Oak St/.test(after.body ?? "") && /6 minutes/.test(after.body ?? ""), JSON.stringify(after));
    const log = readFileSync(server.logPath, "utf8");
    check("ops are paged, naming the ride", new RegExp(`Driver dropped a scheduled ride[^\\n]*${rideId}`).test(log.replace(/\n/g, " ")) || log.includes("Driver dropped a scheduled ride"), "no ops alert in the server log");
  } finally {
    if (rideId) await db.query("DELETE FROM rides WHERE id=$1", [rideId]).catch(() => {});
    await db.query("UPDATE driver_profiles SET presence_dropped_at = NULL WHERE user_id=$1", [FIXTURES.driver.id]).catch(() => {});
  }
}
