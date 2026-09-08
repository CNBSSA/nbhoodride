import { Session, check, section, deleteRides, FIXTURES, PICKUP, DEST, PASSWORD } from "./harness.mjs";
import bcrypt from "bcrypt";

/**
 * Coworker group rides (Mode 4, PG-XXXXXX): one person schedules the ride
 * home from work and shares a code; coworkers join with it. Everyone gets
 * 30% off once a second rider joins; the car holds three; one driver claims
 * the whole group. This is Phase 3b-F of the daily audit, previously
 * code-trace only.
 */
export async function run({ base, db }) {
  const organizer = new Session(base);
  check("organizer logs in", (await organizer.login(FIXTURES.rider.email)).status === 200);

  // Three extra riders with a card on file (card-only mode refuses joiners without one).
  const hash = await bcrypt.hash(PASSWORD, 10);
  const stamp = Date.now();
  const extras = [];
  for (const [i, name] of ["Bola", "Chidi", "Dara"].entries()) {
    const id = `e2e-cw-${stamp}-${i}`;
    await db.query(
      `INSERT INTO users (id,email,password,first_name,last_name,is_approved,phone,registration_completed_at,stripe_customer_id,stripe_payment_method_id)
       VALUES ($1,$2,$3,$4,'Coworker',true,$5,NOW(),'cus_e2e','pm_e2e')`,
      [id, `${id}@example.com`, hash, name, `+1240555${String(1000 + i + (stamp % 8000)).slice(-4)}`]);
    const s = new Session(base);
    check(`${name} logs in`, (await s.login(`${id}@example.com`)).status === 200);
    extras.push({ id, name, session: s });
  }
  const [bola, chidi, dara] = extras;
  const departAt = new Date(Date.now() + 5 * 3600e3).toISOString();
  const joinerPickup = { lat: 38.905, lng: -76.78, address: "Bowie Town Center, MD" };
  const cleanup = { groupId: null };

  try {
    section("Organizer creates the group");
    const noTime = await organizer.req("POST", "/api/rides/create-shared-schedule", { pickupLocation: PICKUP, destinationLocation: DEST, estimatedFare: 20 });
    check("departure time is required", noTime.status === 400, JSON.stringify(noTime.json?.message));
    const created = await organizer.req("POST", "/api/rides/create-shared-schedule", { pickupLocation: PICKUP, destinationLocation: DEST, estimatedFare: 20, scheduledAt: departAt });
    check("group created", created.status === 200, JSON.stringify(created.json?.message ?? created.status));
    const code = created.json?.scheduleCode;
    cleanup.groupId = created.json?.group?.id ?? null;
    check("organizer receives a PG- code", typeof code === "string" && /^PG-/.test(code), `code=${code}`);
    check("organizer's ride carries the departure time", new Date(created.json?.scheduledAt ?? 0).getTime() === new Date(departAt).getTime());
    check("organizer pays full fare while alone", Number(created.json?.estimatedFare) === 20, `fare=${created.json?.estimatedFare}`);

    section("Coworkers join with the code");
    const preview = await bola.session.req("GET", `/api/rides/schedule/${code}`);
    check("code previews as open with 1 of 3 seats filled", preview.status === 200 && preview.json?.filledSlots === 1 && preview.json?.maxSlots === 3, JSON.stringify(preview.json));
    const j1 = await bola.session.req("POST", "/api/rides/join-schedule", { scheduleCode: code.toLowerCase(), pickupLocation: joinerPickup, destinationLocation: DEST });
    check("second rider joins (code is case-insensitive)", j1.status === 200, JSON.stringify(j1.json?.message ?? j1.status));
    check("joiner inherits the group departure time", new Date(j1.json?.scheduledAt ?? 0).getTime() === new Date(departAt).getTime(), `scheduledAt=${j1.json?.scheduledAt}`);

    const { rows: afterTwo } = await db.query("SELECT rider_id, estimated_fare, original_fare, group_discount_amount FROM rides WHERE group_id=$1 ORDER BY created_at", [cleanup.groupId]);
    const org = afterTwo.find((r) => r.rider_id === FIXTURES.rider.id);
    const b = afterTwo.find((r) => r.rider_id === bola.id);
    check("organizer's fare drops 30% once a coworker joins ($20 → $14)", Number(org?.estimated_fare) === 14 && Number(org?.original_fare) === 20, `fare=${org?.estimated_fare} original=${org?.original_fare}`);
    check("joiner is 30% off their own route (not stacked)", b && Math.abs(Number(b.estimated_fare) - Number(b.original_fare) * 0.7) < 0.011, `fare=${b?.estimated_fare} original=${b?.original_fare}`);
    // The joiner's full fare must be the rate card's quote for their route —
    // the same number /api/rides/calculate-fare gives for the same figures.
    const { rows: [bRoute] } = await db.query("SELECT distance, duration FROM rides WHERE group_id=$1 AND rider_id=$2", [cleanup.groupId, bola.id]);
    const bQuote = await bola.session.req("POST", "/api/rides/calculate-fare", { distance: Number(bRoute.distance), duration: bRoute.duration });
    check("joiner's route is recorded and their full fare is the rate card's quote for it", Number(bRoute.distance) > 0 && bRoute.duration > 0 && bQuote.status === 200 && Math.abs(Number(b.original_fare) - bQuote.json.total) < 0.011, `original=${b?.original_fare} quote=${bQuote.json?.total} route=${bRoute.distance}mi/${bRoute.duration}min`);
    const { rows: [bPay] } = await db.query("SELECT payment_method FROM rides WHERE group_id=$1 AND rider_id=$2", [cleanup.groupId, bola.id]);
    check("joiner's seat is a card ride regardless of what the app sent", bPay.payment_method === "card");

    const j2 = await chidi.session.req("POST", "/api/rides/join-schedule", { scheduleCode: code, pickupLocation: joinerPickup, destinationLocation: DEST });
    check("third rider fills the car", j2.status === 200, JSON.stringify(j2.json?.message ?? j2.status));
    const { rows: [c] } = await db.query("SELECT estimated_fare, original_fare FROM rides WHERE group_id=$1 AND rider_id=$2", [cleanup.groupId, chidi.id]);
    check("third rider also gets exactly 30% off", c && Math.abs(Number(c.estimated_fare) - Number(c.original_fare) * 0.7) < 0.011, `fare=${c?.estimated_fare} original=${c?.original_fare}`);

    const j3 = await dara.session.req("POST", "/api/rides/join-schedule", { scheduleCode: code, pickupLocation: joinerPickup, destinationLocation: DEST });
    check("fourth rider is refused (car holds three)", j3.status === 409 || j3.status === 410, `status=${j3.status} ${j3.json?.message ?? ""}`);
    const { rows: [g] } = await db.query("SELECT filled_slots, max_slots, status, discount_active FROM ride_groups WHERE id=$1", [cleanup.groupId]);
    check("group shows 3 of 3 seats and is no longer open", g?.filled_slots === 3 && g?.max_slots === 3 && g?.status !== "open" && g?.discount_active === true, JSON.stringify(g));

    section("Every rider sees the group on Upcoming");
    for (const who of [{ s: organizer, id: FIXTURES.rider.id, label: "organizer" }, { s: bola.session, id: bola.id, label: "joiner" }]) {
      const up = await who.s.req("GET", "/api/rides/scheduled");
      check(`${who.label}'s upcoming list has the group ride`, up.status === 200 && (up.json ?? []).some((r) => r.groupId === cleanup.groupId), `count=${(up.json ?? []).length}`);
    }

    section("Driver claims the whole group");
    const driver = new Session(base);
    check("driver logs in", (await driver.login(FIXTURES.driver.email)).status === 200);
    const board = await driver.req("GET", "/api/driver/scheduled-rides");
    const rowsForGroup = (board.json?.open ?? []).filter((r) => r.groupId === cleanup.groupId);
    check("claim board shows ONE row for the group, not one per seat", rowsForGroup.length === 1, `rows=${rowsForGroup.length}`);
    const anchor = rowsForGroup[0]?.id ?? created.json?.id;
    const claim = await driver.req("POST", `/api/driver/rides/${anchor}/claim`);
    check("driver claims the group", claim.status === 200, JSON.stringify(claim.json?.message ?? claim.status));
    const { rows: legs } = await db.query("SELECT driver_id FROM rides WHERE group_id=$1", [cleanup.groupId]);
    check("all three legs are assigned to the same driver", legs.length === 3 && legs.every((r) => r.driver_id === FIXTURES.driver.id), JSON.stringify(legs.map((r) => r.driver_id)));
    const { rows: [g2] } = await db.query("SELECT driver_id, status FROM ride_groups WHERE id=$1", [cleanup.groupId]);
    check("group is locked to that driver", g2?.driver_id === FIXTURES.driver.id, JSON.stringify(g2));
    const again = await driver.req("POST", `/api/driver/rides/${anchor}/claim`);
    check("a second claim on the same group is refused", again.status === 409, `status=${again.status}`);
    const board2 = await driver.req("GET", "/api/driver/scheduled-rides");
    check("group leaves the open board once claimed", !(board2.json?.open ?? []).some((r) => r.groupId === cleanup.groupId));
    check("group appears in the driver's own upcoming rides", (board2.json?.mine ?? []).some((r) => r.groupId === cleanup.groupId), `mine=${(board2.json?.mine ?? []).length}`);
    const up = await bola.session.req("GET", "/api/rides/scheduled");
    const mine = (up.json ?? []).find((r) => r.groupId === cleanup.groupId);
    check("joiner now sees the driver on their upcoming ride", !!mine?.driverId && mine.driverId === FIXTURES.driver.id, `driverId=${mine?.driverId}`);

    // Group rate policy (shared/groupRatePolicy.ts): 30% holds at two or
    // more seats; below that, unconfirmed seats go back to the solo fare
    // with a free-cancel window, and everyone left is told either way.
    section("A coworker leaves: the two left keep the rate and are told");
    const rideOf = async (riderId) => (await db.query("SELECT id, estimated_fare, original_fare, group_discount_amount, free_cancel_until, status FROM rides WHERE group_id=$1 AND rider_id=$2", [cleanup.groupId, riderId])).rows[0];
    const noticesFor = async (riderId) => (await db.query("SELECT title, body FROM in_app_notifications WHERE user_id=$1 AND type='group_seat_released' ORDER BY created_at", [riderId])).rows;
    const bolaRide = await rideOf(bola.id);
    const leave1 = await bola.session.req("POST", `/api/rides/${bolaRide.id}/cancel`, { reason: "e2e: coworker leaves" });
    check("first coworker cancels free (scheduled, hours out)", leave1.status === 200 && Number(leave1.json?.cancellationFee ?? 0) === 0, JSON.stringify(leave1.json?.message ?? leave1.json?.cancellationFee ?? leave1.status));
    const orgAfter1 = await rideOf(FIXTURES.rider.id);
    const chidiAfter1 = await rideOf(chidi.id);
    check("with two riders left the group rate still holds", Number(orgAfter1.estimated_fare) === 14 && Math.abs(Number(chidiAfter1.estimated_fare) - Number(chidiAfter1.original_fare) * 0.7) < 0.011, `org=${orgAfter1.estimated_fare} chidi=${chidiAfter1.estimated_fare}`);
    const { rows: [gAfter1] } = await db.query("SELECT filled_slots, discount_active FROM ride_groups WHERE id=$1", [cleanup.groupId]);
    check("seat released, rate still on", gAfter1.filled_slots === 2 && gAfter1.discount_active === true, JSON.stringify(gAfter1));
    await new Promise((r) => setTimeout(r, 300));
    const orgNotices1 = await noticesFor(FIXTURES.rider.id);
    check("remaining riders are told, and that their fare is unchanged", orgNotices1.length >= 1 && /unchanged/.test(orgNotices1.at(-1).body) && /2 riders/.test(orgNotices1.at(-1).body), JSON.stringify(orgNotices1.at(-1)));

    section("Down to one before the driver confirms: re-quoted, told, free to cancel");
    const chidiRide = await rideOf(chidi.id);
    const leave2 = await chidi.session.req("POST", `/api/rides/${chidiRide.id}/cancel`, { reason: "e2e: coworker leaves" });
    check("second coworker cancels", leave2.status === 200, JSON.stringify(leave2.json?.message ?? leave2.status));
    const orgAfter2 = await rideOf(FIXTURES.rider.id);
    check("the last rider is back at the solo fare ($14 → $20)", Number(orgAfter2.estimated_fare) === 20 && Number(orgAfter2.group_discount_amount) === 0, `fare=${orgAfter2.estimated_fare} discount=${orgAfter2.group_discount_amount}`);
    const { rows: [gAfter2] } = await db.query("SELECT filled_slots, discount_active FROM ride_groups WHERE id=$1", [cleanup.groupId]);
    check("group rate switched off", gAfter2.filled_slots === 1 && gAfter2.discount_active === false, JSON.stringify(gAfter2));
    const untilMs = orgAfter2.free_cancel_until ? new Date(orgAfter2.free_cancel_until).getTime() - Date.now() : 0;
    check("a ~30-minute free-cancel window is open", untilMs > 25 * 60_000 && untilMs <= 30 * 60_000 + 5000, `window=${Math.round(untilMs / 60_000)} min`);
    await new Promise((r) => setTimeout(r, 300));
    const orgNotices2 = await noticesFor(FIXTURES.rider.id);
    check("the last rider is told the rate is gone, the new fare, and that cancelling is free", orgNotices2.length >= 2 && /solo rate, \$20\.00/.test(orgNotices2.at(-1).body) && /cancel free/.test(orgNotices2.at(-1).body), JSON.stringify(orgNotices2.at(-1)));
    const requotePreview = await organizer.req("GET", `/api/rides/${orgAfter2.id}/cancel-preview`);
    check("cancel preview honours the window with the reason", requotePreview.status === 200 && Number(requotePreview.json?.fee) === 0 && /re-quoted/.test(requotePreview.json?.reason ?? ""), JSON.stringify(requotePreview.json));
  } finally {
    await db.query("DELETE FROM in_app_notifications WHERE type='group_seat_released' AND user_id = ANY($1::varchar[])", [[FIXTURES.rider.id, bola.id, chidi.id, dara.id]]).catch(() => {});
    if (cleanup.groupId) {
      const { rows } = await db.query("SELECT id FROM rides WHERE group_id=$1", [cleanup.groupId]).catch(() => ({ rows: [] }));
      await deleteRides(db, rows.map((r) => r.id)).catch(() => {});
    }
    if (cleanup.groupId) await db.query("DELETE FROM ride_groups WHERE id=$1", [cleanup.groupId]).catch(() => {});
    await db.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [extras.map((e) => e.id)]).catch(() => {});
  }
}
