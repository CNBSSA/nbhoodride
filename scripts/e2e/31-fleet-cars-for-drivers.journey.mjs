import { Session, check, section, serverLog, FIXTURES, tinyPng } from "./harness.mjs";

/**
 * A driver with no car drives a PG Ride car (Car Rental Master Plan,
 * phase 3; only PG Ride's own fleet cars go to drivers, Festus 2026-09-27).
 *
 * Someone signs up and applies to drive with only a licence. They ask for a
 * PG Ride car by the week; approval accepts that car in place of their own
 * insurance and car photos; the desk assigns and hands it over, and the
 * first week's rent is charged; the car becomes their vehicle for riders and
 * dispatch; they may go online only while the rent is paid; the sweep
 * charges the next week; the car is taken back and stops being theirs.
 *
 * Stripe is a fake key here, so no charge can succeed: the journey proves
 * the refusals and stands in for the successful charge.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const applicant = new Session(base); await applicant.csrf();
  const email = `e2e-fleet-driver-${Date.now()}@example.com`;
  const ids = [], carIds = [];
  const logShows = async (re) => { for (let i = 0; i < 25; i++) { if (re.test(serverLog(server))) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
  const upload = async (session) => {
    const up = await session.req("POST", "/api/objects/upload?store=db", {});
    const path = new URL(up.json?.uploadURL ?? "http://x/").pathname;
    return (await session.req("PUT", path, tinyPng(), { "Content-Type": "image/png" })).status === 200 ? path : null;
  };
  const inDays = (d) => { const t = new Date(Date.now() + d * 86400_000); t.setUTCHours(10, 0, 0, 0); return t.toISOString(); };
  const inAYear = inDays(365);

  try {
    section("PG Ride offers a fleet car to drivers");
    const photos = [await upload(admin), await upload(admin), await upload(admin), await upload(admin)];
    const made = await admin.req("POST", "/api/admin/rental/cars", {
      make: "Toyota", model: "Prius", year: new Date().getUTCFullYear() - 2, color: "Grey", licensePlate: "PGD3001", vin: "JTDKARFU0J3000001",
      dailyPrice: 55, deposit: 200, weeklyDriverRent: 260, photos, inspectionExpires: inAYear, registrationExpires: inAYear, insuranceExpires: inAYear,
      pickupLocation: { lat: 38.9073, lng: -76.7781, address: "PG Ride lot, Bowie, MD" },
    });
    const carId = made.json?.id; carIds.push(carId);
    check("a fleet car with a weekly driver rent is added and listed", made.status === 200 && made.json?.weeklyDriverRent === "260.00" && (await admin.req("PATCH", `/api/admin/rental/cars/${carId}`, { status: "listed" })).status === 200, JSON.stringify(made.json?.message ?? made.json?.weeklyDriverRent));

    section("Someone with a licence and no car applies");
    const signup = await applicant.req("POST", "/api/auth/signup", { email, password: "Str0ng!Pass123", firstName: "Femi", lastName: "Fleet", phone: "2405550177", termsAccepted: true, privacyAccepted: true });
    const { rows: [user] } = await db.query("SELECT id FROM users WHERE email=$1", [email]);
    ids.push(user.id);
    check("they sign up and are approved as a person", signup.status === 200 && (await admin.req("POST", `/api/admin/users/${user.id}/approve`, {})).status === 200);
    await applicant.login(email, "Str0ng!Pass123");
    await db.query("UPDATE users SET stripe_customer_id='cus_e2e_fleet', stripe_payment_method_id='pm_e2e_fleet' WHERE id=$1", [user.id]);
    const early = await applicant.req("POST", "/api/driver/fleet-car/request", { carId, startsAt: inDays(2), weeks: 2 });
    check("asking for a car before applying to drive is refused", early.status === 403 && /Apply to drive first/.test(early.json?.message ?? ""), JSON.stringify(early.json));
    check("they apply to drive", (await applicant.req("POST", "/api/driver/profile", { licenseNumber: "F1234567", licenseState: "MD" })).status === 200);
    const noLicence = await applicant.req("POST", "/api/driver/fleet-car/request", { carId, startsAt: inDays(2), weeks: 2 });
    check("and without a licence photo they are told to upload it", noLicence.status === 400 && /licence/.test(noLicence.json?.message ?? ""), JSON.stringify(noLicence.json));
    const licence = await upload(applicant);
    check("they upload their licence", (await applicant.req("PUT", "/api/driver/profile", { licenseImageUrl: licence })).status === 200);
    const refused = await admin.req("PATCH", `/api/admin/drivers/${user.id}`, { approvalStatus: "approved" });
    check("with no car of their own and no PG Ride car, approval still asks for insurance and a car", refused.status === 400 && ["insurance image", "vehicle photos / vehicle record"].every((m) => (refused.json?.missing ?? []).includes(m)), JSON.stringify(refused.json?.missing));

    section("They ask for a PG Ride car by the week");
    const offered = await applicant.req("GET", `/api/driver/fleet-cars?from=${encodeURIComponent(inDays(2))}&to=${encodeURIComponent(inDays(16))}`);
    check("the car is offered with its weekly rent, and no plate", (offered.json?.cars ?? []).some((c) => c.id === carId && c.weeklyRent === "260.00" && !("licensePlate" in c)), JSON.stringify(offered.json?.cars?.map((c) => c.id)));
    check("the public rental seed car, not offered to drivers, is not", !(offered.json?.cars ?? []).some((c) => c.id === "e2e-rental-car"));
    const tooLong = await applicant.req("POST", "/api/driver/fleet-car/request", { carId, startsAt: inDays(2), weeks: 13 });
    check("more than 12 weeks is refused", tooLong.status === 400);
    const asked = await applicant.req("POST", "/api/driver/fleet-car/request", { carId, startsAt: inDays(2), weeks: 2, weeklyRent: 1 });
    check("they ask for 2 weeks at the car's own rent; nothing is charged", asked.status === 200 && asked.json?.status === "requested" && asked.json?.weeklyRent === "260.00" && asked.json?.paymentStatus === "none", JSON.stringify(asked.json?.message ?? asked.json));
    const aId = asked.json?.id;
    check("a second request while one is open is refused", (await applicant.req("POST", "/api/driver/fleet-car/request", { carId, startsAt: inDays(30), weeks: 1 })).status === 409);
    check("PG Ride is paged", await logShows(/A driver asks for a PG Ride car/));

    section("One car, one set of days, whichever door");
    const pubLicence = await upload(rider);
    const clash = await rider.req("POST", "/api/rent/bookings", { carId, startsAt: inDays(5), endsAt: inDays(6), licenceNumber: "M123456789", licenceImageUrl: pubLicence });
    check("a public renter may still ask for those days while the driver's is only a request", clash.status === 200, JSON.stringify(clash.json?.message ?? clash.status));
    check("the desk assigns the car to the driver", (await admin.req("POST", `/api/admin/rental/assignments/${aId}/assign`)).status === 200);
    const blocked = await admin.req("POST", `/api/admin/rental/bookings/${clash.json?.id}/confirm`);
    check("and then cannot confirm a public rental over the driver's weeks", blocked.status === 409, `${blocked.status} ${blocked.json?.message}`);
    await admin.req("POST", `/api/admin/rental/bookings/${clash.json?.id}/decline`, { reason: "Car with a driver" });
    check("nor is the car offered to the public for those days", !((await rider.req("GET", `/api/rent/cars?from=${encodeURIComponent(inDays(5))}&to=${encodeURIComponent(inDays(6))}`)).json ?? []).some((c) => c.id === carId));

    section("An assigned PG Ride car stands in for their own insurance and car");
    const approve = await admin.req("PATCH", `/api/admin/drivers/${user.id}`, { approvalStatus: "approved" });
    check("the operator can now approve them", approve.status === 200, JSON.stringify(approve.json?.message ?? approve.json?.missing));
    const mine = await applicant.req("GET", "/api/driver/fleet-car");
    check("the driver sees their car as confirmed", mine.json?.status === "assigned" && mine.json?.car?.id === carId, JSON.stringify(mine.json?.status));

    section("No rent, no car");
    const handPhotos = [await upload(admin), await upload(admin), await upload(admin), await upload(admin)];
    const hand = await admin.req("POST", `/api/admin/rental/assignments/${aId}/handover`, { odometer: 20000, photos: handPhotos });
    check("when the first week cannot be charged, the car is not handed over", hand.status === 402 && /first week's rent could not be charged/.test(hand.json?.message ?? ""), `${hand.status} ${hand.json?.message}`);
    const { rows: [afterHand] } = await db.query("SELECT a.status, a.vehicle_id, (SELECT count(*)::int FROM driver_rent_charges c WHERE c.assignment_id=a.id AND c.status='failed') AS failed FROM driver_car_assignments a WHERE a.id=$1", [aId]);
    check("it stays assigned, no vehicle is made, and the failed week is recorded", afterHand.status === "assigned" && !afterHand.vehicle_id && afterHand.failed === 1, JSON.stringify(afterHand));
    check("ops are paged", await logShows(/Driver car rent declined at hand-over/));

    section("With the car in hand and the rent paid, they drive it");
    // Stand in for a hand-over whose first week was charged (Stripe is unreachable here).
    const { rows: [prof] } = await db.query("SELECT id FROM driver_profiles WHERE user_id=$1", [user.id]);
    const { rows: [veh] } = await db.query(`INSERT INTO vehicles (driver_profile_id, make, model, year, color, license_plate, vehicle_type, rental_car_id) VALUES ($1,'Toyota','Prius',$2,'Grey','PGD3001','standard',$3) RETURNING id`, [prof.id, new Date().getUTCFullYear() - 2, carId]);
    await db.query(`UPDATE driver_car_assignments SET status='active', vehicle_id=$2, collected_at=NOW(), collect_odometer=20000, paid_through=NOW() + interval '7 days', payment_status='paid' WHERE id=$1`, [aId, veh.id]);
    await db.query(`UPDATE driver_rent_charges SET status='paid', stripe_payment_intent_id='pi_e2e_week1' WHERE assignment_id=$1`, [aId]);
    check("they go online in the PG Ride car", (await applicant.req("POST", "/api/driver/toggle-status", { isOnline: true })).status === 200);
    await applicant.req("POST", "/api/driver/toggle-status", { isOnline: false });
    const carNow = await applicant.req("GET", "/api/driver/fleet-car");
    check("and see it as theirs, with its plate, and the rent paid", carNow.json?.status === "active" && carNow.json?.car?.licensePlate === "PGD3001" && carNow.json?.paymentStatus === "paid", JSON.stringify({ s: carNow.json?.status, p: carNow.json?.car?.licensePlate }));
    const noCancel = await applicant.req("POST", "/api/driver/fleet-car/cancel");
    check("a car in hand cannot be cancelled from the phone", noCancel.status === 409);

    section("When the paid week runs out, the next is charged, and unpaid means offline");
    await db.query("UPDATE driver_car_assignments SET paid_through = NOW() + interval '20 minutes' WHERE id=$1", [aId]);
    const sweep = await admin.req("POST", "/api/admin/analytics/driver-rent-sweep", {});
    check("the sweep tries next week's rent before this week runs out", sweep.status === 200 && sweep.json?.failed === 1, JSON.stringify(sweep.json));
    const { rows: [due] } = await db.query("SELECT payment_status, payment_error, (SELECT count(*)::int FROM driver_rent_charges WHERE assignment_id=$1) AS weeks FROM driver_car_assignments WHERE id=$1", [aId]);
    check("the week is recorded once and the rent marked due, with the reason", due.payment_status === "due" && /failed/.test(due.payment_error ?? "") && due.weeks === 2, JSON.stringify(due));
    check("ops are paged that the driver cannot go online", await logShows(/Driver car rent FAILED/));
    const again = await admin.req("POST", "/api/admin/analytics/driver-rent-sweep", {});
    const { rows: [stillTwo] } = await db.query("SELECT count(*)::int AS n FROM driver_rent_charges WHERE assignment_id=$1", [aId]);
    check("running the sweep again does not make a second row for the same week", again.status === 200 && stillTwo.n === 2, JSON.stringify({ n: stillTwo.n, s: again.json }));
    // A charge whose answer was lost stays "charging"; after ten minutes it
    // is taken up again, and Stripe is asked first whether it went through.
    await db.query("UPDATE driver_rent_charges SET status='charging', updated_at = NOW() - interval '11 minutes' WHERE assignment_id=$1 AND status='failed'", [aId]);
    const stuck = await admin.req("POST", `/api/admin/rental/assignments/${aId}/charge-rent`);
    check("a week stuck charging is taken up again, and when Stripe cannot be asked nothing is charged", stuck.status === 200 && /Could not check with Stripe whether this week was already charged/.test(stuck.json?.paymentError ?? ""), JSON.stringify(stuck.json?.paymentError));
    await db.query("UPDATE driver_rent_charges SET status='charging', updated_at = NOW() WHERE assignment_id=$1 AND status='charging'", [aId]);
    const fresh = await admin.req("POST", `/api/admin/rental/assignments/${aId}/charge-rent`);
    check("a week charging just now is left alone", /being charged right now/.test(fresh.json?.paymentError ?? ""), JSON.stringify(fresh.json?.paymentError));

    section("An edit to the car reaches the driver's copy");
    const repainted = await admin.req("PATCH", `/api/admin/rental/cars/${carId}`, { color: "Blue" });
    const { rows: [copy] } = await db.query("SELECT color FROM vehicles WHERE id=$1", [veh.id]);
    check("riders and dispatch see the car as it is now", repainted.status === 200 && copy.color === "Blue", JSON.stringify(copy));

    section("Rent run out: offline, and cannot come back");
    await db.query("UPDATE driver_profiles SET is_online=true WHERE user_id=$1", [user.id]);
    await db.query("UPDATE driver_car_assignments SET paid_through = NOW() - interval '1 minute' WHERE id=$1", [aId]);
    await admin.req("POST", "/api/admin/analytics/driver-rent-sweep", {});
    const { rows: [wasOnline] } = await db.query("SELECT is_online FROM driver_profiles WHERE user_id=$1", [user.id]);
    check("a driver online when the paid week runs out is taken offline", wasOnline.is_online === false, JSON.stringify(wasOnline));
    const offline = await applicant.req("POST", "/api/driver/toggle-status", { isOnline: true });
    check("with the rent unpaid, they cannot go online in the car, and are told why", offline.status === 403 && /rent/.test(offline.json?.message ?? ""), `${offline.status} ${offline.json?.message}`);
    const ownCarDriver = new Session(base); await ownCarDriver.login(FIXTURES.driver.email);
    const ownOnline = await ownCarDriver.req("POST", "/api/driver/toggle-status", { isOnline: true });
    await ownCarDriver.req("POST", "/api/driver/toggle-status", { isOnline: false });
    check("a driver with a car of their own is not affected", ownOnline.status === 200, `${ownOnline.status} ${ownOnline.json?.message}`);

    section("The car is taken back and stops being theirs");
    const ext = await admin.req("POST", `/api/admin/rental/assignments/${aId}/extend`, { weeks: 1 });
    check("the desk can add a week while the car is free", ext.status === 200 && ext.json?.weeks === 3, JSON.stringify(ext.json?.message ?? ext.json?.weeks));
    const back = await admin.req("POST", `/api/admin/rental/assignments/${aId}/takeback`, { odometer: 20900, photos: handPhotos });
    check("the car is taken back", back.status === 200 && back.json?.status === "ended", JSON.stringify(back.json?.message ?? back.json?.status));
    const { rows: [gone] } = await db.query("SELECT count(*)::int AS n FROM vehicles WHERE id=$1", [veh.id]);
    check("and the driver's copy of it is gone, so riders are never shown a car they no longer drive", gone.n === 0, JSON.stringify(gone));
    const noCar = await applicant.req("POST", "/api/driver/toggle-status", { isOnline: true });
    check("a driver approved on a PG Ride car alone cannot go online once it is back, and is told why", noCar.status === 403 && /no car/.test(noCar.json?.message ?? ""), `${noCar.status} ${noCar.json?.message}`);
    check("and may ask for a car again", (await applicant.req("GET", "/api/driver/fleet-car")).json === null);

    section("Switch off, door shut");
    // The rental journey (30) proves the whole surface answers 404 with the switch off; these share its gate.
    check("a rider is not an admin here either", (await rider.req("GET", "/api/admin/rental/assignments")).status === 403);
  } finally {
    await db.query("DELETE FROM driver_rent_charges WHERE assignment_id IN (SELECT id FROM driver_car_assignments WHERE car_id = ANY($1::varchar[]))", [carIds]).catch(() => {});
    await db.query("DELETE FROM driver_car_assignments WHERE car_id = ANY($1::varchar[])", [carIds]).catch(() => {});
    await db.query("DELETE FROM rental_bookings WHERE car_id = ANY($1::varchar[])", [carIds]).catch(() => {});
    await db.query("DELETE FROM vehicles WHERE rental_car_id = ANY($1::varchar[])", [carIds]).catch(() => {});
    await db.query("DELETE FROM rental_cars WHERE id = ANY($1::varchar[])", [carIds]).catch(() => {});
    await db.query("DELETE FROM driver_profiles WHERE user_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [ids]).catch(() => {});
  }
}
