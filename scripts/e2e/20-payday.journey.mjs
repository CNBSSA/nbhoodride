import { Session, check, section, serverLog, FIXTURES } from "./harness.mjs";

/**
 * Payday: a driver is paid on a date they can plan around, without asking.
 *
 * Before this, earnings sat in a balance until the driver requested a payout
 * and somebody actioned it by hand. There was no payday. This walks the
 * Friday run: who gets paid, who does not and why, that it cannot pay twice,
 * and that a balance is never taken without a payout request to account for
 * it.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const D = FIXTURES.driver.id;

  const balance = async () => Number((await db.query("SELECT COALESCE(virtual_card_balance,'0') AS b FROM users WHERE id=$1", [D])).rows[0].b);
  const requests = async () => (await db.query("SELECT amount, payout_method, payout_details, status FROM payout_requests WHERE driver_id=$1 ORDER BY created_at DESC", [D])).rows;
  const setBalance = (v) => db.query("UPDATE users SET virtual_card_balance=$2 WHERE id=$1", [D, v]);
  const setMethod = (m, d) => db.query("UPDATE driver_profiles SET payout_method=$2, payout_details=$3 WHERE user_id=$1", [D, m, d]);
  // A Friday at 9am Eastern; the key is unique per run so claims never collide.
  const friday = new Date("2026-09-11T13:00:00Z").toISOString();
  const payday = (at) => admin.req("POST", "/api/admin/analytics/payday", { at });

  // Payday is claimed once per Friday, and the claim lives in the database.
  // These journeys use fixed Fridays, so a previous run's claims would make
  // this one silently do nothing. Clear ours before and after.
  const KEYS = ["2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02"];
  const clearClaims = () => db.query(
    "DELETE FROM processed_webhook_events WHERE provider='weekly_payday' AND event_id = ANY($1::varchar[])", [KEYS]);
  await clearClaims();

  const before = await requests();

  try {
    section("A driver with nowhere to send it is not paid, and is named");
    await setMethod(null, null);
    await setBalance("120.00");
    const noMethod = await payday(friday);
    check("the run happens", noMethod.status === 200 && noMethod.json?.ran === true, JSON.stringify(noMethod.json?.message ?? noMethod.status));
    const skippedMe = (noMethod.json?.skipped ?? []).find((l) => l.driverId === D);
    check("the driver is skipped for having no payout method", /payout method/i.test(skippedMe?.reason ?? ""), JSON.stringify(skippedMe));
    check("and their money is untouched", await balance() === 120, String(await balance()));
    await new Promise((r) => setTimeout(r, 300));
    check("the operator is told who is owed money with nowhere to send it", /Waiting on a payout method/.test(serverLog(server)));

    section("With a method on file, the whole balance is paid");
    await setMethod("zelle", "3015550002");
    const run2 = await payday(new Date("2026-09-18T13:00:00Z").toISOString());
    const line = (run2.json?.paid ?? []).find((l) => l.driverId === D);
    check("the driver is paid the whole balance", line?.amount === 120 && line?.paid === true, JSON.stringify(line));
    check("their balance is now zero", await balance() === 0, String(await balance()));
    const reqs = await requests();
    check("a payout request exists for exactly that amount, to their saved method",
      reqs.length === before.length + 1 && Number(reqs[0].amount) === 120 && reqs[0].payout_method === "zelle" && reqs[0].payout_details === "3015550002",
      JSON.stringify(reqs[0]));
    check("and it waits for the operator to send it", reqs[0].status === "pending", String(reqs[0].status));

    section("The same payday cannot pay twice");
    const again = await payday(new Date("2026-09-18T19:00:00Z").toISOString());
    check("a second run on the same Friday does nothing", again.json?.ran === false && /already run/i.test(again.json?.message ?? ""), JSON.stringify(again.json));
    check("no extra payout request appears", (await requests()).length === before.length + 1);

    section("A balance under the minimum rides to next Friday");
    await setBalance("4.99");
    const small = await payday(new Date("2026-09-25T13:00:00Z").toISOString());
    const rode = (small.json?.skipped ?? []).find((l) => l.driverId === D);
    check("it is not paid out in pennies", /next Friday/i.test(rode?.reason ?? ""), JSON.stringify(rode));
    check("and the balance is still theirs", await balance() === 4.99, String(await balance()));

    section("A driver whose suspended flag is NULL is still paid");
    // is_suspended is nullable. Filtering it with `= false` would drop a
    // NULL row silently: unpaid, AND missing from the skipped list, so the
    // operator would never know. Nothing writes NULL today; this makes sure
    // a future something cannot hide a driver's money.
    await db.query("UPDATE driver_profiles SET is_suspended=NULL WHERE user_id=$1", [D]);
    await setBalance("50.00");
    await setMethod("zelle", "3015550002");
    const nullRun = await payday(new Date("2026-10-02T13:00:00Z").toISOString());
    const nullPaid = (nullRun.json?.paid ?? []).find((l) => l.driverId === D);
    check("NULL is read as not suspended, and the driver is paid", !!nullPaid && nullPaid.amount === 50, JSON.stringify(nullPaid ?? nullRun.json?.skipped));
    check("and their balance was taken, not left behind", await balance() === 0, String(await balance()));
    await db.query("UPDATE driver_profiles SET is_suspended=false WHERE user_id=$1", [D]);
  } finally {
    await db.query("UPDATE driver_profiles SET is_suspended=false WHERE user_id=$1", [D]).catch(() => {});
    await clearClaims().catch(() => {});
    await setBalance("0.00").catch(() => {});
    await setMethod(null, null).catch(() => {});
    await db.query("DELETE FROM payout_requests WHERE driver_id=$1 AND created_at > NOW() - interval '5 minutes'", [D]).catch(() => {});
  }
}
