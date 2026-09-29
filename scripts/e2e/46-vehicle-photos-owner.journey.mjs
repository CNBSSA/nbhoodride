import { Session, check, section, FIXTURES } from "./harness.mjs";

/**
 * A driver's car photos are theirs to change (security fix, 2026-09-29).
 * PUT /api/vehicles/photos updated whichever vehicle id it was given, so any
 * signed-in user could overwrite another driver's car photos. It now checks
 * the car belongs to the signed-in driver, as PUT /api/vehicles/:id already did.
 */
export async function run({ base, db }) {
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const { rows: [car] } = await db.query(
    "SELECT v.id, v.photos FROM vehicles v JOIN driver_profiles dp ON dp.id = v.driver_profile_id WHERE dp.user_id=$1 AND v.rental_car_id IS NULL ORDER BY v.created_at LIMIT 1",
    [FIXTURES.driver.id]);
  check("the driver fixture has a car of their own", !!car?.id, JSON.stringify(car));
  const before = car?.photos ?? [];
  try {
    section("Someone else cannot change a driver's car photos");
    const stranger = await rider.req("PUT", "/api/vehicles/photos", { vehicleId: car.id, photoURL: "/objects/x", photos: ["/objects/defaced"] });
    check("a rider is refused", stranger.status === 403, `${stranger.status} ${JSON.stringify(stranger.json)}`);
    const { rows: [after] } = await db.query("SELECT photos FROM vehicles WHERE id=$1", [car.id]);
    check("and the photos are unchanged", JSON.stringify(after.photos ?? []) === JSON.stringify(before), JSON.stringify(after.photos));
    const nothing = await driver.req("PUT", "/api/vehicles/photos", { vehicleId: "not-a-car", photoURL: "/objects/x", photos: [] });
    check("the driver is refused a car that is not theirs", nothing.status === 403, `${nothing.status}`);

    section("The driver can change their own");
    const own = await driver.req("PUT", "/api/vehicles/photos", { vehicleId: car.id, photoURL: "/objects/mine", photos: ["/objects/mine"] });
    check("the driver's own car is updated", own.status === 200, `${own.status} ${JSON.stringify(own.json)}`);
  } finally {
    if (car?.id) await db.query("UPDATE vehicles SET photos=$2 WHERE id=$1", [car.id, JSON.stringify(before)]).catch(() => {});
  }
}
