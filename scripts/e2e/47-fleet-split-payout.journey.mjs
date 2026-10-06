import Stripe from "stripe";
import { Session, check, section, serverLog, startServer, stopServer, deleteRides, FIXTURES, PICKUP, DEST } from "./harness.mjs";

/**
 * Fleet management accounts, slice 4 (PG Ride Fleet Management Accounts
 * Plan): the 25/75 split and the Friday payout.
 *
 * PG Ride keeps its 15% of every fare. On a ride driven in a fleet's car the
 * driver's 85% is shared, 25% to the fleet owner and 75% to the driver; the
 * tip is the driver's alone; a no-show or late-cancel fee earned in the
 * fleet's car is shared the same way; anything earned in the driver's own
 * car is not. Each split is written once whatever retries happen. The Friday
 * payday pays each open fleet with an account on file what it is owed, once;
 * a fleet with nowhere to send it is named. The desk sees its money and
 * never a rider; the account a payout went to is the owner's to see; the
 * operator marks a payout sent and has the year's total for the accountant.
 * With FLEET_ENABLED off nothing is split.
 */
export async function run({ base, db, server }) {
  const stamp = Date.now();
  const orgId = "e2e-fleet", carId = "e2e-fleet-car";
  const otherFleetId = `e2e-fleet-47b-${stamp}`;
  const D = `e2e-fleet47-drv-${stamp}`, M = `e2e-fleet47-mgr-${stamp}`, V = `e2e-fleet47-view-${stamp}`;
  const emailOf = (id) => `${id}@example.com`;
  const rideIds = [];
  const KEYS = ["2027-01-08", "2027-01-15"];
  const clearClaims = () => db.query("DELETE FROM processed_webhook_events WHERE provider='weekly_payday' AND event_id = ANY($1::varchar[])", [KEYS]);
  const loc = (p) => JSON.stringify(p);
  const money = (v) => Math.round(Number(v ?? 0) * 100) / 100;

  // People: a fleet driver, a manager and a viewer, each an approved PG Ride account.
  for (const [id, first, last] of [[D, "Tayo", "Fleetwheel"], [M, "Mona", "Manager"], [V, "Vic", "Viewer"]]) {
    await db.query(`INSERT INTO users (id, email, password, first_name, last_name, is_approved, is_driver, phone, registration_completed_at)
      SELECT $1, $2, password, $3, $4, true, $5, NULL, NOW() FROM users WHERE id=$6`, [id, emailOf(id), first, last, id === D, FIXTURES.rider.id]);
  }
  await db.query(`INSERT INTO driver_profiles (user_id, approval_status, is_online) VALUES ($1, 'approved', false)`, [D]);
  await db.query(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'driver'), ($1,$3,'manager'), ($1,$4,'viewer')`, [orgId, D, M, V]);
  await clearClaims();

  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const owner = new Session(base); await owner.login(FIXTURES.rider.email);        // owner of e2e-fleet (harness seed)
  const rider = owner;                                                             // the same person rides (never shown to the fleet)
  const stranger = new Session(base); await stranger.login(FIXTURES.driver.email);  // owner of another fleet, not this one
  const driver = new Session(base); await driver.login(emailOf(D));
  const manager = new Session(base); await manager.login(emailOf(M));
  const viewer = new Session(base); await viewer.login(emailOf(V));

  const walletRows = async (rideId, reason) => (await db.query("SELECT amount FROM wallet_transactions WHERE ride_id=$1 AND reason=$2", [rideId, reason])).rows;
  const fleetRows = async (rideId) => (await db.query("SELECT kind, organization_id, fleet_car_id, driver_user_id, gross, fleet_share, driver_keeps, payout_id FROM fleet_earnings WHERE ride_id=$1 ORDER BY kind", [rideId])).rows;
  const rideRow = async (id) => (await db.query("SELECT status, payment_status, actual_fare, platform_fee, driver_earnings, tip_amount, fleet_car_id, fleet_org_id, fleet_share FROM rides WHERE id=$1", [id])).rows[0];
  // A card ride whose hold is a wallet one (no Stripe call needed to settle it), on the road with the fleet driver.
  const cardRide = async ({ status = "in_progress", fare = "20.00", extra = "" } = {}) => {
    const { rows: [r] } = await db.query(
      `INSERT INTO rides (rider_id, driver_id, status, pickup_location, destination_location, estimated_fare, payment_method, payment_status,
                          stripe_payment_intent_id, virtual_amount_authorized, accepted_at, started_at, arrived_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'card', 'authorized', $7, $6, NOW() - interval '20 minutes',
               ${status === "in_progress" ? "NOW() - interval '10 minutes'" : "NULL"}, ${status === "driver_arriving" ? "NOW() - interval '7 minutes'" : "NULL"}) RETURNING id`,
      [FIXTURES.rider.id, D, status, loc(PICKUP), loc(DEST), fare, `virtual-e2e-47-${Math.random().toString(36).slice(2)}${extra}`]);
    rideIds.push(r.id);
    return r.id;
  };

  try {
    section("The fleet gives its ready car to its approved driver");
    const given = await owner.req("POST", `/api/fleet/${orgId}/cars/${carId}/assign`, { driverUserId: D });
    check("the car goes to the driver, and is their only car", given.status === 200 && given.json?.driverUserId === D, JSON.stringify(given.json?.message ?? given.json?.driverUserId));

    section("A ride in the fleet's car: PG Ride 15%, then the driver's 85% shared 25/75");
    const r1 = await cardRide();
    const done1 = await driver.req("POST", `/api/driver/rides/${r1}/complete`, {});
    check("the driver completes the $20 ride", done1.status === 200, JSON.stringify(done1.json?.message ?? done1.status));
    let row1 = await rideRow(r1);
    check("the ride is stamped with the fleet's car and the fleet", row1.fleet_car_id === carId && row1.fleet_org_id === orgId, JSON.stringify(row1));
    check("PG Ride keeps $3.00; of the driver's $17.00 the fleet gets $4.25 and the driver $12.75", money(row1.platform_fee) === 3 && money(row1.fleet_share) === 4.25 && money(row1.driver_earnings) === 12.75, JSON.stringify(row1));
    check("the card settled from the hold", row1.payment_status === "paid_card", row1.payment_status);
    check("the driver's wallet is credited their $12.75, once", JSON.stringify((await walletRows(r1, "ride_earnings")).map((w) => money(w.amount))) === "[12.75]");
    let f1 = await fleetRows(r1);
    check("the fleet is credited its $4.25 for the ride, once", f1.length === 1 && f1[0].kind === "fare" && f1[0].organization_id === orgId && f1[0].fleet_car_id === carId && f1[0].driver_user_id === D && money(f1[0].gross) === 17 && money(f1[0].fleet_share) === 4.25 && money(f1[0].driver_keeps) === 12.75 && f1[0].payout_id === null, JSON.stringify(f1));
    const today = await driver.req("GET", "/api/driver/earnings/today");
    check("the driver's own earnings screen shows what they actually get", today.status === 200 && Math.abs(Number(today.json?.fare) - 12.75) < 0.011, JSON.stringify(today.json));

    section("The tip is the driver's alone");
    const guest = new Session(base);
    const payload = JSON.stringify({
      id: `evt_e2e_47_tip_${stamp}`, object: "event", type: "payment_intent.succeeded", created: Math.floor(Date.now() / 1000),
      data: { object: { id: `pi_e2e_47_tip_${stamp}`, object: "payment_intent", amount: 500, amount_received: 500, currency: "usd", status: "succeeded",
        metadata: { rideId: r1, riderId: FIXTURES.rider.id, type: "tip", tipAmount: "5.00" } } },
    });
    const hook = await guest.req("POST", "/api/webhooks/stripe", payload, { "Content-Type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_e2e_fake" }) });
    check("the rider's $5 tip is recorded", hook.status === 200, `${hook.status}`);
    row1 = await rideRow(r1);
    check("all of it goes to the driver: $12.75 + $5.00; the fleet's share is unchanged", money(row1.driver_earnings) === 17.75 && money(row1.tip_amount) === 5 && money(row1.fleet_share) === 4.25, JSON.stringify(row1));
    check("the wallet carries the whole tip, and the fleet has no row for it", JSON.stringify((await walletRows(r1, "tip")).map((w) => money(w.amount))) === "[5]" && (await fleetRows(r1)).length === 1);
    check("driver + fleet + PG Ride account for the fare and the tip exactly", Math.round((money(row1.driver_earnings) + money(row1.fleet_share) + money(row1.platform_fee)) * 100) === 2500);

    section("Written once, whatever retries happen");
    await db.query("UPDATE rides SET payment_status='settlement_failed' WHERE id=$1", [r1]);
    const retry = await admin.req("POST", `/api/admin/rides/${r1}/retry-settlement`, {});
    check("an operator's settlement retry finishes the ride", retry.status === 200, `${retry.status} ${JSON.stringify(retry.json?.message ?? "")}`);
    check("and credits neither the driver nor the fleet again", (await walletRows(r1, "ride_earnings")).length === 1 && (await fleetRows(r1)).length === 1);
    // A commercial job pays the driver from the completion itself; two completions racing both reach the credit.
    const { rows: [cr] } = await db.query(
      `INSERT INTO rides (rider_id, driver_id, status, pickup_location, destination_location, estimated_fare, payment_method, ride_type, passenger_name, passenger_phone, accepted_at, started_at)
       VALUES ($1, $2, 'in_progress', $3, $4, '30.00', 'invoice', 'commercial', 'Pat Passenger', '2405550147', NOW() - interval '20 minutes', NOW() - interval '10 minutes') RETURNING id`,
      [FIXTURES.rider.id, D, loc(PICKUP), loc(DEST)]);
    rideIds.push(cr.id);
    await db.query("INSERT INTO commercial_jobs (ride_id, organization_id, category) VALUES ($1, 'e2e-biz', 'business')", [cr.id]);
    const [c1, c2] = await Promise.all([driver.req("POST", `/api/driver/rides/${cr.id}/complete`, {}), driver.req("POST", `/api/driver/rides/${cr.id}/complete`, {})]);
    check("two completions of a business job at once both answer", c1.status === 200 && c2.status === 200, `${c1.status} ${c2.status}`);
    await driver.req("POST", `/api/driver/rides/${cr.id}/complete`, {});
    const crRow = await rideRow(cr.id);
    check("the $30 job: fleet $6.38 of the driver's $25.50, the driver $19.12", money(crRow.fleet_share) === 6.38 && money(crRow.driver_earnings) === 19.12, JSON.stringify(crRow));
    check("after three completions the driver is credited once and the fleet once", JSON.stringify((await walletRows(cr.id, "ride_earnings")).map((w) => money(w.amount))) === "[19.12]" && (await fleetRows(cr.id)).length === 1);

    section("A ride in the driver's own car is theirs alone");
    const { rows: [prof] } = await db.query("SELECT id FROM driver_profiles WHERE user_id=$1", [D]);
    const { rows: [own] } = await db.query("INSERT INTO vehicles (driver_profile_id, make, model, year, color, license_plate) VALUES ($1, 'Kia', 'Rio', 2021, 'Red', 'OWN0047') RETURNING id", [prof.id]);
    const r2 = await cardRide();
    check("completed", (await driver.req("POST", `/api/driver/rides/${r2}/complete`, {})).status === 200);
    const row2 = await rideRow(r2);
    check("not stamped, and the driver keeps the whole $17.00", !row2.fleet_car_id && row2.fleet_share === null && money(row2.driver_earnings) === 17, JSON.stringify(row2));
    check("the fleet is credited nothing", (await fleetRows(r2)).length === 0);
    await db.query("DELETE FROM vehicles WHERE id=$1", [own.id]);

    section("A no-show fee and a late cancel earned in the fleet's car are shared too");
    const ns = await cardRide({ status: "driver_arriving", fare: "20.00" });
    const noShow = await driver.req("POST", `/api/driver/rides/${ns}/no-show`, { driverLat: PICKUP.lat, driverLng: PICKUP.lng });
    check("the driver reports the no-show", noShow.status === 200, JSON.stringify(noShow.json?.message ?? noShow.status));
    const nsRow = await rideRow(ns);
    check("the ride is stamped with the fleet at that moment", nsRow.fleet_car_id === carId && nsRow.fleet_org_id === orgId, JSON.stringify(nsRow));
    check("of the driver's $6.40 cut of the $8 fee, the driver is credited $4.80", JSON.stringify((await walletRows(ns, "cancellation_fee")).map((w) => money(w.amount))) === "[4.8]");
    const nsF = await fleetRows(ns);
    check("and the fleet $1.60", nsF.length === 1 && nsF[0].kind === "no_show_fee" && money(nsF[0].gross) === 6.4 && money(nsF[0].fleet_share) === 1.6, JSON.stringify(nsF));
    const lc = await cardRide({ status: "driver_arriving", fare: "20.00" });
    const cancelled = await rider.req("POST", `/api/rides/${lc}/cancel`, { reason: "Changed my mind" });
    check("the rider cancels with the driver waiting: a $7 fee", cancelled.status === 200, JSON.stringify(cancelled.json?.message ?? cancelled.status));
    const lcF = await fleetRows(lc);
    check("the driver's $5.60 cut is shared: $4.20 to the driver, $1.40 to the fleet", JSON.stringify((await walletRows(lc, "cancellation_fee")).map((w) => money(w.amount))) === "[4.2]" && lcF.length === 1 && lcF[0].kind === "cancel_fee" && money(lcF[0].fleet_share) === 1.4, JSON.stringify(lcF));

    section("The desk's earnings: the right totals and never a rider");
    const earn = await owner.req("GET", `/api/fleet/${orgId}/earnings?week=this`);
    const expectShare = money(4.25 + 6.38 + 1.6 + 1.4);
    check("this week: 2 rides, $50 in fares, the fleet's 25% and the drivers' 75%", earn.status === 200 && earn.json?.totals?.rides === 2 && money(earn.json?.totals?.fares) === 50 && money(earn.json?.totals?.fleetShare) === expectShare && money(earn.json?.totals?.driversShare) === money(12.75 + 19.12 + 4.8 + 4.2), JSON.stringify(earn.json?.totals));
    const byCar = (earn.json?.byCar ?? []).find((c) => c.fleetCarId === carId);
    const byDriver = (earn.json?.byDriver ?? []).find((d) => d.driverUserId === D);
    check("per car and per driver", byCar?.rides === 2 && money(byCar?.fleetShare) === expectShare && /FLT0001/.test(byCar?.carLabel ?? "") && byDriver?.driverName === "Tayo Fleetwheel" && money(byDriver?.fleetShare) === expectShare, JSON.stringify({ byCar, byDriver }));
    const earnText = JSON.stringify(earn.json);
    check("no rider's name, phone or address, no passenger, no tip", !/Rae|Rider|2405550002|Bowie|National Harbor|Pat Passenger|2405550147|tip/i.test(earnText), earnText.slice(0, 300));
    const last = await owner.req("GET", `/api/fleet/${orgId}/earnings?week=last`);
    check("last week is its own window", last.status === 200 && last.json?.week === "last" && last.json?.weekKey !== earn.json?.weekKey, JSON.stringify({ w: last.json?.weekKey }));
    check("a manager and a viewer see the earnings", (await manager.req("GET", `/api/fleet/${orgId}/earnings`)).json?.totals?.rides === 2 && (await viewer.req("GET", `/api/fleet/${orgId}/earnings`)).json?.totals?.rides === 2);
    check("the fleet's driver and a stranger do not", (await driver.req("GET", `/api/fleet/${orgId}/earnings`)).status === 403 && (await stranger.req("GET", `/api/fleet/${orgId}/earnings`)).status === 403 && (await stranger.req("GET", `/api/fleet/${orgId}/payouts`)).status === 403);

    section("Friday: one payout per fleet, covering exactly what it is owed");
    await db.query(`INSERT INTO organizations (id, name, category, status, facility_fee, fleet_details, contact_phone)
      VALUES ($1, 'E2E Fleet Without Account', 'fleet', 'active', 0.00, $2, '2405550147')`, [otherFleetId, JSON.stringify({ legalName: "E2E No Account LLC", ein: "33-4567890", businessType: "llc" })]);
    const { rows: [otherRide] } = await db.query(`INSERT INTO rides (rider_id, driver_id, status, pickup_location, destination_location, estimated_fare, actual_fare, payment_method, completed_at)
      VALUES ($1, $2, 'completed', $3, $4, '47.06', '47.06', 'card', NOW()) RETURNING id`, [FIXTURES.rider.id, D, loc(PICKUP), loc(DEST)]);
    rideIds.push(otherRide.id);
    await db.query(`INSERT INTO fleet_earnings (organization_id, fleet_car_id, driver_user_id, ride_id, kind, gross, fleet_share, driver_keeps) VALUES ($1, 'e2e-other-car', $2, $3, 'fare', 40.00, 10.00, 30.00)`, [otherFleetId, D, otherRide.id]);
    const { rows: owedRows } = await db.query("SELECT id, fleet_share FROM fleet_earnings WHERE organization_id=$1 AND payout_id IS NULL", [orgId]);
    const owed = money(owedRows.reduce((s, r) => s + Number(r.fleet_share), 0));
    const run1 = await admin.req("POST", "/api/admin/analytics/payday", { at: "2027-01-08T15:00:00Z" });
    const mine = (run1.json?.fleets?.paid ?? []).find((l) => l.organizationId === orgId);
    check("the fleet is paid everything it is owed, to its account", run1.status === 200 && run1.json?.ran === true && money(mine?.amount) === owed && owed === expectShare && mine?.method === "zelle", JSON.stringify(run1.json?.fleets ?? run1.json));
    const { rows: payouts } = await db.query("SELECT id, amount, payout_method, payout_details, status, payday_key FROM fleet_payouts WHERE organization_id=$1", [orgId]);
    check("one payout row, requested, with the account as it was that Friday", payouts.length === 1 && money(payouts[0].amount) === owed && payouts[0].payout_details === "fleet@example.com" && payouts[0].status === "requested" && payouts[0].payday_key === "2027-01-08", JSON.stringify(payouts));
    const { rows: stamped } = await db.query("SELECT id FROM fleet_earnings WHERE payout_id=$1 ORDER BY id", [payouts[0]?.id]);
    check("it covers exactly the rows that were owed", stamped.length === owedRows.length && owedRows.every((o) => stamped.some((r) => r.id === o.id)), `${stamped.length} of ${owedRows.length}`);
    const skippedOther = (run1.json?.fleets?.skipped ?? []).find((l) => l.organizationId === otherFleetId);
    check("a fleet owed money with no payout method is skipped and named", /No payout method/.test(skippedOther?.reason ?? ""), JSON.stringify(skippedOther));
    check("its money is still owed to it", (await db.query("SELECT payout_id FROM fleet_earnings WHERE organization_id=$1", [otherFleetId])).rows[0]?.payout_id === null);
    await new Promise((r) => setTimeout(r, 300));
    check("the operator is told about fleets in the payday alert", /Fleets paid[\s\S]*E2E Fleet Motors|fleets paid \d+[\s\S]*E2E Fleet Motors/.test(serverLog(server)) && /E2E Fleet Without Account \(No payout method/.test(serverLog(server)));
    const run2 = await admin.req("POST", "/api/admin/analytics/payday", { at: "2027-01-08T19:00:00Z" });
    check("a second run on the same Friday does nothing", run2.json?.ran === false);
    const run3 = await admin.req("POST", "/api/admin/analytics/payday", { at: "2027-01-15T15:00:00Z" });
    check("next Friday, with nothing new owed, the fleet is not paid again", run3.json?.ran === true && !(run3.json?.fleets?.paid ?? []).some((l) => l.organizationId === orgId) && (await db.query("SELECT count(*)::int AS n FROM fleet_payouts WHERE organization_id=$1", [orgId])).rows[0].n === 1, JSON.stringify(run3.json?.fleets));

    section("The Payouts view: what each Friday covered; the account is the owner's to see");
    const pv = await owner.req("GET", `/api/fleet/${orgId}/payouts`);
    const p0 = (pv.json?.payouts ?? [])[0];
    check("the owner sees the payout, what it covered and where it goes", pv.status === 200 && money(p0?.amount) === owed && p0?.covered?.rides === 2 && p0?.covered?.fees === 2 && p0?.payoutDetails === "fleet@example.com" && money(pv.json?.owedNow?.amount) === 0, JSON.stringify(p0));
    for (const [who, s] of [["manager", manager], ["viewer", viewer]]) {
      const v = await s.req("GET", `/api/fleet/${orgId}/payouts`);
      check(`a ${who} sees the payouts but not the account`, v.status === 200 && money(v.json?.payouts?.[0]?.amount) === owed && !JSON.stringify(v.json).includes("fleet@example.com"), JSON.stringify(v.json?.payouts?.[0]));
      check(`nor on the desk itself`, !JSON.stringify((await s.req("GET", `/api/fleet/${orgId}`)).json).includes("fleet@example.com"));
    }

    section("The operator sends it and has the year's total for the accountant");
    check("a fleet owner cannot mark a payout sent, or read the yearly total", (await owner.req("POST", `/api/admin/fleet-payouts/${payouts[0]?.id}/sent`, {})).status === 403 && (await owner.req("GET", `/api/admin/fleets/${orgId}/earnings-by-year?year=2026`)).status === 403);
    const adminList = await admin.req("GET", `/api/admin/fleets/${orgId}/payouts`);
    check("the admin lists the fleet's payouts with the account to send to", adminList.status === 200 && adminList.json?.payouts?.[0]?.payoutDetails === "fleet@example.com", JSON.stringify(adminList.json?.payouts?.[0]?.status));
    const sent = await admin.req("POST", `/api/admin/fleet-payouts/${payouts[0]?.id}/sent`, {});
    check("the admin marks it sent", sent.status === 200 && sent.json?.status === "sent" && sent.json?.sentBy === FIXTURES.admin.id, JSON.stringify(sent.json));
    check("once", (await admin.req("POST", `/api/admin/fleet-payouts/${payouts[0]?.id}/sent`, {})).status === 409);
    check("the desk shows it sent", (await owner.req("GET", `/api/fleet/${orgId}/payouts`)).json?.payouts?.[0]?.status === "sent");
    const year = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(new Date()));
    const yt = await admin.req("GET", `/api/admin/fleets/${orgId}/earnings-by-year?year=${year}`);
    check("the year's total: what was sent, with the legal name and full EIN", yt.status === 200 && money(yt.json?.paidTotal) >= owed && yt.json?.payoutsSent >= 1 && yt.json?.legalName === "E2E Fleet Motors LLC" && yt.json?.ein === "12-3456789", JSON.stringify(yt.json));
    const nextYear = await admin.req("GET", `/api/admin/fleets/${orgId}/earnings-by-year?year=${year + 1}`);
    check("another year is its own", nextYear.status === 200 && money(nextYear.json?.paidTotal) === 0, JSON.stringify(nextYear.json?.paidTotal));
    // What is waiting to be sent belongs to this year's record only (Cursor Bugbot on #464).
    const waitingKey = `e2e-47-waiting-${Date.now()}`;
    await db.query("INSERT INTO fleet_payouts (organization_id, payday_key, amount, payout_method, payout_details, status) VALUES ($1, $2, '9.00', 'zelle', 'fleet@example.com', 'requested')", [orgId, waitingKey]);
    try {
      const nowRec = await admin.req("GET", `/api/admin/fleets/${orgId}/earnings-by-year?year=${year}`);
      const pastRec = await admin.req("GET", `/api/admin/fleets/${orgId}/earnings-by-year?year=${year - 1}`);
      check("a payout waiting to be sent shows on this year's record", money(nowRec.json?.requestedNotSent) >= 9 && nowRec.json?.payoutsWaiting >= 1, JSON.stringify(nowRec.json?.requestedNotSent));
      check("and never on a past year's", money(pastRec.json?.requestedNotSent) === 0 && pastRec.json?.payoutsWaiting === 0, JSON.stringify(pastRec.json?.requestedNotSent));
    } finally {
      await db.query("DELETE FROM fleet_payouts WHERE payday_key=$1", [waitingKey]).catch(() => {});
    }

    section("Switch off: nothing is split");
    const off = await startServer({ FLEET_ENABLED: "false" });
    try {
      const d = new Session(off.base); await d.login(emailOf(D));
      const r3 = await cardRide();
      check("the driver, still with the fleet's car, completes a ride", (await d.req("POST", `/api/driver/rides/${r3}/complete`, {})).status === 200);
      const row3 = await rideRow(r3);
      check("the ride is not stamped and the driver keeps the whole $17.00", !row3.fleet_car_id && row3.fleet_share === null && money(row3.driver_earnings) === 17, JSON.stringify(row3));
      check("and the fleet is credited nothing", (await fleetRows(r3)).length === 0 && JSON.stringify((await walletRows(r3, "ride_earnings")).map((w) => money(w.amount))) === "[17]");
      const o = new Session(off.base); await o.login(FIXTURES.rider.email);
      check("the earnings and payouts routes do not exist", (await o.req("GET", `/api/fleet/${orgId}/earnings`)).status === 404 && (await o.req("GET", `/api/fleet/${orgId}/payouts`)).status === 404);
    } finally { await stopServer(off); }
  } finally {
    await clearClaims().catch(() => {});
    await db.query("UPDATE fleet_cars SET driver_user_id = NULL WHERE id=$1", [carId]).catch(() => {});
    await db.query("DELETE FROM vehicles WHERE driver_profile_id IN (SELECT id FROM driver_profiles WHERE user_id=$1)", [D]).catch(() => {});
    await db.query("DELETE FROM fleet_earnings WHERE organization_id = ANY($1::varchar[]) OR driver_user_id=$2", [[orgId, otherFleetId], D]).catch(() => {});
    await db.query("DELETE FROM fleet_payouts WHERE organization_id = ANY($1::varchar[])", [[orgId, otherFleetId]]).catch(() => {});
    await deleteRides(db, rideIds).catch((e) => console.log("  (cleanup rides) " + e.message));
    await db.query("DELETE FROM organization_members WHERE user_id = ANY($1::varchar[]) OR organization_id=$2", [[D, M, V], otherFleetId]).catch(() => {});
    await db.query("DELETE FROM organizations WHERE id=$1", [otherFleetId]).catch(() => {});
    await db.query("DELETE FROM payout_requests WHERE driver_id=$1", [D]).catch(() => {});
    await db.query("DELETE FROM wallet_transactions WHERE user_id = ANY($1::varchar[])", [[D, M, V]]).catch(() => {});
    await db.query("DELETE FROM driver_profiles WHERE user_id=$1", [D]).catch(() => {});
    await db.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [[D, M, V]]).catch(() => {});
  }
}
