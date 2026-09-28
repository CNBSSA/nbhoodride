import { Session, check, section, serverLog, FIXTURES, tinyPng, tinyPdf } from "./harness.mjs";

/**
 * Fleet management accounts, slice 2 (PG Ride Fleet Management Accounts
 * Plan): a fleet's cars.
 *
 * The owner or a manager adds a car with photos and papers, each their own
 * upload; it waits parked for PG Ride's check; PG Ride sends it back with a
 * note or approves it, and only a checked car whose papers are in date is
 * ready; changing what the car IS sends it back to be checked; the hourly
 * sweep parks a ready car the hour a paper lapses and pages ops, and warns
 * ahead; a car's photos and papers are the fleet's desk's to see and
 * nobody else's.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const owner = new Session(base); await owner.login(FIXTURES.rider.email);      // owner of e2e-fleet (harness seed)
  const stranger = new Session(base); await stranger.login(FIXTURES.driver.email);
  const orgId = "e2e-fleet";
  const carIds = [], userIds = [];
  const logShows = async (re) => { for (let i = 0; i < 25; i++) { if (re.test(serverLog(server))) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
  const upload = async (session, pdf = false) => {
    const up = await session.req("POST", "/api/objects/upload?store=db", {});
    const path = new URL(up.json?.uploadURL ?? "http://x/").pathname;
    return (await session.req("PUT", path, pdf ? tinyPdf() : tinyPng(), { "Content-Type": pdf ? "application/pdf" : "image/png" })).status === 200 ? path : null;
  };
  const inDays = (d) => { const t = new Date(Date.now() + d * 86400_000); t.setUTCHours(10, 0, 0, 0); return t.toISOString(); };
  const inAYear = inDays(365);
  const year = new Date().getUTCFullYear() - 3;

  try {
    section("The owner adds a car with its photos and papers");
    const photos = [await upload(owner), await upload(owner), await upload(owner), await upload(owner)];
    const papers = { registrationDocUrl: await upload(owner, true), insuranceDocUrl: await upload(owner), inspectionDocUrl: await upload(owner, true) };
    check("the desk starts with the seeded cars, ready and parked", (await owner.req("GET", `/api/fleet/${orgId}/cars`)).json?.some((c) => c.id === "e2e-fleet-car" && c.status === "ready"));
    const strangerPhoto = await upload(stranger);
    const notYours = await owner.req("POST", `/api/fleet/${orgId}/cars`, { make: "Kia", model: "Soul", year, color: "Green", licensePlate: "FLT9001", photos: [strangerPhoto] });
    check("a photo someone else uploaded cannot be put on a fleet car", notYours.status === 403, `${notYours.status} ${notYours.json?.message}`);
    const bare = await owner.req("POST", `/api/fleet/${orgId}/cars`, { make: "Kia", model: "Soul", year, color: "Green", licensePlate: "FLT9001" });
    const carId = bare.json?.id; carIds.push(carId);
    check("a car is taken parked, waiting for PG Ride, with every gap named", bare.status === 201 && bare.json?.status === "parked" && bare.json?.reviewStatus === "pending" && ["VIN", "photos", "registration card", "insurance card", "inspection certificate", "not checked"].every((w) => (bare.json?.problems ?? []).join(" ").includes(w)), JSON.stringify(bare.json?.problems ?? bare.json?.message));
    check("PG Ride is paged to check it", await logShows(/A fleet car to check[\s\S]*E2E Fleet Motors[\s\S]*Kia Soul/));
    const filled = await owner.req("PATCH", `/api/fleet/${orgId}/cars/${carId}`, { vin: "KNDJN2A29F7000001", seats: 5, photos, ...papers, inspectionExpires: inAYear, registrationExpires: inAYear, insuranceExpires: inAYear });
    check("with everything on file it still waits for PG Ride's check", filled.status === 200 && filled.json?.status === "parked" && (filled.json?.problems ?? []).length === 1 && /not checked/.test(filled.json?.problems?.[0] ?? ""), JSON.stringify(filled.json?.problems ?? filled.json?.message));
    check("a stranger cannot see the fleet's cars", (await stranger.req("GET", `/api/fleet/${orgId}/cars`)).status === 403);
    check("nor add one", (await stranger.req("POST", `/api/fleet/${orgId}/cars`, { make: "X", model: "Y", year, color: "Z", licensePlate: "FLT9999" })).status === 403);
    const pendingFleet = await stranger.req("POST", "/api/fleet/e2e-fleet-app/cars", { make: "X", model: "Y", year, color: "Z", licensePlate: "FLT9998" });
    check("a fleet PG Ride has not approved cannot add cars yet", pendingFleet.status === 409 && /not approved/.test(pendingFleet.json?.message ?? ""), JSON.stringify(pendingFleet.json));

    section("Who may see a car's photos and papers");
    check("the fleet's desk may see the car's photo and its papers", (await owner.req("GET", photos[0])).status === 200 && (await owner.req("GET", papers.insuranceDocUrl)).status === 200);
    check("a stranger may not", (await stranger.req("GET", photos[0])).status === 403 && (await stranger.req("GET", papers.registrationDocUrl)).status === 403);
    check("an admin may", (await admin.req("GET", papers.registrationDocUrl)).status === 200);

    section("PG Ride checks the papers");
    const adminList = await admin.req("GET", `/api/admin/fleets/${orgId}/cars`);
    check("the operator sees the car with its VIN, papers and what is missing", adminList.status === 200 && adminList.json?.some((c) => c.id === carId && c.vin === "KNDJN2A29F7000001" && c.reviewStatus === "pending"), JSON.stringify((adminList.json ?? []).map((c) => c.id)));
    check("sending back needs a note", (await admin.req("POST", `/api/admin/fleets/${orgId}/cars/${carId}/review`, { decision: "reject" })).status === 400);
    check("a rider cannot record a check", (await owner.req("POST", `/api/admin/fleets/${orgId}/cars/${carId}/review`, { decision: "approve" })).status === 403);
    const back = await admin.req("POST", `/api/admin/fleets/${orgId}/cars/${carId}/review`, { decision: "reject", note: "The insurance card is personal cover, not rideshare" });
    check("PG Ride sends it back with a note", back.status === 200 && back.json?.reviewStatus === "rejected" && back.json?.status === "parked", JSON.stringify(back.json?.message ?? back.json?.reviewStatus));
    const seen = (await owner.req("GET", `/api/fleet/${orgId}/cars`)).json?.find((c) => c.id === carId);
    check("the desk sees the note", /personal cover/.test(seen?.reviewNote ?? "") && (seen?.problems ?? []).join(" ").includes("could not accept the papers"), JSON.stringify({ n: seen?.reviewNote, p: seen?.problems }));
    const newInsurance = await upload(owner);
    const fixed = await owner.req("PATCH", `/api/fleet/${orgId}/cars/${carId}`, { insuranceDocUrl: newInsurance });
    check("a new insurance card sends it back to be checked", fixed.status === 200 && fixed.json?.reviewStatus === "pending" && fixed.json?.reviewNote === null, JSON.stringify({ r: fixed.json?.reviewStatus, n: fixed.json?.reviewNote }));
    const ok = await admin.req("POST", `/api/admin/fleets/${orgId}/cars/${carId}/review`, { decision: "approve" });
    check("PG Ride approves, and the car is ready", ok.status === 200 && ok.json?.reviewStatus === "approved" && ok.json?.status === "ready" && (ok.json?.problems ?? []).length === 0, JSON.stringify(ok.json?.problems ?? ok.json?.message));
    const desk = await owner.req("GET", `/api/fleet/${orgId}`);
    check("the desk counts it ready", desk.json?.counts?.cars >= 3 && desk.json?.counts?.carsReady >= 2, JSON.stringify(desk.json?.counts));

    section("What the car IS is checked again; a colour or a photo is not");
    const repaint = await owner.req("PATCH", `/api/fleet/${orgId}/cars/${carId}`, { color: "Blue" });
    check("a repaint keeps the car ready", repaint.status === 200 && repaint.json?.status === "ready" && repaint.json?.reviewStatus === "approved", JSON.stringify({ s: repaint.json?.status, r: repaint.json?.reviewStatus }));
    const newPlate = await owner.req("PATCH", `/api/fleet/${orgId}/cars/${carId}`, { licensePlate: "FLT9002" });
    check("a new plate parks it until PG Ride checks again", newPlate.status === 200 && newPlate.json?.status === "parked" && newPlate.json?.reviewStatus === "pending", JSON.stringify({ s: newPlate.json?.status, r: newPlate.json?.reviewStatus }));
    check("and PG Ride is paged", await logShows(/A fleet car changed: check it again[\s\S]*FLT9002/));
    check("PG Ride approves again", (await admin.req("POST", `/api/admin/fleets/${orgId}/cars/${carId}/review`, { decision: "approve" })).json?.status === "ready");

    section("The sweep parks a car the hour a paper lapses, and warns ahead");
    await db.query("UPDATE fleet_cars SET insurance_expires = NOW() - interval '1 minute' WHERE id=$1", [carId]);
    const sweep = await admin.req("POST", "/api/admin/analytics/fleet-car-sweep", {});
    check("the sweep parks it", sweep.status === 200 && sweep.json?.parked >= 1, JSON.stringify(sweep.json));
    const { rows: [parkedRow] } = await db.query("SELECT status, parked_reason FROM fleet_cars WHERE id=$1", [carId]);
    check("and says why", parkedRow.status === "parked" && /Insurance/.test(parkedRow.parked_reason ?? ""), JSON.stringify(parkedRow));
    check("ops are told which fleet and car", await logShows(/Fleet car taken off the road[\s\S]*E2E Fleet Motors[\s\S]*FLT9002[\s\S]*Insurance/));
    await db.query("UPDATE fleet_cars SET insurance_expires = NOW() + interval '7 days' WHERE id=$1", [carId]);
    const warn = await admin.req("POST", "/api/admin/analytics/fleet-car-sweep", { warnings: true });
    check("seven days before a paper expires, ops are warned", warn.status === 200 && warn.json?.warned >= 1 && await logShows(/Fleet car document expiring[\s\S]*insurance[\s\S]*Days left[^\n]*7/), JSON.stringify(warn.json));
    const warned = (await owner.req("GET", `/api/fleet/${orgId}/cars`)).json?.find((c) => c.id === carId);
    check("and the desk shows the same warning", (warned?.warnings ?? []).some((w) => w.document === "insurance" && w.daysLeft === 7), JSON.stringify(warned?.warnings));
    const renewed = await owner.req("PATCH", `/api/fleet/${orgId}/cars/${carId}`, { insuranceExpires: inAYear });
    check("a renewed date is what the car IS, so PG Ride checks the new card first", renewed.status === 200 && renewed.json?.reviewStatus === "pending" && renewed.json?.status === "parked", JSON.stringify({ s: renewed.json?.status, r: renewed.json?.reviewStatus }));

    section("A manager may run cars; a viewer may only look");
    const managerEmail = `e2e-fleet-mgr-${Date.now()}@example.com`;
    const mgr = new Session(base); await mgr.csrf();
    await mgr.req("POST", "/api/auth/signup", { email: managerEmail, password: "Str0ng!Pass123", firstName: "Mo", lastName: "Manager", phone: "2405550166", termsAccepted: true, privacyAccepted: true });
    const { rows: [mgrUser] } = await db.query("SELECT id FROM users WHERE email=$1", [managerEmail]);
    await admin.req("POST", `/api/admin/users/${mgrUser.id}/approve`, {});
    await mgr.login(managerEmail, "Str0ng!Pass123");
    await admin.req("POST", `/api/admin/organizations/${orgId}/members`, { email: managerEmail, role: "viewer" });
    check("a viewer sees the cars", (await mgr.req("GET", `/api/fleet/${orgId}/cars`)).status === 200);
    check("but cannot change one", (await mgr.req("PATCH", `/api/fleet/${orgId}/cars/${carId}`, { color: "Red" })).status === 403);
    await admin.req("POST", `/api/admin/organizations/${orgId}/members`, { email: managerEmail, role: "manager" });
    check("a manager can", (await mgr.req("PATCH", `/api/fleet/${orgId}/cars/${carId}`, { color: "Red" })).json?.color === "Red");
    userIds.push(mgrUser.id);
  } finally {
    await db.query("DELETE FROM fleet_cars WHERE id = ANY($1::varchar[])", [carIds]).catch(() => {});
    await db.query("DELETE FROM organization_members WHERE user_id = ANY($1::varchar[])", [userIds]).catch(() => {});
    await db.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [userIds]).catch(() => {});
  }
}
