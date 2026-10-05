import { Session, check, section, FIXTURES } from "./harness.mjs";

/**
 * Admin → Reports (2026-10-05): two read-only views of production data that
 * until now needed SQL in Railway's console, which neither Festie nor a
 * working session can reach (server/adminReports.ts).
 *
 * The reliability timeline counts what the server recorded in a window and
 * lists its hourly heartbeats; the rider-balance report counts riders who
 * still hold money in the old Virtual PG Card balance and says what put it
 * there. Only an admin may read either; nothing writes.
 */
export async function run({ base, db }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const stamp = Date.now();
  const R = `e2e-rep-rider-${stamp}`;
  // A window far from anything else the suite writes.
  const from = "2031-03-10T03:00:00Z", to = "2031-03-10T08:00:00Z";

  try {
    section("Only an admin reads the reports");
    check("a rider is refused the timeline", (await rider.req("GET", `/api/admin/reports/reliability-events?from=${from}&to=${to}`)).status >= 401);
    check("and the balances", (await rider.req("GET", "/api/admin/reports/rider-balances")).status >= 401);

    section("The reliability timeline shows when the heartbeats stopped");
    await db.query(`INSERT INTO reliability_events (kind, page, message, created_at) VALUES
      ('watch_ran', 'minute-sweep', 'e2e', '2031-03-10T03:10:00Z'),
      ('watch_ran', 'minute-sweep', 'e2e', '2031-03-10T04:10:00Z'),
      ('client_crash', '/ride', 'e2e', '2031-03-10T04:20:00Z'),
      ('watch_ran', 'minute-sweep', 'e2e', '2031-03-10T09:10:00Z')`);
    const t = await admin.req("GET", `/api/admin/reports/reliability-events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    check("the admin reads it", t.status === 200, `${t.status} ${JSON.stringify(t.json?.message ?? "")}`);
    check("only the events inside the window are counted", t.json?.total === 3, JSON.stringify(t.json?.byKind));
    check("the last heartbeat in the window is named, so a silence after it shows", t.json?.lastHeartbeat === "2031-03-10T04:10:00Z", String(t.json?.lastHeartbeat));
    check("heartbeats are counted by hour", JSON.stringify(t.json?.byHour) === JSON.stringify([{ hour: "2031-03-10T03:00Z", count: 1, heartbeats: 1 }, { hour: "2031-03-10T04:00Z", count: 2, heartbeats: 1 }]), JSON.stringify(t.json?.byHour));
    // Past the 500 listed events, the last heartbeat must still be the real one
    // (Cursor Bugbot on #458).
    await db.query(`INSERT INTO reliability_events (kind, page, message, created_at)
      SELECT 'client_crash', '/ride', 'e2e', '2031-03-11T01:00:00Z'::timestamp + (g * interval '1 second') FROM generate_series(1, 520) g`);
    await db.query(`INSERT INTO reliability_events (kind, page, message, created_at) VALUES ('watch_ran', 'minute-sweep', 'e2e', '2031-03-11T05:00:00Z')`);
    const busy = await admin.req("GET", "/api/admin/reports/reliability-events?from=2031-03-11T00:00Z&to=2031-03-11T06:00Z");
    check("on a busy window the last heartbeat is found past the listed events", busy.json?.truncated === true && busy.json?.lastHeartbeat === "2031-03-11T05:00:00Z", JSON.stringify({ truncated: busy.json?.truncated, listed: busy.json?.events?.length, last: busy.json?.lastHeartbeat }));
    const bad = await admin.req("GET", "/api/admin/reports/reliability-events?from=2031-03-01T00:00Z&to=2031-03-20T00:00Z");
    check("a window longer than 7 days is refused with a reason", bad.status === 400 && /at most 7 days/.test(bad.json?.message ?? ""), JSON.stringify(bad.json));
    const backwards = await admin.req("GET", `/api/admin/reports/reliability-events?from=${encodeURIComponent(to)}&to=${encodeURIComponent(from)}`);
    check("and a window that ends before it starts", backwards.status === 400, `${backwards.status}`);

    section("The rider-balance report counts riders, not drivers, and says where the money came from");
    const before = await admin.req("GET", "/api/admin/reports/rider-balances");
    check("the admin reads it", before.status === 200 && typeof before.json?.riders === "number", JSON.stringify(before.json));
    await db.query(`INSERT INTO users (id, email, password, first_name, last_name, is_approved, virtual_card_balance, registration_completed_at)
      SELECT $1, $2, password, 'Bola', 'Balance', true, '7.50', NOW() FROM users WHERE id=$3`, [R, `${R}@example.com`, FIXTURES.rider.id]);
    await db.query(`INSERT INTO wallet_transactions (user_id, amount, balance_after, reason) VALUES ($1, '7.50', '7.50', 'goodwill_credit')`, [R]);
    const after = await admin.req("GET", "/api/admin/reports/rider-balances");
    check("one more rider holds a balance, $7.50 more in all", after.json?.riders === before.json.riders + 1 && Math.abs(after.json?.total - before.json.total - 7.5) < 0.001, JSON.stringify({ before: before.json?.riders, after: after.json?.riders, total: after.json?.total }));
    check("the rider is listed with what put the money there", (after.json?.list ?? []).some((r) => r.userId === R && r.balance === 7.5 && r.lastCredit === "goodwill_credit"), JSON.stringify((after.json?.list ?? []).filter((r) => r.userId === R)));
    check("and the credits are summed by source", (after.json?.bySource ?? []).some((s) => s.reason === "goodwill_credit" && s.amount >= 7.5), JSON.stringify(after.json?.bySource));
    const { rows: [drv] } = await db.query("SELECT virtual_card_balance AS b FROM users WHERE id=$1", [FIXTURES.driver.id]);
    await db.query("UPDATE users SET virtual_card_balance = '99.00' WHERE id=$1", [FIXTURES.driver.id]);
    const withDriver = await admin.req("GET", "/api/admin/reports/rider-balances");
    check("a driver's earnings are never counted as a rider's balance", withDriver.json?.riders === after.json?.riders && !(withDriver.json?.list ?? []).some((r) => r.userId === FIXTURES.driver.id), JSON.stringify(withDriver.json?.riders));
    await db.query("UPDATE users SET virtual_card_balance = $2 WHERE id=$1", [FIXTURES.driver.id, drv?.b ?? "0.00"]);
  } finally {
    await db.query("DELETE FROM reliability_events WHERE created_at >= '2031-03-10' AND created_at < '2031-03-12' AND message = 'e2e'").catch(() => {});
    // The ledger is append-only, so the test rider is closed, not deleted: a
    // zero balance and a deleted_at keep them out of every later count.
    await db.query("UPDATE users SET virtual_card_balance = '0.00', deleted_at = NOW() WHERE id=$1", [R]).catch(() => {});
  }
}
