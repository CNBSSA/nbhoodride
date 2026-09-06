import { Session, check, section, deleteRides, FIXTURES, PICKUP, DEST } from "./harness.mjs";

// Mirrors shared/weeklyPlan.ts (the journey runner is plain Node, no TS).
const PLAN_BOOK_AHEAD_DAYS = 7;
const planFare = (total) => ({ perRide: Math.round(total * 0.9 * 100) / 100 });

/**
 * Standing weekly ride plan — the commuter's ride home. A rider sets
 * "pickup → destination, Mon–Fri at 5:30 PM" once; PG Ride books each
 * day's ride ahead as an ordinary scheduled ride at a locked plan rate,
 * every ride settles on its own (nothing prepaid), the driver board shows
 * them as standing rides, and pausing withdraws what nobody has claimed.
 */
export async function run({ base, db }) {
  const rider = new Session(base);
  check("rider logs in", (await rider.login(FIXTURES.rider.email)).status === 200);
  const driver = new Session(base);
  check("driver logs in", (await driver.login(FIXTURES.driver.email)).status === 200);
  const admin = new Session(base);
  check("admin logs in", (await admin.login(FIXTURES.admin.email)).status === 200);

  // Booking is rate-limited per rider per hour; clear an interrupted run's leftovers.
  const { rows: stale } = await db.query("SELECT id FROM rides WHERE rider_id=$1 AND created_at > NOW() - interval '1 hour'", [FIXTURES.rider.id]);
  await deleteRides(db, stale.map((r) => r.id));
  await db.query("UPDATE weekly_ride_plans SET is_active=false WHERE rider_id=$1", [FIXTURES.rider.id]);

  section("Starting a Mon–Fri 5:30 PM plan books the coming week at the plan rate");
  const bad = await rider.req("POST", "/api/rider/weekly-plans", { pickup: PICKUP, destination: DEST, days: [], departureHour: 17, departureMinute: 30 });
  check("a plan with no days is refused with a reason", bad.status === 400 && /day/i.test(bad.json?.message ?? ""), JSON.stringify(bad.json));

  const quote = await rider.req("POST", "/api/rides/calculate-fare", { distance: 17.3, duration: 42 });
  check("one-off quote available for comparison", quote.status === 200 && quote.json?.total > 0, JSON.stringify(quote.json?.total));
  const expected = planFare(quote.json.total);

  const started = await rider.req("POST", "/api/rider/weekly-plans", {
    label: "Ride home", pickup: PICKUP, destination: DEST, days: [1, 2, 3, 4, 5], departureHour: 17, departureMinute: 30, distance: 17.3, duration: 42,
  });
  check("plan created", started.status === 200 && started.json?.plan?.id, JSON.stringify(started.json?.message ?? started.status));
  const plan = started.json?.plan ?? {};
  const planId = plan.id;
  check("per-ride fare is 10% under the one-off quote, locked on the plan", Number(plan.perRideFare) === expected.perRide && Number(plan.fullFare) === quote.json.total, `perRide=${plan.perRideFare} full=${plan.fullFare} expected=${expected.perRide}`);
  const booked = started.json?.bookedRideIds ?? [];
  // Mon–Fri inside a rolling 7-day window is 4 or 5 rides depending on the day and the 3h lead.
  check("rides booked for the coming week (4–5 for Mon–Fri)", booked.length >= 4 && booked.length <= 5, `booked=${booked.length}`);

  const { rows: rideRows } = await db.query("SELECT id, status, driver_id, estimated_fare, original_fare, scheduled_at, plan_id, ride_type, distance, duration, payment_method FROM rides WHERE plan_id=$1 ORDER BY scheduled_at", [planId]);
  check("every booked ride is a pending scheduled ride on the plan", rideRows.length === booked.length && rideRows.every((r) => r.status === "pending" && r.plan_id === planId && r.scheduled_at && r.ride_type === "weekly_plan"), JSON.stringify(rideRows.map((r) => [r.status, r.ride_type])));
  check("every ride is quoted at the plan fare with the one-off fare kept for the record", rideRows.every((r) => Number(r.estimated_fare) === expected.perRide && Number(r.original_fare) === quote.json.total), JSON.stringify(rideRows.map((r) => [r.estimated_fare, r.original_fare])));
  check("quoted route miles/minutes carried onto each ride", rideRows.every((r) => Number(r.distance) === 17.3 && r.duration === 42), JSON.stringify(rideRows.map((r) => [r.distance, r.duration])));
  const etTimes = rideRows.map((r) => new Date(r.scheduled_at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }));
  check("every ride departs at 5:30 PM Eastern", etTimes.every((t) => t === "5:30 PM"), JSON.stringify(etTimes));
  const etDays = rideRows.map((r) => new Date(r.scheduled_at).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" }));
  check("no weekend rides", etDays.every((d) => d !== "Sat" && d !== "Sun"), JSON.stringify(etDays));
  const horizon = Date.now() + PLAN_BOOK_AHEAD_DAYS * 86_400_000;
  check("nothing booked beyond the 7-day window", rideRows.every((r) => new Date(r.scheduled_at).getTime() <= horizon));

  section("Nothing is prepaid: each day is its own ride, claimed and settled on its own");
  const firstRide = rideRows[0].id;
  const claim = await driver.req("POST", `/api/driver/rides/${firstRide}/claim`);
  check("driver claims the first plan ride from the board", claim.status === 200, JSON.stringify(claim.json?.message ?? claim.status));
  const { rows: [afterClaim] } = await db.query("SELECT status, driver_id, promo_discount_applied, stripe_payment_intent_id FROM rides WHERE id=$1", [firstRide]);
  check("claim pins the driver; nothing charged or authorized yet", afterClaim.driver_id === FIXTURES.driver.id && afterClaim.status === "pending" && !afterClaim.stripe_payment_intent_id, JSON.stringify(afterClaim));
  // Confirmation authorizes that one ride's card hold (Stripe is unreachable
  // here, so stand in for a successful confirm).
  await db.query("UPDATE rides SET status='accepted', accepted_at=NOW() WHERE id=$1", [firstRide]);
  const { rows: otherRides } = await db.query("SELECT status, driver_id, stripe_payment_intent_id FROM rides WHERE plan_id=$1 AND id<>$2", [planId, firstRide]);
  check("the other days stay pending, unclaimed, with nothing authorized", otherRides.every((r) => r.status === "pending" && !r.driver_id && !r.stripe_payment_intent_id), JSON.stringify(otherRides));

  section("The driver board shows the standing ride; the rider's home shows the plan");
  const board = await driver.req("GET", "/api/driver/scheduled-rides");
  const onBoard = (board.json?.open ?? []).filter((r) => r.planId === planId);
  check("remaining plan rides are on the open board, flagged with the plan", board.status === 200 && onBoard.length === booked.length - 1, `open=${onBoard.length}`);
  const mine = await rider.req("GET", "/api/rider/weekly-plans");
  const listed = (mine.json ?? []).find((p) => p.id === planId);
  check("rider sees the plan with its booked week", !!listed && listed.upcoming?.length === booked.length, `upcoming=${listed?.upcoming?.length}`);
  const upcoming = await rider.req("GET", "/api/rides/scheduled");
  check("plan rides appear in Upcoming, tagged with the plan", (upcoming.json ?? []).filter((r) => r.planId === planId).length === booked.length);
  const live = await rider.req("GET", "/api/rides/active");
  check("a week of booked rides does not park the home screen on 'Finding your driver'", live.status === 200 && !(live.json ?? []).some((r) => r.planId === planId), `active=${(live.json ?? []).length}`);

  section("The sweep is idempotent: running it again books nothing twice");
  const sweep = await admin.req("POST", "/api/admin/analytics/materialize-weekly-plans");
  check("sweep runs", sweep.status === 200, JSON.stringify(sweep.json));
  const { rows: [{ n }] } = await db.query("SELECT COUNT(*)::int AS n FROM rides WHERE plan_id=$1", [planId]);
  check("still exactly one ride per departure", n === booked.length, `rides=${n} booked=${booked.length}`);

  section("Pausing withdraws unclaimed rides and leaves the confirmed one for the rider to decide");
  const paused = await rider.req("POST", `/api/rider/weekly-plans/${planId}/pause`);
  check("pause succeeds", paused.status === 200 && paused.json?.ok, JSON.stringify(paused.json));
  check("unclaimed rides withdrawn, the confirmed ride kept", paused.json?.cancelled === booked.length - 1 && paused.json?.kept === 1, JSON.stringify(paused.json));
  const { rows: afterPause } = await db.query("SELECT status, cancelled_by_role FROM rides WHERE plan_id=$1", [planId]);
  check("withdrawn rides are cancelled by the rider, the accepted one untouched", afterPause.filter((r) => r.status === "cancelled" && r.cancelled_by_role === "rider").length === booked.length - 1 && afterPause.some((r) => r.status === "accepted"), JSON.stringify(afterPause));
  const gone = await rider.req("GET", "/api/rider/weekly-plans");
  check("paused plan no longer listed", !(gone.json ?? []).some((p) => p.id === planId));
  const sweepAfter = await admin.req("POST", "/api/admin/analytics/materialize-weekly-plans");
  const { rows: [{ n: nAfter }] } = await db.query("SELECT COUNT(*)::int AS n FROM rides WHERE plan_id=$1", [planId]);
  check("a paused plan books nothing more", sweepAfter.status === 200 && nAfter === booked.length, `rides=${nAfter}`);
  const again = await rider.req("POST", `/api/rider/weekly-plans/${planId}/pause`);
  check("pausing twice is a clean 404, not a crash", again.status === 404);

  await deleteRides(db, rideRows.map((r) => r.id));
  await db.query("DELETE FROM weekly_ride_plans WHERE id=$1", [planId]);
}
