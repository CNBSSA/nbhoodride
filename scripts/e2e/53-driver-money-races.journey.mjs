import { Session, check, section, FIXTURES, PICKUP, DEST, deleteRides } from "./harness.mjs";

/**
 * Code review 2026-10-06 (driver money findings):
 *
 * 1. A payout request moved anywhere the admin said: a rejected request
 *    (money back on the balance) could later be marked paid, and
 *    processing → rejected never gave the held money back. Now pending →
 *    processing | paid | rejected and processing → paid | rejected, once,
 *    a move into rejected refunds from either, and paid or rejected never
 *    change (409).
 * 2. The driver-drop sweep released an ACCEPTED scheduled ride, stranding
 *    the rider's authorization. Only an unconfirmed claim is released now.
 * 3. A double-tapped no-show collected the fee and credited the driver
 *    twice: the money moved before the ride was marked. The mark is now the
 *    claim, and only its winner moves money.
 * 4. Payday counted a rejected payout against what an owner's cars earned,
 *    so that amount was never paid.
 * 5. A double-tapped driver cancel refunded the rider's hold twice.
 */
export async function run({ base, db }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const driver2 = new Session(base); await driver2.login(FIXTURES.driver.email);
  const D = FIXTURES.driver.id;
  const balanceOf = (id) => db.query("SELECT virtual_card_balance AS b FROM users WHERE id=$1", [id]).then((r) => Number(r.rows[0]?.b ?? 0));
  const payoutIds = [], rideIds = [];
  const ownerId = `e2e-53-owner-${Date.now()}`;
  const { rows: [{ b: driverBalanceBefore }] } = await db.query("SELECT virtual_card_balance AS b FROM users WHERE id=$1", [D]);
  const { rows: [{ b: riderBalanceBefore }] } = await db.query("SELECT virtual_card_balance AS b FROM users WHERE id=$1", [FIXTURES.rider.id]);
  const payout = async (status = "pending", amount = 20) => {
    const { rows: [p] } = await db.query(
      "INSERT INTO payout_requests (driver_id, amount, payout_method, payout_details, status) VALUES ($1, $2, 'zelle', 'e2e53@example.com', $3) RETURNING id",
      [D, amount, status]);
    payoutIds.push(p.id); return p.id;
  };
  const move = (id, status, s = admin) => s.req("PATCH", `/api/admin/payout-requests/${id}`, { status, adminNote: "e2e-53" });
  const statusOf = (id) => db.query("SELECT status FROM payout_requests WHERE id=$1", [id]).then((r) => r.rows[0]?.status);
  const ride = async (fields) => {
    const cols = { rider_id: FIXTURES.rider.id, driver_id: D, pickup_location: JSON.stringify(PICKUP), destination_location: JSON.stringify(DEST), estimated_fare: "20.00", payment_method: "card", ride_type: "standard", ...fields };
    const keys = Object.keys(cols);
    const { rows: [r] } = await db.query(`INSERT INTO rides (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, keys.map((k) => cols[k]));
    rideIds.push(r.id); return r.id;
  };
  const ledger = (rideId, reason) => db.query("SELECT user_id, amount FROM wallet_transactions WHERE ride_id=$1 AND reason=$2", [rideId, reason]).then((r) => r.rows);

  try {
    section("A rejected payout is never paid afterwards");
    const p1 = await payout();
    let bal = await balanceOf(D);
    const rej = await move(p1, "rejected");
    check("the admin rejects a pending payout", rej.status === 200 && (await statusOf(p1)) === "rejected", `${rej.status} ${JSON.stringify(rej.json?.message)}`);
    check("the $20 goes back to the driver's balance", Math.abs((await balanceOf(D)) - bal - 20) < 0.001, `${bal} → ${await balanceOf(D)}`);
    bal = await balanceOf(D);
    const paidAfter = await move(p1, "paid");
    check("marking it paid afterwards is refused with plain words (409)", paidAfter.status === 409 && /already rejected/.test(paidAfter.json?.message ?? ""), `${paidAfter.status} ${JSON.stringify(paidAfter.json)}`);
    check("it stays rejected and the balance is unchanged", (await statusOf(p1)) === "rejected" && (await balanceOf(D)) === bal, `${await statusOf(p1)} ${await balanceOf(D)}`);
    const reprocess = await move(p1, "processing");
    check("nor can it be put back to processing", reprocess.status === 409, `${reprocess.status}`);

    section("A processing payout that is rejected gives the money back");
    const p2 = await payout("pending", 15);
    check("the admin marks it processing", (await move(p2, "processing")).status === 200 && (await statusOf(p2)) === "processing");
    bal = await balanceOf(D);
    const rej2 = await move(p2, "rejected");
    check("then rejects it", rej2.status === 200 && (await statusOf(p2)) === "rejected", `${rej2.status} ${JSON.stringify(rej2.json?.message)}`);
    check("and the $15 held is back on the driver's balance", Math.abs((await balanceOf(D)) - bal - 15) < 0.001, `${bal} → ${await balanceOf(D)}`);

    section("A paid payout is never rejected, and two rejects refund once");
    const p3 = await payout();
    check("a pending payout is marked paid", (await move(p3, "paid")).status === 200);
    bal = await balanceOf(D);
    const unpay = await move(p3, "rejected");
    check("rejecting it afterwards is refused, nothing refunded", unpay.status === 409 && (await statusOf(p3)) === "paid" && (await balanceOf(D)) === bal, `${unpay.status} ${await balanceOf(D)}`);
    const p4 = await payout("processing", 12);
    bal = await balanceOf(D);
    const admin2 = new Session(base); await admin2.login(FIXTURES.admin.email);
    const both = await Promise.all([move(p4, "rejected"), move(p4, "rejected", admin2)]);
    const codes = both.map((r) => r.status).sort();
    check("two admins rejecting at once: one wins, one is told", codes[0] === 200 && codes[1] === 409, JSON.stringify(codes));
    check("and the driver is refunded once", Math.abs((await balanceOf(D)) - bal - 12) < 0.001, `${bal} → ${await balanceOf(D)}`);

    section("Payday: a rejected payout is not a payment an owner was made");
    await db.query("INSERT INTO users (id, email, first_name, last_name, virtual_card_balance) VALUES ($1, $2, 'Rita', 'Owner', '50.00')", [ownerId, `${ownerId}@example.com`]);
    await db.query("INSERT INTO rental_owner_profiles (user_id, payout_method, payout_details) VALUES ($1, 'zelle', 'rita@example.com')", [ownerId]);
    await db.query("INSERT INTO wallet_transactions (user_id, amount, balance_after, reason) VALUES ($1, 50.00, 50.00, 'rental_owner_earnings')", [ownerId]);
    // The owner asked for the $50, PG Ride rejected it and put it back.
    await db.query("INSERT INTO payout_requests (driver_id, amount, payout_method, payout_details, status) VALUES ($1, 50.00, 'zelle', 'rita@example.com', 'rejected')", [ownerId]);
    await db.query("DELETE FROM processed_webhook_events WHERE provider='weekly_payday' AND event_id LIKE '2033-%'");
    const { rows: before } = await db.query("SELECT id FROM payout_requests");
    const known = new Set(before.map((r) => r.id));
    const pay = await admin.req("POST", "/api/admin/analytics/payday", { at: "2033-01-07T15:00:00Z" });
    // Payday pays every balance in the test database; give back everyone
    // else's so later checks see the balances they had.
    const { rows: made } = await db.query("SELECT id, driver_id, amount FROM payout_requests");
    for (const r of made.filter((m) => !known.has(m.id) && m.driver_id !== ownerId)) {
      await db.query("UPDATE users SET virtual_card_balance = CAST(COALESCE(virtual_card_balance,'0') AS DECIMAL(10,2)) + $2 WHERE id=$1", [r.driver_id, r.amount]);
      await db.query("DELETE FROM payout_requests WHERE id=$1", [r.id]);
    }
    const line = (pay.json?.paid ?? []).find((l) => l.driverId === ownerId);
    check("the owner is paid the $50 their car earned", pay.status === 200 && line?.amount === 50, JSON.stringify({ status: pay.status, ran: pay.json?.ran, line, skipped: (pay.json?.skipped ?? []).find((l) => l.driverId === ownerId) }));

    section("The drop sweep releases a claim, never an accepted ride");
    await db.query("UPDATE driver_profiles SET presence_dropped_at = NULL WHERE user_id=$1", [D]);
    const claimedOnly = await ride({ status: "pending", scheduled_at: new Date(Date.now() + 60 * 60e3) });
    const accepted = await ride({ status: "accepted", scheduled_at: new Date(Date.now() + 60 * 60e3), accepted_at: new Date(), stripe_payment_intent_id: "virtual-e2e53-acc", virtual_amount_authorized: "20.00", payment_status: "authorized" });
    await db.query("UPDATE driver_profiles SET presence_dropped_at = NOW() - interval '6 minutes' WHERE user_id=$1", [D]);
    const sweep = await admin.req("POST", "/api/admin/analytics/driver-drop-sweep", {});
    const { rows: [acc] } = await db.query("SELECT status, driver_id, stripe_payment_intent_id FROM rides WHERE id=$1", [accepted]);
    const { rows: [cl] } = await db.query("SELECT status, driver_id FROM rides WHERE id=$1", [claimedOnly]);
    check("the unconfirmed claim is released as before", sweep.status === 200 && sweep.json?.released?.includes(claimedOnly) && cl.driver_id === null && cl.status === "pending", JSON.stringify({ sweep: sweep.json, cl }));
    check("the accepted ride stays with its driver, its authorization in place", !sweep.json?.released?.includes(accepted) && acc.status === "accepted" && acc.driver_id === D && acc.stripe_payment_intent_id === "virtual-e2e53-acc", JSON.stringify(acc));

    section("A double-tapped no-show charges once and pays once");
    const ns = await ride({ status: "driver_arriving", accepted_at: new Date(), arrived_at: new Date(Date.now() - 30 * 60e3), stripe_payment_intent_id: "virtual-e2e53-ns", virtual_amount_authorized: "20.00", payment_status: "authorized" });
    const body = { driverLat: PICKUP.lat, driverLng: PICKUP.lng };
    const taps = await Promise.all([driver.req("POST", `/api/driver/rides/${ns}/no-show`, body), driver2.req("POST", `/api/driver/rides/${ns}/no-show`, body)]);
    const tapCodes = taps.map((r) => r.status).sort();
    check("one tap reports the no-show, the other is told it already was (409)", tapCodes[0] === 200 && tapCodes[1] === 409, JSON.stringify(taps.map((r) => [r.status, r.json?.message])));
    const fee = await ledger(ns, "cancellation_fee");
    const back = await ledger(ns, "cancellation_refund");
    check("the driver is credited their cut once", fee.length === 1 && fee[0].user_id === D, JSON.stringify(fee));
    check("the rider's hold is settled once", back.length === 1, JSON.stringify(back));
    const { rows: [nsRow] } = await db.query("SELECT status, cancellation_fee, payment_status FROM rides WHERE id=$1", [ns]);
    check("the ride is a no-show with the fee on it", nsRow.status === "no_show" && Number(nsRow.cancellation_fee) > 0 && nsRow.payment_status === "cancelled_with_fee", JSON.stringify(nsRow));

    section("A double-tapped driver cancel refunds the rider once");
    const dc = await ride({ status: "accepted", scheduled_at: new Date(Date.now() + 26 * 60 * 60e3), accepted_at: new Date(), stripe_payment_intent_id: "virtual-e2e53-dc", virtual_amount_authorized: "20.00", payment_status: "authorized" });
    const cancels = await Promise.all([driver.req("POST", `/api/rides/${dc}/cancel`, { reason: "e2e-53" }), driver2.req("POST", `/api/rides/${dc}/cancel`, { reason: "e2e-53" })]);
    const cancelCodes = cancels.map((r) => r.status).sort();
    check("one cancel goes through, the other is told (409)", cancelCodes[0] === 200 && cancelCodes[1] === 409, JSON.stringify(cancels.map((r) => [r.status, r.json?.message])));
    const refunds = await ledger(dc, "cancellation_refund");
    check("the rider's $20 hold is refunded once", refunds.length === 1 && Number(refunds[0].amount) === 20, JSON.stringify(refunds));
    const { rows: [dcRow] } = await db.query("SELECT status, driver_id FROM rides WHERE id=$1", [dc]);
    check("the ride is back on the board for another driver", dcRow.status === "pending" && dcRow.driver_id === null, JSON.stringify(dcRow));
    const start = await driver.req("POST", `/api/driver/rides/${dc}/start`, {});
    check("and the driver who cancelled cannot start it", start.status >= 400, `${start.status}`);
  } finally {
    await db.query("UPDATE driver_profiles SET presence_dropped_at = NULL WHERE user_id=$1", [D]).catch(() => {});
    // The released claim leaves the driver a notification; journey 42 reads
    // the driver's latest one, so it must not find this journey's.
    await db.query("DELETE FROM in_app_notifications WHERE user_id=$1 AND data->>'rideId' = ANY($2::varchar[])", [D, rideIds]).catch(() => {});
    await deleteRides(db, rideIds).catch(() => {});
    await db.query("DELETE FROM payout_requests WHERE id = ANY($1::varchar[]) OR driver_id=$2", [payoutIds, ownerId]).catch(() => {});
    await db.query("DELETE FROM wallet_transactions WHERE user_id=$1 OR (user_id=$2 AND reason='payout_rejected' AND performed_by=$3)", [ownerId, D, FIXTURES.admin.id]).catch(() => {});
    await db.query("DELETE FROM rental_owner_profiles WHERE user_id=$1", [ownerId]).catch(() => {});
    await db.query("DELETE FROM users WHERE id=$1", [ownerId]).catch(() => {});
    await db.query("DELETE FROM processed_webhook_events WHERE provider='weekly_payday' AND event_id LIKE '2033-%'").catch(() => {});
    await db.query("UPDATE users SET virtual_card_balance=$2 WHERE id=$1", [D, driverBalanceBefore]).catch(() => {});
    await db.query("UPDATE users SET virtual_card_balance=$2 WHERE id=$1", [FIXTURES.rider.id, riderBalanceBefore]).catch(() => {});
  }
}
