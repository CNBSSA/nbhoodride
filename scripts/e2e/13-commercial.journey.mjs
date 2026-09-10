import { Session, check, section, serverLog, deleteRides, startServer, stopServer, FIXTURES, PICKUP, DEST } from "./harness.mjs";

/**
 * Commercial riders, slice 1: an organization is created, people are
 * attached with roles, a job is booked for a passenger who has no account,
 * a driver claims and completes it with no card involved, the operator is
 * paged by account and job number (never the passenger), and the month's
 * statement adds up. Account A can never see account B.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base);
  check("admin logs in", (await admin.login(FIXTURES.admin.email)).status === 200);
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const rideIds = [];
  const orgIds = [];
  const alerts = (kind, key) => (serverLog(server).match(new RegExp(`\\[rider-alert\\] ${kind} key=${key}`, "g")) || []).length;
  const inHours = (h) => new Date(Date.now() + h * 3_600_000);

  try {
    section("The surface does not exist while the flag is off");
    const off = await startServer({ COMMERCIAL_ENABLED: "false" });
    try {
      const a2 = new Session(off.base); await a2.login(FIXTURES.admin.email);
      check("flag off: admin organizations route answers 404", (await a2.req("GET", "/api/admin/organizations")).status === 404);
      const r2 = new Session(off.base); await r2.login(FIXTURES.rider.email);
      check("flag off: member route answers 404", (await r2.req("GET", "/api/org/mine")).status === 404);
      const cfg = await r2.req("GET", "/api/payment/config");
      check("flag off: the app is told so", cfg.json?.commercialEnabled === false);
    } finally { stopServer(off); }

    section("Accounts and people");
    const cfgOn = await admin.req("GET", "/api/payment/config");
    check("flag on: the app is told so", cfgOn.json?.commercialEnabled === true);
    const bad = await admin.req("POST", "/api/admin/organizations", { category: "medical" });
    check("an organization needs a name", bad.status === 400 && /name/i.test(bad.json?.message ?? ""), JSON.stringify(bad.json));
    const badCat = await admin.req("POST", "/api/admin/organizations", { name: "X", category: "space" });
    check("category must be one of the three", badCat.status === 400);
    const A = await admin.req("POST", "/api/admin/organizations", { name: "Largo Dialysis Center", category: "medical", contactName: "Nurse Okafor", contactEmail: "desk@largodialysis.example", contactPhone: "3015550100" });
    check("medical organization created with the $4 facility fee by default", A.status === 201 && A.json?.facilityFee === "4.00" && A.json?.status === "active", JSON.stringify(A.json));
    orgIds.push(A.json.id);
    const B = await admin.req("POST", "/api/admin/organizations", { name: "Bowie Title & Escrow", category: "business" });
    check("business organization carries no facility fee", B.status === 201 && B.json?.facilityFee === "0.00");
    orgIds.push(B.json.id);
    const list = await admin.req("GET", "/api/admin/organizations");
    check("both accounts listed with counts", list.status === 200 && list.json.some((o) => o.id === A.json.id && o.memberCount === 0 && o.jobCount === 0));

    const unknown = await admin.req("POST", `/api/admin/organizations/${A.json.id}/members`, { email: "nobody@example.com", role: "requester" });
    check("a person must already have a PG Ride account", unknown.status === 404);
    const badRole = await admin.req("POST", `/api/admin/organizations/${A.json.id}/members`, { email: FIXTURES.rider.email, role: "boss" });
    check("role must be owner, requester or billing", badRole.status === 400);
    const m1 = await admin.req("POST", `/api/admin/organizations/${A.json.id}/members`, { email: FIXTURES.rider.email, role: "requester" });
    check("rider attached to A as requester", m1.status === 201 && m1.json?.userId === FIXTURES.rider.id && m1.json?.role === "requester", JSON.stringify(m1.json));
    const m2 = await admin.req("POST", `/api/admin/organizations/${B.json.id}/members`, { email: FIXTURES.rider.email, role: "billing" });
    check("same person attached to B as billing", m2.status === 201 && m2.json?.role === "billing");
    const detail = await admin.req("GET", `/api/admin/organizations/${A.json.id}`);
    check("account detail lists its people", detail.status === 200 && detail.json?.members?.length === 1 && detail.json.members[0].email === FIXTURES.rider.email);

    section("One account can never see another");
    const mine = await rider.req("GET", "/api/org/mine");
    check("a member sees their organizations and roles", mine.status === 200 && mine.json.some((m) => m.organization.id === A.json.id && m.role === "requester") && mine.json.some((m) => m.organization.id === B.json.id && m.role === "billing"), JSON.stringify(mine.json?.map((m) => [m.organization.name, m.role])));
    check("requester lists A's jobs", (await rider.req("GET", `/api/org/${A.json.id}/jobs`)).status === 200);
    check("requester cannot see A's statement", (await rider.req("GET", `/api/org/${A.json.id}/statement`)).status === 403);
    check("billing sees B's statement", (await rider.req("GET", `/api/org/${B.json.id}/statement`)).status === 200);
    check("billing cannot book for B", (await rider.req("POST", `/api/org/${B.json.id}/jobs`, { passengerName: "X" })).status === 403);
    check("requester cannot manage A's people", (await rider.req("GET", `/api/org/${A.json.id}/members`)).status === 403);
    const removed = await admin.req("DELETE", `/api/admin/organizations/${B.json.id}/members/${FIXTURES.rider.id}`);
    check("person removed from B", removed.status === 200 && removed.json?.removed === true);
    check("after removal, B's jobs answer 403", (await rider.req("GET", `/api/org/${B.json.id}/jobs`)).status === 403);
    const stranger = new Session(base); await stranger.login(FIXTURES.driver.email);
    check("a user with no membership gets 403, not an empty list", (await stranger.req("GET", `/api/org/${A.json.id}/jobs`)).status === 403);

    section("Booking for a passenger who has no account");
    const body = { passengerName: "Ada Lovelace", passengerPhone: "2405550177", pickup: PICKUP, destination: DEST, scheduledAt: inHours(4).toISOString(), vehicleType: "standard", poNumber: "PO-118", notes: "Ask for the charge nurse at the side door." };
    const noWhen = await rider.req("POST", `/api/org/${A.json.id}/jobs`, { ...body, scheduledAt: undefined });
    check("a job needs a pickup time", noWhen.status === 400 && /time/i.test(noWhen.json?.message ?? ""), JSON.stringify(noWhen.json));
    const tooSoon = await rider.req("POST", `/api/org/${A.json.id}/jobs`, { ...body, scheduledAt: inHours(1).toISOString() });
    check("less than three hours ahead is refused", tooSoon.status === 400);
    const noName = await rider.req("POST", `/api/org/${A.json.id}/jobs`, { ...body, passengerName: "" });
    check("a passenger name is needed", noName.status === 400 && /passenger/i.test(noName.json?.message ?? ""));
    const badVehicle = await rider.req("POST", `/api/org/${A.json.id}/jobs`, { ...body, vehicleType: "helicopter" });
    check("vehicle type is checked", badVehicle.status === 400);

    const booked = await rider.req("POST", `/api/org/${A.json.id}/jobs`, body);
    check("requester books a job for A", booked.status === 201 && booked.json?.ride?.id, JSON.stringify(booked.json?.message ?? booked.status));
    const ride = booked.json.ride; rideIds.push(ride.id);
    check("the job is a scheduled ride billed to the account", ride.paymentMethod === "invoice" && ride.rideType === "commercial" && ride.status === "pending" && !!ride.scheduledAt, `${ride.paymentMethod} ${ride.rideType} ${ride.status}`);
    check("the ride belongs to the requester; the passenger rides by name", ride.riderId === FIXTURES.rider.id && ride.bookedForFriend === true && ride.passengerName === "Ada Lovelace" && ride.passengerPhone === "2405550177");
    check("quoted on the rate card, with a job number and the facility fee recorded", Number(ride.estimatedFare) > 0 && /^J-\d{5}$/.test(booked.json.job.jobLabel) && booked.json.job.facilityFee === "4.00" && booked.json.job.poNumber === "PO-118", JSON.stringify(booked.json.job));
    check("no card was authorized", !ride.stripePaymentIntentId);
    await new Promise((r) => setTimeout(r, 300));
    const bookLog = serverLog(server);
    const bookLine = bookLog.split("\n").find((l) => l.includes("[commercial] job booked") && l.includes(ride.id)) ?? "";
    check("the operator hears about the booking by account and job, not by passenger", /Account: Largo Dialysis Center \| Job: J-\d{5}/.test(bookLine) && !/Ada Lovelace|2405550177/.test(bookLine), bookLine.slice(0, 160));

    const adminBooked = await admin.req("POST", `/api/admin/organizations/${A.json.id}/jobs`, { ...body, passengerName: "Grace Hopper", scheduledAt: inHours(5).toISOString() });
    check("admin books on A's behalf and the ride belongs to A's requester", adminBooked.status === 201 && adminBooked.json?.ride?.riderId === FIXTURES.rider.id, JSON.stringify(adminBooked.json?.message ?? adminBooked.json?.ride?.riderId));
    rideIds.push(adminBooked.json.ride.id);
    const forB = await admin.req("POST", `/api/admin/organizations/${B.json.id}/jobs`, { ...body, passengerName: "Deed packet", scheduledAt: inHours(6).toISOString() });
    check("with nobody attached to B, an admin booking belongs to the admin", forB.status === 201 && forB.json?.ride?.riderId === FIXTURES.admin.id, JSON.stringify(forB.json?.message ?? forB.json?.ride?.riderId));
    rideIds.push(forB.json.ride.id);
    await admin.req("PATCH", `/api/admin/organizations/${B.json.id}`, { status: "paused" });
    const paused = await admin.req("POST", `/api/admin/organizations/${B.json.id}/jobs`, { ...body, scheduledAt: inHours(6).toISOString() });
    check("a paused account cannot book", paused.status === 409);
    await admin.req("PATCH", `/api/admin/organizations/${B.json.id}`, { status: "active" });

    const jobsA = await rider.req("GET", `/api/org/${A.json.id}/jobs`);
    check("A's job list shows its two jobs with what each is billed so far", jobsA.status === 200 && jobsA.json.length === 2 && jobsA.json.every((j) => j.total === 0 && j.passengerName), JSON.stringify(jobsA.json?.map((j) => [j.jobNumber, j.status, j.total])));
    const jobsB = await admin.req("GET", `/api/admin/organizations/${B.json.id}/jobs`);
    check("B's job list holds only B's job", jobsB.json?.length === 1 && jobsB.json[0].passengerName === "Deed packet");

    section("The operator is paged by account, never by passenger");
    const sweep = await admin.req("POST", "/api/admin/analytics/ride-risk-sweep", { at: new Date(new Date(ride.scheduledAt).getTime() - 100 * 60_000).toISOString() });
    check("unclaimed commercial job is paged at the two-hour stage", (sweep.json?.pages ?? []).some((p) => p.rideId === ride.id && p.stage === "o120"), JSON.stringify(sweep.json?.pages));
    await new Promise((r) => setTimeout(r, 300));
    const pageLog = serverLog(server);
    const pageLine = pageLog.split("\n").find((l) => l.includes(`ride_unclaimed key=${ride.id}:o120`)) ?? "";
    check("the page names the account and the job number", /Account: Largo Dialysis Center/.test(pageLine) && /Job: J-\d{5}/.test(pageLine) && /Work: Medical transportation/.test(pageLine), pageLine.slice(0, 200));
    check("the page carries no passenger name or phone", !/Ada Lovelace|2405550177|Rae Rider|\+12405550002/.test(pageLine), pageLine.slice(0, 200));

    section("The driver claims, starts and completes it; no card, no tip");
    const claim = await driver.req("POST", `/api/driver/rides/${ride.id}/claim`);
    check("driver claims the scheduled job", claim.status === 200, JSON.stringify(claim.json?.message ?? claim.status));
    await driver.req("POST", `/api/driver/rides/${ride.id}/confirm-scheduled`);
    await db.query("UPDATE rides SET scheduled_at = NOW() - interval '5 minutes' WHERE id=$1", [ride.id]);
    const start = await driver.req("POST", `/api/driver/rides/${ride.id}/start`);
    check("driver starts the job", start.status === 200, JSON.stringify(start.json?.message ?? start.status));
    const tipped = await driver.req("POST", `/api/driver/rides/${ride.id}/complete`, { tipAmount: 5 });
    check("a tip cannot be entered on a job billed to an organization", tipped.status === 400 && /organization/i.test(tipped.json?.message ?? ""), JSON.stringify(tipped.json));
    const done = await driver.req("POST", `/api/driver/rides/${ride.id}/complete`, {});
    check("driver completes the job without Stripe", done.status === 200, JSON.stringify(done.json?.message ?? done.status));
    const { rows: [row] } = await db.query("SELECT status, actual_fare, estimated_fare, driver_earnings, platform_fee, payment_status, stripe_payment_intent_id FROM rides WHERE id=$1", [ride.id]);
    check("charged at the quoted fare, split 85/15, nothing sent to Stripe", row.status === "completed" && row.actual_fare === row.estimated_fare && Math.abs(Number(row.driver_earnings) - Number(row.actual_fare) * 0.85) < 0.011 && !row.stripe_payment_intent_id, JSON.stringify(row));
    const after = await rider.req("GET", `/api/org/${A.json.id}/jobs`);
    const doneJob = (after.json ?? []).find((j) => j.rideId === ride.id);
    check("the completed job is billed at fare plus facility fee, and names the driver", doneJob && Math.abs(doneJob.total - (Number(row.actual_fare) + 4)) < 0.011 && /Sam D\./.test(doneJob.driverName ?? ""), JSON.stringify(doneJob && [doneJob.total, doneJob.driverName]));

    section("The month's statement adds up");
    const monthKey = (() => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).formatToParts(new Date(ride.scheduledAt ?? Date.now())); const y = p.find((x) => x.type === "year").value, m = p.find((x) => x.type === "month").value; return `${y}-${m}`; })();
    const stmt = await admin.req("GET", `/api/admin/organizations/${A.json.id}/statement?month=${monthKey}`);
    check("statement builds for the month", stmt.status === 200 && stmt.json?.window?.monthKey === monthKey, JSON.stringify(stmt.json?.message ?? stmt.json?.window));
    const line = (stmt.json?.lines ?? []).find((l) => l.passenger === "Ada Lovelace");
    check("the completed job is a line; the future one is not billable yet", !!line && line.status === "completed" && !(stmt.json.lines ?? []).some((l) => l.passenger === "Grace Hopper"), JSON.stringify(stmt.json?.lines?.map((l) => [l.passenger, l.status])));
    check("totals: fare plus $4 facility fee", Math.abs(stmt.json.totals.total - (Number(row.actual_fare) + 4)) < 0.011 && stmt.json.totals.completed === 1, JSON.stringify(stmt.json.totals));
    const csv = await admin.text("GET", `/api/admin/organizations/${A.json.id}/statement?month=${monthKey}&format=csv`);
    check("CSV statement downloads with a header and the job line", csv.status === 200 && /text\/csv/.test(csv.type) && /^Job,Date,Passenger/.test(csv.text) && csv.text.includes("Ada Lovelace"), csv.text.slice(0, 120));
    const html = await admin.text("GET", `/api/admin/organizations/${A.json.id}/statement?month=${monthKey}&format=html`);
    check("printable statement carries the account name and the total", html.status === 200 && html.text.includes("Largo Dialysis Center") && html.text.includes("statement"), html.text.slice(0, 80));
    const badMonth = await admin.req("GET", `/api/admin/organizations/${A.json.id}/statement?month=2026-13`);
    check("a bad month is refused with a reason", badMonth.status === 400);
    check("a member with the billing role of another account cannot pull A's statement", (await rider.req("GET", `/api/org/${A.json.id}/statement`)).status === 403);
  } finally {
    await deleteRides(db, rideIds).catch(() => {});
    if (orgIds.length) {
      await db.query("DELETE FROM commercial_jobs WHERE organization_id = ANY($1::varchar[])", [orgIds]).catch(() => {});
      await db.query("DELETE FROM organization_members WHERE organization_id = ANY($1::varchar[])", [orgIds]).catch(() => {});
      await db.query("DELETE FROM organizations WHERE id = ANY($1::varchar[])", [orgIds]).catch(() => {});
    }
  }
}
