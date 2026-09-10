import { Session, check, section, serverLog, deleteRides, FIXTURES, PICKUP, DEST } from "./harness.mjs";

/**
 * Slice 3: a standing order books its jobs a week ahead and never twice;
 * a will-call return is booked when the desk says the passenger is ready;
 * waiting at the door is billed past the free minutes; cancellations and
 * no-shows cost what the organization's own terms say.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const rideIds = [];
  const orgIds = [];
  const eastern = (d) => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(d)); const g = (t) => p.find((x) => x.type === t)?.value; return `${g("weekday")} ${g("hour")}:${g("minute")}`; };

  try {
    section("Terms are the organization's own");
    const A = await admin.req("POST", "/api/admin/organizations", { name: "Clinton Dialysis", category: "medical" });
    orgIds.push(A.json.id);
    await admin.req("POST", `/api/admin/organizations/${A.json.id}/members`, { email: FIXTURES.rider.email, role: "owner" });
    const detail = await rider.req("GET", `/api/org/${A.json.id}`);
    check("defaults apply until terms are set", detail.json?.terms?.lateCancelFee === 7 && detail.json?.terms?.noShowFee === 10 && /Cancel free up to 2 hours/.test(detail.json?.termsText ?? ""), JSON.stringify(detail.json?.terms));
    const patched = await admin.req("PATCH", `/api/admin/organizations/${A.json.id}`, { terms: { lateCancelFee: 12, noShowFee: 15, waitFreeMinutes: 5, waitFeePerMinute: 1, bogus: 99 } });
    check("admin sets terms; unknown keys are dropped", patched.status === 200 && patched.json?.terms?.lateCancelFee === 12 && !("bogus" in (patched.json?.terms ?? {})), JSON.stringify(patched.json?.terms));
    const detail2 = await rider.req("GET", `/api/org/${A.json.id}`);
    check("the desk sees the terms in words", /\$12\.00 after that\. No-show \$15\.00\. Waiting is free for 5 minutes, then \$1\.00 a minute/.test(detail2.json?.termsText ?? ""), detail2.json?.termsText);

    section("A standing order books a week ahead, once");
    const now = new Date();
    // Pick a time 4 hours from now (Eastern clock), every day, so today's occurrence is bookable.
    const at = new Date(now.getTime() + 4 * 3_600_000);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
    const hour = Number(parts.find((p) => p.type === "hour").value), minute = Number(parts.find((p) => p.type === "minute").value);
    const so = await rider.req("POST", `/api/org/${A.json.id}/standing-orders`, {
      passengerName: "Rosa Parks", passengerPhone: "2405550190", pickup: PICKUP, destination: DEST,
      days: [0, 1, 2, 3, 4, 5, 6], departureHour: hour, departureMinute: minute, returnMode: "will_call", vehicleType: "standard", poNumber: "SO-1", notes: "Side door.",
    });
    check("standing order created and its first week booked", so.status === 201 && so.json?.id && so.json?.booked >= 7, JSON.stringify(so.json?.message ?? so.json?.booked));
    const bad = await rider.req("POST", `/api/org/${A.json.id}/standing-orders`, { passengerName: "X", pickup: PICKUP, destination: DEST, days: [], departureHour: 6, departureMinute: 0, returnMode: "none" });
    check("a standing order needs at least one day", bad.status === 400);
    const list = await rider.req("GET", `/api/org/${A.json.id}/standing-orders`);
    check("the desk lists it with its job count", list.status === 200 && list.json?.[0]?.id === so.json.id && list.json[0].jobCount >= 7, JSON.stringify(list.json?.map((o) => [o.passengerName, o.jobCount])));
    const jobs1 = await rider.req("GET", `/api/org/${A.json.id}/jobs?from=${encodeURIComponent(now.toISOString())}&to=${encodeURIComponent(new Date(now.getTime() + 8 * 86_400_000).toISOString())}`);
    const fromOrder = (jobs1.json ?? []).filter((j) => j.standingOrderId === so.json.id);
    for (const j of fromOrder) rideIds.push(j.rideId);
    check("seven outbound jobs, one per Eastern day, at the order's time", fromOrder.length >= 7 && fromOrder.every((j) => j.leg === "out") && new Set(fromOrder.map((j) => j.serviceDate)).size === fromOrder.length && fromOrder.every((j) => eastern(j.scheduledAt).endsWith(`${hour}:${String(minute).padStart(2, "0")}`)), JSON.stringify(fromOrder.map((j) => [j.serviceDate, eastern(j.scheduledAt)])));
    const again = await admin.req("POST", `/api/admin/analytics/materialize-standing-orders`);
    check("running the sweep again books nothing twice", again.status === 200 && again.json?.booked === 0, JSON.stringify(again.json));
    const paused = await rider.req("POST", `/api/org/${A.json.id}/standing-orders/${so.json.id}/pause`);
    check("the desk can pause it", paused.status === 200 && paused.json?.isActive === false);
    check("a paused order books nothing", (await admin.req("POST", `/api/admin/analytics/materialize-standing-orders`)).json?.booked === 0);
    await rider.req("POST", `/api/org/${A.json.id}/standing-orders/${so.json.id}/resume`);

    section("Will-call: the desk says the passenger is ready");
    const today = fromOrder.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))[0];
    check("driver claims today's outbound job", (await driver.req("POST", `/api/driver/rides/${today.rideId}/claim`)).status === 200);
    await driver.req("POST", `/api/driver/rides/${today.rideId}/confirm-scheduled`);
    await db.query("UPDATE rides SET scheduled_at = NOW() - interval '40 minutes' WHERE id=$1", [today.rideId]);
    check("driver arrives", (await driver.req("POST", `/api/driver/rides/${today.rideId}/confirm-arrival`)).status === 200);
    await db.query("UPDATE rides SET arrived_at = NOW() - interval '30 minutes' WHERE id=$1", [today.rideId]);
    check("driver starts after waiting", (await driver.req("POST", `/api/driver/rides/${today.rideId}/start`)).status === 200);
    await db.query("UPDATE rides SET started_at = arrived_at + interval '25 minutes' WHERE id=$1", [today.rideId]);
    const earlyReturn = await rider.req("POST", `/api/org/${A.json.id}/jobs/${today.id}/return`, { readyInMinutes: 5 });
    check("passenger ready: a return is booked at least the will-call lead out", earlyReturn.status === 201 && earlyReturn.json?.job?.leg === "return" && earlyReturn.json?.job?.returnOf === today.id, JSON.stringify(earlyReturn.json?.message ?? earlyReturn.json?.job));
    const ret = earlyReturn.json.ride; rideIds.push(ret.id);
    const lead = (new Date(ret.scheduledAt).getTime() - Date.now()) / 60_000;
    check("return leaves about 20 minutes out with pickup and destination swapped", lead > 17 && lead <= 21 && ret.pickupLocation.address === DEST.address && ret.destinationLocation.address === PICKUP.address && ret.passengerName === "Rosa Parks", `${lead.toFixed(1)} min ${ret.pickupLocation.address}`);
    check("a second return for the same trip is refused", (await rider.req("POST", `/api/org/${A.json.id}/jobs/${today.id}/return`, {})).status === 409);
    await new Promise((r) => setTimeout(r, 300));
    check("drivers are told at once", /\[commercial\] will-call return .*Clinton Dialysis/.test(serverLog(server)));

    section("Waiting at the door is billed by the terms");
    check("driver completes the outbound job", (await driver.req("POST", `/api/driver/rides/${today.rideId}/complete`, {})).status === 200);
    await new Promise((r) => setTimeout(r, 400));
    const { rows: [wj] } = await db.query("SELECT wait_minutes, wait_fee FROM commercial_jobs WHERE id=$1", [today.id]);
    check("25 minutes at the door, 5 free, 20 billable at $1: $20.00", wj.wait_minutes === 25 && wj.wait_fee === "20.00", JSON.stringify(wj));
    const after = await rider.req("GET", `/api/org/${A.json.id}/jobs`);
    const doneJob = (after.json ?? []).find((j) => j.id === today.id);
    check("the job's total includes the waiting fee and the facility fee", doneJob && Math.abs(doneJob.total - (Number(doneJob.actualFare) + 4 + 20)) < 0.011, JSON.stringify(doneJob && [doneJob.total, doneJob.actualFare, doneJob.waitFee]));

    section("Cancellations and no-shows cost what the terms say");
    const tomorrow = fromOrder.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))[1];
    const freeCancel = await rider.req("POST", `/api/org/${A.json.id}/jobs/${tomorrow.id}/cancel`, { reason: "Not needed" });
    check("no driver yet: cancelling costs nothing", freeCancel.status === 200 && freeCancel.json?.cancellationFee === "0.00", JSON.stringify(freeCancel.json?.cancellationFee));
    const late = fromOrder.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))[2];
    check("driver claims a later job", (await driver.req("POST", `/api/driver/rides/${late.rideId}/claim`)).status === 200);
    await db.query("UPDATE rides SET scheduled_at = NOW() + interval '90 minutes' WHERE id=$1", [late.rideId]);
    const lateCancel = await rider.req("POST", `/api/org/${A.json.id}/jobs/${late.id}/cancel`, { reason: "Changed plans" });
    check("with a driver and inside the free window: the organization's late fee", lateCancel.status === 200 && lateCancel.json?.cancellationFee === "12.00", JSON.stringify(lateCancel.json?.cancellationFee));
    const ns = fromOrder.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))[3];
    check("driver claims another", (await driver.req("POST", `/api/driver/rides/${ns.rideId}/claim`)).status === 200);
    await driver.req("POST", `/api/driver/rides/${ns.rideId}/confirm-scheduled`);
    await db.query("UPDATE rides SET scheduled_at = NOW() - interval '20 minutes' WHERE id=$1", [ns.rideId]);
    check("driver arrives", (await driver.req("POST", `/api/driver/rides/${ns.rideId}/confirm-arrival`)).status === 200);
    await db.query("UPDATE rides SET arrived_at = NOW() - interval '10 minutes' WHERE id=$1", [ns.rideId]);
    const noShow = await driver.req("POST", `/api/driver/rides/${ns.rideId}/no-show`, { driverLat: PICKUP.lat, driverLng: PICKUP.lng });
    check("driver reports a no-show", noShow.status === 200, JSON.stringify(noShow.json?.message ?? noShow.status));
    await new Promise((r) => setTimeout(r, 400));
    const { rows: [nsj] } = await db.query("SELECT c.cancellation_fee, r.status, r.stripe_payment_intent_id FROM commercial_jobs c JOIN rides r ON r.id=c.ride_id WHERE c.id=$1", [ns.id]);
    check("the organization's no-show fee is on the job; nothing was charged to anyone's card", nsj.cancellation_fee === "15.00" && nsj.status === "no_show" && !nsj.stripe_payment_intent_id, JSON.stringify(nsj));
    const stmt = await rider.req("GET", `/api/org/${A.json.id}/statement?month=${new Date().toISOString().slice(0, 7)}`);
    const totals = stmt.json?.totals ?? {};
    check("the statement carries waiting, late cancel and no-show", totals.waitFees >= 20 && totals.cancellationFees >= 27, JSON.stringify(totals));
  } finally {
    await deleteRides(db, rideIds).catch(() => {});
    if (orgIds.length) {
      await db.query("DELETE FROM commercial_jobs WHERE organization_id = ANY($1::varchar[])", [orgIds]).catch(() => {});
      await db.query("DELETE FROM commercial_standing_orders WHERE organization_id = ANY($1::varchar[])", [orgIds]).catch(() => {});
      await db.query("DELETE FROM organization_members WHERE organization_id = ANY($1::varchar[])", [orgIds]).catch(() => {});
      await db.query("DELETE FROM organizations WHERE id = ANY($1::varchar[])", [orgIds]).catch(() => {});
    }
  }
}
