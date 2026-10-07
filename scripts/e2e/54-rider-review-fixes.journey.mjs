import Stripe from "stripe";
import bcrypt from "bcrypt";
import { Session, check, section, deleteRides, FIXTURES, PICKUP, DEST, PASSWORD } from "./harness.mjs";

/**
 * Code review 2026-10-06, rider-side findings (each check here failed on the
 * code that shipped):
 *
 * R5  ending a ride early whose card settlement fails is handled as Complete
 *     handles it: the ride stays ended, marked settlement_failed, ops paged.
 * R6  Stripe's payment_intent.succeeded promotes only a completed ride still
 *     waiting on its money; it never overwrites a cancellation fee, a failed
 *     settlement or a dispute.
 * R3  joining a coworker group and starting a weekly plan are priced from
 *     road figures that could be true, as every other door; an organizer
 *     cannot join their own group by code, nor a rider twice.
 * R7  every stop and destination at every door is in the service area, and
 *     the whole route is held to the 50-mile limit.
 * R8  a promo ride is taken once per ride, and given back when the ride's
 *     authorization is released before it is driven.
 * R9  a rider's cancel racing a driver's accept: one of them wins.
 * R10 two cancels at once: one of them wins.
 * R11 only a completed ride is rated, and once.
 * R12 a group's pickup order is for the people in it, and the driver's
 *     upcoming card asks with an id the route understands.
 * AI  a message to the assistant is capped.
 */
