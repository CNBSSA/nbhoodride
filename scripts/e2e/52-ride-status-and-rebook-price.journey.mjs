import { Session, check, section, FIXTURES, PICKUP, DEST } from "./harness.mjs";

/**
 * Code review 2026-10-06 (rider and driver findings):
 *
 * 1. `PUT /api/rides/:rideId` took a `status` from the rider or driver, so a
 *    rider in the car could mark the ride completed or cancelled and skip the
 *    capture, the cancellation fee and the driver's pay. A status now changes
 *    only through its own route; the other fields still update.
 * 2. A weekly rebook booked the fare the app saved with the schedule ("0"
 *    when it had none). It is now priced by the server like every booking.
 * 3. A weekly rebook read the saved day and hour on the server's UTC clock,
 *    so "Wednesday 9 AM" was booked for 5 AM Eastern. It is Eastern now.
 * 4. Any signed-in user could list the scheduled board (riders' names and
 *    addresses) and claim a ride off it, stranding the rider. Only an
 *    approved, active driver may now.
 */
export async function run({ base, db }) {
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const rideIds = [];
  let scheduleId = null;
  try {
    section("A ride's status is not the rider's or driver's to set directly");
    const { rows: [r] } = await db.query(
      `INSERT INTO rides (rider_id, driver_id, status, pickup_location, destination_location, estimated_fare, payment_method, ride_type)
       VALUES ($1, $2, 'in_progress', $3, $4, 18.40, 'card', 'standard') RETURNING id`,
      [FIXTURES.rider.id, FIXTURES.driver.id, JSON.stringify(PICKUP), JSON.stringify(DEST)]);
    rideIds.push(r.id);
    const done = await rider.req("PUT", `/api/rides/${r.id}`, { status: "completed" });
    check("a rider cannot mark their ride completed", done.status === 400, `${done.status} ${JSON.stringify(done.json)}`);
    const gone = await rider.req("PUT", `/api/rides/${r.id}`, { status: "cancelled" });
    check("nor cancelled, around the cancel route and its fee", gone.status === 400, `${gone.status}`);
    const drv = await driver.req("PUT", `/api/rides/${r.id}`, { status: "completed" });
    check("a driver cannot complete it around the complete route", drv.status === 400, `${drv.status}`);
    const { rows: [still] } = await db.query("SELECT status FROM rides WHERE id=$1", [r.id]);
    check("the ride is still in progress", still.status === "in_progress", still.status);
    const note = await rider.req("PUT", `/api/rides/${r.id}`, { pickupInstructions: "By the blue door" });
    check("the rider can still change the pickup note", note.status === 200 && note.json?.pickupInstructions === "By the blue door", `${note.status}`);

    section("Only an approved driver sees or claims the scheduled board");
    const { rows: [sch] } = await db.query(
      `INSERT INTO rides (rider_id, status, pickup_location, destination_location, estimated_fare, payment_method, ride_type, scheduled_at)
       VALUES ($1, 'pending', $2, $3, 22.00, 'card', 'standard', NOW() + interval '2 days') RETURNING id`,
      [FIXTURES.driver.id, JSON.stringify(PICKUP), JSON.stringify(DEST)]);
    rideIds.push(sch.id);
    const board = await rider.req("GET", "/api/driver/scheduled-rides");
    check("a rider is shown no open scheduled rides, so no rider's name or address", board.status === 200 && Array.isArray(board.json?.open) && board.json.open.length === 0, JSON.stringify(board.json?.open?.length));
    const grab = await rider.req("POST", `/api/driver/rides/${sch.id}/claim`, {});
    check("a rider cannot claim one", grab.status === 403, `${grab.status} ${JSON.stringify(grab.json)}`);
    const { rows: [unclaimed] } = await db.query("SELECT driver_id FROM rides WHERE id=$1", [sch.id]);
    check("and it stays on the board for drivers", unclaimed.driver_id === null, JSON.stringify(unclaimed));
    const seen = await driver.req("GET", "/api/driver/scheduled-rides");
    check("an approved driver still sees it", (seen.json?.open ?? []).some((x) => x.id === sch.id), JSON.stringify((seen.json?.open ?? []).length));

    section("A weekly rebook is priced by the server, not by what the app saved");
    const saved = await rider.req("POST", "/api/rider/recurring-schedules", {
      label: `e2e-52-${Date.now()}`, pickup: PICKUP, destination: DEST, dayOfWeek: 3, preferredHour: 9, preferredMinute: 0,
      rideKind: "solo_schedule", options: { estimatedFare: "0.50" },
    });
    scheduleId = saved.json?.id ?? saved.json?.schedule?.id ?? null;
    check("the rider saves a weekly ride with a fare of $0.50 in it", saved.status === 200 || saved.status === 201, `${saved.status} ${JSON.stringify(saved.json)}`);
    const quote = await rider.req("POST", "/api/rides/calculate-fare", { pickup: PICKUP, destination: DEST });
    const rebook = await rider.req("POST", `/api/rider/recurring-schedules/${scheduleId}/rebook`, {});
    const rideId = rebook.json?.rideId;
    if (rideId) rideIds.push(rideId);
    const { rows: [booked] } = rideId ? await db.query("SELECT estimated_fare FROM rides WHERE id=$1", [rideId]) : { rows: [] };
    check("the rebook books a ride", rebook.status === 200 && !!rideId, `${rebook.status} ${JSON.stringify(rebook.json)}`);
    const at = rebook.json?.scheduledAt ? new Date(rebook.json.scheduledAt) : null;
    const eastern = at ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hourCycle: "h23", minute: "2-digit" }).format(at) : "";
    check("on the rider's clock: Wednesday 9:00 Eastern, not 9:00 UTC", /^Wed,? 09:00$/.test(eastern), `${rebook.json?.scheduledAt} = ${eastern}`);
    check("at the server's price, never the $0.50 the app saved", Number(booked?.estimated_fare) > 0.5, JSON.stringify({ booked: booked?.estimated_fare, quote: quote.json?.total ?? quote.json?.fare ?? quote.json?.estimatedFare }));
  } finally {
    if (rideIds.length) await db.query("DELETE FROM rides WHERE id = ANY($1::varchar[])", [rideIds]).catch(() => {});
    if (scheduleId) await db.query("DELETE FROM recurring_ride_schedules WHERE id=$1", [scheduleId]).catch(() => {});
  }
}
