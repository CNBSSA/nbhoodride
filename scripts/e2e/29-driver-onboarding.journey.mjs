import { Session, check, section, deleteRides, FIXTURES, PICKUP, DEST } from "./harness.mjs";

/**
 * A driver from the street to the road: the whole path, in one go.
 *
 * Every piece of this was covered somewhere — documents saving, badges,
 * going online, taking a ride — and the path through them was covered
 * nowhere. On 2026-09-22 a driver applied, uploaded everything, was told it
 * was on file, and the operator's Approve refused him: "driver onboarding is
 * incomplete". Two screens reading one record disagreed, and the only person
 * who could find out was the founder, with a driver waiting in front of him.
 *
 * So this walks it end to end and, at the join, makes the driver's own view
 * and the operator's view answer for each other. If they ever disagree again,
 * this fails before anybody ships it.
 */
export async function run({ base, db }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const applicant = new Session(base); await applicant.csrf();
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const email = `e2e-onboard-${Date.now()}@example.com`;
  const ids = [];
  const rideIds = [];

  const uploadOne = async (session, label) => {
    const up = await session.req("POST", "/api/objects/upload", {});
    const path = new URL(up.json?.uploadURL ?? "http://x/").pathname;
    const put = await session.req("PUT", path, `bytes-of-${label}`, { "Content-Type": "image/jpeg" });
    check(`${label} reaches PG Ride's own store`, up.status === 200 && put.status === 200, `upload=${up.status} put=${put.status}`);
    return up.json.uploadURL;
  };

  try {
    section("Someone signs up and is approved as a person");
    const signup = await applicant.req("POST", "/api/auth/signup", {
      email, password: "Str0ng!Pass123", firstName: "Dele", lastName: "Driver",
      phone: "2405550142", termsAccepted: true, privacyAccepted: true,
    });
    check("they sign up and are told they are pending", signup.status === 200 && signup.json?.pendingApproval === true, JSON.stringify(signup.json?.message ?? signup.status));
    const { rows: [user] } = await db.query("SELECT id FROM users WHERE email=$1", [email]);
    ids.push(user.id);
    check("the operator approves the account", (await admin.req("POST", `/api/admin/users/${user.id}/approve`, {})).status === 200);
    await applicant.login(email, "Str0ng!Pass123");

    section("They apply to drive");
    const applied = await applicant.req("POST", "/api/driver/profile", { licenseNumber: "D7654321", licenseState: "MD" });
    check("the application is taken", applied.status === 200 && applied.json?.id, JSON.stringify(applied.json?.message ?? applied.status));
    const drivers = await admin.req("GET", "/api/admin/drivers");
    check("and it is waiting in the operator's drivers queue", (drivers.json ?? []).some((d) => d.userId === user.id), `drivers=${(drivers.json ?? []).length}`);

    section("Approval is refused while the documents are not there, and says what is missing");
    const tooEarly = await admin.req("PATCH", `/api/admin/drivers/${user.id}`, { approvalStatus: "approved" });
    check("Approve is refused", tooEarly.status === 400 && /onboarding is incomplete/i.test(tooEarly.json?.message ?? ""), `${tooEarly.status} ${JSON.stringify(tooEarly.json?.message)}`);
    check("and it names all three: licence, insurance, vehicle", ["license image", "insurance image", "vehicle photos / vehicle record"].every((m) => (tooEarly.json?.missing ?? []).includes(m)), JSON.stringify(tooEarly.json?.missing));
    check("nothing was approved by the refusal", (await db.query("SELECT approval_status FROM driver_profiles WHERE user_id=$1", [user.id])).rows[0].approval_status !== "approved");

    section("They upload what was asked for, the way the documents screen does");
    // Each document is saved to the profile the moment it uploads, one PUT
    // per document, exactly as client/src/components/DocumentUploadModal.tsx
    // does it — so this proves the real path, not a shortcut to the database.
    const licenseUrl = await uploadOne(applicant, "the licence");
    check("the licence is saved to the application", (await applicant.req("PUT", "/api/driver/profile", { licenseImageUrl: licenseUrl })).status === 200);
    const insuranceUrl = await uploadOne(applicant, "the insurance");
    check("the insurance is saved", (await applicant.req("PUT", "/api/driver/profile", { insuranceImageUrl: insuranceUrl })).status === 200);
    const photos = [];
    for (const slot of ["front with plate", "side", "interior", "back"]) {
      photos.push(await uploadOne(applicant, `the ${slot} photo`));
      check(`the ${slot} photo is saved`, (await applicant.req("PUT", "/api/driver/profile", { vehiclePhotoUrls: [...photos] })).status === 200);
    }

    section("The driver's own screen and the operator's screen agree");
    // This is the join that failed in the wild. Both read the same record;
    // they must never be able to tell two different stories about it.
    const mine = await applicant.req("GET", "/api/driver/profile/me");
    check("the driver is told all of it is on file", mine.status === 200 && !!mine.json?.licenseImageUrl && !!mine.json?.insuranceImageUrl && (mine.json?.vehiclePhotoUrls ?? []).length === 4, JSON.stringify({ lic: !!mine.json?.licenseImageUrl, ins: !!mine.json?.insuranceImageUrl, photos: (mine.json?.vehiclePhotoUrls ?? []).length }));
    const theirs = ((await admin.req("GET", "/api/admin/drivers")).json ?? []).find((d) => d.userId === user.id);
    check("the operator is shown exactly the same documents", theirs?.licenseImageUrl === mine.json.licenseImageUrl && theirs?.insuranceImageUrl === mine.json.insuranceImageUrl && JSON.stringify(theirs?.vehiclePhotoUrls ?? []) === JSON.stringify(mine.json.vehiclePhotoUrls), JSON.stringify({ lic: theirs?.licenseImageUrl === mine.json.licenseImageUrl, ins: theirs?.insuranceImageUrl === mine.json.insuranceImageUrl }));

    section("Now Approve works, and it is approval that makes a driver");
    check("a driver who is not approved yet cannot go online", (await applicant.req("POST", "/api/driver/toggle-status", { isOnline: true })).status === 403);
    const approve = await admin.req("PATCH", `/api/admin/drivers/${user.id}`, { approvalStatus: "approved" });
    check("the operator approves them", approve.status === 200, JSON.stringify(approve.json?.message ?? approve.status));
    const { rows: [after] } = await db.query("SELECT is_driver FROM users WHERE id=$1", [user.id]);
    check("approval is what makes them a driver", after.is_driver === true, JSON.stringify(after));
    check("they are out of the waiting list", !((await admin.req("GET", "/api/admin/drivers")).json ?? []).some((d) => d.userId === user.id && (!d.approvalStatus || d.approvalStatus === "pending")));

    section("And they can actually drive");
    check("they go online", (await applicant.req("POST", "/api/driver/toggle-status", { isOnline: true })).status === 200);
    const booked = await rider.req("POST", "/api/rides", {
      pickupLocation: { ...PICKUP, address: "1 Main St, Bowie, MD" },
      destinationLocation: { ...DEST, address: "2 Oak Rd, National Harbor, MD" },
      estimatedFare: 23.21, distance: "5.0", duration: 12,
    });
    check("a rider books a ride", booked.status === 200 && booked.json?.id, JSON.stringify(booked.json?.message ?? booked.status));
    rideIds.push(booked.json.id);
    // Accepting authorizes the rider's card, and Stripe is a fake key here, so
    // the hold is stood in for exactly as journey 09 does. What this journey
    // is proving is that a freshly approved driver may be given the work and
    // may finish it; how a card is charged is journeys 01 and 07.
    const offered = await applicant.req("GET", "/api/driver/pending-rides");
    check("the ride is offered to the new driver", offered.status === 200 && (offered.json ?? []).some((r) => r.id === booked.json.id), `offered=${(offered.json ?? []).length}`);
    await db.query("UPDATE rides SET status='accepted', driver_id=$2, accepted_at=NOW() WHERE id=$1", [booked.json.id, user.id]);
    check("they start it", (await applicant.req("POST", `/api/driver/rides/${booked.json.id}/start`)).status === 200);
    const done = await applicant.req("POST", `/api/driver/rides/${booked.json.id}/complete`, {});
    check("and complete it, earning their share", done.status === 200 && Number(done.json?.driverEarnings) > 0, JSON.stringify({ status: done.status, earned: done.json?.driverEarnings }));
  } finally {
    await deleteRides(db, rideIds).catch(() => {});
    await db.query("DELETE FROM wallet_transactions WHERE user_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM driver_profiles WHERE user_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [ids]).catch(() => {});
  }
}
