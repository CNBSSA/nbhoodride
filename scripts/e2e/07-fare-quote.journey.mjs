import { Session, check, section, FIXTURES, PICKUP, DEST } from "./harness.mjs";

/**
 * The fare a rider confirms at booking is the fare they pay. The first real
 * PG Ride trip was quoted $23.21 and charged $7.12 because completion
 * re-priced the trip from a GPS track that stopped when the driver's screen
 * locked. This drives a ride through start → sparse GPS → complete over the
 * real API and asserts the quote survives.
 */
export async function run({ base, db }) {
  const driver = new Session(base);
  check("driver logs in", (await driver.login(FIXTURES.driver.email)).status === 200);

  const loc = (p) => JSON.stringify(p);
  const seed = async (extra = {}) => {
    const { rows: [r] } = await db.query(
      `INSERT INTO rides (rider_id, driver_id, status, pickup_location, destination_location, estimated_fare, payment_method, promo_discount_applied)
       VALUES ($1, $2, 'accepted', $3, $4, $5, 'cash', $6) RETURNING id`,
      [FIXTURES.rider.id, FIXTURES.driver.id, loc(PICKUP), loc(DEST), extra.quote ?? "23.21", extra.promo ?? "0.00"]);
    return r.id;
  };
  // Two breadcrumbs ~0.3 mi apart, a couple of seconds between them: what a
  // locked phone leaves behind. (Closer in time and the >90 mph glitch
  // filter would rightly discard the hop.)
  const sparseTrack = async (rideId) => {
    await driver.req("POST", `/api/driver/rides/${rideId}/track-location`, { lat: PICKUP.lat, lng: PICKUP.lng });
    await new Promise((r) => setTimeout(r, 15000));
    await driver.req("POST", `/api/driver/rides/${rideId}/track-location`, { lat: PICKUP.lat - 0.003, lng: PICKUP.lng - 0.003 });
  };

  section("Normal completion charges the quoted fare");
  const rideA = await seed();
  check("driver starts the ride", (await driver.req("POST", `/api/driver/rides/${rideA}/start`)).status === 200);
  await sparseTrack(rideA);
  const doneA = await driver.req("POST", `/api/driver/rides/${rideA}/complete`, {});
  check("completion succeeds", doneA.status === 200, JSON.stringify(doneA.json?.message ?? doneA.status));
  check("rider pays the $23.21 quote, not the GPS-metered fare", Number(doneA.json?.actualFare) === 23.21, `actualFare=${doneA.json?.actualFare}`);
  check("GPS distance is still recorded for the records", Number(doneA.json?.driverTraveledDistance) > 0, `traveled=${doneA.json?.driverTraveledDistance}`);

  section("Promo recorded at accept comes off the quote");
  const rideB = await seed({ promo: "5.00" });
  await driver.req("POST", `/api/driver/rides/${rideB}/start`);
  await sparseTrack(rideB);
  const doneB = await driver.req("POST", `/api/driver/rides/${rideB}/complete`, {});
  check("quote minus $5 promo", Number(doneB.json?.actualFare) === 18.21, `actualFare=${doneB.json?.actualFare}`);

  section("Ride ended early mid-trip is metered, never above the quote");
  const rideC = await seed();
  await driver.req("POST", `/api/driver/rides/${rideC}/start`);
  await sparseTrack(rideC);
  const early = await driver.req("POST", `/api/rides/${rideC}/cancel`, { reason: "rider got out early" });
  check("early end accepted", early.status === 200, JSON.stringify(early.json?.message ?? early.status));
  const { rows: [c] } = await db.query("SELECT status, actual_fare FROM rides WHERE id=$1", [rideC]);
  check("early-ended ride is completed", c?.status === "completed", `status=${c?.status}`);
  const earlyFare = Number(c?.actual_fare);
  check("early-end fare is metered and at most the quote", earlyFare > 0 && earlyFare <= 23.21, `actualFare=${c?.actual_fare}`);

  await db.query("DELETE FROM rides WHERE id = ANY($1::varchar[])", [[rideA, rideB, rideC]]).catch(() => {});
}
