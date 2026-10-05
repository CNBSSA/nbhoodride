import { Session, check, section, FIXTURES } from "./harness.mjs";

/**
 * Admin → Reports → Payouts this year (issue #33, AH-060 #4): who PG Ride paid
 * in a tax year and who crossed the 1099-NEC threshold (server/taxYearToDate.ts).
 *
 * The journey works in 2024, a year nothing else in the suite pays in, so its
 * figures are exact: payouts are counted by when they were PAID, in Eastern
 * time, against that year's threshold ($600 for 2024); where the money was
 * sent never reaches the page; a fleet's EIN is masked; and only an admin
 * reads it.
 */
export async function run({ base, db }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const stamp = Date.now();
  const R = `e2e-ytd-${stamp}`;
  const SECRET = `acct-${stamp}-998877`;
  const PAYDAY = `2024-e2e-${stamp}`;

  try {
    section("Only an admin reads it");
    check("a rider is refused", (await rider.req("GET", "/api/admin/tax/year-to-date?year=2024")).status >= 401);

    section("Payouts are counted by the year they were paid, in Eastern time");
    await db.query(`INSERT INTO users (id, email, password, first_name, last_name, is_approved, registration_completed_at)
      SELECT $1, $2, password, 'Yetunde', 'Payee', true, NOW() FROM users WHERE id=$3`, [R, `${R}@example.com`, FIXTURES.rider.id]);
    await db.query(`INSERT INTO payout_requests (driver_id, amount, payout_method, payout_details, status, processed_at) VALUES
      ($1, '400.00', 'zelle', $2, 'paid', '2024-06-14T14:00:00Z'),
      ($1, '250.00', 'check', $2, 'paid', '2025-01-01T03:00:00Z'),
      ($1, '900.00', 'zelle', $2, 'paid', '2025-01-01T06:00:00Z'),
      ($1, '75.00',  'zelle', $2, 'pending', NULL),
      ($1, '60.00',  'zelle', $2, 'rejected', '2024-07-01T14:00:00Z')`, [R, SECRET]);
    const r = await admin.req("GET", "/api/admin/tax/year-to-date?year=2024");
    check("the admin reads 2024", r.status === 200 && r.json?.year === 2024, `${r.status} ${JSON.stringify(r.json?.message ?? "")}`);
    check("2024's threshold is $600", r.json?.threshold === 600, String(r.json?.threshold));
    const me = (r.json?.payees ?? []).find((p) => p.id === R);
    check("a payout made on New Year's Eve in Maryland (03:00 UTC on 1 January) counts for 2024, one made after midnight Eastern does not, and a rejected one never counts", me?.paid === 650 && me?.payouts === 2, JSON.stringify(me));
    check("over $600 reads over the threshold", me?.status === "over", String(me?.status));
    check("both methods are named", JSON.stringify(me?.methods?.slice().sort()) === JSON.stringify(["check", "zelle"]), JSON.stringify(me?.methods));
    check("a request still waiting is not counted in a past year", me?.pending === 0, String(me?.pending));
    check("where the money was sent never reaches the page", !JSON.stringify(r.json).includes(SECRET));
    check("the report says no W-9 is collected", r.json?.w9Collected === false);

    section("Fleets are in it, with the EIN masked");
    await db.query(`INSERT INTO fleet_payouts (organization_id, payday_key, amount, payout_method, payout_details, status, sent_at)
      VALUES ('e2e-fleet', $1, '120.00', 'zelle', $2, 'sent', '2024-03-08T15:00:00Z')`, [PAYDAY, SECRET]);
    const f = await admin.req("GET", "/api/admin/tax/year-to-date?year=2024");
    const fleet = (f.json?.payees ?? []).find((p) => p.id === "e2e-fleet" && p.kind === "fleet");
    check("the fleet's sent payout is counted", fleet?.paid >= 120, JSON.stringify(fleet));
    check("its EIN is masked", !fleet?.ein || /^XX-XXX\d{4}$/.test(fleet.ein), String(fleet?.ein));
    check("and its payout account is not shown", !JSON.stringify(f.json).includes(SECRET));

    section("This year shows what is waiting");
    const now = await admin.req("GET", "/api/admin/tax/year-to-date");
    const meNow = (now.json?.payees ?? []).find((p) => p.id === R);
    check("with no year given it is this year", now.status === 200 && now.json?.year === Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(new Date())), String(now.json?.year));
    check("the $75 asked for and not paid shows as waiting", meNow?.pending === 75, JSON.stringify(meNow));

    section("A year it does not cover is refused with a reason");
    const bad = await admin.req("GET", "/api/admin/tax/year-to-date?year=1999");
    check("1999 is refused", bad.status === 400 && /Choose a year/.test(bad.json?.message ?? ""), JSON.stringify(bad.json));
  } finally {
    await db.query("DELETE FROM fleet_payouts WHERE payday_key = $1", [PAYDAY]).catch(() => {});
    await db.query("DELETE FROM payout_requests WHERE driver_id = $1", [R]).catch(() => {});
    await db.query("DELETE FROM users WHERE id = $1", [R]).catch(async () => {
      await db.query("UPDATE users SET deleted_at = NOW() WHERE id = $1", [R]).catch(() => {});
    });
  }
}
