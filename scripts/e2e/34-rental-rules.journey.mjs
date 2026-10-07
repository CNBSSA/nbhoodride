import { Session, check, section, serverLog, FIXTURES, tinyPng } from "./harness.mjs";

/**
 * The industry-standard rental rules (Festus 2026-09-28: "just copy industry
 * standards and practices"; rules in shared/rental.ts, adopted in the Car
 * Rental Master Plan's decisions):
 *
 *   - a deposit between $100 and $1,000, $250 when left blank;
 *   - a renter 21 or older, licence held a year (two under 25) and valid
 *     through the return; under 25, a young-renter fee of $25 a day;
 *   - a driving-record check before the first rental, recorded by PG Ride:
 *     no rental is confirmed without it; a refusal declines what is waiting
 *     and is shown to the renter; a new licence is a new check;
 *   - a driver may have rent taken from earnings first, once per week, the
 *     card for the rest, and a retry never takes twice;
 *   - a driver who keeps a PG Ride car past their weeks pays every hour
 *     started at the weekly rent / 168, from earnings first.
 *
 * Stripe is a fake key here, so no card charge succeeds: the journey proves
 * what is taken from earnings, what is left for the card, and that failures
 * are said out loud. The arithmetic is unit-tested in shared/rental.test.ts.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const young = new Session(base); await young.csrf();
  const email = `e2e-young-${Date.now()}@example.com`;
  const ids = [], carIds = [];
  const logShows = async (re) => { for (let i = 0; i < 25; i++) { if (re.test(serverLog(server))) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
  const upload = async (session) => {
    const up = await session.req("POST", "/api/objects/upload?store=db", {});
    const path = new URL(up.json?.uploadURL ?? "http://x/").pathname;
    return (await session.req("PUT", path, tinyPng(), { "Content-Type": "image/png" })).status === 200 ? path : null;
  };
  const inDays = (d, h = 10) => { const t = new Date(Date.now() + d * 86400_000); t.setUTCHours(h, 0, 0, 0); return t.toISOString(); };
  const yearsAgo = (y, extraDays = 0) => { const t = new Date(inDays(3)); t.setUTCFullYear(t.getUTCFullYear() - y); return new Date(t.getTime() - extraDays * 86400_000).toISOString().slice(0, 10); };
  const inAYear = inDays(365);
  const { rows: [driverBefore] } = await db.query("SELECT stripe_customer_id, stripe_payment_method_id, virtual_card_balance FROM users WHERE id=$1", [FIXTURES.driver.id]);

  try {
    section("A deposit is between $100 and $1,000, and $250 when left blank");
    const base0 = { make: "Kia", model: "Forte", year: new Date().getUTCFullYear() - 1, color: "Red", licensePlate: "PGR3401", dailyPrice: 40, weeklyDriverRent: 168 };
    const low = await admin.req("POST", "/api/admin/rental/cars", { ...base0, deposit: 50 });
    check("a $50 deposit is refused with the limits", low.status === 400 && /between \$100\.00 and \$1000\.00/.test(low.json?.message ?? ""), JSON.stringify(low.json));
    const high = await admin.req("POST", "/api/admin/rental/cars", { ...base0, deposit: 2500 });
    check("so is $2,500", high.status === 400, JSON.stringify(high.json));
    const blank = await admin.req("POST", "/api/admin/rental/cars", { ...base0, deposit: "" });
    check("left blank, it is $250", blank.status === 200 && blank.json?.deposit === "250.00", JSON.stringify(blank.json?.message ?? blank.json?.deposit));
    const carId = blank.json?.id; carIds.push(carId);
    const photos = [await upload(admin), await upload(admin), await upload(admin), await upload(admin)];
    const listed = await admin.req("PATCH", `/api/admin/rental/cars/${carId}`, {
      vin: "KNAFK4A60F5000001", photos, inspectionExpires: inAYear, registrationExpires: inAYear, insuranceExpires: inAYear,
      pickupLocation: { lat: 38.9073, lng: -76.7781, address: "PG Ride lot, Bowie, MD" }, status: "listed",
    });
    check("with its papers in, it lists", listed.status === 200 && listed.json?.status === "listed", JSON.stringify(listed.json?.problems ?? listed.json?.message));
    await db.query("UPDATE rental_cars SET deposit='0.00' WHERE id=$1", [carId]);
    const lapsed = await admin.req("POST", "/api/admin/analytics/rental-sweep", {});
    const { rows: [hidden] } = await db.query("SELECT status, hidden_reason FROM rental_cars WHERE id=$1", [carId]);
    check("a car whose deposit falls outside the limits stops being listed", lapsed.status === 200 && hidden.status === "hidden" && /Deposit has to be between/.test(hidden.hidden_reason ?? ""), JSON.stringify(hidden));
    await admin.req("PATCH", `/api/admin/rental/cars/${carId}`, { deposit: 250, status: "listed" });

    section("Who may rent: 21 and over, a licence held long enough, valid through the return");
    await young.req("POST", "/api/auth/signup", { email, password: "Str0ng!Pass123", firstName: "Tobi", lastName: "Young", phone: "2405550191", termsAccepted: true, privacyAccepted: true });
    const { rows: [user] } = await db.query("SELECT id FROM users WHERE email=$1", [email]);
    ids.push(user.id);
    await admin.req("POST", `/api/admin/users/${user.id}/approve`, {});
    await young.login(email, "Str0ng!Pass123");
    await db.query("UPDATE users SET stripe_customer_id='cus_e2e_young', stripe_payment_method_id='pm_e2e_young' WHERE id=$1", [user.id]);
    const licence = await upload(young);
    const from = inDays(3), to = inDays(5);
    const ask = (extra) => young.req("POST", "/api/rent/bookings", { carId, startsAt: from, endsAt: to, licenceNumber: "Y1234567", licenceImageUrl: licence, ...extra });
    const noPhoto = await young.req("POST", "/api/rent/bookings", { carId, startsAt: from, endsAt: to, licenceNumber: "Y1234567", dateOfBirth: yearsAgo(30), licenceIssuedOn: yearsAgo(5), licenceExpiresOn: "2031-01-01" });
    check("a first-time renter without a licence photo is refused", noPhoto.status === 400 && /licence photo/i.test(noPhoto.json?.message ?? ""), JSON.stringify(noPhoto.json));
    const noDob = await ask({});
    check("a first request without a date of birth is refused, saying so", noDob.status === 400 && /date of birth/.test(noDob.json?.message ?? ""), JSON.stringify(noDob.json));
    const twenty = await ask({ dateOfBirth: yearsAgo(20), licenceIssuedOn: yearsAgo(3), licenceExpiresOn: "2031-01-01" });
    check("20 on the first day is refused: renters are at least 21", twenty.status === 400 && /at least 21/.test(twenty.json?.message ?? ""), JSON.stringify(twenty.json));
    const newLicence = await ask({ dateOfBirth: yearsAgo(23), licenceIssuedOn: yearsAgo(1, 30), licenceExpiresOn: "2031-01-01" });
    check("under 25 with a licence held under two years is refused", newLicence.status === 400 && /Under 25.*2 years/.test(newLicence.json?.message ?? ""), JSON.stringify(newLicence.json));
    const expiring = await ask({ dateOfBirth: yearsAgo(23), licenceIssuedOn: yearsAgo(3), licenceExpiresOn: from.slice(0, 10) });
    check("a licence that expires before the return is refused", expiring.status === 400 && /expires before the rental ends/.test(expiring.json?.message ?? ""), JSON.stringify(expiring.json));

    section("Under 25, a young-renter fee of $25 a day, charged with the rental");
    const q = await young.req("POST", "/api/rent/quote", { carId, startsAt: from, endsAt: to, dateOfBirth: yearsAgo(23) });
    check("the quote carries $50 for two days, in the total", q.status === 200 && q.json?.quote?.youngRenterFee === 50 && q.json?.quote?.rentalTotal === 130 && q.json?.ageKnown === true, JSON.stringify(q.json?.quote ?? q.json));
    const asked = await ask({ dateOfBirth: yearsAgo(23), licenceIssuedOn: yearsAgo(3), licenceExpiresOn: "2031-01-01", rentalTotal: 1 });
    check("a 23-year-old with three years of licence may ask, priced by the server with the fee", asked.status === 200 && asked.json?.status === "requested" && asked.json?.youngRenterFee === "50.00" && asked.json?.rentalTotal === "130.00", JSON.stringify(asked.json?.message ?? asked.json));
    check("PG Ride is paged that the driving record is not checked yet", await logShows(/Car rental requested[\s\S]*Young-renter fee[\s\S]*NOT CHECKED/));
    const again = await young.req("POST", "/api/rent/quote", { carId, startsAt: inDays(8), endsAt: inDays(9) });
    check("the date of birth is kept: the next quote has the fee without asking", again.json?.quote?.youngRenterFee === 25, JSON.stringify(again.json?.quote));
    const adultQuote = await rider.req("POST", "/api/rent/quote", { carId, startsAt: from, endsAt: to });
    check("a renter over 25 pays no such fee", adultQuote.json?.quote?.youngRenterFee === 0 && adultQuote.json?.quote?.rentalTotal === 80, JSON.stringify(adultQuote.json?.quote));

    section("No rental is confirmed before PG Ride clears the driving record");
    const early = await admin.req("POST", `/api/admin/rental/bookings/${asked.json?.id}/confirm`);
    check("confirming is refused and says why", early.status === 409 && /driving record/.test(early.json?.message ?? ""), `${early.status} ${early.json?.message}`);
    const list = await admin.req("GET", "/api/admin/rental/renters");
    const row = (list.json?.renters ?? []).find((r) => r.userId === user.id);
    check("the renter is on the desk's list to check, with their licence and the standard to check against", row?.needsCheck === true && row?.licenceNumber === "Y1234567" && /DUI/.test(list.json?.standard ?? ""), JSON.stringify(row));
    check("a rider cannot record a check", (await rider.req("POST", `/api/admin/rental/renters/${user.id}/record`, { result: "cleared" })).status === 403);
    const noNote = await admin.req("POST", `/api/admin/rental/renters/${user.id}/record`, { result: "refused" });
    check("refusing needs the reason the renter is shown", noNote.status === 400, JSON.stringify(noNote.json));
    const refused = await admin.req("POST", `/api/admin/rental/renters/${user.id}/record`, { result: "refused", note: "Two speeding tickets this year" });
    check("the desk refuses with a reason", refused.status === 200 && refused.json?.recordStatus === "refused", JSON.stringify(refused.json));
    const { rows: [declined] } = await db.query("SELECT status, cancel_reason FROM rental_bookings WHERE id=$1", [asked.json?.id]);
    check("what was waiting is declined, with the reason", declined.status === "declined" && /Two speeding tickets/.test(declined.cancel_reason ?? ""), JSON.stringify(declined));
    const me = await young.req("GET", "/api/rent/me");
    check("the renter sees their record did not clear, and why", me.json?.renter?.recordStatus === "refused" && /speeding/.test(me.json?.renter?.recordNote ?? ""), JSON.stringify(me.json?.renter));
    const blocked = await ask({});
    check("and cannot ask again on the same licence", blocked.status === 403 && /driving record/.test(blocked.json?.message ?? ""), JSON.stringify(blocked.json));
    const renewed = await ask({ licenceNumber: "Y7654321", licenceIssuedOn: yearsAgo(3) });
    check("a new licence is a new check: the request is taken, waiting for it", renewed.status === 200 && renewed.json?.status === "requested", JSON.stringify(renewed.json?.message ?? renewed.json?.status));
    check("and the record is back to waiting", (await young.req("GET", "/api/rent/me")).json?.renter?.recordStatus === "pending");
    const cleared = await admin.req("POST", `/api/admin/rental/renters/${user.id}/record`, { result: "cleared" });
    check("the desk records the new licence's record cleared", cleared.status === 200 && cleared.json?.recordStatus === "cleared" && !!cleared.json?.recordCheckedAt, JSON.stringify(cleared.json));
    const ok = await admin.req("POST", `/api/admin/rental/bookings/${renewed.json?.id}/confirm`);
    check("and now the rental is confirmed", ok.status === 200 && ok.json?.status === "confirmed", `${ok.status} ${ok.json?.message}`);
    await young.req("POST", `/api/rent/bookings/${renewed.json?.id}/cancel`);

    section("A driver's rent from earnings first, once a week, the card for the rest");
    // A PG Ride car with the fixture driver for a week, as if handed over (Stripe is unreachable here).
    // Its three weeks end exactly three paid weeks after the paid week began: rent is charged by the whole week only (code review 2026-10-06).
    await db.query("UPDATE users SET stripe_customer_id='cus_e2e_drv', stripe_payment_method_id='pm_e2e_drv', virtual_card_balance='100.00' WHERE id=$1", [FIXTURES.driver.id]);
    const { rows: [a] } = await db.query(`INSERT INTO driver_car_assignments (car_id, driver_user_id, status, starts_at, weeks, ends_at, weekly_rent, collected_at, collect_odometer, paid_through, payment_status)
      VALUES ($1, $2, 'active', NOW() - interval '7 days', 3, NOW() + interval '14 days 10 minutes', '168.00', NOW() - interval '7 days', 1000, NOW() + interval '10 minutes', 'paid') RETURNING id`, [carId, FIXTURES.driver.id]);
    const agreed = await driver.req("POST", "/api/driver/fleet-car/rent-from-earnings", { agree: true });
    check("the driver agrees to rent from earnings", agreed.status === 200 && !!agreed.json?.rentFromEarningsAgreedAt, JSON.stringify(agreed.json?.message ?? agreed.json?.rentFromEarningsAgreedAt));
    check("another driver's agreement is theirs alone", (await rider.req("POST", "/api/driver/fleet-car/rent-from-earnings", { agree: true })).status === 404);
    const week2 = await admin.req("POST", `/api/admin/rental/assignments/${a.id}/charge-rent`);
    const { rows: [w2] } = await db.query("SELECT id, status, from_earnings FROM driver_rent_charges WHERE assignment_id=$1", [a.id]);
    const { rows: [bal1] } = await db.query("SELECT virtual_card_balance AS b FROM users WHERE id=$1", [FIXTURES.driver.id]);
    check("the week takes the $100 in earnings, and the card is asked for the other $68", week2.status === 200 && w2?.from_earnings === "100.00" && bal1.b === "0.00" && ["failed", "charging"].includes(w2?.status), JSON.stringify({ w2, b: bal1.b }));
    check("the card failing leaves the rent due, said out loud", week2.json?.paymentStatus === "due" && await logShows(/Driver car rent FAILED/), JSON.stringify(week2.json?.paymentError));
    await db.query("UPDATE users SET virtual_card_balance='500.00' WHERE id=$1", [FIXTURES.driver.id]);
    await admin.req("POST", `/api/admin/rental/assignments/${a.id}/charge-rent`);
    const { rows: [bal2] } = await db.query("SELECT virtual_card_balance AS b, (SELECT count(*)::int FROM wallet_transactions WHERE ride_id=$2 AND reason='driver_car_rent') AS n FROM users WHERE id=$1", [FIXTURES.driver.id, w2.id]);
    check("a retry of that week asks the card again but never takes earnings twice", bal2.b === "500.00" && bal2.n === 1, JSON.stringify(bal2));
    // That week settles by hand; the next is due now, and earnings cover all of it.
    await db.query("UPDATE driver_rent_charges SET status='paid', stripe_payment_intent_id='pi_e2e_rest' WHERE id=$1", [w2.id]);
    await db.query("UPDATE driver_car_assignments SET paid_through = (SELECT period_start FROM driver_rent_charges WHERE id=$2) + interval '7 days', payment_status='paid', payment_error=NULL WHERE id=$1", [a.id, w2.id]);
    const week3 = await admin.req("POST", `/api/admin/rental/assignments/${a.id}/charge-rent`);
    const { rows: [bal3] } = await db.query("SELECT virtual_card_balance AS b FROM users WHERE id=$1", [FIXTURES.driver.id]);
    check("a week the earnings cover is paid without touching the card", week3.json?.paymentStatus === "paid" && bal3.b === "332.00", JSON.stringify({ p: week3.json?.paymentStatus, e: week3.json?.paymentError, b: bal3.b }));
    const mine = await driver.req("GET", "/api/driver/fleet-car");
    check("the driver sees their rent comes from earnings", !!mine.json?.rentFromEarningsAgreedAt, JSON.stringify(mine.json?.rentFromEarningsAgreedAt));

    section("A driver who keeps the car past their weeks pays every hour started");
    await db.query("UPDATE driver_car_assignments SET ends_at = NOW() - interval '90 minutes' WHERE id=$1", [a.id]);
    await db.query("UPDATE users SET virtual_card_balance='1.00' WHERE id=$1", [FIXTURES.driver.id]);
    const backPhotos = [await upload(admin), await upload(admin), await upload(admin), await upload(admin)];
    const back = await admin.req("POST", `/api/admin/rental/assignments/${a.id}/takeback`, { odometer: 1500, photos: backPhotos });
    check("90 minutes late is 2 hours at $168/168 = $2.00", back.status === 200 && back.json?.status === "ended" && back.json?.lateHours === 2 && back.json?.lateCharge === "2.00", JSON.stringify({ s: back.status, m: back.json?.message, h: back.json?.lateHours, c: back.json?.lateCharge }));
    check("$1.00 comes from earnings and the card is asked for the rest, failing out loud", back.json?.returnFromEarnings === "1.00" && /Return charge failed \(\$1\.00 was taken from earnings\)/.test(back.json?.paymentError ?? ""), JSON.stringify({ e: back.json?.returnFromEarnings, p: back.json?.paymentError }));
    check("ops are paged with the late hours", await logShows(/Driver car return charge FAILED[\s\S]*2 h, \$2\.00/));
    const retry = await admin.req("POST", `/api/admin/rental/assignments/${a.id}/charge-damage`);
    const { rows: [ret] } = await db.query("SELECT count(*)::int AS n FROM wallet_transactions WHERE ride_id=$1 AND reason='driver_car_return'", [a.id]);
    check("a retry never takes earnings twice", retry.status === 200 && ret.n === 1, JSON.stringify({ s: retry.status, n: ret.n }));
    const withdraw = await driver.req("POST", "/api/driver/fleet-car/rent-from-earnings", { agree: false });
    check("with no car any more, there is nothing to agree to", withdraw.status === 404, JSON.stringify(withdraw.json));
  } finally {
    await db.query("DELETE FROM wallet_transactions WHERE user_id=$1 AND reason IN ('driver_car_rent','driver_car_return','driver_car_rent_refund')", [FIXTURES.driver.id]).catch(() => {});
    await db.query("DELETE FROM driver_rent_charges WHERE assignment_id IN (SELECT id FROM driver_car_assignments WHERE car_id = ANY($1::varchar[]))", [carIds]).catch(() => {});
    await db.query("DELETE FROM driver_car_assignments WHERE car_id = ANY($1::varchar[])", [carIds]).catch(() => {});
    await db.query("DELETE FROM rental_bookings WHERE car_id = ANY($1::varchar[])", [carIds]).catch(() => {});
    await db.query("DELETE FROM rental_cars WHERE id = ANY($1::varchar[])", [carIds]).catch(() => {});
    await db.query("DELETE FROM rental_renters WHERE user_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("UPDATE users SET stripe_customer_id=$2, stripe_payment_method_id=$3, virtual_card_balance=$4 WHERE id=$1",
      [FIXTURES.driver.id, driverBefore?.stripe_customer_id ?? null, driverBefore?.stripe_payment_method_id ?? null, driverBefore?.virtual_card_balance ?? "0.00"]).catch(() => {});
  }
}
