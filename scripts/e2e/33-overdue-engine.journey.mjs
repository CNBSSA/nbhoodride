import { Session, check, section, serverLog, FIXTURES, tinyPng } from "./harness.mjs";

/**
 * Overdue cars and the engine cut-off (Festus 2026-09-27: "No grace for late
 * returns, we cut off the engine remotely").
 *
 * A car out on a rental past its return time pages ops once to cut off the
 * engine, naming the car, its plate and who has it; the desk records the
 * cut-off and the restore; the renter is told the car is overdue; a return
 * one minute late pays an hour; a PG Ride car still with a driver after the
 * end of their weeks pages the same way. No tracker is connected, so the
 * record says the cut-off is made in the tracker's own app.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const renter = new Session(base); await renter.login(FIXTURES.rider.email);
  const carIds = [];
  const logCount = (re) => (serverLog(server).match(new RegExp(re.source, "g")) ?? []).length;
  const logShows = async (re) => { for (let i = 0; i < 25; i++) { if (re.test(serverLog(server))) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
  const upload = async (session) => {
    const up = await session.req("POST", "/api/objects/upload?store=db", {});
    const path = new URL(up.json?.uploadURL ?? "http://x/").pathname;
    return (await session.req("PUT", path, tinyPng(), { "Content-Type": "image/png" })).status === 200 ? path : null;
  };
  const inAYear = new Date(Date.now() + 365 * 86400_000).toISOString();

  try {
    section("A car out past its return time pages ops to cut off the engine, once");
    const photos = [await upload(admin), await upload(admin), await upload(admin), await upload(admin)];
    const made = await admin.req("POST", "/api/admin/rental/cars", {
      make: "Kia", model: "Forte", year: new Date().getUTCFullYear() - 1, color: "Red", licensePlate: "LATE501", vin: "3KPF24AD0ME000001",
      dailyPrice: 40, deposit: 100, lateHourFee: 20, photos, inspectionExpires: inAYear, registrationExpires: inAYear, insuranceExpires: inAYear,
      pickupLocation: { lat: 38.9073, lng: -76.7781, address: "PG Ride lot, Bowie, MD" },
    });
    const carId = made.json?.id; carIds.push(carId);
    const { rows: [b] } = await db.query(`INSERT INTO rental_bookings (car_id, renter_id, starts_at, ends_at, days, daily_price, rental_total, deposit, late_hour_fee, status, licence_number, licence_image_url, collected_at, collect_odometer, collect_photos, charge_intent_id, payment_status)
      VALUES ($1, $2, NOW() - interval '1 day', NOW() - interval '1 minute', 1, 40, 40, 100, 20, 'collected', 'M123456789', '/api/objects/db-upload/00000000-0000-4000-8000-0000000000c5', NOW() - interval '1 day', 5000, $3::jsonb, 'pi_e2e_late', 'charged') RETURNING id`,
      [carId, FIXTURES.rider.id, JSON.stringify(photos)]);
    const before = logCount(/Rental car OVERDUE: cut off the engine/);
    const sweep = await admin.req("POST", "/api/admin/analytics/rental-overdue-sweep", {});
    check("the watch finds the car a minute late and pages ops", sweep.status === 200 && sweep.json?.paged >= 1, JSON.stringify(sweep.json));
    check("the page names the car, its plate and who has it", await logShows(/Rental car OVERDUE: cut off the engine[\s\S]*LATE501[\s\S]*Renter/));
    await admin.req("POST", "/api/admin/analytics/rental-overdue-sweep", {});
    await new Promise((r) => setTimeout(r, 400));
    check("and pages it once, not every minute", logCount(/Rental car OVERDUE: cut off the engine/) === before + 1, `${logCount(/Rental car OVERDUE: cut off the engine/) - before} pages`);
    const mine = ((await renter.req("GET", "/api/rent/bookings")).json ?? []).find((x) => x.id === b.id);
    check("the renter's rental still shows as on the road, due back in the past", mine?.status === "collected" && new Date(mine.endsAt).getTime() < Date.now());

    section("The desk records the engine cut off and restored");
    const cut = await admin.req("POST", `/api/admin/rental/cars/${carId}/engine-cut-off`);
    check("the cut-off is recorded, and says the tracker is not connected yet", cut.status === 200 && cut.json?.car?.engineCutOffAt && cut.json?.tracker?.sent === false && /tracker's own app/.test(cut.json?.tracker?.reason ?? ""), JSON.stringify(cut.json?.tracker));
    check("recording it twice is refused", (await admin.req("POST", `/api/admin/rental/cars/${carId}/engine-cut-off`)).status === 409);
    check("ops are told", await logShows(/Rental car engine cut off[\s\S]*LATE501/));
    check("a rider cannot cut off an engine", (await renter.req("POST", `/api/admin/rental/cars/${carId}/engine-cut-off`)).status === 403);
    const { rows: [next] } = await db.query(`INSERT INTO rental_bookings (car_id, renter_id, starts_at, ends_at, days, daily_price, rental_total, deposit, status, licence_number, licence_image_url)
      VALUES ($1, $2, NOW() + interval '5 days', NOW() + interval '6 days', 1, 40, 40, 100, 'confirmed', 'M123456789', '/api/objects/db-upload/00000000-0000-4000-8000-0000000000c5') RETURNING id`, [carId, FIXTURES.rider.id]);
    await db.query("UPDATE rental_bookings SET status='returned' WHERE id=$1", [b.id]);
    const blocked = await admin.req("POST", `/api/admin/rental/bookings/${next.id}/collect`, { odometer: 5100, photos });
    check("a car recorded as cut off cannot be handed to the next renter", blocked.status === 409 && /engine is recorded as cut off/.test(blocked.json?.message ?? ""), `${blocked.status} ${blocked.json?.message}`);
    await db.query("UPDATE rental_bookings SET status='collected' WHERE id=$1", [b.id]);
    await db.query("DELETE FROM rental_bookings WHERE id=$1", [next.id]);
    const restored = await admin.req("POST", `/api/admin/rental/cars/${carId}/engine-restored`);
    check("the restore is recorded, with who restored it", restored.status === 200 && restored.json?.car?.engineRestoredAt && restored.json?.car?.engineRestoredBy === FIXTURES.admin.id, JSON.stringify({ at: restored.json?.car?.engineRestoredAt, by: restored.json?.car?.engineRestoredBy }));

    section("No grace: a car back a minute late pays an hour");
    await db.query("UPDATE rental_bookings SET ends_at = NOW() - interval '1 minute', deposit_intent_id = NULL WHERE id=$1", [b.id]);
    const back = await admin.req("POST", `/api/admin/rental/bookings/${b.id}/return`, { odometer: 5050, photos });
    check("one minute late is one hour at $20, from the deposit", back.status === 200 && back.json?.settlement?.lateHours === 1 && back.json?.settlement?.lateCharge === 20, JSON.stringify(back.json?.settlement ?? back.json?.message));

    section("A PG Ride car still with a driver after their weeks pages the same way");
    const { rows: [prof] } = await db.query("SELECT id FROM driver_profiles WHERE user_id=$1", [FIXTURES.driver.id]);
    await db.query("UPDATE rental_cars SET weekly_driver_rent = 250 WHERE id=$1", [carId]);
    const { rows: [a] } = await db.query(`INSERT INTO driver_car_assignments (car_id, driver_user_id, status, starts_at, weeks, ends_at, weekly_rent, collected_at, paid_through, payment_status)
      VALUES ($1, $2, 'active', NOW() - interval '7 days', 1, NOW() - interval '2 minutes', 250, NOW() - interval '7 days', NOW() - interval '2 minutes', 'paid') RETURNING id`, [carId, FIXTURES.driver.id]);
    await admin.req("POST", "/api/admin/analytics/rental-overdue-sweep", {});
    check("the driver's car is paged as overdue, naming the driver", await logShows(/Driver's PG Ride car OVERDUE: cut off the engine[\s\S]*LATE501[\s\S]*Driver/));
    // The public rental above is finished; only the driver has the car now.
    await db.query("UPDATE rental_bookings SET status='closed' WHERE id=$1", [b.id]);
    const ext = await admin.req("POST", `/api/admin/rental/assignments/${a.id}/extend`, { weeks: 1 });
    const { rows: [afterExt] } = await db.query("SELECT overdue_paged_at FROM driver_car_assignments WHERE id=$1", [a.id]);
    check("extending the driver's weeks clears the page, so a second lateness pages again", ext.status === 200 && afterExt.overdue_paged_at === null, JSON.stringify({ s: ext.status, m: ext.json?.message, p: afterExt.overdue_paged_at }));
    await db.query("DELETE FROM driver_car_assignments WHERE id=$1", [a.id]);
    void prof;

    section("Renters and drivers are told up front");
    const terms = await renter.req("GET", "/api/rent/terms");
    check("the rental terms say every hour late is charged and a late car may be stopped", /every hour late \(from the first minute\)/.test(terms.json?.terms ?? "") && /stopped remotely/.test(terms.json?.terms ?? ""), JSON.stringify(terms.json?.terms));
    const driverTerms = await renter.req("GET", "/api/driver/fleet-cars");
    check("and so do the terms for drivers", /stopped remotely/.test(driverTerms.json?.terms ?? ""), JSON.stringify(driverTerms.json?.terms));
  } finally {
    await db.query("DELETE FROM driver_car_assignments WHERE car_id = ANY($1::varchar[])", [carIds]).catch(() => {});
    await db.query("DELETE FROM rental_bookings WHERE car_id = ANY($1::varchar[])", [carIds]).catch(() => {});
    await db.query("DELETE FROM rental_cars WHERE id = ANY($1::varchar[])", [carIds]).catch(() => {});
  }
}
