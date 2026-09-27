import { Session, check, section, serverLog, FIXTURES, tinyPng, tinyPdf } from "./harness.mjs";

/**
 * Private owners list their own cars (Car Rental Master Plan, phase 2;
 * Festus 2026-09-27: owners are paid weekly, PG Ride keeps 10% of every
 * transaction and the owner gets the rest).
 *
 * An owner lists a car with its papers; it cannot list until PG Ride checks
 * them; the owner says how to be paid and lists it; a renter finds it as a
 * private car and asks for it; the owner accepts and runs the rental; when
 * it closes the owner is credited 90% of what it collected, exactly once;
 * the Friday payday pays them. A private car is never offered to drivers,
 * and changing what the car is sends it back to be checked.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const renter = new Session(base); await renter.login(FIXTURES.rider.email);
  const owner = new Session(base); await owner.csrf();
  const stranger = new Session(base); await stranger.login(FIXTURES.driver.email);
  const email = `e2e-owner-${Date.now()}@example.com`;
  const ids = [], carIds = [];
  const logShows = async (re) => { for (let i = 0; i < 25; i++) { if (re.test(serverLog(server))) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
  const upload = async (session, pdf = false) => {
    const up = await session.req("POST", "/api/objects/upload?store=db", {});
    const path = new URL(up.json?.uploadURL ?? "http://x/").pathname;
    return (await session.req("PUT", path, pdf ? tinyPdf() : tinyPng(), { "Content-Type": pdf ? "application/pdf" : "image/png" })).status === 200 ? path : null;
  };
  const inDays = (d) => { const t = new Date(Date.now() + d * 86400_000); t.setUTCHours(10, 0, 0, 0); return t.toISOString(); };
  const inAYear = inDays(365);
  const { rows: [cardBefore] } = await db.query("SELECT stripe_customer_id, stripe_payment_method_id FROM users WHERE id=$1", [FIXTURES.rider.id]);
  await db.query("UPDATE users SET stripe_customer_id='cus_e2e_own', stripe_payment_method_id='pm_e2e_own' WHERE id=$1", [FIXTURES.rider.id]);

  try {
    section("An owner lists their car with its papers");
    await owner.req("POST", "/api/auth/signup", { email, password: "Str0ng!Pass123", firstName: "Ola", lastName: "Owner", phone: "2405550188", termsAccepted: true, privacyAccepted: true });
    const { rows: [user] } = await db.query("SELECT id FROM users WHERE email=$1", [email]);
    ids.push(user.id);
    await admin.req("POST", `/api/admin/users/${user.id}/approve`, {});
    await owner.login(email, "Str0ng!Pass123");
    const photos = [await upload(owner), await upload(owner), await upload(owner), await upload(owner)];
    const papers = { registrationDocUrl: await upload(owner, true), insuranceDocUrl: await upload(owner), inspectionDocUrl: await upload(owner, true), ownershipDocUrl: await upload(owner, true) };
    const driverRent = await owner.req("POST", "/api/rent/my-cars", { make: "Honda", model: "Accord", year: new Date().getUTCFullYear() - 3, color: "Black", licensePlate: "OWN4001", dailyPrice: 60, weeklyDriverRent: 200 });
    check("an owner cannot offer their car to drivers", driverRent.status === 403 && /Only PG Ride's own cars/.test(driverRent.json?.message ?? ""), JSON.stringify(driverRent.json));
    const made = await owner.req("POST", "/api/rent/my-cars", {
      make: "Honda", model: "Accord", year: new Date().getUTCFullYear() - 3, color: "Black", seats: 5, licensePlate: "OWN4001", vin: "1HGCV1F30LA000001",
      dailyPrice: 60, deposit: 100, milesPerDay: 0, photos, ...papers, inspectionExpires: inAYear, registrationExpires: inAYear, insuranceExpires: inAYear,
      pickupLocation: { lat: 38.9073, lng: -76.7781, address: "12 Elm St, Bowie, MD" },
    });
    const carId = made.json?.id; carIds.push(carId);
    check("the car is taken as a private car, hidden, waiting for PG Ride's check", made.status === 200 && made.json?.ownerKind === "private" && made.json?.reviewStatus === "pending" && made.json?.status === "hidden", JSON.stringify(made.json?.message ?? made.json?.reviewStatus));
    check("PG Ride is paged to check it", await logShows(/A private car to check/));
    const early = await owner.req("PATCH", `/api/rent/my-cars/${carId}`, { status: "listed" });
    check("listing before saying how to be paid is refused", early.status === 409 && /how you want to be paid/.test(early.json?.message ?? ""), JSON.stringify(early.json));
    check("the owner says how to be paid", (await owner.req("PUT", "/api/rent/owner-payout", { payoutMethod: "zelle", payoutDetails: email })).status === 200);
    const unchecked = await owner.req("PATCH", `/api/rent/my-cars/${carId}`, { status: "listed" });
    check("and still cannot list until PG Ride has checked the papers", unchecked.status === 409 && (unchecked.json?.problems ?? []).some((p) => /has not checked the papers/.test(p)), JSON.stringify(unchecked.json?.problems));
    check("someone else cannot touch the owner's car", (await stranger.req("PATCH", `/api/rent/my-cars/${carId}`, { dailyPrice: 1 })).status === 404);

    section("PG Ride checks the papers");
    check("sending back needs a note", (await admin.req("POST", `/api/admin/rental/cars/${carId}/review`, { decision: "reject" })).status === 400);
    const back = await admin.req("POST", `/api/admin/rental/cars/${carId}/review`, { decision: "reject", note: "Registration photo is blurry" });
    check("PG Ride sends it back with a note the owner sees", back.status === 200 && back.json?.reviewStatus === "rejected" && ((await owner.req("GET", "/api/rent/my-cars")).json?.cars?.[0]?.reviewNote === "Registration photo is blurry"));
    const newReg = await upload(owner);
    check("the owner sends a new photo, which puts it back in the queue", (await owner.req("PATCH", `/api/rent/my-cars/${carId}`, { registrationDocUrl: newReg })).json?.reviewStatus === "pending");
    check("PG Ride accepts the papers", (await admin.req("POST", `/api/admin/rental/cars/${carId}/review`, { decision: "approve" })).json?.reviewStatus === "approved");
    const listed = await owner.req("PATCH", `/api/rent/my-cars/${carId}`, { status: "listed" });
    check("the owner lists it", listed.status === 200 && listed.json?.status === "listed", JSON.stringify(listed.json?.problems ?? listed.json?.status));

    section("Changing what the car is sends it back to be checked; a price change does not");
    const repriced = await owner.req("PATCH", `/api/rent/my-cars/${carId}`, { dailyPrice: 65 });
    check("a new price keeps it listed", repriced.json?.status === "listed" && repriced.json?.reviewStatus === "approved", JSON.stringify({ s: repriced.json?.status, r: repriced.json?.reviewStatus }));
    const replated = await owner.req("PATCH", `/api/rent/my-cars/${carId}`, { licensePlate: "OWN4002" });
    check("a new plate takes it off the list until PG Ride checks again", replated.json?.status === "hidden" && replated.json?.reviewStatus === "pending", JSON.stringify({ s: replated.json?.status, r: replated.json?.reviewStatus }));
    await admin.req("POST", `/api/admin/rental/cars/${carId}/review`, { decision: "approve" });
    check("once checked again it can be listed", (await owner.req("PATCH", `/api/rent/my-cars/${carId}`, { status: "listed" })).json?.status === "listed");

    section("A renter finds it as a private car; drivers never see it");
    const found = ((await renter.req("GET", `/api/rent/cars?from=${encodeURIComponent(inDays(3))}&to=${encodeURIComponent(inDays(4))}`)).json ?? []).find((c) => c.id === carId);
    check("the renter sees it as a private owner's car at the owner's price", found?.ownerKind === "private" && found?.dailyPrice === "65.00", JSON.stringify(found));
    check("a driver asking for a PG Ride car is never offered it", !((await stranger.req("GET", "/api/driver/fleet-cars")).json?.cars ?? []).some((c) => c.id === carId));
    const licence = await upload(renter);
    const asked = await renter.req("POST", "/api/rent/bookings", { carId, startsAt: inDays(3), endsAt: inDays(5), licenceNumber: "M123456789", licenceImageUrl: licence });
    check("the renter asks for it for 2 days", asked.status === 200 && asked.json?.rentalTotal === "130.00", JSON.stringify(asked.json?.message ?? asked.json?.rentalTotal));
    const bId = asked.json?.id;
    check("PG Ride's page says the owner accepts it", await logShows(/Car rental requested[\s\S]*owner accepts or declines in My cars/));

    section("The owner runs the rental of their own car");
    const theirs = await owner.req("GET", "/api/rent/my-cars/bookings");
    const row = (theirs.json ?? []).find((b) => b.id === bId);
    check("the owner sees the request with the renter's first name and licence, and no payment ids", row?.renter?.firstName && row?.licenceNumber === "M123456789" && !("chargeIntentId" in (row ?? {})), JSON.stringify(row && Object.keys(row)));
    check("and may open the renter's licence photo", (await owner.req("GET", licence)).status === 200);
    check("someone else cannot accept it", (await stranger.req("POST", `/api/rent/my-cars/bookings/${bId}/confirm`)).status === 404);
    check("the owner accepts it", (await owner.req("POST", `/api/rent/my-cars/bookings/${bId}/confirm`)).json?.status === "confirmed");
    const handPhotos = [await upload(owner), await upload(owner), await upload(owner), await upload(owner)];
    const hand = await owner.req("POST", `/api/rent/my-cars/bookings/${bId}/collect`, { odometer: 30000, photos: handPhotos });
    check("the owner's hand-over charges the renter first; when that fails, the car stays", hand.status === 402, `${hand.status} ${hand.json?.message}`);
    // Stand in for a hand-over whose charge went through, with no deposit hold
    // left to settle (Stripe is unreachable here), ending on time.
    await db.query(`UPDATE rental_bookings SET status='collected', collected_at=NOW() - interval '2 days', collect_odometer=30000, collect_photos=$2::jsonb, charge_intent_id='pi_e2e_own', deposit_intent_id=NULL, payment_status='charged', payment_error=NULL, starts_at=NOW() - interval '2 days', ends_at=NOW() + interval '10 minutes' WHERE id=$1`, [bId, JSON.stringify(handPhotos)]);
    const midRental = await owner.req("PATCH", `/api/rent/my-cars/${carId}`, { licensePlate: "OWN9999" });
    check("while the car is out, the owner cannot change what it is", midRental.status === 409 && /out on a rental/.test(midRental.json?.message ?? ""), `${midRental.status} ${midRental.json?.message}`);
    const returned = await owner.req("POST", `/api/rent/my-cars/bookings/${bId}/return`, { odometer: 30120, photos: handPhotos });
    check("the owner takes it back on time and the rental closes", returned.status === 200 && returned.json?.status === "closed", JSON.stringify(returned.json?.message ?? returned.json?.status));

    section("The owner is credited 90% of what the rental collected, once");
    const { rows: [shares] } = await db.query("SELECT owner_share, platform_share, owner_credited_at FROM rental_bookings WHERE id=$1", [bId]);
    check("PG Ride keeps $13.00 (10%) of $130.00, the owner is credited $117.00", shares.owner_share === "117.00" && shares.platform_share === "13.00" && shares.owner_credited_at, JSON.stringify(shares));
    const { rows: [bal] } = await db.query("SELECT virtual_card_balance FROM users WHERE id=$1", [user.id]);
    const { rows: ledger } = await db.query("SELECT amount FROM wallet_transactions WHERE user_id=$1 AND reason='rental_owner_earnings'", [user.id]);
    check("the credit is on the owner's balance and ledger", Number(bal.virtual_card_balance) === 117 && ledger.length === 1 && ledger[0].amount === "117.00", JSON.stringify({ bal: bal.virtual_card_balance, ledger }));
    await admin.req("POST", "/api/admin/analytics/rental-sweep", {});
    await owner.req("POST", `/api/rent/my-cars/bookings/${bId}/settle`).catch(() => {});
    const { rows: ledger2 } = await db.query("SELECT amount FROM wallet_transactions WHERE user_id=$1 AND reason='rental_owner_earnings'", [user.id]);
    check("the sweep and a retried settlement do not pay it twice", ledger2.length === 1, `${ledger2.length} credits`);
    const theirsNow = ((await owner.req("GET", "/api/rent/my-cars/bookings")).json ?? []).find((b) => b.id === bId);
    check("the owner sees what they were credited", theirsNow?.ownerShare === "117.00", JSON.stringify(theirsNow?.ownerShare));

    section("Friday's payday pays the owner their car earnings, and only those");
    // A refund that lands in the same balance is the owner's own money as a
    // rider, not car earnings: payday must not pay it out.
    await db.query("UPDATE users SET virtual_card_balance = virtual_card_balance + 40 WHERE id=$1", [user.id]);
    await db.query("INSERT INTO wallet_transactions (user_id, amount, balance_after, reason) VALUES ($1, 40.00, 157.00, 'dispute_refund')", [user.id]);
    const payday = await admin.req("POST", "/api/admin/analytics/payday", { at: "2031-01-10T15:00:00Z" });
    const line = (payday.json?.paid ?? []).find((l) => l.driverId === user.id);
    check("the owner, who is not a driver, is paid their $117 of car earnings to their Zelle", payday.status === 200 && line?.amount === 117 && line?.method === "zelle", JSON.stringify(payday.json?.paid?.map((l) => [l.name, l.amount]) ?? payday.json));
    const { rows: [req] } = await db.query("SELECT amount, payout_method FROM payout_requests WHERE driver_id=$1", [user.id]);
    const { rows: [after] } = await db.query("SELECT virtual_card_balance FROM users WHERE id=$1", [user.id]);
    check("a payout request for the car earnings is raised; the $40 refund stays in the balance", req?.amount === "117.00" && Number(after.virtual_card_balance) === 40, JSON.stringify({ req, bal: after.virtual_card_balance }));
  } finally {
    await db.query("DELETE FROM payout_requests WHERE driver_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM wallet_transactions WHERE user_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM rental_bookings WHERE car_id = ANY($1::varchar[])", [carIds]).catch(() => {});
    await db.query("DELETE FROM rental_cars WHERE id = ANY($1::varchar[])", [carIds]).catch(() => {});
    await db.query("DELETE FROM rental_owner_profiles WHERE user_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("UPDATE users SET stripe_customer_id=$2, stripe_payment_method_id=$3 WHERE id=$1", [FIXTURES.rider.id, cardBefore?.stripe_customer_id ?? null, cardBefore?.stripe_payment_method_id ?? null]).catch(() => {});
  }
}
