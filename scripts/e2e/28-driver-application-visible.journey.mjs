import { Session, check, section, serverLog, FIXTURES } from "./harness.mjs";

/**
 * Nobody waits invisibly.
 *
 * A driver applied on 2026-09-22, was told his application was pending, and
 * nothing ever appeared for the operator to approve. Two weaknesses met: a
 * driver's application is a row of its own that never shows in the pending
 * USERS queue (it belongs to the drivers queue), and an application that
 * fails to save tells nobody — the successful one pages ops, the failed one
 * only wrote a log line.
 *
 * So: an application that lands must be visible to the operator in the
 * drivers queue, an application that fails must page ops, and an applicant
 * who is already an approved rider must not be expected in the users queue.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const applicant = new Session(base); await applicant.csrf();
  const email = `e2e-applicant-${Date.now()}@example.com`;
  const ids = [];

  try {
    section("A rider who applies to drive is waiting in the drivers queue, not the users queue");
    const signup = await applicant.req("POST", "/api/auth/signup", {
      email, password: "Str0ng!Pass123", firstName: "Ada", lastName: "Applicant", phone: "2405550199", termsAccepted: true, privacyAccepted: true,
    });
    check("the rider signs up and is told they are pending approval", signup.status === 200 && signup.json?.pendingApproval === true, JSON.stringify(signup.json?.message ?? signup.status));
    const { rows: [row] } = await db.query("SELECT id FROM users WHERE email=$1", [email]);
    ids.push(row.id);
    const pending = await admin.req("GET", "/api/admin/users/pending");
    check("they are in the pending users queue while their account waits", (pending.json ?? []).some((u) => u.id === row.id), `pending=${(pending.json ?? []).length}`);

    // Approved as a rider. This is the state the real applicant was in: Active.
    await admin.req("POST", `/api/admin/users/${row.id}/approve`, {});
    const afterApproval = await admin.req("GET", "/api/admin/users/pending");
    check("once approved they leave the users queue", !(afterApproval.json ?? []).some((u) => u.id === row.id));

    await applicant.login(email, "Str0ng!Pass123");
    const applied = await applicant.req("POST", "/api/driver/profile", { licenseNumber: "D1234567", licenseState: "MD" });
    check("they apply to drive", applied.status === 200 && applied.json?.id, JSON.stringify(applied.json?.message ?? applied.status));
    check("applying does not make them a driver yet: approval is the only thing that does", (await db.query("SELECT is_driver FROM users WHERE id=$1", [row.id])).rows[0].is_driver !== true);
    // The card in the users list still reads "Rider" for them, which is why
    // the drivers queue is the one that has to carry the application.
    const stillNotInUsers = await admin.req("GET", "/api/admin/users/pending");
    check("they are NOT in the pending users queue — their account is already approved", !(stillNotInUsers.json ?? []).some((u) => u.id === row.id));
    const drivers = await admin.req("GET", "/api/admin/drivers");
    const mine = (drivers.json ?? []).find((d) => d.userId === row.id);
    check("they ARE in the drivers queue, waiting", !!mine && (!mine.approvalStatus || mine.approvalStatus === "pending"), JSON.stringify(mine && { status: mine.approvalStatus }));
    await new Promise((r) => setTimeout(r, 300));
    check("and the operator was paged the moment it landed", /New driver application/.test(serverLog(server)));

    section("An application that does not land says so, to them and to the operator");
    const before = serverLog(server).length;
    const refused = await applicant.req("POST", "/api/driver/profile", { licenseNumber: "" });
    // The second application is refused as a duplicate, not a failure: the
    // route is idempotent on purpose so a double tap cannot make two rows.
    check("applying twice returns the same application rather than a second one", refused.status === 200 && refused.json?.id === applied.json?.id, JSON.stringify(refused.json?.id));
    const { rows: [{ n }] } = await db.query("SELECT COUNT(*)::int AS n FROM driver_profiles WHERE user_id=$1", [row.id]);
    check("still exactly one application on file", n === 1, `rows=${n}`);

    // A fresh applicant whose form is refused: they are told, and so is ops.
    const other = new Session(base); await other.csrf();
    const email2 = `e2e-applicant2-${Date.now()}@example.com`;
    await other.req("POST", "/api/auth/signup", { email: email2, password: "Str0ng!Pass123", firstName: "Bem", lastName: "Applicant", phone: "2405550198", termsAccepted: true, privacyAccepted: true });
    const { rows: [row2] } = await db.query("SELECT id FROM users WHERE email=$1", [email2]);
    ids.push(row2.id);
    await admin.req("POST", `/api/admin/users/${row2.id}/approve`, {});
    await other.login(email2, "Str0ng!Pass123");
    const bad = await other.req("POST", "/api/driver/profile", { licenseNumber: "no", licenseState: "MARYLAND", vehicleYear: 1492 });
    check("a form that cannot be accepted is refused in words, not a 500", bad.status === 400 && (bad.json?.message ?? "").length > 3, `${bad.status} ${JSON.stringify(bad.json?.message)}`);
    await new Promise((r) => setTimeout(r, 300));
    check("and the operator is paged that an application failed, with the reason", /Driver application FAILED/.test(serverLog(server).slice(before)), serverLog(server).slice(before).split("\n").filter((l) => /application/i.test(l)).slice(-2).join(" | ").slice(0, 200));
    const { rows: [{ n: n2 }] } = await db.query("SELECT COUNT(*)::int AS n FROM driver_profiles WHERE user_id=$1", [row2.id]);
    check("nothing half-made is left behind for the operator to find", n2 === 0, `rows=${n2}`);
  } finally {
    await db.query("DELETE FROM driver_profiles WHERE user_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM wallet_transactions WHERE user_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [ids]).catch(() => {});
  }
}
