import { Session, check, section, serverLog, startServer, stopServer, FIXTURES, PICKUP, DEST, tinyPng } from "./harness.mjs";

/**
 * Fleet management accounts, slice 3 (PG Ride Fleet Management Accounts
 * Plan): drivers and cars.
 *
 * The fleet's owner invites a driver by email; the invitee accepts from the
 * link and is a person PG Ride approves like any sign-up, with their driver
 * application already started; a fleet can never approve its own drivers,
 * so a car cannot go to them until PG Ride has. A driver drives for one
 * fleet at a time. The owner gives a ready car to an approved driver — one
 * car per driver, one driver per car, never a car waiting for PG Ride — and
 * the car becomes the driver's vehicle for riders and dispatch; an edit to
 * the car reaches the copy; a parked car stops being drivable; taking the
 * car back or removing the driver is refused while they are on a ride, and
 * the copy goes with the car. The desk sees names, PG Ride's approval and
 * cars, never a phone or an address.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const owner = new Session(base); await owner.login(FIXTURES.rider.email);      // owner of e2e-fleet (harness seed)
  const stranger = new Session(base); await stranger.login(FIXTURES.driver.email); // owner of the pending e2e-fleet-app
  const orgId = "e2e-fleet", carId = "e2e-fleet-car", pendingCarId = "e2e-fleet-car-2";
  const otherFleetId = `e2e-fleet-45b-${Date.now()}`, spareCarId = `e2e-fleet-car-45-${Date.now()}`;
  const email = `e2e-fleet-drv-${Date.now()}@example.com`, phone = "2405550145";
  const userIds = [], rideIds = [];
  const logShows = async (re) => { for (let i = 0; i < 25; i++) { if (re.test(serverLog(server))) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
  const upload = async (session) => {
    const up = await session.req("POST", "/api/objects/upload?store=db", {});
    const path = new URL(up.json?.uploadURL ?? "http://x/").pathname;
    return (await session.req("PUT", path, tinyPng(), { "Content-Type": "image/png" })).status === 200 ? path : null;
  };
  const tokenOf = (link) => String(link ?? "").split("/org/join/")[1] ?? "";
  const copies = async (uid) => (await db.query("SELECT v.* FROM vehicles v JOIN driver_profiles p ON p.id = v.driver_profile_id WHERE p.user_id=$1 AND v.fleet_car_id IS NOT NULL", [uid])).rows;

  try {
    section("The owner invites a driver; the driver accepts the link");
    check("a stranger cannot see the fleet's drivers", (await stranger.req("GET", `/api/fleet/${orgId}/drivers`)).status === 403);
    check("nor invite one", (await stranger.req("POST", `/api/fleet/${orgId}/drivers`, { email })).status === 403);
    const notYet = await stranger.req("POST", "/api/fleet/e2e-fleet-app/drivers", { email });
    check("a fleet PG Ride has not approved cannot invite drivers yet", notYet.status === 409 && /not approved/.test(notYet.json?.message ?? ""), JSON.stringify(notYet.json));
    check("an email is needed", (await owner.req("POST", `/api/fleet/${orgId}/drivers`, { email: "nobody" })).status === 400);
    const inv = await owner.req("POST", `/api/fleet/${orgId}/drivers`, { email });
    check("the owner invites a driver and gets the link to send", inv.status === 202 && /\/org\/join\/[0-9a-f]{48}$/.test(inv.json?.link ?? ""), JSON.stringify(inv.json?.message ?? inv.json?.link));
    const listed = await owner.req("GET", `/api/fleet/${orgId}/drivers`);
    check("the desk shows the invitation waiting", (listed.json?.invitations ?? []).some((i) => i.email === email), JSON.stringify(listed.json?.invitations));
    const joiner = new Session(base); await joiner.csrf();
    const desc = await joiner.req("GET", `/api/org/invitations/${tokenOf(inv.json?.link)}`);
    check("the link names the fleet and the driver role", desc.status === 200 && desc.json?.role === "driver" && desc.json?.organizationName === "E2E Fleet Motors", JSON.stringify(desc.json));
    const accepted = await joiner.req("POST", `/api/org/invitations/${tokenOf(inv.json?.link)}/accept`, { firstName: "Dayo", lastName: "Fleetdriver", phone, password: "Str0ng!Pass123", termsAccepted: true, privacyAccepted: true });
    check("they accept, and are told PG Ride approves them first", accepted.status === 200 && accepted.json?.pendingApproval === true, JSON.stringify(accepted.json));
    const { rows: [u] } = await db.query("SELECT u.id, u.is_approved, u.is_driver, p.approval_status FROM users u LEFT JOIN driver_profiles p ON p.user_id=u.id WHERE u.email=$1", [email]);
    if (u) userIds.push(u.id);
    check("the fleet did not approve them: the account waits for PG Ride, the driver application is started, and they are not a driver", u && u.is_approved === false && u.is_driver === false && u.approval_status === "pending", JSON.stringify(u));
    check("they are not signed in by accepting", (await joiner.req("GET", "/api/auth/user")).status === 401);
    const { rows: [m] } = await db.query("SELECT role FROM organization_members WHERE organization_id=$1 AND user_id=$2", [orgId, u?.id]);
    check("they are the fleet's driver", m?.role === "driver", JSON.stringify(m));
    check("PG Ride is paged, naming the fleet", await logShows(/New signup from a fleet: wants to DRIVE[\s\S]*E2E Fleet Motors/));
    check("the link is single use", (await joiner.req("POST", `/api/org/invitations/${tokenOf(inv.json?.link)}/accept`, { firstName: "X", lastName: "Y", phone, password: "Str0ng!Pass123", termsAccepted: true, privacyAccepted: true })).status === 410);

    section("Who sees what on the Drivers view");
    const view = await owner.req("GET", `/api/fleet/${orgId}/drivers`);
    const me = (view.json?.drivers ?? []).find((d) => d.userId === u?.id);
    check("the desk lists the driver by name, not approved by PG Ride yet, with no car", me?.name === "Dayo Fleetdriver" && me?.approvedByPgRide === false && /Waiting for PG Ride/.test(me?.approvalText ?? "") && me?.car === null, JSON.stringify(me));
    check("and never their phone or email", !JSON.stringify(view.json).includes(phone) && !JSON.stringify(view.json?.drivers ?? []).includes(email));

    section("A fleet can never approve its own drivers");
    const early = await owner.req("POST", `/api/fleet/${orgId}/cars/${carId}/assign`, { driverUserId: u?.id });
    check("a car cannot go to a driver PG Ride has not approved, and the desk is told why", early.status === 409 && /PG Ride has not approved them as a driver/.test(early.json?.message ?? "") && /cannot approve its own drivers/.test(early.json?.message ?? ""), JSON.stringify(early.json));
    check("the fleet's owner cannot use PG Ride's approval", (await owner.req("PATCH", `/api/admin/drivers/${u?.id}`, { approvalStatus: "approved" })).status === 403);
    check("PG Ride approves the person", (await admin.req("POST", `/api/admin/users/${u?.id}/approve`, {})).status === 200);
    const driver = new Session(base); await driver.login(email, "Str0ng!Pass123");
    const noLicence = await admin.req("PATCH", `/api/admin/drivers/${u?.id}`, { approvalStatus: "approved" });
    check("without a licence PG Ride cannot approve the driver; the fleet's cars stand in for their own insurance and car, the licence does not", noLicence.status === 400 && JSON.stringify(noLicence.json?.missing) === JSON.stringify(["license image"]), JSON.stringify(noLicence.json?.missing));
    const licence = await upload(driver);
    check("the driver uploads their licence", (await driver.req("PUT", "/api/driver/profile", { licenseNumber: "D4512345", licenseImageUrl: licence })).status === 200);
    const approved = await admin.req("PATCH", `/api/admin/drivers/${u?.id}`, { approvalStatus: "approved" });
    check("PG Ride approves the driver", approved.status === 200, JSON.stringify(approved.json?.message ?? approved.json?.missing));
    const noCar = await driver.req("POST", "/api/driver/toggle-status", { isOnline: true });
    check("with no car yet they cannot go online, and are told why", noCar.status === 403 && /no car/.test(noCar.json?.message ?? ""), `${noCar.status} ${noCar.json?.message}`);
    check("a driver is never served the fleet desk", (await driver.req("GET", `/api/fleet/${orgId}`)).status === 403 && (await driver.req("GET", `/api/fleet/${orgId}/drivers`)).status === 403);

    section("The owner gives a ready car to the approved driver");
    const pending = await owner.req("POST", `/api/fleet/${orgId}/cars/${pendingCarId}/assign`, { driverUserId: u?.id });
    check("a car waiting for PG Ride's check cannot go to a driver", pending.status === 409 && /not ready to carry riders/.test(pending.json?.message ?? ""), JSON.stringify(pending.json));
    check("a stranger cannot give a car", (await stranger.req("POST", `/api/fleet/${orgId}/cars/${carId}/assign`, { driverUserId: u?.id })).status === 403);
    const given = await owner.req("POST", `/api/fleet/${orgId}/cars/${carId}/assign`, { driverUserId: u?.id });
    check("the ready car goes to the driver", given.status === 200 && given.json?.driverUserId === u?.id, JSON.stringify(given.json?.message ?? given.json?.driverUserId));
    let copy = await copies(u?.id);
    check("and is copied into the driver's vehicles, so riders and dispatch see it", copy.length === 1 && copy[0].fleet_car_id === carId && copy[0].license_plate === "FLT0001", JSON.stringify(copy));
    check("PG Ride is paged", await logShows(/Fleet car given to a driver[\s\S]*E2E Fleet Motors[\s\S]*FLT0001[\s\S]*Dayo Fleetdriver/));
    const carsView = (await owner.req("GET", `/api/fleet/${orgId}/cars`)).json?.find((c) => c.id === carId);
    check("the desk shows who has the car", carsView?.driverName === "Dayo Fleetdriver", JSON.stringify(carsView?.driverName));
    const online = await driver.req("POST", "/api/driver/toggle-status", { isOnline: true });
    check("the driver goes online in the fleet's car", online.status === 200, `${online.status} ${online.json?.message}`);
    await driver.req("POST", "/api/driver/toggle-status", { isOnline: false });
    check("the driver cannot change the fleet's car from their own vehicle screen", (await driver.req("PUT", `/api/vehicles/${copy[0]?.id}`, { licensePlate: "HACKED1" })).status === 409);

    section("One car per driver, one driver per car");
    await db.query(`INSERT INTO fleet_cars (id, organization_id, make, model, year, color, seats, license_plate, vin, photos, registration_doc_url, insurance_doc_url, inspection_doc_url, inspection_expires, registration_expires, insurance_expires, review_status, status)
      SELECT $1, organization_id, 'Hyundai', 'Elantra', year, 'Grey', seats, 'FLT0045', '5NPD84LF0LH000045', photos, registration_doc_url, insurance_doc_url, inspection_doc_url, inspection_expires, registration_expires, insurance_expires, 'approved', 'ready' FROM fleet_cars WHERE id=$2`, [spareCarId, carId]);
    const second = await owner.req("POST", `/api/fleet/${orgId}/cars/${spareCarId}/assign`, { driverUserId: u?.id });
    check("a second car for the same driver is refused", second.status === 409 && /One car per driver/.test(second.json?.message ?? ""), JSON.stringify(second.json));
    await admin.req("POST", `/api/admin/organizations/${orgId}/members`, { email: FIXTURES.driver.email, role: "driver" });
    const taken = await owner.req("POST", `/api/fleet/${orgId}/cars/${carId}/assign`, { driverUserId: FIXTURES.driver.id });
    check("the same car for a second driver is refused", taken.status === 409 && /already with a driver/.test(taken.json?.message ?? ""), JSON.stringify(taken.json));
    await admin.req("DELETE", `/api/admin/organizations/${orgId}/members/${FIXTURES.driver.id}`);

    section("A driver drives for one fleet at a time");
    await db.query(`INSERT INTO organizations (id, name, category, status, facility_fee, fleet_details, payout_method, payout_details, contact_phone)
      VALUES ($1, 'E2E Second Fleet', 'fleet', 'active', 0.00, $2, 'zelle', 'second@example.com', '2405550199')`, [otherFleetId, JSON.stringify({ legalName: "E2E Second Fleet LLC", ein: "22-3456789", businessType: "llc" })]);
    await db.query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [otherFleetId, FIXTURES.rider.id]);
    const byDesk = await admin.req("POST", `/api/admin/organizations/${otherFleetId}/members`, { email, role: "driver" });
    check("adding them as a second fleet's driver is refused, without naming the other fleet", byDesk.status === 409 && /already drives for another fleet/.test(byDesk.json?.message ?? "") && !/E2E Fleet Motors/.test(byDesk.json?.message ?? ""), JSON.stringify(byDesk.json));
    const inv2 = await owner.req("POST", `/api/fleet/${otherFleetId}/drivers`, { email });
    const second2 = await joiner.req("POST", `/api/org/invitations/${tokenOf(inv2.json?.link)}/accept`, {});
    check("and when they open a second fleet's invitation they are told which fleet they drive for", second2.status === 409 && /You already drive for E2E Fleet Motors\. A driver drives for one fleet at a time/.test(second2.json?.message ?? ""), JSON.stringify(second2.json));
    const { rows: [twoFleets] } = await db.query("SELECT count(*)::int AS n FROM organization_members WHERE user_id=$1 AND role='driver'", [u?.id]);
    check("they are still one fleet's driver", twoFleets.n === 1, JSON.stringify(twoFleets));

    section("An existing account that accepts a driver invitation starts its driver application too");
    const existingId = `e2e-fleet-45x-${Date.now()}`, existingEmail = `${existingId}@example.com`;
    await db.query(`INSERT INTO users (id, email, password, first_name, last_name, is_approved, registration_completed_at)
      SELECT $1, $2, password, 'Ade', 'Hasaccount', true, NOW() FROM users WHERE id=$3`, [existingId, existingEmail, FIXTURES.rider.id]);
    userIds.push(existingId);
    const inv3 = await owner.req("POST", `/api/fleet/${orgId}/drivers`, { email: existingEmail });
    const joiner3 = new Session(base);
    await joiner3.req("GET", `/api/org/invitations/${tokenOf(inv3.json?.link)}`);
    const acc3 = await joiner3.req("POST", `/api/org/invitations/${tokenOf(inv3.json?.link)}/accept`, {});
    check("they are attached and told PG Ride has not approved them as a driver yet", acc3.status === 200 && acc3.json?.existing === true && acc3.json?.driverApproved === false, JSON.stringify(acc3.json));
    const { rows: [app3] } = await db.query("SELECT approval_status FROM driver_profiles WHERE user_id=$1", [existingId]);
    check("their driver application is started, pending PG Ride", app3?.approval_status === "pending", JSON.stringify(app3));
    check("and ops are told", await logShows(/Existing account joined a fleet: wants to DRIVE/));
    await db.query("DELETE FROM organization_invitations WHERE email = $1", [existingEmail]).catch(() => {});

    section("An edit to the car reaches the driver's copy; a parked car stops being drivable");
    await owner.req("PATCH", `/api/fleet/${orgId}/cars/${carId}`, { color: "Pearl" });
    copy = await copies(u?.id);
    check("a new colour reaches the copy", copy[0]?.color === "Pearl", JSON.stringify(copy[0]?.color));
    check("what the car IS cannot change under the driver", (await owner.req("PATCH", `/api/fleet/${orgId}/cars/${carId}`, { licensePlate: "FLT0099" })).status === 409);
    await db.query("UPDATE fleet_cars SET insurance_expires = NOW() - interval '1 minute' WHERE id=$1", [carId]);
    await db.query("UPDATE driver_profiles SET is_online=true WHERE user_id=$1", [u?.id]);
    check("the sweep parks the car", (await admin.req("POST", "/api/admin/analytics/fleet-car-sweep", {})).json?.parked >= 1);
    const { rows: [afterPark] } = await db.query("SELECT is_online FROM driver_profiles WHERE user_id=$1", [u?.id]);
    check("its copy is gone and the driver, not on a ride, is taken offline", (await copies(u?.id)).length === 0 && afterPark.is_online === false, JSON.stringify(afterPark));
    const parkedOnline = await driver.req("POST", "/api/driver/toggle-status", { isOnline: true });
    check("the driver cannot go online in a parked car, and is told why", parkedOnline.status === 403 && /parked/.test(parkedOnline.json?.message ?? "") && /Insurance/.test(parkedOnline.json?.message ?? ""), `${parkedOnline.status} ${parkedOnline.json?.message}`);
    await db.query("UPDATE fleet_cars SET insurance_expires = NOW() + interval '365 days' WHERE id=$1", [carId]);
    const back = await admin.req("POST", `/api/admin/fleets/${orgId}/cars/${carId}/review`, { decision: "approve" });
    copy = await copies(u?.id);
    check("put right and checked again, the car is ready and the driver's again", back.json?.status === "ready" && copy.length === 1, JSON.stringify({ s: back.json?.status, n: copy.length }));

    section("Not while the driver is on a ride");
    const { rows: [ride] } = await db.query(
      `INSERT INTO rides (rider_id, driver_id, status, pickup_location, destination_location, estimated_fare, payment_method, started_at)
       VALUES ($1, $2, 'in_progress', $3, $4, '18.00', 'card', NOW() - interval '5 minutes') RETURNING id`,
      [FIXTURES.rider.id, u?.id, JSON.stringify(PICKUP), JSON.stringify(DEST)]);
    rideIds.push(ride.id);
    const onRide = await owner.req("POST", `/api/fleet/${orgId}/cars/${carId}/take-back`);
    check("taking the car back is refused while the driver is on a ride", onRide.status === 409 && /on a ride/.test(onRide.json?.message ?? ""), JSON.stringify(onRide.json));
    const removeOnRide = await owner.req("DELETE", `/api/fleet/${orgId}/drivers/${u?.id}`);
    check("and so is removing the driver", removeOnRide.status === 409 && /on a ride/.test(removeOnRide.json?.message ?? ""), JSON.stringify(removeOnRide.json));
    check("PG Ride's operator cannot remove a driver who still has a car either", (await admin.req("DELETE", `/api/admin/organizations/${orgId}/members/${u?.id}`)).status === 409);
    await db.query("UPDATE rides SET status='completed', completed_at=NOW() WHERE id=$1", [ride.id]);

    section("Taking the car back");
    const tb = await owner.req("POST", `/api/fleet/${orgId}/cars/${carId}/take-back`);
    check("the owner takes the car back", tb.status === 200 && tb.json?.driverUserId === null, JSON.stringify(tb.json?.message ?? tb.json?.driverUserId));
    check("and the driver's copy is gone", (await copies(u?.id)).length === 0);
    check("PG Ride is paged", await logShows(/Fleet car taken back[\s\S]*FLT0001/));
    const afterBack = await driver.req("POST", "/api/driver/toggle-status", { isOnline: true });
    check("with no car, the driver cannot go online, and is told why", afterBack.status === 403 && /no car/.test(afterBack.json?.message ?? ""), `${afterBack.status} ${afterBack.json?.message}`);
    check("taking back a car nobody has is refused", (await owner.req("POST", `/api/fleet/${orgId}/cars/${carId}/take-back`)).status === 409);

    section("Removing a driver takes their car back first");
    check("the car goes to the driver again", (await owner.req("POST", `/api/fleet/${orgId}/cars/${carId}/assign`, { driverUserId: u?.id })).status === 200);
    const removed = await owner.req("DELETE", `/api/fleet/${orgId}/drivers/${u?.id}`);
    check("the owner removes the driver", removed.status === 200 && removed.json?.removed === true, JSON.stringify(removed.json));
    const { rows: [left] } = await db.query("SELECT (SELECT driver_user_id FROM fleet_cars WHERE id=$2) AS car_driver, (SELECT count(*)::int FROM organization_members WHERE organization_id=$3 AND user_id=$1) AS member, (SELECT count(*)::int FROM users WHERE id=$1) AS account", [u?.id, carId, orgId]);
    check("the car is back with the fleet, they are no longer its driver, and they keep their PG Ride account", left.car_driver === null && left.member === 0 && left.account === 1 && (await copies(u?.id)).length === 0, JSON.stringify(left));
    check("the owner is not removed through the Drivers door", (await owner.req("DELETE", `/api/fleet/${orgId}/drivers/${FIXTURES.rider.id}`)).status === 409);

    section("Switch off, door shut");
    const off = await startServer({ FLEET_ENABLED: "false" });
    try {
      const o = new Session(off.base); await o.login(FIXTURES.rider.email);
      check("with fleets off, the drivers routes do not exist", (await o.req("GET", `/api/fleet/${orgId}/drivers`)).status === 404 && (await o.req("POST", `/api/fleet/${orgId}/cars/${carId}/assign`, { driverUserId: "x" })).status === 404 && (await o.req("POST", `/api/fleet/${orgId}/cars/${carId}/take-back`)).status === 404);
    } finally { await stopServer(off); }
  } finally {
    await db.query("UPDATE fleet_cars SET driver_user_id = NULL, color = 'White', insurance_expires = NOW() + interval '365 days', review_status = 'approved', status = 'ready', parked_reason = NULL WHERE id=$1", [carId]).catch(() => {});
    await db.query("DELETE FROM vehicles WHERE fleet_car_id = ANY($1::varchar[])", [[carId, spareCarId, pendingCarId]]).catch(() => {});
    await db.query("DELETE FROM fleet_cars WHERE id=$1", [spareCarId]).catch(() => {});
    await db.query("DELETE FROM rides WHERE id = ANY($1::varchar[])", [rideIds]).catch(() => {});
    await db.query("DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2", [orgId, FIXTURES.driver.id]).catch(() => {});
    await db.query("DELETE FROM organization_invitations WHERE organization_id = ANY($1::varchar[]) AND email = $2", [[orgId, otherFleetId], email]).catch(() => {});
    await db.query("DELETE FROM organization_members WHERE organization_id = $1 OR user_id = ANY($2::varchar[])", [otherFleetId, userIds]).catch(() => {});
    await db.query("DELETE FROM organizations WHERE id = $1", [otherFleetId]).catch(() => {});
    await db.query("DELETE FROM driver_profiles WHERE user_id = ANY($1::varchar[])", [userIds]).catch(() => {});
    await db.query("DELETE FROM wallet_transactions WHERE user_id = ANY($1::varchar[])", [userIds]).catch(() => {});
    await db.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [userIds]).catch(() => {});
  }
}
