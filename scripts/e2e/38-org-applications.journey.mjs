import { Session, check, section, serverLog, FIXTURES } from "./harness.mjs";

/**
 * Self-serve organization applications (Festus 2026-09-28, from the product
 * feedback: "org onboarding is manual — email to you; systematize early").
 *
 * A clinic, an office or a restaurant opens its own booking account: it
 * applies with the organization's details, ops are paged, the desk opens on
 * the application's status, and nothing can be booked until PG Ride
 * approves; PG Ride sends it back with a note or approves it in Admin,
 * Organizations, the owner corrects and sends again, and an approved
 * account books like any account PG Ride created itself. The EIN is shown
 * masked to the desk and only the operator sees it in full.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const applicant = new Session(base); await applicant.csrf();
  const stranger = new Session(base); await stranger.login(FIXTURES.driver.email);
  const email = `e2e-orgapp-${Date.now()}@example.com`;
  const ids = [], orgIds = [];
  const logShows = async (re) => { for (let i = 0; i < 25; i++) { if (re.test(serverLog(server))) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };

  try {
    section("An organization applies for its own account");
    await applicant.req("POST", "/api/auth/signup", { email, password: "Str0ng!Pass123", firstName: "Bisi", lastName: "Clinic", phone: "2405550155", termsAccepted: true, privacyAccepted: true });
    const { rows: [user] } = await db.query("SELECT id FROM users WHERE email=$1", [email]);
    ids.push(user.id);
    await admin.req("POST", `/api/admin/users/${user.id}/approve`, {});
    await applicant.login(email, "Str0ng!Pass123");
    const bad = await applicant.req("POST", "/api/org/apply", { name: "", category: "fleet", ein: "12", businessType: "cult", contactPhone: "12" });
    check("an incomplete application is refused, naming every problem", bad.status === 400 && (bad.json?.problems ?? []).length === 6, JSON.stringify(bad.json));
    const applied = await applicant.req("POST", "/api/org/apply", { name: "Largo Dialysis", category: "medical", legalName: "Largo Dialysis Center LLC", ein: "12 3456780", businessType: "llc", contactPhone: "(240) 555-0155", address: "1 Main St, Largo, MD" });
    const orgId = applied.json?.id; orgIds.push(orgId);
    check("a complete one is taken as a medical account waiting for PG Ride, with the category's fee", applied.status === 201 && applied.json?.category === "medical" && applied.json?.status === "pending" && applied.json?.facilityFee === "4.00", JSON.stringify(applied.json?.message ?? applied.json?.status));
    check("PG Ride is paged with the business, never the full EIN", await logShows(/Organization application[\s\S]*Largo Dialysis Center LLC \(llc\), EIN XX-XXX6780/));
    check("a second application while one waits is refused", (await applicant.req("POST", "/api/org/apply", { name: "Again", category: "business", legalName: "Again LLC", ein: "123456789", businessType: "llc", contactPhone: "2405550155" })).status === 409);

    section("The desk opens on the application; nothing books until it is approved");
    const mine = await applicant.req("GET", "/api/org/mine");
    check("the applicant is the account's owner and the portal lists it, pending", (mine.json ?? []).some((m) => m.organization.id === orgId && m.role === "owner" && m.organization.status === "pending"), JSON.stringify(mine.json?.map((m) => [m.organization.id, m.organization.status])));
    const detail = await applicant.req("GET", `/api/org/${orgId}`);
    check("the desk sees the application with the EIN masked, and no raw details", detail.status === 200 && detail.json?.application?.ein === "XX-XXX6780" && !("businessDetails" in detail.json) && !("fleetDetails" in detail.json), JSON.stringify(Object.keys(detail.json ?? {})));
    const book = await applicant.req("POST", `/api/org/${orgId}/jobs`, { passengerName: "A Patient", pickup: { lat: 38.9, lng: -76.8, address: "1 Main St" }, destination: { lat: 38.91, lng: -76.81, address: "2 Main St" }, scheduledAt: new Date(Date.now() + 86400_000).toISOString() });
    check("booking is refused with words that say the account is not approved yet", book.status === 409 && /not approved/.test(book.json?.message ?? ""), JSON.stringify(book.json));
    const standing = await applicant.req("POST", `/api/org/${orgId}/standing-orders`, { passengerName: "A Patient" });
    check("so is a standing order", standing.status === 409 && /not approved/.test(standing.json?.message ?? ""), JSON.stringify(standing.json));
    const flip = await admin.req("PATCH", `/api/admin/organizations/${orgId}`, { status: "active" });
    check("the operator cannot simply set it active: the application is approved through its review", flip.status === 409 && /not been approved/.test(flip.json?.message ?? ""), JSON.stringify(flip.json));
    check("someone outside the account cannot open its desk", (await stranger.req("GET", `/api/org/${orgId}`)).status === 403);

    section("PG Ride sends it back, the owner corrects it, PG Ride approves");
    const list = await admin.req("GET", "/api/admin/organizations");
    const row = (list.json ?? []).find((o) => o.id === orgId);
    check("the operator's list shows it to check, with the EIN in full", row?.status === "pending" && row?.businessDetails?.ein === "12-3456780", JSON.stringify(row?.businessDetails));
    check("sending back needs a note", (await admin.req("POST", `/api/admin/organizations/${orgId}/review`, { decision: "reject" })).status === 400);
    check("a rider cannot record a check", (await applicant.req("POST", `/api/admin/organizations/${orgId}/review`, { decision: "approve" })).status === 403);
    const back = await admin.req("POST", `/api/admin/organizations/${orgId}/review`, { decision: "reject", note: "The EIN does not match the LLC's registration" });
    check("PG Ride sends it back with a note", back.status === 200 && back.json?.status === "rejected", JSON.stringify(back.json?.message ?? back.json?.status));
    const seen = await applicant.req("GET", `/api/org/${orgId}`);
    check("the owner sees the note", seen.json?.status === "rejected" && /does not match/.test(seen.json?.application?.reviewNote ?? ""), JSON.stringify(seen.json?.application));
    check("a stranger cannot correct it", (await stranger.req("PATCH", `/api/org/${orgId}/application`, { ein: "98-7654320" })).status === 403);
    const again = await applicant.req("PATCH", `/api/org/${orgId}/application`, { ein: "98-7654320" });
    check("the owner corrects the EIN and sends it again", again.status === 200 && again.json?.status === "pending" && again.json?.reviewNote === null && again.json?.businessDetails?.ein === "98-7654320", JSON.stringify(again.json?.message ?? again.json?.status));
    check("PG Ride is paged that it is back", await logShows(/Organization application sent again[\s\S]*Largo Dialysis/));
    const approved = await admin.req("POST", `/api/admin/organizations/${orgId}/review`, { decision: "approve" });
    check("PG Ride approves it", approved.status === 200 && approved.json?.status === "active", JSON.stringify(approved.json?.message ?? approved.json?.status));
    check("an approved account's details are no longer changed from the desk", (await applicant.req("PATCH", `/api/org/${orgId}/application`, { ein: "123456789" })).status === 409);
    const bookNow = await applicant.req("POST", `/api/org/${orgId}/jobs`, { passengerName: "A Patient", pickup: { lat: 38.9073, lng: -76.7781, address: "1 Main St, Bowie, MD" }, destination: { lat: 38.9123, lng: -76.7881, address: "2 Main St, Bowie, MD" }, scheduledAt: new Date(Date.now() + 86400_000).toISOString() });
    check("and the desk books like any account PG Ride created", bookNow.status === 201 && bookNow.json?.job?.jobNumber > 0, JSON.stringify(bookNow.json?.message ?? bookNow.json?.job?.jobNumber));
    check("an approved account can be paused and reopened as before", (await admin.req("PATCH", `/api/admin/organizations/${orgId}`, { status: "paused" })).json?.status === "paused" && (await admin.req("PATCH", `/api/admin/organizations/${orgId}`, { status: "active" })).json?.status === "active");
    check("and an account PG Ride creates itself is active at once, as it always was", (await admin.req("POST", "/api/admin/organizations", { name: "E2E Direct Office", category: "business" })).json?.status === "active");
    const { rows: direct } = await db.query("SELECT id FROM organizations WHERE name='E2E Direct Office'");
    for (const d of direct) orgIds.push(d.id);
  } finally {
    await db.query("DELETE FROM commercial_jobs WHERE organization_id = ANY($1::varchar[])", [orgIds]).catch(() => {});
    await db.query("DELETE FROM rides WHERE id IN (SELECT ride_id FROM commercial_jobs WHERE organization_id = ANY($1::varchar[]))", [orgIds]).catch(() => {});
    await db.query("DELETE FROM organization_members WHERE organization_id = ANY($1::varchar[])", [orgIds]).catch(() => {});
    await db.query("DELETE FROM organizations WHERE id = ANY($1::varchar[])", [orgIds]).catch(() => {});
    await db.query("DELETE FROM organization_members WHERE user_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM wallet_transactions WHERE user_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [ids]).catch(() => {});
  }
}
