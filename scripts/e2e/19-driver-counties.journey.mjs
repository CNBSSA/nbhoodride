import { Session, check, section, deleteRides, FIXTURES, PICKUP, DEST } from "./harness.mjs";

/**
 * A driver's counties for TODAY, chosen when they go online, decide what
 * work they can see and be sent.
 *
 * Two places used to read only the permanent preferences while the live
 * socket read the daily ones, so a driver who added a county for tonight's
 * shift was pinged about rides there and then could neither see them on
 * their board nor be dispatched to one. Nothing tested counties at all,
 * which is how that survived.
 */
export async function run({ base, db }) {
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const rideIds = [];
  const loc = (p) => JSON.stringify(p);

  // Remember what the driver had, so the rest of the suite is unaffected.
  const { rows: [before] } = await db.query(
    "SELECT accepted_counties, daily_counties FROM driver_profiles WHERE user_id=$1", [FIXTURES.driver.id]);

  try {
    section("A scheduled ride waiting in a county the driver has not accepted");
    // PICKUP is Bowie; the county is stamped on the ride at booking. Seeded
    // directly here so the test does not depend on a live geocoder.
    const pickupCounty = "Prince George's County";
    const elsewhere = "Montgomery County";
    const { rows: [r] } = await db.query(
      `INSERT INTO rides (rider_id, status, pickup_location, destination_location, payment_method, estimated_fare, scheduled_at, pickup_county)
       VALUES ($1,'pending',$2,$3,'card','20.00', NOW() + interval '5 hours', $4) RETURNING id`,
      [FIXTURES.rider.id, loc(PICKUP), loc(DEST), pickupCounty]);
    rideIds.push(r.id);
    const { rows: [county] } = await db.query("SELECT pickup_county FROM rides WHERE id=$1", [r.id]);
    check("the ride knows which county it starts in", county.pickup_county === pickupCounty, JSON.stringify(county));
    await db.query(
      "UPDATE driver_profiles SET accepted_counties=ARRAY[$2]::text[], daily_counties=NULL WHERE user_id=$1",
      [FIXTURES.driver.id, elsewhere]);
    const hidden = await driver.req("GET", "/api/driver/scheduled-rides");
    check("a driver who does not cover that county never sees the ride",
      !JSON.stringify(hidden.json ?? {}).includes(r.id), `accepted=${elsewhere}, pickup=${pickupCounty}`);

    section("Going online for tonight in that county");
    const online = await driver.req("POST", "/api/driver/toggle-status", { isOnline: true, dailyCounties: [pickupCounty] });
    check("the driver goes online having picked tonight's county", online.status === 200, JSON.stringify(online.json));
    const { rows: [saved] } = await db.query("SELECT daily_counties FROM driver_profiles WHERE user_id=$1", [FIXTURES.driver.id]);
    check("tonight's county is recorded against the driver", (saved.daily_counties ?? []).includes(pickupCounty), JSON.stringify(saved));

    const shown = await driver.req("GET", "/api/driver/scheduled-rides");
    check("now the ride is on their board, though their permanent prefs say otherwise",
      JSON.stringify(shown.json ?? {}).includes(r.id), `daily=${pickupCounty}, accepted=${elsewhere}`);

    section("Going offline gives tonight's county back");
    check("the driver goes offline", (await driver.req("POST", "/api/driver/toggle-status", { isOnline: false })).status === 200);
    const { rows: [cleared] } = await db.query("SELECT daily_counties FROM driver_profiles WHERE user_id=$1", [FIXTURES.driver.id]);
    check("tonight's county is cleared, so it cannot shrink tomorrow's coverage", cleared.daily_counties === null, JSON.stringify(cleared));
    const gone = await driver.req("GET", "/api/driver/scheduled-rides");
    check("and the ride leaves their board again", !JSON.stringify(gone.json ?? {}).includes(r.id));

    section("A driver who names no counties is sent everything");
    await db.query("UPDATE driver_profiles SET accepted_counties=ARRAY[]::text[], daily_counties=NULL WHERE user_id=$1", [FIXTURES.driver.id]);
    const all = await driver.req("GET", "/api/driver/scheduled-rides");
    check("an empty list means every county, not none", JSON.stringify(all.json ?? {}).includes(r.id));
  } finally {
    await db.query(
      "UPDATE driver_profiles SET accepted_counties=$2, daily_counties=$3 WHERE user_id=$1",
      [FIXTURES.driver.id, before?.accepted_counties ?? null, before?.daily_counties ?? null]).catch(() => {});
    await driver.req("POST", "/api/driver/toggle-status", { isOnline: false }).catch(() => {});
    await deleteRides(db, rideIds).catch(() => {});
  }
}
