import { Session, check, section, serverLog, startServer, stopServer, FIXTURES } from "./harness.mjs";

/**
 * Fleet management accounts, slice 1 (PG Ride Fleet Management Accounts Plan;
 * Festus 2026-09-28: "25/75 of the driver's 85%").
 *
 * A fleet is a fourth kind of organization that supplies cars and drivers and
 * never books: an investor applies with the business's details, says how the
 * fleet is paid, and PG Ride approves it or sends it back with a note; the
 * owner corrects it and sends it again. A fleet has its own roles (owner,
 * manager, viewer, driver), never books a ride and is never billed. Each
 * switch covers only its own organizations: with fleets off nobody sees one,
 * and with commercial off the booking accounts are hidden but fleets work.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const stranger = new Session(base); await stranger.login(FIXTURES.driver.email);
  const investor = new Session(base); await investor.csrf();
  const email = `e2e-fleet-${Date.now()}@example.com`;
  const ids = [], orgIds = [];
  const logShows = async (re) => { for (let i = 0; i < 25; i++) { if (re.test(serverLog(server))) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };

  try {
    section("Each switch covers only its own organizations");
    const noFleet = await startServer({ FLEET_ENABLED: "false" });
    try {
      const r = new Session(noFleet.base); await r.login(FIXTURES.rider.email);
      const a = new Session(noFleet.base); await a.login(FIXTURES.admin.email);
      check("with fleets off, the fleet routes do not exist", (await r.req("GET", "/api/fleet/mine")).status === 404);
      check("nor PG Ride's review", (await a.req("POST", "/api/admin/fleets/e2e-fleet-app/review", { decision: "approve" })).status === 404);
      check("the app is told so", (await r.req("GET", "/api/payment/config")).json?.fleetEnabled === false);
      const mine = await r.req("GET", "/api/org/mine");
      check("the rider's own fleet is hidden from their organizations, the booking accounts are not", mine.status === 200 && !(mine.json ?? []).some((m) => m.organization.category === "fleet") && (mine.json ?? []).some((m) => m.organization.id === "e2e-org"), JSON.stringify((mine.json ?? []).map((m) => m.organization.id)));
      const list = await a.req("GET", "/api/admin/organizations");
      check("and from the operator's list", !(list.json ?? []).some((o) => o.category === "fleet"));
      check("a fleet cannot be opened by id either", (await a.req("GET", "/api/admin/organizations/e2e-fleet")).status === 404);
    } finally { await stopServer(noFleet); }
    const noCommercial = await startServer({ COMMERCIAL_ENABLED: "false" });
    try {
      const r = new Session(noCommercial.base); await r.login(FIXTURES.rider.email);
      const a = new Session(noCommercial.base); await a.login(FIXTURES.admin.email);
      const mine = await r.req("GET", "/api/org/mine");
      check("with commercial off and fleets on, the portal lists the fleet alone", mine.status === 200 && (mine.json ?? []).length >= 1 && (mine.json ?? []).every((m) => m.organization.category === "fleet"), JSON.stringify((mine.json ?? []).map((m) => m.organization.id)));
      check("the fleet desk works", (await r.req("GET", "/api/fleet/e2e-fleet")).status === 200);
      const list = await a.req("GET", "/api/admin/organizations");
      check("the operator sees fleets and no booking accounts", list.status === 200 && (list.json ?? []).every((o) => o.category === "fleet"), JSON.stringify((list.json ?? []).map((o) => o.category)));
      check("a booking account cannot be opened", (await a.req("GET", "/api/admin/organizations/e2e-org")).status === 404);
      check("nor created", (await a.req("POST", "/api/admin/organizations", { name: "X", category: "medical" })).status === 404);
    } finally { await stopServer(noCommercial); }

    section("An investor applies with the business's details");
    await investor.req("POST", "/api/auth/signup", { email, password: "Str0ng!Pass123", firstName: "Ife", lastName: "Investor", phone: "2405550177", termsAccepted: true, privacyAccepted: true });
    const { rows: [user] } = await db.query("SELECT id FROM users WHERE email=$1", [email]);
    ids.push(user.id);
    await admin.req("POST", `/api/admin/users/${user.id}/approve`, {});
    await investor.login(email, "Str0ng!Pass123");
    const bad = await investor.req("POST", "/api/fleet/apply", { name: "", ein: "123", businessType: "cult", contactPhone: "12" });
    check("an incomplete application is refused, naming every problem", bad.status === 400 && (bad.json?.problems ?? []).length === 5, JSON.stringify(bad.json));
    const applied = await investor.req("POST", "/api/fleet/apply", { name: "Largo Cars", legalName: "Largo Cars LLC", ein: "12 3456780", businessType: "llc", contactPhone: "(240) 555-0177" });
    const fleetId = applied.json?.id; orgIds.push(fleetId);
    check("a complete one is taken as a fleet waiting for PG Ride", applied.status === 201 && applied.json?.category === "fleet" && applied.json?.status === "pending", JSON.stringify(applied.json?.message ?? applied.json?.status));
    check("PG Ride is paged with the business, never the full EIN", await logShows(/Fleet application[\s\S]*Largo Cars LLC \(llc\), EIN XX-XXX6780/));
    check("a second application while one waits is refused", (await investor.req("POST", "/api/fleet/apply", { name: "Again", legalName: "Again LLC", ein: "123456789", businessType: "llc", contactPhone: "2405550177" })).status === 409);

    section("The fleet desk, for the fleet's own people only");
    const desk = await investor.req("GET", `/api/fleet/${fleetId}`);
    check("the owner sees where the application stands, the business and a masked EIN", desk.status === 200 && desk.json?.status === "pending" && desk.json?.role === "owner" && desk.json?.business?.ein === "XX-XXX6780" && desk.json?.business?.legalName === "Largo Cars LLC", JSON.stringify(desk.json));
    check("someone outside the fleet is refused", (await stranger.req("GET", `/api/fleet/${fleetId}`)).status === 403);
    const mine = await investor.req("GET", "/api/org/mine");
    check("the fleet is in the owner's organizations, so the /org portal opens on it", (mine.json ?? []).some((m) => m.organization.id === fleetId && m.role === "owner"));
    const listed = (mine.json ?? []).find((m) => m.organization.id === fleetId)?.organization ?? {};
    check("and that list carries no EIN, payout account or payment ids", !("fleetDetails" in listed) && !("payoutDetails" in listed) && !("stripeCustomerId" in listed) && !("defaultPaymentMethodId" in listed), JSON.stringify(Object.keys(listed)));
    check("a fleet never books: the booking routes do not serve it", (await investor.req("POST", `/api/org/${fleetId}/jobs`, {})).status === 404 && (await investor.req("GET", `/api/org/${fleetId}`)).status === 404);
    const adminBook = await admin.req("POST", `/api/admin/organizations/${fleetId}/jobs`, { passengerName: "X" });
    check("nor can PG Ride book for it", adminBook.status === 409 && /does not book/.test(adminBook.json?.message ?? ""), JSON.stringify(adminBook.json));

    section("PG Ride approves only a fleet that has said how it is paid");
    const tooSoon = await admin.req("POST", `/api/admin/fleets/${fleetId}/review`, { decision: "approve" });
    check("approving before a payout method is on file is refused, saying so", tooSoon.status === 409 && /how it is paid/.test(tooSoon.json?.message ?? ""), JSON.stringify(tooSoon.json));
    check("nor can the status simply be set to active", (await admin.req("PATCH", `/api/admin/organizations/${fleetId}`, { status: "active" })).status === 409);
    check("a payout method must be one PG Ride pays by", (await investor.req("PUT", `/api/fleet/${fleetId}/payout`, { payoutMethod: "crypto", payoutDetails: "x" })).status === 400);
    const payout = await investor.req("PUT", `/api/fleet/${fleetId}/payout`, { payoutMethod: "zelle", payoutDetails: "pay@largocars.example" });
    check("the owner saves the business's payout account", payout.status === 200 && payout.json?.payoutMethod === "zelle", JSON.stringify(payout.json));
    check("sending back needs a note", (await admin.req("POST", `/api/admin/fleets/${fleetId}/review`, { decision: "reject" })).status === 400);
    const back = await admin.req("POST", `/api/admin/fleets/${fleetId}/review`, { decision: "reject", note: "The EIN does not match the LLC's registration" });
    check("PG Ride sends it back with a note", back.status === 200 && back.json?.status === "rejected", JSON.stringify(back.json?.message ?? back.json?.status));
    const seen = await investor.req("GET", `/api/fleet/${fleetId}`);
    check("the owner sees the note", seen.json?.status === "rejected" && /does not match/.test(seen.json?.reviewNote ?? ""), JSON.stringify(seen.json?.reviewNote));
    const again = await investor.req("PATCH", `/api/fleet/${fleetId}/application`, { ein: "98-7654320" });
    check("the owner corrects the EIN and sends it again", again.status === 200 && again.json?.status === "pending" && again.json?.fleetDetails?.ein === "98-7654320" && again.json?.reviewNote === null, JSON.stringify(again.json?.message ?? again.json?.status));
    check("PG Ride is paged that it is back", await logShows(/Fleet application sent again[\s\S]*Largo Cars/));
    const approved = await admin.req("POST", `/api/admin/fleets/${fleetId}/review`, { decision: "approve" });
    check("PG Ride approves it", approved.status === 200 && approved.json?.status === "active", JSON.stringify(approved.json?.message ?? approved.json?.status));
    check("and the desk says so", (await investor.req("GET", `/api/fleet/${fleetId}`)).json?.status === "active");
    check("an approved fleet's business details are no longer changed from the desk", (await investor.req("PATCH", `/api/fleet/${fleetId}/application`, { ein: "123456789" })).status === 409);
    check("an approved fleet can be paused and reopened", (await admin.req("PATCH", `/api/admin/organizations/${fleetId}`, { status: "paused" })).json?.status === "paused" && (await admin.req("PATCH", `/api/admin/organizations/${fleetId}`, { status: "active" })).json?.status === "active");
    check("and never turned into a booking account", (await admin.req("PATCH", `/api/admin/organizations/${fleetId}`, { category: "medical" })).status === 400);

    section("A fleet's people hold a fleet's roles");
    const wrongRole = await admin.req("POST", `/api/admin/organizations/${fleetId}/members`, { email: FIXTURES.driver.email, role: "requester" });
    check("a booking role is refused on a fleet, naming the fleet's roles", wrongRole.status === 400 && /owner, manager, viewer or driver/.test(wrongRole.json?.message ?? ""), JSON.stringify(wrongRole.json));
    check("nor a fleet role on a booking account", (await admin.req("POST", "/api/admin/organizations/e2e-org/members", { email: FIXTURES.driver.email, role: "manager" })).status === 400);
    check("PG Ride adds a manager", (await admin.req("POST", `/api/admin/organizations/${fleetId}/members`, { email: FIXTURES.driver.email, role: "manager" })).status === 201);
    const asManager = await stranger.req("GET", `/api/fleet/${fleetId}`);
    check("a manager sees the desk, but not the payout account", asManager.status === 200 && asManager.json?.payout?.onFile === true && !("payoutDetails" in (asManager.json?.payout ?? {})), JSON.stringify(asManager.json?.payout));
    check("and cannot change how the fleet is paid", (await stranger.req("PUT", `/api/fleet/${fleetId}/payout`, { payoutMethod: "check", payoutDetails: "somewhere" })).status === 403);
    await admin.req("POST", `/api/admin/organizations/${fleetId}/members`, { email: FIXTURES.driver.email, role: "driver" });
    const asDriver = await stranger.req("GET", `/api/fleet/${fleetId}`);
    check("a driver is pointed to the driver app instead of the desk", asDriver.status === 403 && /driver app/.test(asDriver.json?.message ?? ""), JSON.stringify(asDriver.json));
    await admin.req("DELETE", `/api/admin/organizations/${fleetId}/members/${FIXTURES.driver.id}`);

    section("A fleet is paid, never billed");
    const run = await admin.req("POST", "/api/admin/analytics/weekly-billing", {});
    const { rows: [stmts] } = await db.query("SELECT count(*)::int AS n FROM commercial_statements WHERE organization_id=$1", [fleetId]);
    check("the Monday billing run passes the fleet by", run.status === 200 && stmts.n === 0, JSON.stringify({ s: run.status, n: stmts.n }));
  } finally {
    await db.query("DELETE FROM organization_members WHERE organization_id = ANY($1::varchar[])", [orgIds]).catch(() => {});
    await db.query("DELETE FROM organizations WHERE id = ANY($1::varchar[])", [orgIds]).catch(() => {});
    await db.query("DELETE FROM organization_members WHERE user_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [ids]).catch(() => {});
  }
}
