import { Session, check, section, deleteRides, FIXTURES, PICKUP, DEST } from "./harness.mjs";

/**
 * Cash is discontinued (founder decision, 2026-09-18).
 *
 * Nothing in the product creates a cash ride any more: booking refuses it in
 * words, and a ride row written without a payment method is born a card ride
 * rather than a cash one. What is not taken away is the settling of rides
 * booked when cash was still taken — a driver can still confirm the money and
 * the tip that came with it, the ride still reads Cash on the receipt, and
 * the operator can watch that tail run out.
 */
export async function run({ base, db }) {
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const loc = (p) => JSON.stringify(p);
  const ids = [];

  // A ride from before the change: written straight to the table, as one
  // booked back then would be.
  const legacy = async (status = "completed") => {
    const { rows: [r] } = await db.query(
      `INSERT INTO rides (rider_id, driver_id, status, pickup_location, destination_location, estimated_fare, actual_fare,
                          payment_method, payment_status, platform_fee, driver_earnings, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, '23.21', '23.21', 'cash', 'pending_payment', '3.48', '19.73',
               NOW() - interval '40 minutes', NOW() - interval '10 minutes') RETURNING id`,
      [FIXTURES.rider.id, FIXTURES.driver.id, status, loc(PICKUP), loc(DEST)]);
    ids.push(r.id); return r.id;
  };

  try {
    section("Nothing takes cash any more");
    const asked = await rider.req("POST", "/api/rides", {
      pickupLocation: { ...PICKUP, address: "1 Main St" }, destinationLocation: { ...DEST, address: "2 Oak Rd" },
      estimatedFare: 23.21, paymentMethod: "cash",
    });
    check("booking a cash ride is refused, and says why", asked.status === 400 && /no longer takes cash/i.test(asked.json?.message ?? ""), `${asked.status} ${JSON.stringify(asked.json?.message)}`);

    // The table itself no longer leans towards cash: a row that names no
    // payment method is a card ride.
    const { rows: [defaulted] } = await db.query(
      `INSERT INTO rides (rider_id, status, pickup_location, destination_location, estimated_fare)
       VALUES ($1, 'pending', $2, $3, '10.00') RETURNING id, payment_method`,
      [FIXTURES.rider.id, loc(PICKUP), loc(DEST)]);
    ids.push(defaulted.id);
    check("a ride written without a payment method is a card ride, not a cash one", defaulted.payment_method === "card", JSON.stringify(defaulted));

    section("A ride booked when cash was taken still settles");
    const old = await legacy();
    const confirm = await driver.req("POST", `/api/rides/${old}/confirm-payment`, { tipAmount: 4 });
    check("the driver confirms the money and the tip that came with it", confirm.status === 200 && confirm.json?.success === true, JSON.stringify(confirm.json?.message ?? confirm.status));
    const { rows: [settled] } = await db.query("SELECT payment_status, tip_amount, cash_received_at FROM rides WHERE id=$1", [old]);
    check("it reads as paid in cash, with the tip and the time", settled.payment_status === "paid_cash" && settled.tip_amount === "4.00" && !!settled.cash_received_at, JSON.stringify(settled));
    const again = await driver.req("POST", `/api/rides/${old}/confirm-payment`, {});
    check("confirming it twice is refused", again.status === 400 && /already been confirmed/i.test(again.json?.message ?? ""), JSON.stringify(again.json));
    const receipt = await rider.req("GET", `/api/rides/${old}/receipt`);
    check("the receipt still names how it was paid", receipt.status === 200 && /cash/i.test(JSON.stringify(receipt.json)), `${receipt.status}`);

    // Rides from back then may carry no payment method at all: the column has
    // always allowed it and the old default was cash, so their driver could
    // always confirm the money. That must not change with the discontinuation.
    const { rows: [blank] } = await db.query(
      `INSERT INTO rides (rider_id, driver_id, status, pickup_location, destination_location, estimated_fare, actual_fare,
                          payment_method, payment_status, platform_fee, driver_earnings, completed_at)
       VALUES ($1, $2, 'completed', $3, $4, '12.00', '12.00', NULL, 'pending_payment', '1.80', '10.20', NOW()) RETURNING id, payment_method`,
      [FIXTURES.rider.id, FIXTURES.driver.id, loc(PICKUP), loc(DEST)]);
    ids.push(blank.id);
    check("a ride with no payment method recorded stays that way", blank.payment_method === null, JSON.stringify(blank));
    const blankConfirm = await driver.req("POST", `/api/rides/${blank.id}/confirm-payment`, { tipAmount: 2 });
    check("and its driver can still confirm the money they took", blankConfirm.status === 200 && blankConfirm.json?.success === true, JSON.stringify(blankConfirm.json?.message ?? blankConfirm.status));
    const blankReceipt = await rider.req("GET", `/api/rides/${blank.id}/receipt`);
    check("its receipt calls it Cash, not a card that was never charged", blankReceipt.status === 200 && /"?paymentMethodLabel"?:"Cash"/.test(JSON.stringify(blankReceipt.json)), JSON.stringify(blankReceipt.json?.paymentMethodLabel ?? blankReceipt.status));

    section("A card ride cannot be marked paid in cash");
    // Before this the driver's confirm would take any completed ride, which
    // would have closed a card ride without ever charging the card.
    const { rows: [cardRide] } = await db.query(
      `INSERT INTO rides (rider_id, driver_id, status, pickup_location, destination_location, estimated_fare, actual_fare,
                          payment_method, payment_status, platform_fee, driver_earnings, completed_at)
       VALUES ($1, $2, 'completed', $3, $4, '23.21', '23.21', 'card', 'pending_payment', '3.48', '19.73', NOW()) RETURNING id`,
      [FIXTURES.rider.id, FIXTURES.driver.id, loc(PICKUP), loc(DEST)]);
    ids.push(cardRide.id);
    const wrong = await driver.req("POST", `/api/rides/${cardRide.id}/confirm-payment`, {});
    check("a card ride is refused, in words", wrong.status === 400 && /not paid in cash/i.test(wrong.json?.message ?? ""), `${wrong.status} ${JSON.stringify(wrong.json?.message)}`);
    const { rows: [untouched] } = await db.query("SELECT payment_status FROM rides WHERE id=$1", [cardRide.id]);
    check("and it is left alone", untouched.payment_status === "pending_payment", JSON.stringify(untouched));

    section("The operator can watch the tail run out");
    const fin = await admin.req("GET", `/api/admin/finances?year=${new Date().getFullYear()}`);
    // Including a ride from before the method was recorded: it is money in a
    // driver's hand like any other cash ride, so the operator must see it.
    check("the figures count the cash rides and how many are still unconfirmed", fin.status === 200 && typeof fin.json?.cashRides === "number" && typeof fin.json?.cashRidesUnsettled === "number" && fin.json.cashRides >= 1, JSON.stringify({ cash: fin.json?.cashRides, unsettled: fin.json?.cashRidesUnsettled }));
    const unsettledBefore = fin.json.cashRidesUnsettled;
    await legacy();
    const fin2 = await admin.req("GET", `/api/admin/finances?year=${new Date().getFullYear()}`);
    check("an unconfirmed one raises the count", fin2.json?.cashRidesUnsettled === unsettledBefore + 1, `${unsettledBefore} → ${fin2.json?.cashRidesUnsettled}`);
  } finally {
    await deleteRides(db, ids).catch(() => {});
  }
}
