import { Session, check, section, serverLog, deleteRides, FIXTURES, PICKUP, DEST } from "./harness.mjs";
import { spawnSync } from "node:child_process";

/**
 * Proactive reliability: the operator is paged about a ride in trouble
 * before the rider is, a white-screen crash reaches the operator, and the
 * Rider Promise Review counts both the next morning.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base);
  check("admin logs in", (await admin.login(FIXTURES.admin.email)).status === 200);
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
  const common = { rider_id: FIXTURES.rider.id, pickup_location: loc(PICKUP), destination_location: loc(DEST), payment_method: "card", estimated_fare: "20.00" };
  const now = new Date();
  const inMin = (m) => new Date(now.getTime() + m * 60_000);
  const sweep = async (at = now) => admin.req("POST", "/api/admin/analytics/ride-risk-sweep", { at: at.toISOString() });
  const alerts = (kind, key) => (serverLog(server).match(new RegExp(`\\[rider-alert\\] ${kind} key=${key}`, "g")) || []).length;
  const stamps = async (id) => (await db.query("SELECT reminder_stamps FROM rides WHERE id=$1", [id])).rows[0].reminder_stamps ?? {};

  // Driver position: the e2e driver is parked at the pickup with a fresh timestamp unless a step says otherwise.
  const parkDriver = (at, minutesAgo = 1) => db.query(
    "UPDATE driver_profiles SET current_location=$2, updated_at=NOW() - ($3 || ' minutes')::interval WHERE user_id=$1",
    [FIXTURES.driver.id, at ? loc(at) : null, String(minutesAgo)]);

  const unclaimed2h = await seed({ ...common, status: "pending", scheduled_at: inMin(100) });
  const unclaimed15 = await seed({ ...common, status: "pending", scheduled_at: inMin(14), plan_id: null });
  const farOff = await seed({ ...common, status: "pending", scheduled_at: inMin(300) });
  const driverFar = await seed({ ...common, status: "accepted", driver_id: FIXTURES.driver.id, scheduled_at: inMin(9) });

  try {
    section("Unclaimed rides page the operator, once per stage");
    await parkDriver(DEST); // 16 miles from the pickup
    const first = await sweep();
    check("sweep runs", first.status === 200 && Array.isArray(first.json?.pages), JSON.stringify(first.json?.message ?? first.status));
    const stagesOf = (id) => (first.json?.pages ?? []).filter((p) => p.rideId === id).map((p) => `${p.kind}:${p.stage}`);
    check("ride 100 min out is paged at the 2-hour stage", stagesOf(unclaimed2h).includes("ride_unclaimed:o120"), JSON.stringify(stagesOf(unclaimed2h)));
    check("ride 14 min out is paged at the 15-minute stage (one page, not two)", stagesOf(unclaimed15).join() === "ride_unclaimed:o15", JSON.stringify(stagesOf(unclaimed15)));
    check("ride 5 hours out is left alone", stagesOf(farOff).length === 0);
    check("driver 16 miles away at T-9 is paged", stagesOf(driverFar).includes("driver_far_from_pickup:o10"), JSON.stringify(stagesOf(driverFar)));
    await new Promise((r) => setTimeout(r, 300));
    check("2-hour page reached Telegram with the ride id", alerts("ride_unclaimed", `${unclaimed2h}:o120`) === 1);
    check("15-minute page reached Telegram", alerts("ride_unclaimed", `${unclaimed15}:o15`) === 1);
    check("driver-far page reached Telegram", alerts("driver_far_from_pickup", driverFar) === 1);
    const log = serverLog(server);
    check("page names the rider, the time and the pickup", /ride_unclaimed key=.*Rider: Rae Rider \| Phone: \+12405550002 \| Leaves: \d+:\d\d [AP]M \(\d+ min\) \| Pickup: Bowie, MD/.test(log), "fields missing");
    check("driver page says how far away the driver is", /driver_far_from_pickup key=.*Driver is 1\d(\.\d)? miles from the pickup · 9 min to departure/.test(log), "distance missing");
    const s15 = await stamps(unclaimed15);
    check("late-booked ride is stamped for both stages so T-2h can never fire after T-15", s15.o15 && s15.o120, JSON.stringify(s15));
    check("driver check is stamped once", (await stamps(driverFar)).o10 !== undefined);

    const again = await sweep();
    check("a second sweep pages nothing again", (again.json?.pages ?? []).length === 0, JSON.stringify(again.json?.pages));

    section("The same unclaimed ride escalates at T-15, then stops");
    const later = await sweep(inMin(86)); // the 100-min ride is now 14 min out
    const esc = (later.json?.pages ?? []).filter((p) => p.rideId === unclaimed2h).map((p) => p.stage);
    check("2-hour-paged ride is paged again at 15 minutes", esc.join() === "o15", JSON.stringify(esc));
    check("nothing fires after departure", ((await sweep(inMin(101))).json?.pages ?? []).length === 0);

    section("A driver who is close by with a fresh position is not paged");
    const driverNear = await seed({ ...common, status: "accepted", driver_id: FIXTURES.driver.id, scheduled_at: inMin(10) });
    seeded.push(driverNear);
    await parkDriver({ lat: 38.92, lng: -76.79 }); // ~1.2 miles
    const ok = await sweep();
    const okKinds = (ok.json?.pages ?? []).filter((p) => p.rideId === driverNear).map((p) => p.kind);
    check("near driver is checked and found fine", okKinds.join() === "driver_ok", JSON.stringify(okKinds));
    check("no page for the near driver", alerts("driver_far_from_pickup", driverNear) === 0);

    section("A driver whose position is stale is paged, not trusted");
    const driverStale = await seed({ ...common, status: "pending", driver_id: FIXTURES.driver.id, scheduled_at: inMin(10) });
    seeded.push(driverStale);
    await parkDriver({ lat: 38.92, lng: -76.79 }, 45);
    const st = await sweep();
    check("stale position pages", (st.json?.pages ?? []).some((p) => p.rideId === driverStale && p.kind === "driver_far_from_pickup"), JSON.stringify(st.json?.pages));
    await new Promise((r) => setTimeout(r, 300));
    check("page says the position is old and the driver has not confirmed", /last position is 4\d min old · 10 min to departure · driver has not confirmed/.test(serverLog(server)));

    section("A white-screen crash reaches the operator and the ledger");
    const rider = new Session(base); await rider.login(FIXTURES.rider.email);
    const crashMsg = "Cannot read properties of undefined (reading 'map') at RiderDashboard";
    const crash = await rider.req("POST", "/api/client-errors", { kind: "client_crash", message: crashMsg, page: "/" });
    check("crash report accepted", crash.status === 200, JSON.stringify(crash.json));
    await new Promise((r) => setTimeout(r, 400));
    const rx = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    check("crash alert sent with its own title", alerts("client_crash", rx(`${FIXTURES.rider.id}:${crashMsg.slice(0, 40)}`)) === 1);
    const { rows: ev } = await db.query("SELECT kind, user_id, page, message FROM reliability_events WHERE user_id=$1 AND kind='client_crash' ORDER BY created_at DESC LIMIT 1", [FIXTURES.rider.id]);
    check("crash recorded against the rider with page and message", ev[0]?.page === "/" && /RiderDashboard/.test(ev[0]?.message ?? ""), JSON.stringify(ev[0]));
    const { rows: pg } = await db.query("SELECT count(*)::int AS n FROM reliability_events WHERE kind='ride_unclaimed' AND page=$1", [unclaimed2h]);
    check("ride pages are recorded too", pg[0].n >= 1, `n=${pg[0].n}`);

    section("The review is a watchdog on the watchdogs");
    // A check that dies quietly is worse than no check. The heartbeats say
    // which ran; the production watch marks itself on the health endpoint it
    // already calls, so no secret or extra endpoint is involved.
    const beat = await fetch(`${base}/health/deps?probe=production-watch`);
    check("the outside watch can mark itself on the health endpoint", beat.status === 200 || beat.status === 503);
    await new Promise((r) => setTimeout(r, 400));
    // Scoped to this run, not "the newest few rows": other watches beat away in
    // the background all through the suite, and on a database that has served
    // more than one run they crowd a global LIMIT out of usefulness.
    const { rows: beats } = await db.query("SELECT page, message FROM reliability_events WHERE kind='watch_ran' AND created_at > NOW() - interval '2 minutes' ORDER BY created_at DESC");
    check("the heartbeat is recorded under a known watch name", beats.some((b) => b.page === "production-watch" && /Production watch/.test(b.message ?? "")), JSON.stringify(beats.map((b) => b.page)));
    await admin.req("POST", "/api/admin/analytics/dependency-check", {});
    await new Promise((r) => setTimeout(r, 400));
    const { rows: beats2 } = await db.query("SELECT DISTINCT page FROM reliability_events WHERE kind='watch_ran'");
    check("a watch run by hand leaves the same heartbeat as the nightly one", beats2.some((b) => b.page === "dependency-watch"), JSON.stringify(beats2.map((b) => b.page)));
    const junk = await fetch(`${base}/health/deps?probe=not-a-real-watch`);
    check("an unknown probe name records nothing", (junk.status === 200 || junk.status === 503));
    await new Promise((r) => setTimeout(r, 300));
    const { rows: [junkRow] } = await db.query("SELECT count(*)::int AS n FROM reliability_events WHERE kind='watch_ran' AND page='not-a-real-watch'");
    check("only the watches we know about can leave a heartbeat", junkRow.n === 0, `n=${junkRow.n}`);

    section("The morning review counts what reached people");
    // Review "tomorrow at 4 AM Eastern": its window is today, where every event above landed.
    const at = new Date(now.getTime() + 24 * 3_600_000);
    const rv = await admin.req("GET", `/api/admin/analytics/rider-promise-review?at=${encodeURIComponent(at.toISOString())}`);
    const h = rv.json?.metrics?.appHealth ?? {};
    check("review counts the crash as an app error and a crash", h.appErrors >= 1 && h.crashes >= 1, JSON.stringify(h));
    check("review counts the rider as a person affected", h.peopleAffected >= 1, JSON.stringify(h));
    const pa = rv.json?.metrics?.pagedAhead ?? {};
    check("review counts rides paged before departure", pa.paged >= 3, JSON.stringify(pa));
    check("review text carries the app-health line", /App health: \d+ app errors?/.test(rv.json?.text ?? ""), (rv.json?.text ?? "").split("\n").find((l) => l.startsWith("App health")));
    check("review text carries the paged-ahead line", /Paged ahead: \d+ rides? flagged before departure/.test(rv.json?.text ?? ""));
    const overnight = rv.json?.metrics?.overnight ?? [];
    check("the review names every overnight check and whether each one ran", overnight.length === 3 && overnight.every((w) => typeof w.ran === "boolean") && overnight.some((w) => /Production watch/.test(w.label) && w.ran === true) && overnight.some((w) => /Database and Stripe/.test(w.label) && w.ran === true), JSON.stringify(overnight));
    check("a check that has not run is named, not hidden", /Minute sweep/.test(JSON.stringify(overnight)), JSON.stringify(overnight.map((w) => w.label)));
    check("review text carries the overnight line", /Overnight checks: (all \d+ ran|.*DID NOT RUN)/.test(rv.json?.text ?? ""), (rv.json?.text ?? "").split("\n").find((l) => l.startsWith("Overnight")));

    section("The server watches its own lifelines");
    // Stripe is armed with a fake key and unreachable here, so the first check
    // must page "Stripe unreachable" exactly once, and a check ten minutes later
    // must stay quiet; the database is fine throughout.
    const d1 = await admin.req("POST", "/api/admin/analytics/dependency-check", { at: now.toISOString() });
    check("dependency check runs", d1.status === 200 && d1.json?.report?.deps?.database, JSON.stringify(d1.json?.message ?? d1.status));
    check("database answers", d1.json?.report?.deps?.database?.ok === true, JSON.stringify(d1.json?.report?.deps?.database));
    check("stripe is configured and unreachable here", d1.json?.report?.deps?.stripe?.configured === true && d1.json?.report?.deps?.stripe?.ok === false, JSON.stringify(d1.json?.report?.deps?.stripe));
    check("stripe failure never leaks the key", !/sk_test_e2e_fake/.test(JSON.stringify(d1.json)));
    const d2 = await admin.req("POST", "/api/admin/analytics/dependency-check", { at: inMin(10).toISOString() });
    check("still down ten minutes later pages nothing new", (d2.json?.paged ?? []).length === 0, JSON.stringify(d2.json?.paged));
    const d3 = await admin.req("POST", "/api/admin/analytics/dependency-check", { at: inMin(70).toISOString() });
    check("still down after an hour reminds once", (d3.json?.paged ?? []).some((p) => p.dep === "stripe" && p.event === "still_down" && p.minutes >= 60), JSON.stringify(d3.json?.paged));
    await new Promise((r) => setTimeout(r, 300));
    check("the down page is logged", /\[dependency-watch\] stripe down ::/.test(serverLog(server)));
    const { rows: down } = await db.query("SELECT count(*)::int AS n FROM reliability_events WHERE kind='dependency_down' AND page='stripe'");
    check("the outage is recorded once", down[0].n >= 1, `n=${down[0].n}`);
    const depsPage = await fetch(`${base}/health/deps`);
    const depsJson = await depsPage.json();
    check("/health/deps is public, 503 while Stripe is down, and names it", depsPage.status === 503 && (depsJson.down ?? []).includes("stripe"), JSON.stringify(depsJson.down));
    const rv2 = await admin.req("GET", `/api/admin/analytics/rider-promise-review?at=${encodeURIComponent(at.toISOString())}`);
    const outages = rv2.json?.metrics?.appHealth?.outages ?? [];
    check("review lists the Stripe outage as still down", outages.some((o) => o.name === "Stripe" && o.minutes === null), JSON.stringify(outages));
    check("review text carries the outages line", /Outages: Stripe \(still down\)/.test(rv2.json?.text ?? ""));

    section("Found by the every-button audit");
    // A new driver's first visit to Ownership fires two requests at once;
    // both used to insert the ownership row and one answered 500.
    await db.query("DELETE FROM driver_ownership WHERE driver_id=$1", [FIXTURES.driver.id]);
    const drv = new Session(base); await drv.login(FIXTURES.driver.email);
    const [own1, own2] = await Promise.all([drv.req("GET", "/api/driver/ownership/projections"), drv.req("GET", "/api/driver/ownership")]);
    check("a new driver opening Ownership twice at once gets two answers, not a 500", own1.status === 200 && own2.status === 200, `${own1.status} ${own2.status}`);
    // With Stripe unreachable, the saved-cards list is an outage (503 with a
    // plain message), not a server error that pages ops and shows nothing.
    const cards = await rider.req("GET", "/api/payment/methods");
    check("saved cards during a Stripe outage answer 503 with a message, not 500", cards.status === 503 && /temporarily unavailable/.test(cards.json?.message ?? ""), `${cards.status} ${JSON.stringify(cards.json)}`);

    section("The outside watch can use this server");
    const probe = spawnSync("node", ["scripts/production-watch.mjs"], { env: { ...process.env, BASE_URL: base }, encoding: "utf8" });
    const lastLine = (probe.stdout ?? "").trim().split("\n").pop() ?? "";
    check("outside probe passes against a healthy app shell and pages", probe.status === 0, `${probe.status}: ${lastLine} ${probe.stderr}`);
    check("outside probe carries the server's own view instead of paging twice", /server reports down: stripe \(already paged by the server\)/.test(lastLine), lastLine);
    const probeDown = spawnSync("node", ["scripts/production-watch.mjs"], { env: { ...process.env, BASE_URL: "http://127.0.0.1:1" }, encoding: "utf8" });
    check("outside probe fails red when nothing answers", probeDown.status === 1 && /^DOWN — Process/.test((probeDown.stdout ?? "").trim().split("\n").pop() ?? ""), (probeDown.stdout ?? "").trim().split("\n").pop());
  } finally {
    await db.query("DELETE FROM reliability_events WHERE kind IN ('dependency_down','dependency_up')").catch(() => {});
    await parkDriver(null);
    await deleteRides(db, seeded).catch(() => {});
    await db.query("DELETE FROM reliability_events WHERE user_id=$1 OR page = ANY($2)", [FIXTURES.rider.id, seeded]).catch(() => {});
  }
}
