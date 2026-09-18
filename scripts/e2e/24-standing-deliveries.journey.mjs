/**
 * Standing deliveries: a business account books the same parcel to the same
 * recipient on the same days; the sweep books a week ahead, once per day;
 * each job is a real delivery with its handover; the account pays.
 */
import { Session, check, section, deleteRides, deleteOrgs, FIXTURES, PICKUP, DEST } from "./harness.mjs";

export async function run({ base, db }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const orgIds = [];
  try {
    const shop = await admin.req("POST", "/api/admin/organizations", { name: "Daily Bread Bakery", category: "food" });
    const orgId = shop.json.id; orgIds.push(orgId);
    await admin.req("POST", `/api/admin/organizations/${orgId}/members`, { email: FIXTURES.rider.email, role: "owner" });
    const clinic = await admin.req("POST", "/api/admin/organizations", { name: "Some Clinic", category: "medical" });
    orgIds.push(clinic.json.id);
    await admin.req("POST", `/api/admin/organizations/${clinic.json.id}/members`, { email: FIXTURES.rider.email, role: "owner" });
    const order = (extra = {}) => ({
      kind: "delivery", parcelSize: "medium", handover: "reception", pickupContact: { name: "Bakery counter" }, dropContact: { name: "Hotel kitchen", phone: "3015550190" },
      passengerName: "ignored for a parcel", pickup: PICKUP, destination: DEST, days: [0, 1, 2, 3, 4, 5, 6], departureHour: 7, departureMinute: 30, returnMode: "fixed", returnHour: 9, returnMinute: 0, windowHours: 3, ...extra,
    });

    section("Only a delivery account, and only billed to the account");
    const wrongKind = await rider.req("POST", `/api/org/${clinic.json.id}/standing-orders`, order());
    check("a medical account cannot set up a standing parcel", wrongKind.status === 409 && /books rides, not deliveries/.test(wrongKind.json?.message ?? ""), JSON.stringify(wrongKind.json));
    const recipientPays = await rider.req("POST", `/api/org/${orgId}/standing-orders`, order({ payer: "recipient" }));
    check("a standing delivery cannot be recipient-pays", recipientPays.status === 400 && /billed to your account/.test(recipientPays.json?.message ?? ""), JSON.stringify(recipientPays.json));
    const noSize = await rider.req("POST", `/api/org/${orgId}/standing-orders`, order({ parcelSize: "pallet" }));
    check("the parcel needs a size", noSize.status === 400, JSON.stringify(noSize.json));

    section("A standing parcel books a week of deliveries, once each");
    const so = await rider.req("POST", `/api/org/${orgId}/standing-orders`, order());
    check("created, with the recipient as the name, no return leg, the size and handover kept", so.status === 201 && so.json?.kind === "delivery" && so.json?.passengerName === "Hotel kitchen" && so.json?.returnMode === "none" && so.json?.parcelSize === "medium" && so.json?.handover === "reception" && so.json?.booked >= 5, JSON.stringify({ kind: so.json?.kind, name: so.json?.passengerName, rm: so.json?.returnMode, booked: so.json?.booked, message: so.json?.message }));
    const jobs = await rider.req("GET", `/api/org/${orgId}/jobs?from=${new Date().toISOString()}&to=${new Date(Date.now() + 10 * 86_400_000).toISOString()}`);
    const mine = (jobs.json ?? []).filter((j) => j.parcel);
    check("every booked job is a real parcel with its handover and contacts, billed to the account", mine.length >= 5 && mine.every((j) => j.parcel.parcelSize === "medium" && j.parcel.handover === "reception" && j.parcel.dropContact?.name === "Hotel kitchen" && j.recipientApproval === "none" && /Ready|deliver by/.test(j.delivery ?? "")), JSON.stringify(mine[0] ? { parcel: mine[0].parcel, approval: mine[0].recipientApproval, delivery: mine[0].delivery } : jobs.json?.length));
    const { rows: [{ n: perDay }] } = await db.query("SELECT count(*)::int AS n FROM commercial_jobs WHERE standing_order_id=$1 GROUP BY service_date ORDER BY n DESC LIMIT 1", [so.json.id]);
    check("one job per service day", perDay === 1, `max per day=${perDay}`);
    const again = await admin.req("POST", "/api/admin/analytics/materialize-standing-orders");
    const { rows: [{ n: total }] } = await db.query("SELECT count(*)::int AS n FROM commercial_jobs WHERE standing_order_id=$1", [so.json.id]);
    check("running the sweep again books nothing new", again.status === 200 && total === so.json.booked, `total=${total} booked=${so.json.booked}`);
    const paused = await rider.req("POST", `/api/org/${orgId}/standing-orders/${so.json.id}/pause`);
    check("it can be paused like any standing order", paused.status === 200 && paused.json?.isActive === false, JSON.stringify(paused.json?.isActive));

    section("What a request body cannot do (post-implementation audit)");
    const forged = await rider.req("POST", `/api/org/${orgId}/deliveries`, { parcelSize: "small", pickupContact: { name: "Counter" }, dropContact: { name: "Someone" }, readyAt: new Date(Date.now() + 90 * 60_000).toISOString(), windowHours: 2, pickup: PICKUP, destination: DEST, standing: { orderId: so.json.id, serviceDate: "2099-01-01", leg: "out" } });
    const { rows: [forgedRow] } = await db.query("SELECT standing_order_id, service_date FROM commercial_jobs WHERE id=$1", [forged.json?.job?.id]);
    check("a one-off delivery cannot stamp itself as a standing order's occurrence", forged.status === 201 && forgedRow?.standing_order_id === null && forgedRow?.service_date === null, JSON.stringify(forgedRow));
    const parcelJob = mine[0];
    const noReturn = await rider.req("POST", `/api/org/${orgId}/jobs/${parcelJob.id}/return`, { readyInMinutes: 30 });
    check("a parcel has no return leg", noReturn.status === 409 && /no return leg/.test(noReturn.json?.message ?? ""), JSON.stringify(noReturn.json));
    const badPhone = await rider.req("POST", `/api/org/${orgId}/standing-orders`, order({ dropContact: { name: "Hotel kitchen", phone: "12345" } }));
    check("a bad phone on a standing order is refused once, not failed every day", badPhone.status === 400 && /10-digit/.test(badPhone.json?.message ?? ""), JSON.stringify(badPhone.json));
  } finally {
    for (const id of orgIds) {
      const { rows } = await db.query("SELECT ride_id FROM commercial_jobs WHERE organization_id=$1", [id]).catch(() => ({ rows: [] }));
      await deleteRides(db, rows.map((r) => r.ride_id)).catch(() => {});
    }
    await deleteOrgs(db, orgIds).catch(() => {});
  }
}