export async function run({ base, db }) {
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const guest = new Session(base);
  const stamp = Date.now();
  const hash = await bcrypt.hash(PASSWORD, 10);
  const joinerId = `e2e-54-joiner-${stamp}`;
  await db.query(
    `INSERT INTO users (id,email,password,first_name,last_name,is_approved,phone,registration_completed_at,stripe_customer_id,stripe_payment_method_id)
     VALUES ($1,$2,$3,'Joiner','FiftyFour',true,$4,NOW(),'cus_e2e','pm_e2e')`,
    [joinerId, `${joinerId}@example.com`, hash, `+1240556${String(stamp % 10000).padStart(4, "0")}`]);
  const joiner = new Session(base); await joiner.login(`${joinerId}@example.com`);
  const farerId = `e2e-54-farer-${stamp}`;
  await db.query(
    `INSERT INTO users (id,email,password,first_name,last_name,is_approved,phone,registration_completed_at,stripe_customer_id,stripe_payment_method_id)
     VALUES ($1,$2,$3,'Farer','FiftyFour',true,$4,NOW(),'cus_e2e','pm_e2e')`,
    [farerId, `${farerId}@example.com`, hash, `+1240557${String(stamp % 10000).padStart(4, "0")}`]);
  const farer = new Session(base); await farer.login(`${farerId}@example.com`);

  const { rows: [{ promo_rides_remaining: promoBefore }] } = await db.query("SELECT promo_rides_remaining FROM users WHERE id=$1", [FIXTURES.rider.id]);
  const startedAt = new Date(Date.now() - 1000);
  const groupIds = [];
  const planIds = [];
  const loc = (p) => JSON.stringify(p);
  const seed = async (cols) => {
    const c = { rider_id: FIXTURES.rider.id, driver_id: FIXTURES.driver.id, status: "pending", estimated_fare: "18.00", payment_method: "card", ride_type: "standard", ...cols };
    const keys = Object.keys(c);
    const { rows: [r] } = await db.query(
      `INSERT INTO rides (pickup_location, destination_location, ${keys.join(",")}) VALUES ($1, $2, ${keys.map((_, i) => `$${i + 3}`).join(",")}) RETURNING id`,
      [loc(PICKUP), loc(DEST), ...keys.map((k) => c[k])]);
    return r.id;
  };
  const ride = async (id) => (await db.query("SELECT * FROM rides WHERE id=$1", [id])).rows[0];
  const promo = async () => Number((await db.query("SELECT promo_rides_remaining AS p FROM users WHERE id=$1", [FIXTURES.rider.id])).rows[0].p ?? 0);

  try {
    section("R7: a stop or destination far away is refused at every door");
    const nyStop = { lat: 40.7128, lng: -74.006, address: "New York, NY" };
    const oceanCity = { lat: 38.3365, lng: -75.0849, address: "Ocean City, MD" };
    const viaNy = await rider.req("POST", "/api/rides", { pickupLocation: PICKUP, destinationLocation: DEST, stops: [nyStop], estimatedFare: 30, paymentMethod: "card" });
    check("an ordinary booking with a stop in New York is refused as outside the area", viaNy.status === 400 && /outside our service area/.test(viaNy.json?.message ?? ""), `${viaNy.status} ${JSON.stringify(viaNy.json)}`);
    const viaBeach = await rider.req("POST", "/api/rides", { pickupLocation: PICKUP, destinationLocation: DEST, stops: [oceanCity], estimatedFare: 30, paymentMethod: "card" });
    check("an ordinary booking with a stop at the beach is held to the 50-mile limit", viaBeach.status === 400 && /mile limit/.test(viaBeach.json?.message ?? ""), `${viaBeach.status} ${JSON.stringify(viaBeach.json)}`);
    const multiFar = await rider.req("POST", "/api/rides/multi-stop", { pickupLocation: PICKUP, destinationLocation: nyStop, pickupStops: [], estimatedFare: 30 });
    check("a multi-stop ride to New York is refused", multiFar.status === 400 && /outside our service area/.test(multiFar.json?.message ?? ""), `${multiFar.status} ${JSON.stringify(multiFar.json)}`);
    const departAt = new Date(Date.now() + 5 * 3600e3).toISOString();
    const groupFar = await rider.req("POST", "/api/rides/create-shared-schedule", { pickupLocation: PICKUP, destinationLocation: oceanCity, estimatedFare: 30, scheduledAt: departAt });
    if (groupFar.json?.groupId || groupFar.json?.group?.id) groupIds.push(groupFar.json.group?.id ?? groupFar.json.groupId);
    check("a coworker group to the beach is held to the 50-mile limit", groupFar.status === 400 && /mile limit/.test(groupFar.json?.message ?? ""), `${groupFar.status} ${JSON.stringify(groupFar.json?.message ?? groupFar.json?.id)}`);

    section("R3: joining a coworker group is priced on figures that could be true; no own group, no second seat");
    const created = await rider.req("POST", "/api/rides/create-shared-schedule", { pickupLocation: PICKUP, destinationLocation: DEST, estimatedFare: 20, scheduledAt: departAt });
    const code = created.json?.scheduleCode;
    const groupId = created.json?.group?.id;
    if (groupId) groupIds.push(groupId);
    check("the rider organizes a group", created.status === 200 && !!code, `${created.status} ${JSON.stringify(created.json?.message)}`);
    const own = await rider.req("POST", "/api/rides/join-schedule", { scheduleCode: code, pickupLocation: PICKUP, destinationLocation: DEST });
    check("the organizer cannot join their own group by its code", own.status === 400 && /your own group/.test(own.json?.message ?? ""), `${own.status} ${JSON.stringify(own.json?.message)}`);
    const joinerPickup = { lat: 38.905, lng: -76.78, address: "Bowie Town Center, MD" };
    const joined = await joiner.req("POST", "/api/rides/join-schedule", { scheduleCode: code, pickupLocation: joinerPickup, destinationLocation: DEST, distance: 0.1, duration: 1 });
    const joinedRide = joined.json?.id ? await ride(joined.json.id) : null;
    check("a joiner claiming a 0.1-mile, 1-minute trip is priced on the server's route instead (a 13-mile trip, well over the minimum fare)",
      joined.status === 200 && Number(joinedRide?.original_fare) > 15 && Number(joinedRide?.distance) > 10,
      `${joined.status} ${JSON.stringify({ msg: joined.json?.message, original: joinedRide?.original_fare, miles: joinedRide?.distance })}`);
    const twice = await joiner.req("POST", "/api/rides/join-schedule", { scheduleCode: code, pickupLocation: joinerPickup, destinationLocation: DEST });
    check("the same rider cannot take a second seat", twice.status === 409 && /already have a seat/.test(twice.json?.message ?? ""), `${twice.status} ${JSON.stringify(twice.json?.message)}`);
    const farJoin = await farer.req("POST", "/api/rides/join-schedule", { scheduleCode: code, pickupLocation: joinerPickup, destinationLocation: nyStop });
    check("and a joiner's own destination is held to the area too (R7)", farJoin.status === 400 && /outside our service area/.test(farJoin.json?.message ?? ""), `${farJoin.status} ${JSON.stringify(farJoin.json?.message)}`);

    section("R12: a group's pickup order is for the people in it; the driver's card asks with the ride group's id");
    const asOrganizer = await rider.req("GET", `/api/shared-rides/${groupId}/pickup-order?kind=ride_group`);
    check("the coworker group's pickup order is served by its ride-group id (the card met a 404 before)", asOrganizer.status === 200 && (asOrganizer.json?.pickupOrder ?? []).length === 2, `${asOrganizer.status} ${JSON.stringify(asOrganizer.json?.pickupOrder)}`);
    const srg = `e2e-54-srg-${stamp}`;
    await seed({ shared_ride_group_id: srg, driver_id: null, status: "pending" });
    await seed({ shared_ride_group_id: srg, driver_id: null, status: "pending", rider_id: joinerId });
    const stranger = await driver.req("GET", `/api/shared-rides/${srg}/pickup-order`);
    check("someone who is not in the group cannot read its riders' pickups", stranger.status === 404, `${stranger.status}`);
    const member = await rider.req("GET", `/api/shared-rides/${srg}/pickup-order`);
    check("a rider in it can", member.status === 200 && member.json?.totalRiders === 2, `${member.status}`);

    section("R3: a weekly plan is priced on figures that could be true");
    const plan = await rider.req("POST", "/api/rider/weekly-plans", {
      pickup: PICKUP, destination: DEST, days: [1, 3], departureHour: 8, departureMinute: 0, distance: 400, duration: 1000, label: `e2e-54-${stamp}`,
    });
    const planId = plan.json?.plan?.id;
    if (planId) planIds.push(planId);
    const full = Number(plan.json?.quote?.fullFare);
    check("a plan claiming 400 miles for a 13-mile trip is priced on the server's route, not near the fare cap", plan.status === 200 && full > 15 && full < 60, `${plan.status} ${JSON.stringify(plan.json?.quote ?? plan.json?.message)}`);
    const planFar = await rider.req("POST", "/api/rider/weekly-plans", {
      pickup: PICKUP, destination: DEST, stops: [nyStop], days: [2], departureHour: 8, departureMinute: 0,
    });
    if (planFar.json?.plan?.id) planIds.push(planFar.json.plan.id);
    check("and a plan with a stop in New York is refused (R7)", planFar.status === 400 && /outside our service area/.test(planFar.json?.message ?? ""), `${planFar.status} ${JSON.stringify(planFar.json?.message)}`);

    section("R5: ending a ride early whose settlement fails is handled as Complete handles it");
    const early = await seed({ status: "in_progress", started_at: new Date(Date.now() - 10 * 60e3), accepted_at: new Date(Date.now() - 20 * 60e3),
      payment_status: "authorized", stripe_payment_intent_id: `pi_e2e_54_early_${stamp}`, stripe_authorized_amount: "18.00", virtual_amount_authorized: "0.00" });
    const ended = await rider.req("POST", `/api/rides/${early}/cancel`, { reason: "Let me out here" });
    const endedRow = await ride(early);
    check("the rider's early end answers as ended, not a 500, though the card could not be captured", ended.status === 200 && ended.json?.endedEarly === true, `${ended.status} ${JSON.stringify(ended.json?.message)}`);
    check("the ride is completed and marked settlement_failed for the reconciliation queue", endedRow.status === "completed" && endedRow.payment_status === "settlement_failed", `${endedRow.status}/${endedRow.payment_status}`);

    section("R6: Stripe's 'succeeded' never overwrites a fee, a failed settlement or a dispute");
    const signedPost = (obj) => {
      const payload = JSON.stringify(obj);
      const sig = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_e2e_fake" });
      return guest.req("POST", "/api/webhooks/stripe", payload, { "Content-Type": "application/json", "stripe-signature": sig });
    };
    const succeeded = (tag, rideId) => ({
      id: `evt_e2e_54_${tag}_${stamp}`, object: "event", type: "payment_intent.succeeded", created: Math.floor(Date.now() / 1000),
      data: { object: { id: `pi_e2e_54_${tag}`, object: "payment_intent", amount: 500, amount_received: 500, currency: "usd", status: "succeeded",
        metadata: { rideId, riderId: FIXTURES.rider.id, type: "ride_authorization" } } },
    });
    const feeRide = await seed({ status: "cancelled", payment_status: "cancelled_with_fee", cancellation_fee: "5.00" });
    const failedRide = await seed({ status: "completed", payment_status: "settlement_failed", actual_fare: "18.00", completed_at: new Date() });
    const disputedRide = await seed({ status: "completed", payment_status: "disputed", actual_fare: "18.00", completed_at: new Date() });
    const waitingRide = await seed({ status: "completed", payment_status: "authorized", actual_fare: "18.00", completed_at: new Date() });
    for (const [tag, id] of [["fee", feeRide], ["failed", failedRide], ["disputed", disputedRide], ["waiting", waitingRide]]) {
      const r = await signedPost(succeeded(tag, id));
      check(`Stripe's event for the ${tag} ride is accepted`, r.status === 200, `${r.status} ${JSON.stringify(r.json)}`);
    }
    check("a cancellation fee stays a cancellation fee", (await ride(feeRide)).payment_status === "cancelled_with_fee", (await ride(feeRide)).payment_status);
    check("a failed settlement stays on the reconciliation queue", (await ride(failedRide)).payment_status === "settlement_failed", (await ride(failedRide)).payment_status);
    check("a dispute stays a dispute", (await ride(disputedRide)).payment_status === "disputed", (await ride(disputedRide)).payment_status);
    check("a completed ride waiting on its money is marked paid", (await ride(waitingRide)).payment_status === "paid_card", (await ride(waitingRide)).payment_status);

    section("R8: one promo ride per ride, given back when the ride is released undriven");
    // A $4 fare is covered by the $5 welcome credit, so no card is touched.
    await db.query("UPDATE users SET promo_rides_remaining=1 WHERE id=$1", [FIXTURES.rider.id]);
    const carried = await seed({ estimated_fare: "4.00", promo_discount_applied: "4.00" });
    const acc1 = await driver.req("POST", `/api/driver/rides/${carried}/accept`, {});
    check("a ride that already carries its promo is accepted", acc1.status === 200, `${acc1.status} ${JSON.stringify(acc1.json?.message)}`);
    check("and takes no second promo ride from the rider", await promo() === 1, String(await promo()));
    await db.query("UPDATE rides SET status='cancelled' WHERE id=$1", [carried]);

    await db.query("UPDATE users SET promo_rides_remaining=1 WHERE id=$1", [FIXTURES.rider.id]);
    const later = await seed({ estimated_fare: "4.00", scheduled_at: new Date(Date.now() + 26 * 3600e3) });
    const acc2 = await driver.req("POST", `/api/driver/rides/${later}/accept`, {});
    check("the driver accepts a $4 ride paid by the welcome credit", acc2.status === 200 && await promo() === 0 && Number((await ride(later)).promo_discount_applied) === 4, `${acc2.status} promo=${await promo()}`);
    const bail = await driver.req("POST", `/api/rides/${later}/cancel`, { reason: "Car trouble" });
    const afterBail = await ride(later);
    check("the driver cancels and the ride goes back on the board", bail.status === 200 && afterBail.status === "pending", `${bail.status} ${afterBail.status}`);
    check("the rider has their promo ride back while the ride waits for a driver", await promo() === 1 && Number(afterBail.promo_discount_applied) === 0, `promo=${await promo()} applied=${afterBail.promo_discount_applied}`);
    await db.query("UPDATE rides SET driver_id=$2 WHERE id=$1", [later, FIXTURES.driver.id]);
    const acc3 = await driver.req("POST", `/api/driver/rides/${later}/accept`, {});
    check("re-accepted, it takes the promo ride once more, not a second one", acc3.status === 200 && await promo() === 0 && Number((await ride(later)).promo_discount_applied) === 4, `${acc3.status} ${JSON.stringify(acc3.json?.message)} promo=${await promo()}`);
    const free = await rider.req("POST", `/api/rides/${later}/cancel`, { reason: "Plans changed" });
    check("the rider cancels a day ahead at no charge, and the promo ride comes back", free.status === 200 && await promo() === 1, `${free.status} ${JSON.stringify(free.json?.message)} promo=${await promo()}`);

    section("R9: a rider's cancel racing a driver's accept — one of them wins");
    await db.query("UPDATE users SET promo_rides_remaining=50 WHERE id=$1", [FIXTURES.rider.id]);
    let bothWon = 0, holdOnCancelled = 0;
    for (let i = 0; i < 6; i++) {
      const id = await seed({ estimated_fare: "4.00" });
      const [c, a] = await Promise.all([
        rider.req("POST", `/api/rides/${id}/cancel`, { reason: "race" }),
        driver.req("POST", `/api/driver/rides/${id}/accept`, {}),
      ]);
      if (c.status === 200 && a.status === 200) bothWon++;
      const row = await ride(id);
      if (row.status === "cancelled" && (row.payment_status === "authorized" || Number(row.promo_discount_applied) > 0)) holdOnCancelled++;
    }
    check("never both: the cancel and the accept do not both succeed", bothWon === 0, `both succeeded in ${bothWon}/6`);
    check("a cancelled ride is left with no authorization and no promo taken", holdOnCancelled === 0, `${holdOnCancelled}/6`);

    section("R10: two cancels at once — one of them wins");
    let doubled = 0;
    for (let i = 0; i < 3; i++) {
      const id = await seed({ status: "accepted", accepted_at: new Date(), payment_status: "authorized", stripe_payment_intent_id: `virtual-e2e54-${stamp}-${i}` });
      const [c1, c2] = await Promise.all([
        rider.req("POST", `/api/rides/${id}/cancel`, { reason: "tap" }),
        rider.req("POST", `/api/rides/${id}/cancel`, { reason: "tap" }),
      ]);
      if (c1.status === 200 && c2.status === 200) doubled++;
    }
    check("a double tap cancels once", doubled === 0, `both succeeded in ${doubled}/3`);

    section("R11: only a completed ride is rated, and once");
    const cancelledRide = await seed({ status: "cancelled", payment_status: "cancelled" });
    const rateCancelled = await rider.req("POST", `/api/rides/${cancelledRide}/rating`, { rating: 1 });
    check("a cancelled ride takes no rating", rateCancelled.status === 400 && (await ride(cancelledRide)).driver_rating === null, `${rateCancelled.status}`);
    let rated2 = 0;
    for (let i = 0; i < 3; i++) {
      const id = await seed({ status: "completed", payment_status: "paid_card", actual_fare: "18.00", completed_at: new Date() });
      const [r1, r2] = await Promise.all([
        rider.req("POST", `/api/rides/${id}/rating`, { rating: 5 }),
        rider.req("POST", `/api/rides/${id}/rating`, { rating: 1 }),
      ]);
      if (r1.status === 200 && r2.status === 200) rated2++;
    }
    check("two ratings sent at once rate the ride once", rated2 === 0, `both landed in ${rated2}/3`);

    section("AI: a message to the assistant is capped");
    const convo = await rider.req("POST", "/api/ai/conversations", { title: "e2e-54" });
    const tooLong = await rider.req("POST", `/api/ai/conversations/${convo.json?.id}/messages`, { content: "a".repeat(2001) });
    check("a 2,001-character message is refused in plain words", tooLong.status === 400 && /under 2,000 characters/.test(tooLong.json?.message ?? ""), `${tooLong.status} ${JSON.stringify(tooLong.json)}`);
    if (convo.json?.id) {
      await db.query("DELETE FROM chat_messages WHERE conversation_id=$1", [convo.json.id]).catch(() => {});
      await db.query("DELETE FROM conversations WHERE id=$1", [convo.json.id]).catch(() => {});
    }
  } finally {
    const { rows } = await db.query(
      "SELECT id FROM rides WHERE (rider_id = ANY($1::varchar[]) AND created_at >= $2) OR group_id = ANY($3::varchar[]) OR plan_id = ANY($4::varchar[])",
      [[FIXTURES.rider.id, joinerId, farerId], startedAt, groupIds, planIds]).catch(() => ({ rows: [] }));
    await deleteRides(db, rows.map((r) => r.id)).catch(() => {});
    await db.query("DELETE FROM ride_groups WHERE id = ANY($1::varchar[])", [groupIds]).catch(() => {});
    await db.query("DELETE FROM weekly_ride_plans WHERE id = ANY($1::varchar[])", [planIds]).catch(() => {});
    await db.query("DELETE FROM in_app_notifications WHERE user_id = ANY($1::varchar[])", [[joinerId, farerId]]).catch(() => {});
    await db.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [[joinerId, farerId]]).catch(() => {});
    await db.query("UPDATE users SET promo_rides_remaining=$2 WHERE id=$1", [FIXTURES.rider.id, promoBefore]).catch(() => {});
  }
}
