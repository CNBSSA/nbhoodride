import { Session, check, section, serverLog, FIXTURES } from "./harness.mjs";

/**
 * The driver funnel, front and center (Festus 2026-09-28, from the product
 * feedback: "your #1 risk is supply, and driver onboarding is buried").
 *
 * The application starts at sign-up: /drive and the landing page send an
 * applicant to /signup?drive=1, "I want to drive" creates their driver
 * application before they can even log in, ops are paged that a DRIVER
 * signed up, and the Drivers queue shows them at once. Once approved as a
 * person, the home screen tells them their next step and takes them to
 * their documents. And the application is the applicant's to fill in, never
 * to approve: the save routes take only their documents, so an app that
 * writes "approved" on its own application changes nothing.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const applicant = new Session(base); await applicant.csrf();
  const email = `e2e-funnel-${Date.now()}@example.com`;
  const ids = [];
  const logShows = async (re) => { for (let i = 0; i < 25; i++) { if (re.test(serverLog(server))) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };

  try {
    section("Every door to driving leads to the application");
    const drive = await fetch(`${base}/drive`);
    const html = await drive.text();
    check("/drive works signed out and sends drivers to sign up as drivers", drive.status === 200 && html.includes('href="/signup?drive=1"') && !html.includes('href="/signup">Start driving'), `${drive.status}`);
    check("and its first step says the application starts at sign-up", /I want to drive/.test(html));

    section("Signing up as a driver starts the application");
    const signup = await applicant.req("POST", "/api/auth/signup", { email, password: "Str0ng!Pass123", firstName: "Funmi", lastName: "Driver", phone: "2405550142", termsAccepted: true, privacyAccepted: true, wantsToDrive: true });
    check("the account is created, awaiting approval, with a driver application", signup.status === 200 && signup.json?.pendingApproval === true && signup.json?.driverApplication === true, JSON.stringify(signup.json?.message ?? signup.json));
    const { rows: [user] } = await db.query("SELECT id, is_driver, is_approved FROM users WHERE email=$1", [email]);
    ids.push(user.id);
    const { rows: [profile] } = await db.query("SELECT approval_status FROM driver_profiles WHERE user_id=$1", [user.id]);
    check("the application exists from minute one, pending, and nothing is approved", profile?.approval_status === "pending" && user.is_driver === false && user.is_approved === false, JSON.stringify({ profile, user }));
    check("ops are paged that a DRIVER signed up, with what to do next", await logShows(/wants to DRIVE[\s\S]*Funmi Driver[\s\S]*Approve the person in Admin/));
    const queue = await admin.req("GET", "/api/admin/drivers");
    check("the Drivers queue shows them before they can even log in", queue.status === 200 && (queue.json ?? []).some((d) => d.userId === user.id || d.user?.id === user.id || d.id === user.id), JSON.stringify((queue.json ?? []).map((d) => d.userId ?? d.user?.id ?? d.id).slice(-3)));
    const plain = await applicant.req("POST", "/api/auth/signup", { email: `e2e-rider-${Date.now()}@example.com`, password: "Str0ng!Pass123", firstName: "Ola", lastName: "Rider", phone: "2405550143", termsAccepted: true, privacyAccepted: true });
    if (plain.json?.user?.id) ids.push(plain.json.user.id);
    const { rows: [noApp] } = await db.query("SELECT count(*)::int AS n FROM driver_profiles WHERE user_id=$1", [plain.json?.user?.id ?? "none"]);
    check("a plain sign-up starts no application", plain.status === 200 && plain.json?.driverApplication === false && noApp.n === 0, JSON.stringify({ d: plain.json?.driverApplication, n: noApp.n }));

    section("Once approved as a person, the next step is on the home screen");
    check("PG Ride approves the person", (await admin.req("POST", `/api/admin/users/${user.id}/approve`, {})).status === 200);
    check("the applicant logs in", (await applicant.login(email, "Str0ng!Pass123")).status === 200);
    const me = await applicant.req("GET", "/api/auth/user");
    check("their account carries the pending application the home banner reads", me.json?.driverProfile?.approvalStatus === "pending" && me.json?.isDriver === false && !me.json?.driverProfile?.licenseImageUrl, JSON.stringify({ s: me.json?.driverProfile?.approvalStatus, d: me.json?.isDriver }));
    const again = await applicant.req("POST", "/api/driver/profile", { userId: user.id });
    check("tapping Apply on Profile finds the application already there", again.status === 200 && again.json?.approvalStatus === "pending");

    section("An application is filled in by the applicant, never approved by them");
    const tamper = await applicant.req("PUT", "/api/driver/profile", { approvalStatus: "approved", badges: ["medical", "delivery"], isVerifiedNeighbor: true, licenseNumber: "F1234567" });
    const { rows: [after] } = await db.query("SELECT approval_status, badges, is_verified_neighbor, license_number FROM driver_profiles WHERE user_id=$1", [user.id]);
    check("an app that writes approved, badges and verified on its own application saves only its licence number", tamper.status === 200 && after.approval_status === "pending" && !(after.badges ?? []).length && after.is_verified_neighbor !== true && after.license_number === "F1234567", JSON.stringify(after));
    check("and cannot go online", (await applicant.req("POST", "/api/driver/toggle-status", { isOnline: true })).status === 403);
    const nothing = await applicant.req("PUT", "/api/driver/profile", { approvalStatus: "approved" });
    check("a save with nothing of the applicant's in it is refused, saying what it takes", nothing.status === 400 && /licence|license/i.test(nothing.json?.message ?? ""), JSON.stringify(nothing.json));
    const tamperCreate = new Session(base);
    const email2 = `e2e-funnel2-${Date.now()}@example.com`;
    await tamperCreate.csrf();
    const s2 = await tamperCreate.req("POST", "/api/auth/signup", { email: email2, password: "Str0ng!Pass123", firstName: "Tobi", lastName: "Tamper", phone: "2405550144", termsAccepted: true, privacyAccepted: true });
    if (s2.json?.user?.id) ids.push(s2.json.user.id);
    await admin.req("POST", `/api/admin/users/${s2.json?.user?.id}/approve`, {});
    await tamperCreate.login(email2, "Str0ng!Pass123");
    const created = await tamperCreate.req("POST", "/api/driver/profile", { approvalStatus: "approved", badges: ["medical"], licenseNumber: "T7654321" });
    check("nor can an application be created already approved", created.status === 200 && created.json?.approvalStatus === "pending" && !(created.json?.badges ?? []).length, JSON.stringify({ s: created.json?.approvalStatus, b: created.json?.badges }));
    check("so that applicant cannot go online either", (await tamperCreate.req("POST", "/api/driver/toggle-status", { isOnline: true })).status === 403);
  } finally {
    await db.query("DELETE FROM driver_profiles WHERE user_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM wallet_transactions WHERE user_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [ids]).catch(() => {});
  }
}
