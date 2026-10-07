import { createServer } from "node:http";
import { Session, check, section, serverLog, startServer, stopServer, FIXTURES, tinyPng } from "./harness.mjs";

/**
 * Car rental money and safety, fixed after the code review of 2026-10-06.
 *
 * Every other rental journey runs against a Stripe that cannot answer, so it
 * can only prove that failures are safe. This one starts its own server
 * pointed at a stand-in for Stripe (STRIPE_API_BASE_FOR_TESTS) that can be
 * told to charge, decline, or take the money and lose the answer, and
 * replays a request under the same idempotency key exactly as Stripe does.
 * It counts the charges that really happened.
 *
 *   RN1  a hand-over whose answer was lost and then pressed again charges
 *        the first week once; two desks at once charge it once; a driver who
 *        cancels gets back what a failed hand-over took from earnings;
 *   RN2  an early hand-over moves the end of the weeks earlier too, and the
 *        sweep never charges a week past it;
 *   RN3  a car whose insurance lapsed is not confirmed, assigned or handed
 *        over, and the desk can call off a confirmed rental;
 *   RN4  a renter whose driving record is no longer cleared is not handed a car;
 *   RN5  a car owner with a pending driver application is paid on payday, once;
 *   RN6  a booking stamped as credited with no credit is paid by the catch-up, once;
 *   RN7  two rentals of one car handed over at once: one goes out;
 *   RN8  a card declined at hand-over and then accepted: a real second try;
 *   RN9  two settlements at once never leave a closed rental marked failed;
 *   D5   a driver whose PG Ride car's rent ran out cannot go online by typing
 *        in a car, and cannot edit the PG Ride car's copy.
 */

/** A small stand-in for the parts of Stripe's API the rental code uses. */
async function stripeStub() {
  const intents = new Map();
  const byKey = new Map();
  const state = { mode: "succeed", delayMs: 0, errorDelayMs: 0, creates: [], refunds: [] };
  let n = 0;
  const parse = (text) => {
    const out = {};
    for (const [k, v] of new URLSearchParams(text)) {
      const m = /^(\w+)\[(\w+)\]$/.exec(k);
      if (m) { out[m[1]] = out[m[1]] ?? {}; out[m[1]][m[2]] = v; } else out[k] = v;
    }
    return out;
  };
  const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json", "request-id": `req_${++n}` }); res.end(JSON.stringify(body)); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const server = createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const url = new URL(req.url, "http://stub");
    const body = parse(raw);
    if (req.method === "POST" && url.pathname === "/v1/payment_intents") {
      const key = req.headers["idempotency-key"];
      if (state.mode === "lose") {
        // Stripe takes the money; the answer never arrives (every retry too).
        if (!byKey.has(key)) {
          const pi = { id: `pi_stub_${++n}`, object: "payment_intent", amount: Number(body.amount), currency: "usd", customer: body.customer, metadata: body.metadata ?? {}, status: body.capture_method === "manual" ? "requires_capture" : "succeeded", created: n };
          intents.set(pi.id, pi); byKey.set(key, { code: 200, body: pi });
          state.creates.push({ key, pi, outcome: pi.status });
        }
        req.socket.destroy();
        return;
      }
      if (state.delayMs) await wait(state.delayMs);
      const done = byKey.get(key);
      if (done) return send(res, done.code, done.body);
      const pi = { id: `pi_stub_${++n}`, object: "payment_intent", amount: Number(body.amount), currency: "usd", customer: body.customer, metadata: body.metadata ?? {}, created: n };
      if (state.mode === "idem") {
        // Stripe refusing to replay a key whose request changed: nothing raised by THIS request.
        return send(res, 400, { error: { type: "idempotency_error", message: "Keys for idempotent requests can only be used with the same parameters they were first used with." } });
      }
      if (state.mode === "processing") {
        pi.status = "processing"; intents.set(pi.id, pi); byKey.set(key, { code: 200, body: { ...pi } }); state.creates.push({ key, pi, outcome: "processing" });
        return send(res, 200, pi);
      }
      if (state.mode === "decline") {
        pi.status = "requires_payment_method"; intents.set(pi.id, pi);
        const err = { error: { type: "card_error", code: "card_declined", decline_code: "insufficient_funds", message: "Your card has insufficient funds.", payment_intent: pi } };
        byKey.set(key, { code: 402, body: err }); state.creates.push({ key, pi, outcome: "declined" });
        return send(res, 402, err);
      }
      pi.status = body.capture_method === "manual" ? "requires_capture" : "succeeded";
      intents.set(pi.id, pi); byKey.set(key, { code: 200, body: pi }); state.creates.push({ key, pi, outcome: pi.status });
      return send(res, 200, pi);
    }
    if (req.method === "GET" && url.pathname === "/v1/payment_intents") {
      const customer = url.searchParams.get("customer");
      const data = [...intents.values()].filter((p) => p.customer === customer).sort((a, b) => b.created - a.created);
      return send(res, 200, { object: "list", data, has_more: false, url: "/v1/payment_intents" });
    }
    const one = /^\/v1\/payment_intents\/([\w]+)(?:\/(capture|cancel))?$/.exec(url.pathname);
    if (one) {
      const pi = intents.get(one[1]);
      if (!pi) return send(res, 404, { error: { type: "invalid_request_error", message: "No such payment_intent" } });
      if (!one[2]) return send(res, 200, pi);
      if (pi.status !== "requires_capture") {
        if (state.errorDelayMs) await wait(state.errorDelayMs);
        return send(res, 400, { error: { type: "invalid_request_error", code: "payment_intent_unexpected_state", message: `This PaymentIntent could not be ${one[2] === "capture" ? "captured" : "canceled"} because it has a status of ${pi.status}.` } });
      }
      pi.status = one[2] === "capture" ? "succeeded" : "canceled";
      if (one[2] === "capture" && body.amount_to_capture) pi.amount_received = Number(body.amount_to_capture);
      return send(res, 200, pi);
    }
    if (req.method === "POST" && url.pathname === "/v1/refunds") {
      state.refunds.push(body.payment_intent);
      return send(res, 200, { id: `re_stub_${++n}`, object: "refund", status: "succeeded", payment_intent: body.payment_intent, amount: 0 });
    }
    send(res, 404, { error: { type: "invalid_request_error", message: `stub has no ${req.method} ${url.pathname}` } });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  /** Charges that took money for one booking or assignment and purpose. */
  const charged = (refId, type) => state.creates.filter((c) => c.pi.metadata.rentalBookingId === refId && c.pi.metadata.type === type && c.outcome !== "declined");
  /** A "processing" charge settles. */
  const settle = (id) => { const pi = intents.get(id); if (pi) pi.status = "succeeded"; };
  return { url, state, charged, settle, close: () => new Promise((r) => server.close(r)) };
}

