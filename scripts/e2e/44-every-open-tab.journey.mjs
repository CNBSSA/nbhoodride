import WebSocket from "ws";
import { Session, check, section, FIXTURES, PICKUP, DEST } from "./harness.mjs";

/**
 * One person, every open tab (reliability audit 2026-09-29; priority 5).
 * The server kept one socket per user, so a second tab silently orphaned
 * the first: a rider with the app open on a phone and a laptop got the
 * driver's message on whichever joined last. Now every open socket a person
 * has receives it, closing one tab leaves the others live, and a driver is
 * only "gone" (the drop-grace clock) when the last tab closes.
 */
function openSocket(base, session, userId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { Cookie: session.cookieHeader(), "X-Forwarded-Proto": "https" } });
    const got = [];
    ws.on("message", (d) => { try { got.push(JSON.parse(String(d))); } catch {} });
    const timer = setTimeout(() => reject(new Error("socket did not open")), 5000);
    ws.on("open", () => { ws.send(JSON.stringify({ type: "join", userId })); clearTimeout(timer); setTimeout(() => resolve({ ws, got }), 300); });
    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const closed = (ws) => new Promise((r) => { ws.once("close", () => setTimeout(r, 300)); ws.close(); });

export async function run({ base, db }) {
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  let rideId = null;
  try {
    const { rows: [r] } = await db.query(
      `INSERT INTO rides (rider_id, driver_id, status, pickup_location, destination_location, estimated_fare, payment_method, ride_type)
       VALUES ($1, $2, 'accepted', $3, $4, 12.5, 'card', 'standard') RETURNING id`,
      [FIXTURES.rider.id, FIXTURES.driver.id, JSON.stringify(PICKUP), JSON.stringify(DEST)]);
    rideId = r.id;

    section("A message reaches every tab the rider has open");
    const phone = await openSocket(base, rider, FIXTURES.rider.id);
    const laptop = await openSocket(base, rider, FIXTURES.rider.id);
    const sent = await driver.req("POST", `/api/rides/${rideId}/messages`, { body: "Outside, blue Camry" });
    check("the driver's message is accepted", sent.status === 200 || sent.status === 201, `${sent.status} ${JSON.stringify(sent.json?.message)}`);
    await wait(500);
    const onPhone = phone.got.some((m) => m.type === "ride_message");
    const onLaptop = laptop.got.some((m) => m.type === "ride_message");
    check("the first tab gets it", onPhone, JSON.stringify(phone.got.map((m) => m.type)));
    check("and so does the second, not only the last to join", onLaptop, JSON.stringify(laptop.got.map((m) => m.type)));

    section("Closing one tab leaves the other live");
    await closed(phone.ws);
    await driver.req("POST", `/api/rides/${rideId}/messages`, { body: "Still here" });
    await wait(500);
    check("the remaining tab still receives", laptop.got.filter((m) => m.type === "ride_message").length >= 2, JSON.stringify(laptop.got.map((m) => m.type)));
    await closed(laptop.ws);

    section("A driver is only gone when the last tab closes");
    await db.query("UPDATE driver_profiles SET presence_dropped_at = NULL WHERE user_id=$1", [FIXTURES.driver.id]);
    const d1 = await openSocket(base, driver, FIXTURES.driver.id);
    const d2 = await openSocket(base, driver, FIXTURES.driver.id);
    await closed(d1.ws);
    const { rows: [after1] } = await db.query("SELECT presence_dropped_at AS at FROM driver_profiles WHERE user_id=$1", [FIXTURES.driver.id]);
    check("closing one of two tabs does not start the drop clock", after1.at === null, String(after1.at));
    await closed(d2.ws);
    const { rows: [after2] } = await db.query("SELECT presence_dropped_at AS at FROM driver_profiles WHERE user_id=$1", [FIXTURES.driver.id]);
    check("closing the last one does", after2.at !== null, String(after2.at));
  } finally {
    if (rideId) {
      await db.query("DELETE FROM ride_messages WHERE ride_id=$1", [rideId]).catch(() => {});
      await db.query("DELETE FROM rides WHERE id=$1", [rideId]).catch(() => {});
    }
    await db.query("UPDATE driver_profiles SET presence_dropped_at = NULL WHERE user_id=$1", [FIXTURES.driver.id]).catch(() => {});
  }
}
