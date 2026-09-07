import { Session, check, section, serverLog, deleteRides, FIXTURES, PICKUP, DEST } from "./harness.mjs";

/**
 * Rider Promise Review — the 4:00 AM Eastern Telegram report on whether
 * riders got where they were going. Seeds one of each outcome into
 * "yesterday" (relative to a chosen review moment), builds the review over
 * the real API, and checks every number and line; then drives the real
 * once-a-day send path and its idempotency.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base);
  check("admin logs in", (await admin.login(FIXTURES.admin.email)).status === 200);

  // Review "tomorrow at 4:30 AM Eastern-ish": its window is today's Eastern
  // day, so everything seeded relative to that window lands inside it.
  const at = new Date(Date.now() + 24 * 3_600_000);
  const probe = await admin.req("GET", `/api/admin/analytics/rider-promise-review?at=${encodeURIComponent(at.toISOString())}`);
  check("review builds for an arbitrary moment", probe.status === 200 && probe.json?.window?.start && probe.json?.window?.end, JSON.stringify(probe.json?.message ?? probe.status));
  const start = new Date(probe.json.window.start);
  const end = new Date(probe.json.window.end);
  check("window is one Eastern calendar day ending before the review moment", end - start >= 23 * 3_600_000 && end - start <= 25 * 3_600_000 && end <= at, `${start.toISOString()} → ${end.toISOString()}`);
  const mid = new Date(start.getTime() + 12 * 3_600_000);
  const h = (n) => new Date(mid.getTime() + n * 3_600_000);
  const loc = (p) => JSON.stringify(p);
  const seeded = [];
  const seed = async (cols) => {
    const keys = Object.keys(cols);
    const { rows: [r] } = await db.query(
      `INSERT INTO rides (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`,
      keys.map((k) => cols[k]));
    seeded.push(r.id);
    return r.id;
  };
  const common = { rider_id: FIXTURES.rider.id, pickup_location: loc(PICKUP), destination_location: loc(DEST), payment_method: "card" };

  section("Yesterday: one of every outcome");
  const kept = await seed({ ...common, driver_id: FIXTURES.driver.id, status: "completed", estimated_fare: "23.21", actual_fare: "23.21", scheduled_at: h(-3), arrived_at: new Date(h(-3).getTime() + 2 * 60_000), completed_at: h(-2), created_at: h(-9) });
  const wrongFare = await seed({ ...common, driver_id: FIXTURES.driver.id, status: "completed", estimated_fare: "23.21", actual_fare: "7.12", promo_discount_applied: "0.00", created_at: h(-1), completed_at: h(0) });
  const promoOk = await seed({ ...common, driver_id: FIXTURES.driver.id, status: "completed", estimated_fare: "23.21", actual_fare: "18.21", promo_discount_applied: "5.00", created_at: h(-1), completed_at: h(0) });
  const endedEarly = await seed({ ...common, driver_id: FIXTURES.driver.id, status: "completed", estimated_fare: "23.21", actual_fare: "9.00", cancelled_by: FIXTURES.rider.id, cancelled_by_role: "rider", created_at: h(1), completed_at: h(2) });
  const stranded = await seed({ ...common, status: "cancelled", cancelled_by: "system", cancelled_by_role: "system", estimated_fare: "20.00", scheduled_at: h(-2), reminder_stamps: JSON.stringify({ w120: "x", w15: "x", w5: "x" }), created_at: h(-8) });
  const nearMiss = await seed({ ...common, driver_id: FIXTURES.driver.id, status: "completed", estimated_fare: "20.00", actual_fare: "20.00", scheduled_at: h(2), arrived_at: new Date(h(2).getTime() + 12 * 60_000), completed_at: h(3), reminder_stamps: JSON.stringify({ w5: "x" }), created_at: h(-8) });
  const riderCancelled = await seed({ ...common, status: "cancelled", cancelled_by: FIXTURES.rider.id, cancelled_by_role: "rider", estimated_fare: "20.00", created_at: h(3) });
  const driverBailed = await seed({ ...common, driver_id: FIXTURES.driver.id, status: "cancelled", cancelled_by: FIXTURES.driver.id, cancelled_by_role: "driver", estimated_fare: "20.00", created_at: h(4) });

  section("Tomorrow: what is at risk");
  const { rows: [plan] } = await db.query(
    `INSERT INTO weekly_ride_plans (rider_id, label, pickup, destination, days, departure_hour, departure_minute, full_fare, per_ride_fare)
     VALUES ($1, 'e2e review plan', $2, $3, '[1,2,3,4,5]', 17, 30, '23.21', '20.89') RETURNING id`, [FIXTURES.rider.id, loc(PICKUP), loc(DEST)]);
  const soonUnclaimed = await seed({ ...common, status: "pending", estimated_fare: "20.00", scheduled_at: new Date(at.getTime() + 6 * 3_600_000), created_at: h(5) });
  const planUnclaimed = await seed({ ...common, status: "pending", estimated_fare: "20.89", scheduled_at: new Date(at.getTime() + 20 * 3_600_000), plan_id: plan.id, ride_type: "weekly_plan", created_at: h(5) });
  const claimedAhead = await seed({ ...common, driver_id: FIXTURES.driver.id, status: "accepted", estimated_fare: "20.00", scheduled_at: new Date(at.getTime() + 8 * 3_600_000), created_at: h(5) });

  try {
    section("The four numbers");
    const r = await admin.req("GET", `/api/admin/analytics/rider-promise-review?at=${encodeURIComponent(at.toISOString())}`);
    const m = r.json?.metrics ?? {};
    check("review builds", r.status === 200 && m.booked !== undefined, JSON.stringify(r.json?.message ?? r.status));
    check("delivered counts every completed ride", m.delivered >= 4, `delivered=${m.delivered}`);
    check("failed counts the driver bail-out and the stranding, not the rider's own cancellation", m.failed >= 2 && m.riderCancelled >= 1, `failed=${m.failed} riderCancelled=${m.riderCancelled}`);
    check("stranding: reached T-5 with no driver and never completed", m.strandings >= 1, `strandings=${m.strandings}`);
    check("near-miss: reached T-5 with no driver, driver still came", m.nearMisses >= 1, `nearMisses=${m.nearMisses}`);
    const dev = (m.fareDeviations ?? []).map((d) => d.rideId);
    check("fare mismatch lists the $7.12 ride", dev.includes(wrongFare), JSON.stringify(m.fareDeviations));
    check("a promo ride charged quote-minus-promo is not a mismatch", !dev.includes(promoOk));
    check("a ride ended early (metered on purpose) is not a mismatch", !dev.includes(endedEarly));
    check("the on-quote ride is not a mismatch", !dev.includes(kept));
    check("late pickup counted, worst at 12 min", m.latePickups >= 1 && m.worstLateMinutes >= 12, `late=${m.latePickups} worst=${m.worstLateMinutes}`);
    check("looking ahead: the unclaimed ride inside 12h is flagged", m.ahead?.unclaimedInDangerWindow >= 1 && m.ahead?.unclaimedNext24h >= 2, JSON.stringify(m.ahead));
    check("looking ahead: the unclaimed plan ride and the active plan are counted", m.ahead?.unclaimedPlanRides >= 1 && m.ahead?.activePlans >= 1, JSON.stringify(m.ahead));
    const text = r.json?.text ?? "";
    check("message is named so it can't be confused with the code-health report", text.startsWith("🚦 Rider Promise Review — "));
    check("verdict is red with broken promises", text.includes("🔴") && /promises? broken/.test(text), text.split("\n")[1]);
    check("message names the mismatched ride with both figures", text.includes(`ride ${wrongFare.slice(0, 8)}: quoted $23.21, charged $7.12`));
    check("message flags the danger-window ride", text.includes("inside 12h ⚠️"));
    check("message fits a Telegram post", text.length < 4096, `len=${text.length}`);

    section("The 4:00 AM send: once a day, never twice, never early");
    // `end` is Eastern midnight after the reviewed day, so end + 2.5h is
    // 2:30 AM Eastern (too early) and end + 4.5h is 4:30 AM (due).
    const early = new Date(end.getTime() + 2.5 * 3_600_000);
    const due = new Date(end.getTime() + 4.5 * 3_600_000);
    const notDue = await admin.req("POST", "/api/admin/analytics/rider-promise-review", { at: early.toISOString() });
    check("before 4 AM Eastern nothing is sent", notDue.status === 200 && notDue.json?.sent === false && notDue.json?.reason === "not_due", JSON.stringify(notDue.json));
    const sent = await admin.req("POST", "/api/admin/analytics/rider-promise-review", { at: due.toISOString() });
    check("at the review hour the day is claimed and the report goes out", sent.status === 200 && sent.json?.sent === true && typeof sent.json?.text === "string", JSON.stringify(sent.json?.reason ?? sent.json?.sent));
    await new Promise((res) => setTimeout(res, 300));
    const log = serverLog(server);
    check("server records the send", (log.match(/\[rider-promise-review\] sent for /g) || []).length >= 1);
    check("the report that went out is the one for the reviewed day", (sent.json?.text ?? "").includes(probe.json.window.dayLabel), sent.json?.text?.split("\n")[0]);
    const again = await admin.req("POST", "/api/admin/analytics/rider-promise-review", { at: new Date(due.getTime() + 60_000).toISOString() });
    check("a minute later the same day is not sent again", again.status === 200 && again.json?.sent === false && again.json?.reason === "already_sent", JSON.stringify(again.json));
  } finally {
    await deleteRides(db, seeded).catch(() => {});
    await db.query("DELETE FROM weekly_ride_plans WHERE id=$1", [plan.id]).catch(() => {});
    await db.query("DELETE FROM processed_webhook_events WHERE provider='rider_promise_review'").catch(() => {});
  }
}