export async function run({ db }) {
  const stub = await stripeStub();
  const srv = await startServer({ STRIPE_API_BASE_FOR_TESTS: stub.url });
  const base = srv.base;
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const tag = Date.now().toString(36);
  const userIds = [], carIds = [];
  const inDays = (d, h = 10) => { const t = new Date(Date.now() + d * 86400_000); t.setUTCHours(h, 0, 0, 0); return t.toISOString(); };
  const inAYear = inDays(365);
  const upload = async (session) => {
    const up = await session.req("POST", "/api/objects/upload?store=db", {});
    const path = new URL(up.json?.uploadURL ?? "http://x/").pathname;
    return (await session.req("PUT", path, tinyPng(), { "Content-Type": "image/png" })).status === 200 ? path : null;
  };
  const photos = [await upload(admin), await upload(admin), await upload(admin), await upload(admin)];
  let vinN = 0;
  const vin = () => `JTDKARFU0J${String(4000000 + Math.floor(Math.random() * 900000) + (++vinN)).slice(0, 7)}`;
  /** A listed PG Ride fleet car, offered to drivers. */
  const fleetCar = async (plate) => {
    const made = await admin.req("POST", "/api/admin/rental/cars", {
      make: "Toyota", model: "Prius", year: new Date().getUTCFullYear() - 2, color: "Grey", licensePlate: plate, vin: vin(),
      dailyPrice: 50, deposit: 200, weeklyDriverRent: 168, photos, inspectionExpires: inAYear, registrationExpires: inAYear, insuranceExpires: inAYear,
      pickupLocation: { lat: 38.9073, lng: -76.7781, address: "PG Ride lot, Bowie, MD" },
    });
    const id = made.json?.id; carIds.push(id);
    await admin.req("PATCH", `/api/admin/rental/cars/${id}`, { status: "listed" });
    return id;
  };
  /** A driver with a licence and a card on file, signed in. */
  const newDriver = async (name, { balance = 0, insurance = false } = {}) => {
    const id = `e2e-56-${name}-${tag}`; const email = `${id}@example.com`; userIds.push(id);
    await db.query(`INSERT INTO users (id, email, password, first_name, last_name, is_approved, is_driver, phone, registration_completed_at, stripe_customer_id, stripe_payment_method_id, virtual_card_balance)
      SELECT $1, $2, password, $3, 'Review', true, true, '+12405559' || lpad(floor(random()*1000)::text, 3, '0'), NOW(), $4, $5, $6 FROM users WHERE id=$7`,
      [id, email, name, `cus_56_${name}_${tag}`, `pm_56_${name}_${tag}`, balance.toFixed(2), FIXTURES.driver.id]);
    const { rows: [p] } = await db.query(`INSERT INTO driver_profiles (user_id, approval_status, is_online, license_image_url, insurance_image_url) VALUES ($1, 'approved', false, '/api/objects/db-upload/00000000-0000-4000-8000-0000000000c6', $2) RETURNING id`,
      [id, insurance ? "/api/objects/db-upload/00000000-0000-4000-8000-0000000000c6" : null]);
    const s = new Session(base); await s.login(email);
    return { id, profileId: p.id, s };
  };
  /** An assignment the desk has assigned, starting at `startsAt`. */
  const assigned = async (carId, driverId, startsAt, weeks = 1, agreed = false) => {
    const { rows: [a] } = await db.query(`INSERT INTO driver_car_assignments (car_id, driver_user_id, status, starts_at, weeks, ends_at, weekly_rent, rent_from_earnings_agreed_at)
      VALUES ($1, $2, 'assigned', $3::timestamp, $4, $3::timestamp + ($4::int * interval '1 week'), '168.00', $5) RETURNING id`, [carId, driverId, startsAt, weeks, agreed ? new Date() : null]);
    return a.id;
  };
  const handOver = (aId) => admin.req("POST", `/api/admin/rental/assignments/${aId}/handover`, { odometer: 1000, photos });
  /** A public rental already confirmed for the rider, renter's record cleared by the harness. */
  const confirmedRental = async (carId, renterId, startDay) => {
    const { rows: [b] } = await db.query(`INSERT INTO rental_bookings (car_id, renter_id, starts_at, ends_at, days, daily_price, rental_total, deposit, miles_allowed, status, licence_number, licence_image_url)
      VALUES ($1, $2, NOW() + ($3 || ' days')::interval, NOW() + ($3 || ' days')::interval + interval '1 day', 1, 50, 50, 200, 100, 'confirmed', 'M123456789', '/api/objects/db-upload/00000000-0000-4000-8000-0000000000c5') RETURNING id`, [carId, renterId, String(startDay)]);
    return b.id;
  };
  const collect = (bId) => admin.req("POST", `/api/admin/rental/bookings/${bId}/collect`, { odometer: 1000, photos });

  try {
    section("RN1: a hand-over whose answer was lost, pressed again, charges the first week once");
    const car1 = await fleetCar(`PG56A${tag.slice(-2)}`);
    const d1 = await newDriver("lost");
    const a1 = await assigned(car1, d1.id, inDays(1));
    stub.state.mode = "lose";
    const lost = await handOver(a1);
    check("Stripe takes the money but its answer never arrives: the car stays, and the desk is told nothing more will be charged", lost.status === 402 && /No answer from Stripe/.test(lost.json?.message ?? ""), `${lost.status} ${lost.json?.message}`);
    const { rows: [open1] } = await db.query("SELECT status, error FROM driver_rent_charges WHERE assignment_id=$1", [a1]);
    check("the week is left charging with the reason, not failed", open1?.status === "charging" && !!open1?.error, JSON.stringify(open1));
    stub.state.mode = "succeed";
    const again = await handOver(a1);
    check("pressed again, the car goes out", again.status === 200 && again.json?.status === "active", `${again.status} ${again.json?.message}`);
    check("and the first week was charged once, not twice", stub.charged(a1, "rental_driver_rent").length === 1, `${stub.charged(a1, "rental_driver_rent").length} charges`);
    const { rows: rows1 } = await db.query("SELECT status FROM driver_rent_charges WHERE assignment_id=$1", [a1]);
    check("one week row, paid", rows1.length === 1 && rows1[0].status === "paid", JSON.stringify(rows1));

    section("RN1: two desks handing over the same request at once charge once");
    const car2 = await fleetCar(`PG56B${tag.slice(-2)}`);
    const d2 = await newDriver("twodesks");
    const a2 = await assigned(car2, d2.id, inDays(1));
    stub.state.delayMs = 400;
    const [h1, h2] = await Promise.all([handOver(a2), handOver(a2)]);
    stub.state.delayMs = 0;
    const { rows: [copies2] } = await db.query("SELECT count(*)::int AS n FROM vehicles WHERE rental_car_id=$1", [car2]);
    check("exactly one hand-over goes through", [h1, h2].filter((r) => r.status === 200).length === 1 && copies2.n === 1, `${h1.status} ${h2.status} copies ${copies2.n}`);
    check("the first week is charged once and nothing is refunded", stub.charged(a2, "rental_driver_rent").length === 1 && stub.state.refunds.length === 0, `${stub.charged(a2, "rental_driver_rent").length} charges, ${stub.state.refunds.length} refunds`);
    const { rows: [state2] } = await db.query("SELECT status FROM driver_car_assignments WHERE id=$1", [a2]);
    check("and the driver has the car", state2.status === "active", JSON.stringify(state2));

    section("RN1: a driver who cancels gets back what a failed hand-over took from earnings");
    const car3 = await fleetCar(`PG56C${tag.slice(-2)}`);
    const d3 = await newDriver("earnings", { balance: 100 });
    const a3 = await assigned(car3, d3.id, inDays(1), 1, true);
    stub.state.mode = "decline";
    const declined3 = await handOver(a3);
    const { rows: [bal3] } = await db.query("SELECT virtual_card_balance AS b FROM users WHERE id=$1", [d3.id]);
    check("the card declines the other $68; $100 was taken from earnings", declined3.status === 402 && bal3.b === "0.00", `${declined3.status} ${bal3.b}`);
    stub.state.mode = "succeed";
    const cancelled3 = await d3.s.req("POST", "/api/driver/fleet-car/cancel");
    const { rows: [back3] } = await db.query("SELECT virtual_card_balance AS b, (SELECT count(*)::int FROM wallet_transactions WHERE user_id=$1 AND reason='driver_car_rent_refund') AS n FROM users WHERE id=$1", [d3.id]);
    check("they cancel before collection, and the $100 is back in their balance, once", cancelled3.status === 200 && back3.b === "100.00" && back3.n === 1, JSON.stringify({ s: cancelled3.status, ...back3 }));

    section("RN2: an early hand-over moves the end of the weeks earlier, and no week is charged past it");
    const car4 = await fleetCar(`PG56D${tag.slice(-2)}`);
    const d4 = await newDriver("early");
    const a4 = await assigned(car4, d4.id, inDays(3), 2);
    const early = await handOver(a4);
    const { rows: [e4] } = await db.query("SELECT ends_at, paid_through, collected_at FROM driver_car_assignments WHERE id=$1", [a4]);
    const weeks = (d) => (new Date(d).getTime() - new Date(e4.collected_at).getTime()) / (7 * 86400_000);
    check("handed over three days early, the two weeks run from the hand-over", early.status === 200 && Math.abs(weeks(e4.ends_at) - 2) < 1e-6 && Math.abs(weeks(e4.paid_through) - 1) < 1e-6, JSON.stringify({ s: early.status, m: early.json?.message, ends: weeks(e4.ends_at), paid: weeks(e4.paid_through) }));
    // Week two is paid; nothing more is owed.
    await db.query("UPDATE driver_car_assignments SET paid_through = collected_at + interval '14 days' WHERE id=$1", [a4]);
    const before4 = stub.state.creates.length;
    await admin.req("POST", `/api/admin/rental/assignments/${a4}/charge-rent`);
    await admin.req("POST", "/api/admin/analytics/driver-rent-sweep", {});
    const { rows: [rows4] } = await db.query("SELECT count(*)::int AS n FROM driver_rent_charges WHERE assignment_id=$1", [a4]);
    check("with both weeks paid, neither the desk nor the sweep charges a third", rows4.n === 1 && stub.state.creates.length === before4, JSON.stringify({ rows: rows4.n, charges: stub.state.creates.length - before4 }));

    section("RN3: a car whose insurance lapsed does not go out, by either door");
    const car5 = await fleetCar(`PG56E${tag.slice(-2)}`);
    const b5 = await confirmedRental(car5, FIXTURES.rider.id, 2);
    const req5 = await confirmedRental(car5, FIXTURES.rider.id, 5);
    await db.query("UPDATE rental_bookings SET status='requested' WHERE id=$1", [req5]);
    const d5 = await newDriver("lapsed");
    const a5 = await assigned(car5, d5.id, inDays(9));
    const r5 = await db.query(`INSERT INTO driver_car_assignments (car_id, driver_user_id, status, starts_at, weeks, ends_at, weekly_rent) VALUES ($1, $2, 'requested', NOW() + interval '20 days', 1, NOW() + interval '27 days', '168.00') RETURNING id`, [car5, FIXTURES.driver.id]);
    await db.query("UPDATE rental_cars SET insurance_expires = NOW() - interval '1 minute' WHERE id=$1", [car5]);
    const c5 = await collect(b5);
    check("a confirmed rental is not handed over, and the desk is told the insurance lapsed", c5.status === 409 && /Insurance/.test(c5.json?.message ?? "") && stub.charged(b5, "rental_rental").length === 0, `${c5.status} ${c5.json?.message}`);
    const conf5 = await admin.req("POST", `/api/admin/rental/bookings/${req5}/confirm`);
    check("a waiting request is not confirmed", conf5.status === 409 && /Insurance/.test(conf5.json?.message ?? ""), `${conf5.status} ${conf5.json?.message}`);
    const h5 = await handOver(a5);
    check("a driver's assigned car is not handed over", h5.status === 409 && /Insurance/.test(h5.json?.message ?? ""), `${h5.status} ${h5.json?.message}`);
    const as5 = await admin.req("POST", `/api/admin/rental/assignments/${r5.rows[0].id}/assign`);
    check("nor is a driver's request assigned", as5.status === 409 && /Insurance/.test(as5.json?.message ?? ""), `${as5.status} ${as5.json?.message}`);
    const off5 = await admin.req("POST", `/api/admin/rental/bookings/${b5}/decline`, { reason: "Insurance lapsed" });
    check("the desk can call off the confirmed rental", off5.status === 200 && off5.json?.status === "declined", `${off5.status} ${off5.json?.message}`);

    section("RN4: a renter whose driving record is no longer cleared is not handed a car");
    const car6 = await fleetCar(`PG56F${tag.slice(-2)}`);
    const renterId = `e2e-56-renter-${tag}`; userIds.push(renterId);
    await db.query(`INSERT INTO users (id, email, first_name, last_name, is_approved, stripe_customer_id, stripe_payment_method_id) VALUES ($1, $2, 'Rita', 'Renter', true, $3, $4)`, [renterId, `${renterId}@example.com`, `cus_56_r_${tag}`, `pm_56_r_${tag}`]);
    await db.query(`INSERT INTO rental_renters (user_id, date_of_birth, licence_number, licence_issued_on, licence_expires_on, licence_image_url, record_status, record_checked_at)
      VALUES ($1, '1990-01-15', 'R56${tag.slice(-4)}', '2010-03-01', '2035-01-15', '/api/objects/db-upload/00000000-0000-4000-8000-0000000000c5', 'cleared', NOW())`, [renterId]);
    const b6 = await confirmedRental(car6, renterId, 2);
    await admin.req("POST", `/api/admin/rental/renters/${renterId}/record`, { result: "refused", note: "Licence suspended last month" });
    const c6 = await collect(b6);
    check("refused after the rental was confirmed, the car is not handed over and nothing is charged", c6.status === 409 && /driving record/.test(c6.json?.message ?? "") && stub.charged(b6, "rental_rental").length === 0, `${c6.status} ${c6.json?.message}`);
    const { rows: [still6] } = await db.query("SELECT status FROM rental_bookings WHERE id=$1", [b6]);
    check("the confirmed rental itself is left for PG Ride to decide (a pending policy)", still6.status === "confirmed", JSON.stringify(still6));

    section("RN7: two rentals of one car handed over at once: one goes out");
    const car7 = await fleetCar(`PG56G${tag.slice(-2)}`);
    const b7a = await confirmedRental(car7, FIXTURES.rider.id, 1);
    const b7b = await confirmedRental(car7, FIXTURES.rider.id, 3);
    stub.state.delayMs = 400;
    const [x7, y7] = await Promise.all([collect(b7a), collect(b7b)]);
    stub.state.delayMs = 0;
    const { rows: [out7] } = await db.query("SELECT count(*)::int AS n FROM rental_bookings WHERE car_id=$1 AND status='collected'", [car7]);
    check("exactly one is collected; the other is told the car is out", out7.n === 1 && [x7, y7].some((r) => r.status === 409 && /still out/.test(r.json?.message ?? "")), `${x7.status} ${y7.status} ${x7.json?.message ?? ""} ${y7.json?.message ?? ""} collected ${out7.n}`);

    section("RN8: a card declined at hand-over and then accepted is a real second try");
    const car8 = await fleetCar(`PG56H${tag.slice(-2)}`);
    const b8 = await confirmedRental(car8, FIXTURES.rider.id, 2);
    stub.state.mode = "decline";
    const no8 = await collect(b8);
    check("the card declines: the car stays", no8.status === 402, `${no8.status} ${no8.json?.message}`);
    stub.state.mode = "succeed";
    const yes8 = await collect(b8);
    check("the renter tops up the same card and the desk tries again: it goes through", yes8.status === 200 && yes8.json?.status === "collected", `${yes8.status} ${yes8.json?.message}`);
    check("charged once, with a deposit held", stub.charged(b8, "rental_rental").length === 1 && stub.charged(b8, "rental_deposit").length === 1, JSON.stringify(stub.state.creates.filter((c) => c.pi.metadata.rentalBookingId === b8).map((c) => c.outcome)));

    section("RN9: two settlements at once never leave a closed rental marked failed");
    // A deposit held on the stand-in, on a rental just returned owing $30 of it.
    const hold = await fetch(`${stub.url}/v1/payment_intents`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `hold-56-${tag}` },
      body: new URLSearchParams({ amount: "20000", currency: "usd", customer: "cus_e2e", capture_method: "manual", "metadata[type]": "rental_deposit" }).toString() }).then((r) => r.json());
    const dep9 = { deposit_intent_id: hold.id };
    await db.query(`UPDATE rental_bookings SET status='returned', returned_at=NOW(), return_odometer=1100, deposit_intent_id=$3, beyond_deposit_intent_id=NULL, payment_status='charged', payment_error=NULL, settlement=$2::jsonb WHERE id=$1`,
      [b8, JSON.stringify({ fromDeposit: 30, beyondDeposit: 0, depositReleased: 170, extrasTotal: 30 }), hold.id]);
    stub.state.errorDelayMs = 800;
    await Promise.all([admin.req("POST", `/api/admin/rental/bookings/${b8}/settle`), admin.req("POST", `/api/admin/rental/bookings/${b8}/settle`)]);
    stub.state.errorDelayMs = 0;
    const { rows: [s9] } = await db.query("SELECT status, payment_status, payment_error FROM rental_bookings WHERE id=$1", [b8]);
    check("the deposit is captured once and the rental is closed and settled", !!dep9.deposit_intent_id && s9.status === "closed" && s9.payment_status === "settled", JSON.stringify(s9));

    section("Bugbot #474: a charge still processing is waited for, never charged again under a new key");
    const car11 = await fleetCar(`PG56L${tag.slice(-2)}`);
    const b11 = await confirmedRental(car11, FIXTURES.rider.id, 2);
    stub.state.mode = "processing";
    const p11 = await collect(b11);
    check("a rental charge that comes back processing keeps the car here and says why", p11.status === 402 && /processing/.test(p11.json?.message ?? ""), `${p11.status} ${p11.json?.message}`);
    stub.state.mode = "succeed";
    const q11 = await collect(b11);
    check("pressed again while it is still processing, nothing new is sent to the card", q11.status === 402 && stub.charged(b11, "rental_rental").length === 1, `${q11.status} ${q11.json?.message} charges ${stub.charged(b11, "rental_rental").length}`);
    stub.settle(stub.charged(b11, "rental_rental")[0]?.pi.id);
    const r11 = await collect(b11);
    check("once it settles, the hand-over adopts that charge: one charge in all", r11.status === 200 && r11.json?.status === "collected" && stub.charged(b11, "rental_rental").length === 1, `${r11.status} ${r11.json?.message} charges ${stub.charged(b11, "rental_rental").length}`);
    const car12 = await fleetCar(`PG56M${tag.slice(-2)}`);
    const d12 = await newDriver("processing");
    const a12 = await assigned(car12, d12.id, inDays(1));
    stub.state.mode = "processing";
    await handOver(a12);
    stub.state.mode = "succeed";
    const h12 = await handOver(a12);
    check("a driver's first week still processing is not charged again on a second press", h12.status === 402 && stub.charged(a12, "rental_driver_rent").length === 1, `${h12.status} ${h12.json?.message} charges ${stub.charged(a12, "rental_driver_rent").length}`);
    const car13 = await fleetCar(`PG56N${tag.slice(-2)}`);
    const d13 = await newDriver("idem");
    const a13 = await assigned(car13, d13.id, inDays(1));
    stub.state.mode = "idem";
    const i13 = await handOver(a13);
    stub.state.mode = "succeed";
    const { rows: [w13] } = await db.query("SELECT status, attempt, error FROM driver_rent_charges WHERE assignment_id=$1", [a13]);
    check("an idempotency error is not a decline: the week stays open on the same attempt, and the desk is told", i13.status === 402 && w13?.status === "charging" && w13?.attempt === 1, JSON.stringify(w13));

    section("Bugbot #474: a hand-over whose answer was lost, then declined or cancelled, gives the money back");
    const car14 = await fleetCar(`PG56P${tag.slice(-2)}`);
    const b14 = await confirmedRental(car14, FIXTURES.rider.id, 2);
    const b15 = await confirmedRental(car14, FIXTURES.rider.id, 5);
    stub.state.mode = "lose";
    await collect(b14);
    await collect(b15);
    stub.state.mode = "succeed";
    const lost14 = stub.charged(b14, "rental_rental")[0]?.pi.id, lost15 = stub.charged(b15, "rental_rental")[0]?.pi.id;
    const off14 = await admin.req("POST", `/api/admin/rental/bookings/${b14}/decline`, { reason: "Called off" });
    check("the desk declines: the charge Stripe took without answering is refunded", off14.status === 200 && !!lost14 && stub.state.refunds.includes(lost14), `${off14.status} refunds ${JSON.stringify(stub.state.refunds)} lost ${lost14}`);
    const off15 = await rider.req("POST", `/api/rent/bookings/${b15}/cancel`, { reason: "Plans changed" });
    check("the renter cancels: the same, and the booking says refunded", off15.status === 200 && !!lost15 && stub.state.refunds.includes(lost15) && off15.json?.paymentStatus === "refunded", `${off15.status} ${off15.json?.paymentStatus} lost ${lost15}`);

    section("RN5: a car owner with a pending driver application is paid on payday, once");
    const ownerId = `e2e-56-owner-${tag}`; const bothId = `e2e-56-both-${tag}`; userIds.push(ownerId, bothId);
    for (const [id, bal] of [[ownerId, "90.00"], [bothId, "120.00"]]) {
      await db.query(`INSERT INTO users (id, email, first_name, last_name, is_approved, virtual_card_balance) VALUES ($1, $2, 'Owen', 'Owner', true, $3)`, [id, `${id}@example.com`, bal]);
      await db.query(`INSERT INTO rental_owner_profiles (user_id, payout_method, payout_details) VALUES ($1, 'zelle', 'owner@example.com')`, [id]);
      await db.query(`INSERT INTO wallet_transactions (user_id, amount, balance_after, reason, ride_id) VALUES ($1, $2, $2, 'rental_owner_earnings', $3)`, [id, bal, `bk-${id}`]);
    }
    await db.query(`INSERT INTO driver_profiles (user_id, approval_status) VALUES ($1, 'pending')`, [ownerId]);
    await db.query(`INSERT INTO driver_profiles (user_id, approval_status, payout_method, payout_details) VALUES ($1, 'approved', 'zelle', 'driver@example.com')`, [bothId]);
    const payday = await admin.req("POST", "/api/admin/analytics/payday", { at: "2032-03-05T15:00:00Z" });
    const { rows: reqs } = await db.query("SELECT driver_id, amount, payout_details FROM payout_requests WHERE driver_id = ANY($1::varchar[]) ORDER BY driver_id", [[ownerId, bothId]]);
    const ownerReq = reqs.filter((r) => r.driver_id === ownerId), bothReq = reqs.filter((r) => r.driver_id === bothId);
    check("the owner whose driver application is still pending is paid their $90 to their owner payout", payday.status === 200 && ownerReq.length === 1 && ownerReq[0].amount === "90.00" && ownerReq[0].payout_details === "owner@example.com", JSON.stringify({ s: payday.status, reqs }));
    check("an approved driver who also owns a car is paid once, through the driver row", bothReq.length === 1 && bothReq[0].payout_details === "driver@example.com", JSON.stringify(bothReq));

    section("RN6: a booking marked credited with no credit on the ledger is paid by the catch-up, once");
    const { rows: [pcar] } = await db.query(`INSERT INTO rental_cars (owner_kind, owner_user_id, make, model, year, color, license_plate, daily_price, status, review_status)
      VALUES ('private', $1, 'Honda', 'Fit', 2022, 'Blue', $2, 40, 'hidden', 'approved') RETURNING id`, [ownerId, `PG56Q${tag.slice(-2)}`]);
    carIds.push(pcar.id);
    const { rows: [pb] } = await db.query(`INSERT INTO rental_bookings (car_id, renter_id, starts_at, ends_at, days, daily_price, rental_total, deposit, status, licence_number, licence_image_url, owner_credited_at, owner_share, platform_share)
      VALUES ($1, $2, NOW() - interval '3 days', NOW() - interval '1 day', 2, 40, 80, 200, 'closed', 'M123456789', '/api/objects/db-upload/00000000-0000-4000-8000-0000000000c5', NOW() - interval '2 hours', 72.00, 8.00) RETURNING id`, [pcar.id, FIXTURES.rider.id]);
    await admin.req("POST", "/api/admin/analytics/rental-sweep", {});
    await admin.req("POST", "/api/admin/analytics/rental-sweep", {});
    const { rows: [led6] } = await db.query("SELECT count(*)::int AS n, COALESCE(SUM(amount::numeric), 0)::text AS total FROM wallet_transactions WHERE ride_id=$1 AND reason='rental_owner_earnings'", [pb.id]);
    check("the owner is credited the $72 the stamp recorded, once across two sweeps", led6.n === 1 && Number(led6.total) === 72, JSON.stringify(led6));

    section("D5: a typed-in car does not put a driver whose PG Ride car's rent ran out back online");
    const d9 = await newDriver("typedin");
    const car9 = await fleetCar(`PG56J${tag.slice(-2)}`);
    const { rows: [copy9] } = await db.query(`INSERT INTO vehicles (driver_profile_id, make, model, year, color, license_plate, vehicle_type, rental_car_id) VALUES ($1, 'Toyota', 'Prius', 2024, 'Grey', 'PG56J', 'standard', $2) RETURNING id`, [d9.profileId, car9]);
    await db.query(`INSERT INTO driver_car_assignments (car_id, driver_user_id, status, starts_at, weeks, ends_at, weekly_rent, collected_at, vehicle_id, paid_through, payment_status)
      VALUES ($1, $2, 'active', NOW() - interval '8 days', 2, NOW() + interval '6 days', '168.00', NOW() - interval '8 days', $3, NOW() - interval '1 day', 'due')`, [car9, d9.id, copy9.id]);
    const blocked9 = await d9.s.req("POST", "/api/driver/toggle-status", { isOnline: true });
    check("with the rent unpaid, they cannot go online", blocked9.status === 403, `${blocked9.status} ${blocked9.json?.message}`);
    const typed = await d9.s.req("POST", "/api/vehicles", { make: "Ford", model: "Imaginary", year: 2023, color: "Red", licensePlate: "FAKE56", rentalCarId: "nope", fleetCarId: "nope", isEv: true, vehicleType: "suv" });
    const { rows: [t9] } = await db.query("SELECT rental_car_id, fleet_car_id, is_ev, vehicle_type FROM vehicles WHERE id=$1", [typed.json?.id]);
    check("a car they type in is saved as their own description only: no PG Ride or fleet mark, no EV, no class", typed.status === 200 && t9 && !t9.rental_car_id && !t9.fleet_car_id && t9.is_ev === false && t9.vehicle_type === "standard", JSON.stringify({ s: typed.status, t9 }));
    // And a plain typed-in car, no marks at all: still not a car they may drive on alone.
    await d9.s.req("POST", "/api/vehicles", { make: "Ford", model: "Imaginary", year: 2023, color: "Red", licensePlate: "FAKE57" });
    const still9 = await d9.s.req("POST", "/api/driver/toggle-status", { isOnline: true });
    await d9.s.req("POST", "/api/driver/toggle-status", { isOnline: false });
    check("and with no insurance of their own on file it does not let them go online", still9.status === 403 && /rent/.test(still9.json?.message ?? ""), `${still9.status} ${still9.json?.message}`);
    const edit9 = await d9.s.req("PUT", `/api/vehicles/${copy9.id}`, { licensePlate: "HACKED1" });
    check("nor can they edit the PG Ride car's copy", edit9.status === 409, `${edit9.status} ${edit9.json?.message}`);
    const insured = await newDriver("insured", { insurance: true });
    const car10 = await fleetCar(`PG56K${tag.slice(-2)}`);
    const { rows: [copy10] } = await db.query(`INSERT INTO vehicles (driver_profile_id, make, model, year, color, license_plate, vehicle_type, rental_car_id) VALUES ($1, 'Toyota', 'Prius', 2024, 'Grey', 'PG56K', 'standard', $2) RETURNING id`, [insured.profileId, car10]);
    await db.query(`INSERT INTO driver_car_assignments (car_id, driver_user_id, status, starts_at, weeks, ends_at, weekly_rent, collected_at, vehicle_id, paid_through, payment_status)
      VALUES ($1, $2, 'active', NOW() - interval '8 days', 2, NOW() + interval '6 days', '168.00', NOW() - interval '8 days', $3, NOW() - interval '1 day', 'due')`, [car10, insured.id, copy10.id]);
    await insured.s.req("POST", "/api/vehicles", { make: "Honda", model: "Accord", year: 2021, color: "Black", licensePlate: "OWN56" });
    const own10 = await insured.s.req("POST", "/api/driver/toggle-status", { isOnline: true });
    await insured.s.req("POST", "/api/driver/toggle-status", { isOnline: false });
    check("a driver with their own car and their own insurance on file is not affected", own10.status === 200, `${own10.status} ${own10.json?.message}`);
  } finally {
    stopServer(srv);
    await stub.close();
    const ids = userIds;
    await db.query("DELETE FROM payout_requests WHERE driver_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM wallet_transactions WHERE user_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM driver_rent_charges WHERE assignment_id IN (SELECT id FROM driver_car_assignments WHERE car_id = ANY($1::varchar[]))", [carIds]).catch(() => {});
    await db.query("UPDATE driver_car_assignments SET vehicle_id=NULL WHERE car_id = ANY($1::varchar[])", [carIds]).catch(() => {});
    await db.query("DELETE FROM driver_car_assignments WHERE car_id = ANY($1::varchar[])", [carIds]).catch(() => {});
    await db.query("DELETE FROM vehicles WHERE driver_profile_id IN (SELECT id FROM driver_profiles WHERE user_id = ANY($1::varchar[]))", [ids]).catch(() => {});
    await db.query("DELETE FROM rental_bookings WHERE car_id = ANY($1::varchar[])", [carIds]).catch(() => {});
    await db.query("DELETE FROM rental_cars WHERE id = ANY($1::varchar[])", [carIds]).catch(() => {});
    await db.query("DELETE FROM rental_renters WHERE user_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM rental_owner_profiles WHERE user_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM driver_profiles WHERE user_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("UPDATE rental_renters SET record_status='cleared', record_checked_at=NOW() WHERE user_id=$1", [FIXTURES.rider.id]).catch(() => {});
  }
}
