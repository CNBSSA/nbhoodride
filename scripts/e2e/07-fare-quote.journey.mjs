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

  section("Booking records the quoted route, and the receipt shows it");
  const rider = new Session(base);
  check("rider logs in", (await rider.login(FIXTURES.rider.email)).status === 200);
  const booked = await rider.req("POST", "/api/rides", { pickupLocation: PICKUP, destinationLocation: DEST, estimatedFare: 23.21, paymentMethod: "card", distance: 17.3, duration: 42 });
  check("booking accepted", booked.status === 200, JSON.stringify(booked.json?.message ?? booked.status));
  check("quoted miles and minutes stored on the ride", Number(booked.json?.distance) === 17.3 && booked.json?.duration === 42, `distance=${booked.json?.distance} duration=${booked.json?.duration}`);
  const noFigures = await rider.req("POST", "/api/rides", { pickupLocation: PICKUP, destinationLocation: DEST, estimatedFare: 23.21, paymentMethod: "card" });
  check("server fills in route miles when the app sends none", Number(noFigures.json?.distance) > 5 && noFigures.json?.duration >= 5, `distance=${noFigures.json?.distance} duration=${noFigures.json?.duration}`);
  await db.query("UPDATE rides SET driver_id=$1, status='completed', actual_fare='23.21', started_at=NOW() - interval '45 minutes', completed_at=NOW(), driver_traveled_distance='0.26', driver_traveled_time=45 WHERE id=$2", [FIXTURES.driver.id, booked.json.id]);
  const receipt = await rider.req("GET", `/api/rides/${booked.json.id}/receipt`);
  check("receipt shows the quoted 17.3 mi, not the 0.26 mi GPS track", receipt.status === 200 && receipt.json?.distanceMiles === 17.3 && receipt.json?.durationMinutes === 42, JSON.stringify({ d: receipt.json?.distanceMiles, t: receipt.json?.durationMinutes }));
  check("receipt has a real distance charge", (receipt.json?.distanceCharge ?? 0) > 10, `distanceCharge=${receipt.json?.distanceCharge}`);
  await db.query("DELETE FROM rides WHERE id = ANY($1::varchar[])", [[booked.json.id, noFigures.json?.id].filter(Boolean)]).catch(() => {});

  section("Add a stop: the whole route is quoted and shown");
  const stopA = { lat: 38.95, lng: -76.93, address: "Hyattsville Pharmacy, MD" };
  const withStop = await rider.req("POST", "/api/rides", { pickupLocation: PICKUP, destinationLocation: DEST, estimatedFare: 30, paymentMethod: "card", stops: [stopA] });
  check("booking with a stop accepted", withStop.status === 200, JSON.stringify(withStop.json?.message ?? withStop.status));
  check("stop stored on the ride, in order", Array.isArray(withStop.json?.stops) && withStop.json.stops.length === 1 && withStop.json.stops[0].address === stopA.address, JSON.stringify(withStop.json?.stops));
  check("route miles cover pickup → stop → destination (longer than the direct trip)", Number(withStop.json?.distance) > Number(noFigures.json?.distance), `with stop=${withStop.json?.distance} direct=${noFigures.json?.distance}`);
  const tooMany = await rider.req("POST", "/api/rides", { pickupLocation: PICKUP, destinationLocation: DEST, estimatedFare: 30, paymentMethod: "card", stops: [stopA, stopA, stopA] });
  check("more than two stops is refused with a reason", tooMany.status === 400 && /stops/i.test(tooMany.json?.message ?? ""), JSON.stringify(tooMany.json));
  const badStop = await rider.req("POST", "/api/rides", { pickupLocation: PICKUP, destinationLocation: DEST, estimatedFare: 30, paymentMethod: "card", stops: [{ address: "no coordinates" }] });
  check("a stop without coordinates is refused", badStop.status === 400, `status=${badStop.status}`);
  const drv = await driver.req("GET", "/api/driver/pending-rides");
  const pendingWithStop = (drv.json ?? []).find((r) => r.id === withStop.json.id);
  check("driver's pending request carries the stop", Array.isArray(pendingWithStop?.stops) && pendingWithStop.stops.length === 1, JSON.stringify(pendingWithStop?.stops));
  await db.query("UPDATE rides SET driver_id=$1, status='completed', actual_fare='30.00', started_at=NOW() - interval '30 minutes', completed_at=NOW() WHERE id=$2", [FIXTURES.driver.id, withStop.json.id]);
  const stopReceipt = await rider.req("GET", `/api/rides/${withStop.json.id}/receipt`);
  check("receipt lists the stop between pickup and destination", stopReceipt.status === 200 && Array.isArray(stopReceipt.json?.stops) && stopReceipt.json.stops[0] === stopA.address, JSON.stringify(stopReceipt.json?.stops));
  await db.query("DELETE FROM rides WHERE id = ANY($1::varchar[])", [[withStop.json.id].filter(Boolean)]).catch(() => {});

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

  const ids = [rideA, rideB, rideC];
  await db.query("DELETE FROM l4_readiness_events WHERE ride_id = ANY($1::varchar[])", [ids]).catch(() => {});
  await db.query("DELETE FROM rides WHERE id = ANY($1::varchar[])", [ids]).catch(() => {});
}
