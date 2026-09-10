import { Session, check, section, serverLog, deleteRides, deleteOrgs, FIXTURES, PICKUP, DEST } from "./harness.mjs";

/**
 * Slice 4: only a driver cleared for the work sees it or can take it. The
 * board hides a medical job from an unbadged driver and the claim route
 * refuses it outright; once the operator grants the badge, both open. The
 * passenger, who holds no account, is texted the driver's name and a
 * tracking link, and the driver records who received them at the far end.
 * Ordinary rides never need a badge.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const rideIds = [];
  const orgIds = [];
  const inHours = (h) => new Date(Date.now() + h * 3_600_000).toISOString();
  const board = async () => (await driver.req("GET", "/api/driver/scheduled-rides")).json;
  const onBoard = (b, rideId) => JSON.stringify(b ?? {}).includes(rideId);

  try {
    section("A driver starts cleared for nothing");
    const cleared = await admin.req("PUT", `/api/admin/drivers/${FIXTURES.driver.id}/badges`, { badges: [] });
    check("the operator can clear a driver's badges", cleared.status === 200 && cleared.json?.badges?.length === 0 && cleared.json?.summary === "Ordinary rides only", JSON.stringify(cleared.json));
    const mine = await driver.req("GET", "/api/driver/badges");
    check("the driver is told what they hold and what exists", mine.status === 200 && mine.json?.badges?.length === 0 && mine.json?.all?.length === 2 && mine.json.all.every((b) => b.held === false), JSON.stringify(mine.json));

    section("Unbadged: the work is neither shown nor claimable");
    const A = await admin.req("POST", "/api/admin/organizations", { name: "Suitland Kidney Care", category: "medical" });
    orgIds.push(A.json.id);
    await admin.req("POST", `/api/admin/organizations/${A.json.id}/members`, { email: FIXTURES.rider.email, role: "owner" });
    const job = await rider.req("POST", `/api/org/${A.json.id}/jobs`, { passengerName: "Ella Fitzgerald", passengerPhone: "2405550166", pickup: PICKUP, destination: DEST, scheduledAt: inHours(5) });
    check("a medical job is booked", job.status === 201, JSON.stringify(job.json?.message ?? job.status));
    const medicalRide = job.json.ride.id; rideIds.push(medicalRide);

    const ordinary = await rider.req("POST", "/api/rides", { pickupLocation: PICKUP, destinationLocation: DEST, estimatedFare: 20, paymentMethod: "card", scheduledAt: inHours(5) });
    check("an ordinary scheduled ride is booked too", ordinary.status === 200 || ordinary.status === 201, JSON.stringify(ordinary.json?.message ?? ordinary.status));
    const ordinaryRide = ordinary.json?.id ?? ordinary.json?.ride?.id; if (ordinaryRide) rideIds.push(ordinaryRide);

    const before = await board();
    check("the medical job is hidden from an unbadged driver", !onBoard(before, medicalRide));
    check("the ordinary ride is still on the same board", !ordinaryRide || onBoard(before, ordinaryRide), "ordinary ride missing");
    const refused = await driver.req("POST", `/api/driver/rides/${medicalRide}/claim`);
    check("claiming it is refused with the badge named and how to get it", refused.status === 403 && /Medical transport/.test(refused.json?.message ?? "") && /Ask PG Ride/.test(refused.json?.message ?? ""), JSON.stringify(refused.json));
    const { rows: [still] } = await db.query("SELECT driver_id, status FROM rides WHERE id=$1", [medicalRide]);
    check("the job is untouched by the refused claim", still.driver_id === null && still.status === "pending", JSON.stringify(still));

    section("The operator grants the badge");
    const granted = await admin.req("PUT", `/api/admin/drivers/${FIXTURES.driver.id}/badges`, { badges: ["medical", "nonsense"] });
    check("only real badges are granted", granted.status === 200 && JSON.stringify(granted.json?.badges) === JSON.stringify(["medical"]) && granted.json?.summary === "Medical transport", JSON.stringify(granted.json));
    const after = await board();
    check("the job appears on the board", onBoard(after, medicalRide));
    check("a delivery badge is still not held", (await driver.req("GET", "/api/driver/badges")).json?.all?.find((b) => b.id === "delivery")?.held === false);
    check("the driver claims it", (await driver.req("POST", `/api/driver/rides/${medicalRide}/claim`)).status === 200);

    section("The passenger is texted, and no account is needed");
    await new Promise((r) => setTimeout(r, 400));
    const log = serverLog(server);
    const line = log.split("\n").reverse().find((l) => l.includes("[commercial] passenger texted") && l.includes("Suitland Kidney Care")) ?? "";
    check("the passenger is texted the driver's name and a tracking link", /Suitland Kidney Care/.test(line), line.slice(0, 160));
    check("the message names the driver, the account and a guardian link", /Sam/.test(line) && /Suitland Kidney Care/.test(line) && /\/guardian\//.test(line) && /No app needed/.test(line), line.slice(0, 240));
    const { rows: [link] } = await db.query("SELECT share_token, guardian_name FROM guardian_links WHERE active_ride_id=$1 ORDER BY created_at DESC LIMIT 1", [medicalRide]);
    check("the link exists and is labelled for the passenger", !!link?.share_token && link.guardian_name === "Passenger", JSON.stringify(link));
    const anon = await fetch(`${base}/guardian/${link.share_token}`);
    check("it opens with no account at all", anon.status === 200);

    section("Who received the passenger");
    await driver.req("POST", `/api/driver/rides/${medicalRide}/confirm-scheduled`);
    await db.query("UPDATE rides SET scheduled_at = NOW() - interval '5 minutes' WHERE id=$1", [medicalRide]);
    await driver.req("POST", `/api/driver/rides/${medicalRide}/start`);
    const blank = await driver.req("POST", `/api/driver/rides/${medicalRide}/proof`, { receivedBy: "  " });
    check("a signature needs a name", blank.status === 400 && /who received/i.test(blank.json?.message ?? ""), JSON.stringify(blank.json));
    const notMine = await rider.req("POST", `/api/driver/rides/${medicalRide}/proof`, { receivedBy: "Someone" });
    check("only the driver holding the job can sign it", notMine.status === 403);
    const proof = await driver.req("POST", `/api/driver/rides/${medicalRide}/proof`, { receivedBy: "Nurse Adeyemi", note: "Handed over at the dialysis desk" });
    check("the driver records who received the passenger", proof.status === 200 && proof.json?.proof?.receivedBy === "Nurse Adeyemi" && !!proof.json?.proof?.signedAt, JSON.stringify(proof.json));
    check("driver completes the job", (await driver.req("POST", `/api/driver/rides/${medicalRide}/complete`, {})).status === 200);
    const { rows: [saved] } = await db.query("SELECT proof FROM commercial_jobs WHERE ride_id=$1", [medicalRide]);
    check("the signature is on the job for the statement and any dispute", saved.proof?.receivedBy === "Nurse Adeyemi" && saved.proof?.signedBy === FIXTURES.driver.id, JSON.stringify(saved.proof));

    section("An ordinary ride never needs a badge");
    await admin.req("PUT", `/api/admin/drivers/${FIXTURES.driver.id}/badges`, { badges: [] });
    if (ordinaryRide) {
      check("with no badges at all, the ordinary ride is still claimable", (await driver.req("POST", `/api/driver/rides/${ordinaryRide}/claim`)).status === 200);
    }
  } finally {
    // The fixture driver is cleared for everything between runs.
    await db.query("UPDATE driver_profiles SET badges=ARRAY['medical','delivery']::text[] WHERE user_id=$1", [FIXTURES.driver.id]).catch(() => {});
    await deleteRides(db, rideIds).catch(() => {});
    await deleteOrgs(db, orgIds).catch(() => {});
  }
}
