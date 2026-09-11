import { Session, check, section, serverLog, deleteRides, deleteOrgs, FIXTURES, PICKUP, DEST } from "./harness.mjs";

/**
 * The requester portal's server side (slice 2): an owner manages the
 * organization's people, any booker can cancel a job whoever booked it under
 * the rider ladder (free while unclaimed, free far ahead), a job on the road
 * cannot be cancelled from the desk, and the assigned driver is told.
 * The portal page itself is covered by the every-button audit (requester
 * role) and the desktop layout audit.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const rideIds = [];
  const orgIds = [];
  const inHours = (h) => new Date(Date.now() + h * 3_600_000).toISOString();
  const body = { passengerName: "Mae Jemison", passengerPhone: "2405550188", pickup: PICKUP, destination: DEST, vehicleType: "standard" };

  try {
    section("An owner manages people; a requester cannot");
    const A = await admin.req("POST", "/api/admin/organizations", { name: "Upper Marlboro Adult Day", category: "medical" });
    check("organization created", A.status === 201, JSON.stringify(A.json?.message ?? A.status));
    orgIds.push(A.json.id);
    await admin.req("POST", `/api/admin/organizations/${A.json.id}/members`, { email: FIXTURES.rider.email, role: "owner" });
    check("owner lists people", (await rider.req("GET", `/api/org/${A.json.id}/members`)).status === 200);
    const added = await rider.req("POST", `/api/org/${A.json.id}/members`, { email: FIXTURES.driver.email, role: "requester" });
    check("owner adds a requester by email", added.status === 201 && added.json?.role === "requester", JSON.stringify(added.json));
    const asRequester = new Session(base); await asRequester.login(FIXTURES.driver.email);
    check("the new requester sees the organization", (await asRequester.req("GET", "/api/org/mine")).json?.some((m) => m.organization.id === A.json.id && m.role === "requester"));
    check("a requester cannot add people", (await asRequester.req("POST", `/api/org/${A.json.id}/members`, { email: FIXTURES.admin.email, role: "billing" })).status === 403);
    check("a requester cannot remove people", (await asRequester.req("DELETE", `/api/org/${A.json.id}/members/${FIXTURES.rider.id}`)).status === 403);
    check("an owner cannot remove themself", (await rider.req("DELETE", `/api/org/${A.json.id}/members/${FIXTURES.rider.id}`)).status === 400);
    check("owner sees the organization's detail", (await rider.req("GET", `/api/org/${A.json.id}`)).json?.name === "Upper Marlboro Adult Day");

    section("Any booker can cancel, whoever booked it");
    const byRequester = await asRequester.req("POST", `/api/org/${A.json.id}/jobs`, { ...body, scheduledAt: inHours(5) });
    check("requester books a job", byRequester.status === 201, JSON.stringify(byRequester.json?.message ?? byRequester.status));
    rideIds.push(byRequester.json.ride.id);
    const jobId = byRequester.json.job.id;
    const wrongOrg = await admin.req("POST", "/api/admin/organizations", { name: "Other Co", category: "business" });
    orgIds.push(wrongOrg.json.id);
    await admin.req("POST", `/api/admin/organizations/${wrongOrg.json.id}/members`, { email: FIXTURES.admin.email, role: "owner" });
    check("a job cannot be cancelled through another organization", (await admin.req("POST", `/api/org/${wrongOrg.json.id}/jobs/${jobId}/cancel`, {})).status === 404);
    const cancelled = await rider.req("POST", `/api/org/${A.json.id}/jobs/${jobId}/cancel`, { reason: "Patient admitted overnight" });
    check("owner cancels the requester's unclaimed job, free", cancelled.status === 200 && cancelled.json?.cancellationFee === "0.00" && cancelled.json?.ride?.status === "cancelled", JSON.stringify(cancelled.json));
    const { rows: [cj] } = await db.query("SELECT cancellation_fee FROM commercial_jobs WHERE id=$1", [jobId]);
    check("the job carries the fee for the statement", cj.cancellation_fee === "0.00");
    check("cancelling it again is refused", (await rider.req("POST", `/api/org/${A.json.id}/jobs/${jobId}/cancel`, {})).status === 409);
    const listed = await rider.req("GET", `/api/org/${A.json.id}/jobs`);
    check("the cancelled job shows as cancelled with nothing billed", listed.json?.find((j) => j.id === jobId)?.status === "cancelled" && listed.json?.find((j) => j.id === jobId)?.total === 0);

    section("A claimed job far ahead cancels free and the driver is told; one on the road cannot");
    const claimedJob = await rider.req("POST", `/api/org/${A.json.id}/jobs`, { ...body, passengerName: "Katherine Johnson", scheduledAt: inHours(6) });
    rideIds.push(claimedJob.json.ride.id);
    check("driver claims it", (await driver.req("POST", `/api/driver/rides/${claimedJob.json.ride.id}/claim`)).status === 200);
    const c2 = await rider.req("POST", `/api/org/${A.json.id}/jobs/${claimedJob.json.job.id}/cancel`, { reason: "Appointment moved" });
    check("claimed job six hours out cancels free", c2.status === 200 && c2.json?.cancellationFee === "0.00", JSON.stringify(c2.json));
    await new Promise((r) => setTimeout(r, 300));
    check("the driver is told the job was cancelled", /\[commercial\] job cancelled .*driver e2e-driver/.test(serverLog(server)));
    const onRoad = await rider.req("POST", `/api/org/${A.json.id}/jobs`, { ...body, passengerName: "Dorothy Vaughan", scheduledAt: inHours(4) });
    rideIds.push(onRoad.json.ride.id);
    await driver.req("POST", `/api/driver/rides/${onRoad.json.ride.id}/claim`);
    await driver.req("POST", `/api/driver/rides/${onRoad.json.ride.id}/confirm-scheduled`);
    await db.query("UPDATE rides SET scheduled_at = NOW() - interval '5 minutes' WHERE id=$1", [onRoad.json.ride.id]);
    check("driver starts it", (await driver.req("POST", `/api/driver/rides/${onRoad.json.ride.id}/start`)).status === 200);
    const c3 = await rider.req("POST", `/api/org/${A.json.id}/jobs/${onRoad.json.job.id}/cancel`, {});
    check("a job on the road cannot be cancelled from the desk", c3.status === 409 && /Call PG Ride/.test(c3.json?.message ?? ""), JSON.stringify(c3.json));
    check("driver completes it", (await driver.req("POST", `/api/driver/rides/${onRoad.json.ride.id}/complete`, {})).status === 200);
  } finally {
    await deleteRides(db, rideIds).catch(() => {});
    await deleteOrgs(db, orgIds).catch(() => {});
  }
}
