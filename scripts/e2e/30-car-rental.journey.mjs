import { Session, check, section, serverLog, startServer, stopServer, FIXTURES, tinyPng } from "./harness.mjs";

/**
 * Car rental, phase 1 (PG Ride Car Rental Master Plan): PG Ride lists its own
 * cars, the public rents them by the day, and money moves only at the desk.
 *
 * Walks it end to end over the real API: the switch, an admin listing a car
 * only once it qualifies, a renter finding, pricing and requesting it, the
 * overlap rule under two admins' confirmations, who may see which photo,
 * collection refusing to hand over a car whose rental could not be charged,
 * a return that is recorded and priced whatever the card does, and the
 * sweep taking a car off the list the hour its insurance lapses.
 *
 * Stripe is a fake key here, so no charge can succeed: the journey proves
 * that failures are safe and said out loud; the arithmetic is unit-tested in
 * shared/rental.test.ts.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const other = new Session(base); await other.login(FIXTURES.driver.email);
  const carIds = [];
  const upload = async (session) => {
    const up = await session.req("POST", "/api/objects/upload?store=db", {});
    const path = new URL(up.json?.uploadURL ?? "http://x/").pathname;
    const put = await session.req("PUT", path, tinyPng(), { "Content-Type": "image/png" });
    return put.status === 200 ? path : null;
  };
  const inDays = (d, h = 10) => { const t = new Date(Date.now() + d * 86400_000); t.setUTCHours(h, 0, 0, 0); return t.toISOString(); };
  const inAYear = inDays(365);
  const { rows: [cardBefore] } = await db.query("SELECT stripe_customer_id, stripe_payment_method_id FROM users WHERE id=$1", [FIXTURES.rider.id]);
  await db.query("UPDATE users SET stripe_customer_id='cus_e2e_rent', stripe_payment_method_id='pm_e2e_rent' WHERE id = ANY($1::varchar[])", [[FIXTURES.rider.id, FIXTURES.driver.id]]);

  try {
    section("Off means off");
    const off = await startServer({ RENTAL_ENABLED: "false" });
    try {
      const offRider = new Session(off.base); await offRider.login(FIXTURES.rider.email);
      const offAdmin = new Session(off.base); await offAdmin.login(FIXTURES.admin.email);
      check("with the switch off, a renter's rental routes do not exist", (await offRider.req("GET", "/api/rent/cars")).status === 404);
      check("nor the admin's", (await offAdmin.req("GET", "/api/admin/rental/cars")).status === 404);
      const cfg = await offRider.req("GET", "/api/payment/config");
      check("and the app is told so, so the buttons stay hidden", cfg.json?.rentalEnabled === false, JSON.stringify(cfg.json?.rentalEnabled));
    } finally { await stopServer(off); }
    check("with it on, the app is told so", (await rider.req("GET", "/api/payment/config")).json?.rentalEnabled === true);

    section("A car is listed only once it qualifies");
    const bare = await admin.req("POST", "/api/admin/rental/cars", { make: "Toyota", model: "Corolla", year: new Date().getUTCFullYear() - 1, color: "White", licensePlate: "PGR7001", dailyPrice: 45, deposit: 150, milesPerDay: 100, extraMileFee: 0.5, lateHourFee: 12 });
    check("an admin adds a fleet car; it starts hidden", bare.status === 200 && bare.json?.status === "hidden" && bare.json?.ownerKind === "fleet", JSON.stringify(bare.json?.message ?? bare.json?.status));
    const carId = bare.json?.id; carIds.push(carId);
    const tooSoon = await admin.req("PATCH", `/api/admin/rental/cars/${carId}`, { status: "listed" });
    check("listing it before its papers are in is refused, naming every gap", tooSoon.status === 409 && ["VIN", "photos", "inspection", "Registration", "Insurance", "Pick-up"].every((w) => (tooSoon.json?.problems ?? []).join(" ").includes(w)), JSON.stringify(tooSoon.json?.problems));
    const riderPhoto = await upload(rider);
    const notYours = await admin.req("PATCH", `/api/admin/rental/cars/${carId}`, { photos: [riderPhoto] });
    check("a photo someone else uploaded cannot be put on a car", notYours.status === 403, `${notYours.status} ${notYours.json?.message}`);
    const photos = [await upload(admin), await upload(admin), await upload(admin), await upload(admin)];
    check("the admin uploads four photos to PG Ride's own store", photos.every(Boolean));
    const ready = await admin.req("PATCH", `/api/admin/rental/cars/${carId}`, {
      vin: "2T1BURHE5JC000001", photos, inspectionExpires: inAYear, registrationExpires: inAYear, insuranceExpires: inAYear,
      pickupLocation: { lat: 38.9073, lng: -76.7781, address: "PG Ride lot, Bowie, MD" }, status: "listed",
    });
    check("with its papers in, it lists", ready.status === 200 && ready.json?.status === "listed", JSON.stringify(ready.json?.problems ?? ready.json?.message ?? ready.json?.status));
    const byRider = await rider.req("POST", "/api/admin/rental/cars", { make: "X" });
    check("a rider cannot list a car through the admin door", byRider.status === 403, `${byRider.status}`);

    section("A renter finds it, sees the price, and asks for it");
    const from = inDays(3), to = new Date(new Date(from).getTime() + 50 * 3600_000).toISOString();
    const list = await rider.req("GET", `/api/rent/cars?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    const shown = (list.json ?? []).find((c) => c.id === carId);
    check("the listed car is offered for those dates", list.status === 200 && !!shown, `${list.status} ${(list.json ?? []).length} cars`);
    check("without its VIN or plate", shown && !("vin" in shown) && !("licensePlate" in shown), JSON.stringify(Object.keys(shown ?? {})));
    const q = await rider.req("POST", "/api/rent/quote", { carId, startsAt: from, endsAt: to });
    check("50 hours is 3 days at the car's own price, with its deposit and miles", q.status === 200 && q.json?.quote?.days === 3 && q.json?.quote?.rentalTotal === 135 && q.json?.quote?.deposit === 150 && q.json?.quote?.milesAllowed === 300 && q.json?.available === true, JSON.stringify(q.json?.quote ?? q.json));
    const long = await rider.req("POST", "/api/rent/quote", { carId, startsAt: from, endsAt: inDays(12) });
    check("longer than six days is refused with the reason", long.status === 400 && /up to 6 days/.test(long.json?.message ?? ""), JSON.stringify(long.json));
    const photoSeen = await rider.req("GET", photos[0]);
    check("a renter may see a listed car's photo", photoSeen.status === 200, `${photoSeen.status}`);
    const noLicence = await rider.req("POST", "/api/rent/bookings", { carId, startsAt: from, endsAt: to, licenceNumber: "M123456789" });
    check("a request without a licence photo is refused", noLicence.status === 400 && /licence photo/i.test(noLicence.json?.message ?? ""), JSON.stringify(noLicence.json));
    const licence = await upload(rider);
    const asked = await rider.req("POST", "/api/rent/bookings", { carId, startsAt: from, endsAt: to, licenceNumber: "m123456789", licenceImageUrl: licence, rentalTotal: 1 });
    check("a request with a licence is taken, priced by the server, and charges nothing", asked.status === 200 && asked.json?.status === "requested" && asked.json?.rentalTotal === "135.00" && asked.json?.paymentStatus === "none" && asked.json?.licenceNumber === "M123456789", JSON.stringify(asked.json?.message ?? { s: asked.json?.status, t: asked.json?.rentalTotal }));
    check("and the renter is never shown payment ids", asked.json && !("chargeIntentId" in asked.json) && !("depositIntentId" in asked.json));
    const bookingId = asked.json?.id;
    await new Promise((r) => setTimeout(r, 300));
    check("PG Ride is paged to confirm it", /\[ops-alert\][\s\S]*Car rental requested/.test(serverLog(server)));

    section("Only one rental holds a car for any hour");
    const otherLicence = await upload(other);
    const clash = await other.req("POST", "/api/rent/bookings", { carId, startsAt: inDays(4), endsAt: inDays(5), licenceNumber: "D987654321", licenceImageUrl: otherLicence });
    check("a second person may ask for overlapping days while the first is only a request", clash.status === 200 && clash.json?.status === "requested", JSON.stringify(clash.json?.message ?? clash.json?.status));
    const [c1, c2] = await Promise.all([
      admin.req("POST", `/api/admin/rental/bookings/${bookingId}/confirm`),
      admin.req("POST", `/api/admin/rental/bookings/${clash.json?.id}/confirm`),
    ]);
    const wins = [c1, c2].filter((r) => r.status === 200).length;
    check("two admins confirming both at once: exactly one wins, the other is told why", wins === 1 && [c1, c2].some((r) => r.status === 409 && /already confirmed/.test(r.json?.message ?? "")), `${c1.status} ${c2.status}`);
    if (c1.status !== 200) {
      // Make the rider's booking the confirmed one for the rest of the journey.
      await db.query("UPDATE rental_bookings SET status='requested' WHERE id=$1", [clash.json?.id]);
      await db.query("UPDATE rental_bookings SET status='confirmed' WHERE id=$1", [bookingId]);
    }
    const declined = await admin.req("POST", `/api/admin/rental/bookings/${clash.json?.id}/decline`, { reason: "Car taken" });
    check("the other request is declined, and nothing was charged", declined.status === 200 && declined.json?.status === "declined" && declined.json?.paymentStatus === "none", JSON.stringify(declined.json?.message ?? declined.json?.status));
    const gone = await rider.req("GET", `/api/rent/cars?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    check("a confirmed car is no longer offered for those days", !(gone.json ?? []).some((c) => c.id === carId));
    const later = await rider.req("GET", `/api/rent/cars?from=${encodeURIComponent(inDays(20))}&to=${encodeURIComponent(inDays(21))}`);
    check("but is for other days", (later.json ?? []).some((c) => c.id === carId));

    section("Each renter sees only their own");
    const mine = await rider.req("GET", "/api/rent/bookings");
    check("the renter sees their rental", (mine.json ?? []).some((b) => b.id === bookingId));
    const theirs = await other.req("GET", "/api/rent/bookings");
    check("another renter does not", !(theirs.json ?? []).some((b) => b.id === bookingId));
    check("nor can they cancel it", (await other.req("POST", `/api/rent/bookings/${bookingId}/cancel`)).status === 404);
    check("nor see its licence photo", (await other.req("GET", licence)).status === 403);
    check("while its renter can", (await rider.req("GET", licence)).status === 200);

    section("No charge, no hand-over");
    const handPhotos = [await upload(admin), await upload(admin), await upload(admin), await upload(admin)];
    const fewPhotos = await admin.req("POST", `/api/admin/rental/bookings/${bookingId}/collect`, { odometer: 10000, photos: handPhotos.slice(0, 2) });
    check("hand-over needs four photos of the car", fewPhotos.status === 400 && /4 photos/.test(fewPhotos.json?.message ?? ""), JSON.stringify(fewPhotos.json));
    const collect = await admin.req("POST", `/api/admin/rental/bookings/${bookingId}/collect`, { odometer: 10000, photos: handPhotos });
    check("when the rental cannot be charged, the car is not handed over, and the desk is told why", collect.status === 402 && /could not be charged/.test(collect.json?.message ?? ""), `${collect.status} ${collect.json?.message}`);
    const { rows: [afterCollect] } = await db.query("SELECT status, payment_error, charge_intent_id FROM rental_bookings WHERE id=$1", [bookingId]);
    check("it stays confirmed, with the reason on it and no charge recorded", afterCollect.status === "confirmed" && /declined/.test(afterCollect.payment_error ?? "") && !afterCollect.charge_intent_id, JSON.stringify(afterCollect));
    await new Promise((r) => setTimeout(r, 300));
    check("and ops are paged", /Rental charge declined at collection/.test(serverLog(server)));

    section("One car is out on one rental at a time");
    const nextLicence = licence;
    const next = await rider.req("POST", "/api/rent/bookings", { carId, startsAt: inDays(8), endsAt: inDays(9), licenceNumber: "M123456789", licenceImageUrl: nextLicence });
    check("the next rental is requested and confirmed", next.status === 200 && (await admin.req("POST", `/api/admin/rental/bookings/${next.json?.id}/confirm`)).status === 200, JSON.stringify(next.json?.message ?? next.json?.status));
    await db.query("UPDATE rental_bookings SET status='collected', collect_odometer=9000 WHERE id=$1", [bookingId]);
    const early = await admin.req("POST", `/api/admin/rental/bookings/${next.json?.id}/collect`, { odometer: 10000, photos: handPhotos });
    check("while the last rental is still out, the next cannot be handed over", early.status === 409 && /still out on the previous rental/.test(early.json?.message ?? ""), `${early.status} ${early.json?.message}`);
    await rider.req("POST", `/api/rent/bookings/${next.json?.id}/cancel`);

    section("A return is recorded and priced whatever the card does");
    // Stand in for a collection whose charge and deposit hold went through
    // (Stripe is unreachable here), two days ago.
    await db.query(`UPDATE rental_bookings SET status='collected', collected_at=NOW() - interval '50 hours', collect_odometer=10000, collect_photos=$2::jsonb,
      charge_intent_id='pi_e2e_rent', deposit_intent_id='pi_e2e_dep', payment_status='charged', payment_error=NULL,
      starts_at=NOW() - interval '50 hours', ends_at=NOW() - interval '150 minutes' WHERE id=$1`, [bookingId, JSON.stringify(handPhotos)]);
    const noNote = await admin.req("POST", `/api/admin/rental/bookings/${bookingId}/return`, { odometer: 10400, photos: handPhotos, damageAmount: 80 });
    check("damage without saying what it is is refused", noNote.status === 400 && /Say what the damage is/.test(noNote.json?.message ?? ""), JSON.stringify(noNote.json));
    const backwards = await admin.req("POST", `/api/admin/rental/bookings/${bookingId}/return`, { odometer: 9000, photos: handPhotos });
    check("an odometer that went backwards is refused", backwards.status === 400, JSON.stringify(backwards.json));
    const back = await admin.req("POST", `/api/admin/rental/bookings/${bookingId}/return`, { odometer: 10400, photos: handPhotos, damageAmount: 80, damageNote: "Scratch on rear bumper" });
    const s = back.json?.settlement ?? {};
    // 400 miles on 300 allowed at $0.50 = $50; 2.5 hours late = 3 hours at $12 = $36; damage $80 → $166 on a $150 deposit.
    check("the return is priced from the booking: extra miles, late hours past the grace hour, and damage", back.status === 200 && s.extraMiles === 100 && s.extraMilesCharge === 50 && s.lateHours === 3 && s.lateCharge === 36 && s.damage === 80 && s.extrasTotal === 166 && s.fromDeposit === 150 && s.depositReleased === 0 && s.beyondDeposit === 16, JSON.stringify(s));
    check("the car is back even though the card could not be settled", back.json?.status === "returned" && back.json?.paymentStatus === "failed" && /Settlement failed/.test(back.json?.paymentError ?? ""), JSON.stringify({ st: back.json?.status, ps: back.json?.paymentStatus, e: back.json?.paymentError }));
    await new Promise((r) => setTimeout(r, 300));
    check("and ops are paged to retry it", /Rental settlement FAILED/.test(serverLog(server)));
    const retry = await admin.req("POST", `/api/admin/rental/bookings/${bookingId}/settle`);
    check("a retry is safe: it answers, still returned, still failed", retry.status === 200 && retry.json?.status === "returned" && retry.json?.paymentStatus === "failed", JSON.stringify({ s: retry.status, st: retry.json?.status }));
    const seenBack = (await rider.req("GET", "/api/rent/bookings")).json?.find((b) => b.id === bookingId);
    check("the renter sees the damage and what it cost", seenBack?.damageNote === "Scratch on rear bumper" && seenBack?.settlement?.extrasTotal === 166);

    section("Cancelling before collection is free");
    const second = await rider.req("POST", "/api/rent/bookings", { carId, startsAt: inDays(20), endsAt: inDays(21), licenceNumber: "M123456789", licenceImageUrl: licence });
    const cancelled = await rider.req("POST", `/api/rent/bookings/${second.json?.id}/cancel`, { reason: "Plans changed" });
    check("the renter cancels a request and nothing was charged", cancelled.status === 200 && cancelled.json?.status === "cancelled" && cancelled.json?.paymentStatus === "none", JSON.stringify(cancelled.json?.message ?? cancelled.json?.status));
    check("a returned rental cannot be cancelled", (await rider.req("POST", `/api/rent/bookings/${bookingId}/cancel`)).status === 409);

    section("The sweep takes a car off the list the hour its insurance lapses");
    await db.query("UPDATE rental_cars SET insurance_expires = NOW() - interval '1 minute' WHERE id=$1", [carId]);
    const sweep = await admin.req("POST", "/api/admin/analytics/rental-sweep", {});
    check("the sweep hides it", sweep.status === 200 && sweep.json?.hidden >= 1, JSON.stringify(sweep.json));
    const { rows: [hiddenCar] } = await db.query("SELECT status, hidden_reason FROM rental_cars WHERE id=$1", [carId]);
    check("and says why", hiddenCar.status === "hidden" && /Insurance/.test(hiddenCar.hidden_reason ?? ""), JSON.stringify(hiddenCar));
    check("renters no longer see it", !((await rider.req("GET", "/api/rent/cars")).json ?? []).some((c) => c.id === carId));
    check("nor can they request it", (await rider.req("POST", "/api/rent/quote", { carId, startsAt: inDays(30), endsAt: inDays(31) })).status === 404);
    await new Promise((r) => setTimeout(r, 300));
    check("ops are told which car and why", /Rental car taken off the list[\s\S]*Insurance/.test(serverLog(server)));
  } finally {
    await db.query("DELETE FROM rental_bookings WHERE car_id = ANY($1::varchar[])", [carIds]).catch(() => {});
    await db.query("DELETE FROM rental_cars WHERE id = ANY($1::varchar[])", [carIds]).catch(() => {});
    await db.query("UPDATE users SET stripe_customer_id=$2, stripe_payment_method_id=$3 WHERE id=$1", [FIXTURES.rider.id, cardBefore?.stripe_customer_id ?? null, cardBefore?.stripe_payment_method_id ?? null]).catch(() => {});
    await db.query("UPDATE users SET stripe_customer_id=NULL, stripe_payment_method_id=NULL WHERE id=$1", [FIXTURES.driver.id]).catch(() => {});
  }
}
