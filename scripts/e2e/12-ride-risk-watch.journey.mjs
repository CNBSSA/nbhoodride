import { Session, check, section, serverLog, deleteRides, FIXTURES, PICKUP, DEST } from "./harness.mjs";

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
  } finally {
    await parkDriver(null);
    await deleteRides(db, seeded).catch(() => {});
    await db.query("DELETE FROM reliability_events WHERE user_id=$1 OR page = ANY($2)", [FIXTURES.rider.id, seeded]).catch(() => {});
  }
}
