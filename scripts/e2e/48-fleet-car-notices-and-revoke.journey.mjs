import { Session, check, section, serverLog, FIXTURES, PICKUP, DEST } from "./harness.mjs";

/**
 * Fleet slice 3, finished (2026-09-30).
 *
 * Giving a driver a fleet car, or taking it back, changed the car riders see
 * without a word to the driver. Now the driver is told in the app each time.
 * A fleet car is only ever with a driver PG Ride approves: when PG Ride
 * revokes the driver's approval, suspends them or their account, or revokes
 * the account's approval, the car goes back to the fleet at once, the copy
 * leaves their vehicles and they are told why; on a ride it waits for the
 * ride to end, and the hourly sweep catches a driver changed by any other
 * door. And a fleet's driver is invited by email to drive, not "to book".
 */
export async function run({ base, db, server }) {
  const stamp = Date.now();
  const D = `e2e-fleet48-drv-${stamp}`, orgId = "e2e-fleet", carId = `e2e-fleet48-car-${stamp}`;
  const email = `${D}@example.com`;
  const rideIds = [];
  const logShows = async (re) => { for (let i = 0; i < 25; i++) { if (re.test(serverLog(server))) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
  const holder = async () => (await db.query("SELECT driver_user_id FROM fleet_cars WHERE id=$1", [carId])).rows[0]?.driver_user_id ?? null;
  const copies = async () => (await db.query("SELECT v.id FROM vehicles v JOIN driver_profiles p ON p.id = v.driver_profile_id WHERE p.user_id=$1 AND v.fleet_car_id=$2", [D, carId])).rows.length;
  const notices = async (type) => (await db.query("SELECT title, body FROM in_app_notifications WHERE user_id=$1 AND type=$2 ORDER BY created_at", [D, type])).rows;
  const approveAll = async () => {
    await db.query("UPDATE driver_profiles SET approval_status='approved', is_suspended=false WHERE user_id=$1", [D]);
    await db.query("UPDATE users SET is_approved=true, is_suspended=false, is_driver=true WHERE id=$1", [D]);
  };

  // An approved driver of the seeded fleet, with no car of their own, and a ready car of the fleet's for this journey alone.
  await db.query(`INSERT INTO users (id, email, password, first_name, last_name, is_approved, is_driver, phone, registration_completed_at)
    SELECT $1, $2, password, 'Kemi', 'Carless', true, true, NULL, NOW() FROM users WHERE id=$3`, [D, email, FIXTURES.rider.id]);
  await db.query("INSERT INTO driver_profiles (user_id, approval_status, is_online) VALUES ($1, 'approved', false)", [D]);
  await db.query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'driver')", [orgId, D]);
  await db.query(`INSERT INTO fleet_cars (id, organization_id, make, model, year, color, seats, license_plate, vin, photos, registration_doc_url, insurance_doc_url, inspection_doc_url, inspection_expires, registration_expires, insurance_expires, review_status, status)
    SELECT $1, organization_id, 'Kia', 'K5', year, 'Grey', seats, $2, $3, photos, registration_doc_url, insurance_doc_url, inspection_doc_url, inspection_expires, registration_expires, insurance_expires, 'approved', 'ready'
    FROM fleet_cars WHERE id='e2e-fleet-car'`, [carId, `F48${String(stamp).slice(-4)}`, `5XXG14J2${String(stamp).slice(-9)}`]);

  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const owner = new Session(base); await owner.login(FIXTURES.rider.email); // owner of e2e-fleet (harness seed)
  const give = () => owner.req("POST", `/api/fleet/${orgId}/cars/${carId}/assign`, { driverUserId: D });

  try {
    section("The driver is told when a car is given and when it goes back");
    const given = await give();
    check("the owner gives the car to the driver", given.status === 200 && (await holder()) === D && (await copies()) === 1, `${given.status} ${JSON.stringify(given.json?.message ?? "")}`);
    const [g] = await notices("fleet-car-assigned");
    check("the driver has a notice naming the fleet, the car and the split", !!g && /E2E Fleet Motors gave you a car/.test(g.title) && /Kia K5/.test(g.body) && /75% to you and 25% to E2E Fleet Motors/.test(g.body), JSON.stringify(g));
    const back = await owner.req("POST", `/api/fleet/${orgId}/cars/${carId}/take-back`, {});
    check("the owner takes it back", back.status === 200 && (await holder()) === null && (await copies()) === 0, `${back.status}`);
    const [t] = await notices("fleet-car-taken-back");
    check("the driver is told, and that with no car they cannot go online", !!t && /E2E Fleet Motors took .*Kia K5.* back/.test(t.body) && /cannot go online/.test(t.body), JSON.stringify(t));

    section("PG Ride revokes the driver's approval: the car goes back to the fleet");
    await give();
    const revoked = await admin.req("PATCH", `/api/admin/drivers/${D}`, { approvalStatus: "rejected" });
    check("PG Ride rejects the driver", revoked.status === 200, `${revoked.status}`);
    check("the car is back with the fleet and its copy has left the driver's vehicles", (await holder()) === null && (await copies()) === 0);
    const byPg = (await notices("fleet-car-taken-back")).at(-1);
    check("the driver is told PG Ride took it, and why", /PG Ride took .* back for E2E Fleet Motors\. Reason: Driver approval is no longer in place/.test(byPg?.body ?? ""), JSON.stringify(byPg));
    check("ops are paged, naming the reason", await logShows(/Fleet car taken back: driver no longer approved[\s\S]*Driver approval is no longer in place/));
    const refused = await give();
    check("and the fleet cannot give it back to them", refused.status === 409 && (await holder()) === null, `${refused.status}`);

    section("Suspending the driver, the account, or the account's approval does the same");
    for (const [label, door] of [
      ["the driver is suspended", () => admin.req("PATCH", `/api/admin/drivers/${D}`, { isSuspended: true })],
      ["the account is suspended", () => admin.req("PATCH", `/api/admin/users/${D}`, { isSuspended: true })],
      ["the account's approval is revoked", () => admin.req("POST", `/api/admin/users/${D}/revoke-approval`, {})],
    ]) {
      await approveAll();
      const again = await give();
      const res = await door();
      check(`${label}: the car goes back`, again.status === 200 && res.status === 200 && (await holder()) === null && (await copies()) === 0, `${again.status} ${res.status} holder=${await holder()}`);
    }

    section("On a ride, the car stays until the ride ends; the sweep takes it back then");
    await approveAll();
    await give();
    const { rows: [ride] } = await db.query(`INSERT INTO rides (rider_id, driver_id, status, pickup_location, destination_location, estimated_fare, payment_method, ride_type)
      VALUES ($1, $2, 'in_progress', $3, $4, 12.5, 'card', 'standard') RETURNING id`, [FIXTURES.rider.id, D, JSON.stringify(PICKUP), JSON.stringify(DEST)]);
    rideIds.push(ride.id);
    await admin.req("PATCH", `/api/admin/drivers/${D}`, { approvalStatus: "rejected" });
    check("revoked mid-ride, the driver keeps the car under them", (await holder()) === D && (await copies()) === 1);
    const midRide = await admin.req("POST", "/api/admin/analytics/fleet-car-sweep", {});
    check("the sweep leaves it while the ride is on", midRide.status === 200 && midRide.json?.waitingOnRide >= 1 && (await holder()) === D, JSON.stringify(midRide.json));
    await db.query("UPDATE rides SET status='completed', completed_at=NOW() WHERE id=$1", [ride.id]);
    const after = await admin.req("POST", "/api/admin/analytics/fleet-car-sweep", {});
    check("once it ends, the sweep takes the car back", after.status === 200 && after.json?.released >= 1 && (await holder()) === null && (await copies()) === 0, JSON.stringify(after.json));

    section("The sweep catches a driver changed by any other door");
    await approveAll();
    await give();
    await db.query("UPDATE driver_profiles SET approval_status='suspended' WHERE user_id=$1", [D]);
    const net = await admin.req("POST", "/api/admin/analytics/fleet-car-sweep", {});
    check("changed behind the admin's back, the car still goes back on the next sweep", net.status === 200 && (await holder()) === null, JSON.stringify(net.json));
    await approveAll();
    await give();
    const kept = await admin.req("POST", "/api/admin/analytics/fleet-car-sweep", {});
    check("an approved driver keeps their car through the sweep", kept.status === 200 && (await holder()) === D && (await copies()) === 1, JSON.stringify(kept.json));

    section("A fleet's driver is invited to drive, not to book");
    const invEmail = `e2e-fleet48-inv-${stamp}@example.com`;
    const inv = await owner.req("POST", `/api/fleet/${orgId}/drivers`, { email: invEmail });
    check("the owner invites a driver", inv.status === 202, `${inv.status}`);
    // The harness's mail server refuses every email on purpose, and every
    // failed email is written to reliability_events under its subject.
    let subjectSeen = false;
    for (let i = 0; i < 25 && !subjectSeen; i++) {
      subjectSeen = (await db.query("SELECT 1 FROM reliability_events WHERE kind='email_failed' AND page=$1 LIMIT 1", ["E2E Fleet Motors invited you to drive for their fleet on PG Ride"])).rows.length > 0;
      if (!subjectSeen) await new Promise((r) => setTimeout(r, 200));
    }
    check("the email's subject says drive for the fleet, not book rides", subjectSeen);
    await db.query("DELETE FROM organization_invitations WHERE email=$1", [invEmail]).catch(() => {});
  } finally {
    await db.query("UPDATE fleet_cars SET driver_user_id=NULL WHERE id=$1", [carId]).catch(() => {});
    await db.query("DELETE FROM rides WHERE id = ANY($1::varchar[])", [rideIds]).catch(() => {});
    await db.query("DELETE FROM vehicles WHERE driver_profile_id IN (SELECT id FROM driver_profiles WHERE user_id=$1)", [D]).catch(() => {});
    await db.query("DELETE FROM fleet_cars WHERE id=$1", [carId]).catch(() => {});
    await db.query("DELETE FROM in_app_notifications WHERE user_id=$1", [D]).catch(() => {});
    await db.query("DELETE FROM organization_members WHERE user_id=$1", [D]).catch(() => {});
    await db.query("DELETE FROM admin_activity_log WHERE target_id=$1", [D]).catch(() => {});
    await db.query("DELETE FROM driver_profiles WHERE user_id=$1", [D]).catch(() => {});
    await db.query("DELETE FROM users WHERE id=$1", [D]).catch(() => {});
  }
}
