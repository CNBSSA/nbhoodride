import Stripe from "stripe";
import { Session, check, section, deleteRides, FIXTURES, PICKUP, DEST } from "./harness.mjs";

/**
 * Tips after a card ride (shared/tipPolicy.ts).
 *
 * Until the rates audit of 2026-09-18 a card rider had no way to tip: the
 * driver's Complete refused a tip on a card ride "because the rider adds
 * it", and nothing let the rider add it. This is that door. Stripe is a
 * fake key here, so the charge itself cannot succeed; what is proven is who
 * may tip, for what, how much, that nothing is written or credited unless
 * the card went through, and that a tip already on the ledger is refused
 * before the card is touched.
 */
export async function run({ base, db }) {
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const loc = (p) => JSON.stringify(p);
  const seed = async ({ method = "card", status = "completed", daysAgo = 0, tip = "0.00", paymentStatus, refunded = null } = {}) => {
    const { rows: [r] } = await db.query(
      `INSERT INTO rides (rider_id, driver_id, status, pickup_location, destination_location, estimated_fare, actual_fare, payment_method, payment_status,
                          platform_fee, driver_earnings, tip_amount, refunded_amount, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, '23.21', '23.21', $6, $7, '3.48', '19.73', $8, $10,
               NOW() - ($9 || ' days')::interval - interval '30 minutes', NOW() - ($9 || ' days')::interval)
       RETURNING id`,
      [FIXTURES.rider.id, FIXTURES.driver.id, status, loc(PICKUP), loc(DEST), method, paymentStatus ?? (method === "card" ? "paid_card" : "paid_cash"), tip, String(daysAgo), refunded]);
    return r.id;
  };
  const guest = new Session(base);
  const balance = async () => Number((await db.query("SELECT COALESCE(virtual_card_balance,'0') AS b FROM users WHERE id=$1", [FIXTURES.driver.id])).rows[0].b);
  const tipRows = async (id) => (await db.query("SELECT amount FROM wallet_transactions WHERE ride_id=$1 AND reason='tip'", [id])).rows;

  const card = await seed();
  const cash = await seed({ method: "cash" });
  const old = await seed({ daysAgo: 10 });
  const onRoad = await seed({ status: "in_progress" });
  const ids = [card, cash, old, onRoad];
  const before = await balance();

  try {
    section("Who may tip, for what");
    const asDriver = await driver.req("POST", `/api/rides/${card}/tip`, { amount: 5 });
    check("the driver cannot tip themselves", asDriver.status === 403, `${asDriver.status}`);
    const onCash = await rider.req("POST", `/api/rides/${cash}/tip`, { amount: 5 });
    check("a cash ride's tip is handed to the driver, not charged", onCash.status === 400 && /handed to the driver/.test(onCash.json?.message ?? ""), JSON.stringify(onCash.json));
    const tooOld = await rider.req("POST", `/api/rides/${old}/tip`, { amount: 5 });
    check("a ride ten days back is past the window", tooOld.status === 400 && /7 days/.test(tooOld.json?.message ?? ""), JSON.stringify(tooOld.json));
    const notDone = await rider.req("POST", `/api/rides/${onRoad}/tip`, { amount: 5 });
    check("a ride still on the road cannot be tipped yet", notDone.status === 400 && /completed/.test(notDone.json?.message ?? ""), JSON.stringify(notDone.json));
    check("a made-up ride is not found", (await rider.req("POST", `/api/rides/00000000-0000-0000-0000-000000000000/tip`, { amount: 5 })).status === 404);
    // A tip sits on top of a settled fare. A ride whose settlement failed
    // is the operator's to sort out first: its own charge must never be
    // mistaken for the fare's, and a tip must not ride along on a retry.
    const unsettled = await seed({ paymentStatus: "settlement_failed" }); ids.push(unsettled);
    const onUnsettled = await rider.req("POST", `/api/rides/${unsettled}/tip`, { amount: 5 });
    check("a ride whose fare has not settled takes no tip yet", onUnsettled.status === 400 && onUnsettled.json?.reason === "not_settled", JSON.stringify(onUnsettled.json));
    const refundedRide = await seed({ refunded: "10.00" }); ids.push(refundedRide);
    const onRefunded = await rider.req("POST", `/api/rides/${refundedRide}/tip`, { amount: 5 });
    check("a refunded ride takes no tip", onRefunded.status === 400 && onRefunded.json?.reason === "refunded", JSON.stringify(onRefunded.json));

    section("How much");
    for (const amount of [0, 0.5, 100.01, -3, "abc", null]) {
      const r = await rider.req("POST", `/api/rides/${card}/tip`, { amount });
      check(`$${amount} is not a tip PG Ride takes`, r.status === 400 && /between \$1 and \$100/.test(r.json?.message ?? ""), `${r.status} ${JSON.stringify(r.json)}`);
    }

    section("The card is charged before anything is written; nothing moves when it does not go through");
    await db.query("UPDATE users SET stripe_customer_id=NULL, stripe_payment_method_id=NULL WHERE id=$1", [FIXTURES.rider.id]);
    const noCard = await rider.req("POST", `/api/rides/${card}/tip`, { amount: 5 });
    check("a rider with no card on file is sent to Payments", noCard.status === 400 && /Add a card/.test(noCard.json?.message ?? ""), JSON.stringify(noCard.json));
    await db.query("UPDATE users SET stripe_customer_id='cus_e2e', stripe_payment_method_id='pm_e2e' WHERE id=$1", [FIXTURES.rider.id]);
    const attempt = await rider.req("POST", `/api/rides/${card}/tip`, { amount: 5 });
    check("with Stripe unreachable the tip is refused in words, not a 500", attempt.status === 503 && /not available right now/.test(attempt.json?.message ?? ""), `${attempt.status} ${JSON.stringify(attempt.json)}`);
    const { rows: [afterFail] } = await db.query("SELECT tip_amount, driver_earnings FROM rides WHERE id=$1", [card]);
    check("nothing is written on the ride", afterFail.tip_amount === "0.00" && afterFail.driver_earnings === "19.73", JSON.stringify(afterFail));
    check("and the driver's wallet is untouched", (await tipRows(card)).length === 0 && await balance() === before, String(await balance()));

    section("A tip already on the ledger is refused before the card is touched");
    const tipped = await seed({ tip: "0.00" }); ids.push(tipped);
    await db.query("INSERT INTO wallet_transactions (user_id, amount, balance_after, reason, ride_id) VALUES ($1, '5.00', '0.00', 'tip', $2)", [FIXTURES.driver.id, tipped]);
    const again = await rider.req("POST", `/api/rides/${tipped}/tip`, { amount: 5 });
    check("the second tip is refused as already tipped", again.status === 409 && again.json?.reason === "already_tipped", JSON.stringify(again.json));
    const shown = await seed({ tip: "5.00" }); ids.push(shown);
    const onRide = await rider.req("POST", `/api/rides/${shown}/tip`, { amount: 2 });
    check("a ride that carries a tip is refused too", onRide.status === 409, JSON.stringify(onRide.json));

    section("The rating screen knows which rides can be tipped");
    const list = await rider.req("GET", "/api/rides/for-rating");
    const mine = (list.json ?? []).find((r) => r.id === card);
    check("the card ride is listed with its payment method and tip, so the card can offer a tip", !!mine && mine.paymentMethod === "card" && mine.tipAmount === "0.00" && !!mine.completedAt, JSON.stringify(mine && { pm: mine.paymentMethod, tip: mine.tipAmount }));

    section("Stripe's word records the tip once, and never marks a fare paid");
    // The webhook is the fallback for a charge that came back "processing"
    // or a request that died between Stripe and the ledger. Signed as
    // Stripe signs it; the harness runs the server with the e2e secret.
    const signedPost = (obj) => {
      const payload = JSON.stringify(obj);
      const sig = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_e2e_fake" });
      return guest.req("POST", "/api/webhooks/stripe", payload, { "Content-Type": "application/json", "stripe-signature": sig });
    };
    const tipEvent = (id, rideId, cents) => ({
      id: `evt_e2e_${id}_${Date.now()}`, object: "event", type: "payment_intent.succeeded", created: Math.floor(Date.now() / 1000),
      data: { object: { id: `pi_e2e_${id}`, object: "payment_intent", amount: cents, amount_received: cents, currency: "usd", status: "succeeded",
        metadata: { rideId, riderId: FIXTURES.rider.id, type: "tip", tipAmount: (cents / 100).toFixed(2) } } },
    });
    const beforeHook = await balance();
    const hook = await signedPost(tipEvent("tip1", card, 500));
    check("a signed tip event is accepted", hook.status === 200, `${hook.status} ${JSON.stringify(hook.json)}`);
    const { rows: [afterHook] } = await db.query("SELECT tip_amount, driver_earnings, payment_status FROM rides WHERE id=$1", [card]);
    check("the ride carries the tip and the driver's earnings grew by it; the fare's status is untouched", afterHook.tip_amount === "5.00" && afterHook.driver_earnings === "24.73" && afterHook.payment_status === "paid_card", JSON.stringify(afterHook));
    check("the driver's wallet is credited all of it, once", (await tipRows(card)).length === 1 && Math.abs((await balance()) - beforeHook - 5) < 0.011, String(await balance()));
    await signedPost(tipEvent("tip1-again", card, 500));
    check("the same tip told again is not credited twice", (await tipRows(card)).length === 1 && Math.abs((await balance()) - beforeHook - 5) < 0.011, String(await balance()));
    const afterHookTip = await rider.req("POST", `/api/rides/${card}/tip`, { amount: 3 });
    check("and the rider cannot add another", afterHookTip.status === 409 && afterHookTip.json?.reason === "already_tipped", JSON.stringify(afterHookTip.json));
    await signedPost(tipEvent("tip-unsettled", unsettled, 300));
    const { rows: [stillFailed] } = await db.query("SELECT payment_status FROM rides WHERE id=$1", [unsettled]);
    check("a tip event never marks a failed settlement as paid", stillFailed.payment_status === "settlement_failed", JSON.stringify(stillFailed));

    section("The driver still cannot enter a tip on a card ride");
    const byDriver = await driver.req("POST", `/api/driver/rides/${onRoad}/complete`, { tipAmount: 4 });
    check("Complete refuses it: the rider adds it", byDriver.status === 400 && /added by the rider/.test(byDriver.json?.message ?? ""), JSON.stringify(byDriver.json));
  } finally {
    await db.query("DELETE FROM wallet_transactions WHERE ride_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await deleteRides(db, ids).catch(() => {});
  }
}
