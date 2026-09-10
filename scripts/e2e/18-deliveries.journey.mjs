import { Session, check, section, serverLog, deleteRides, deleteOrgs, FIXTURES, PICKUP, DEST } from "./harness.mjs";

/**
 * Slice 6: a job with no passenger. A law office sends a parcel across the
 * county; there is a pickup contact, a drop contact, a size and a window.
 * It is priced on the delivery tariff, only a driver with the delivery
 * badge sees it, and it is not finished until someone is named as having
 * taken it.
 */
export async function run({ base, db, server }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const rideIds = [];
  const orgIds = [];
  const inMin = (m) => new Date(Date.now() + m * 60_000).toISOString();
  const body = () => ({
    parcelSize: "small",
    pickupContact: { name: "Front desk", phone: "3015550111" },
    dropContact: { name: "Ms Rivera", phone: "3015550122", note: "Suite 300, ask at reception" },
    readyAt: inMin(90),
    windowHours: 2,
    pickup: PICKUP,
    destination: DEST,
    poNumber: "DEL-9",
  });

  try {
    section("Only a delivery account books deliveries");
    const clinic = await admin.req("POST", "/api/admin/organizations", { name: "Fort Washington Clinic", category: "medical" });
    orgIds.push(clinic.json.id);
    await admin.req("POST", `/api/admin/organizations/${clinic.json.id}/members`, { email: FIXTURES.rider.email, role: "owner" });
    const wrongKind = await rider.req("POST", `/api/org/${clinic.json.id}/deliveries`, body());
    check("a medical account cannot book a parcel", wrongKind.status === 409 && /books rides, not deliveries/i.test(wrongKind.json?.message ?? ""), JSON.stringify(wrongKind.json?.message));

    const office = await admin.req("POST", "/api/admin/organizations", { name: "Oxon Hill Title Co", category: "business", contactName: "Night desk", contactPhone: "3015559000" });
    orgIds.push(office.json.id);
    await admin.req("POST", `/api/admin/organizations/${office.json.id}/members`, { email: FIXTURES.rider.email, role: "owner" });

    section("What a delivery needs");
    const noDrop = await rider.req("POST", `/api/org/${office.json.id}/deliveries`, { ...body(), dropContact: { name: "" } });
    check("someone must receive it", noDrop.status === 400 && /Who receives it/i.test(noDrop.json?.message ?? ""), JSON.stringify(noDrop.json?.message));
    const noSize = await rider.req("POST", `/api/org/${office.json.id}/deliveries`, { ...body(), parcelSize: "pallet" });
    check("the parcel size is one of the four", noSize.status === 400 && /envelope/i.test(noSize.json?.message ?? ""));
    const tooSoon = await rider.req("POST", `/api/org/${office.json.id}/deliveries`, { ...body(), readyAt: inMin(5) });
    check("it cannot be asked for in five minutes", tooSoon.status === 400 && /45 minutes/.test(tooSoon.json?.message ?? ""), JSON.stringify(tooSoon.json?.message));

    section("Booked: no passenger, two contacts, a window");
    const booked = await rider.req("POST", `/api/org/${office.json.id}/deliveries`, body());
    check("the delivery is booked", booked.status === 201 && booked.json?.ride?.id, JSON.stringify(booked.json?.message ?? booked.status));
    const ride = booked.json.ride; rideIds.push(ride.id);
    const jobId = booked.json.job.id;
    check("it is a commercial job billed to the account, not to a card", ride.paymentMethod === "invoice" && ride.rideType === "commercial" && !ride.stripePaymentIntentId);
    check("the driver's card names who receives it", ride.passengerName === "Ms Rivera" && /Small box/.test(ride.pickupInstructions ?? ""), `${ride.passengerName} :: ${ride.pickupInstructions}`);
    // Bowie to National Harbor is about 16 miles: $9 covers 3, then $1.60 a mile.
    const miles = Number(ride.distance);
    const expected = Math.round((9 + Math.max(0, miles - 3) * 1.6) * 100) / 100;
    check("it is priced on the delivery tariff, not the ride tariff", Math.abs(Number(ride.estimatedFare) - expected) < 0.011, `${ride.estimatedFare} for ${miles} miles, expected ${expected}`);
    const { rows: [job] } = await db.query("SELECT parcel_size, pickup_contact, drop_contact, window_start, window_end, po_number FROM commercial_jobs WHERE id=$1", [jobId]);
    check("the parcel, both contacts and the window are on the job", job.parcel_size === "small" && job.pickup_contact?.name === "Front desk" && job.drop_contact?.phone === "3015550122" && !!job.window_start && !!job.window_end && job.po_number === "DEL-9", JSON.stringify(job));
    check("the window is as wide as asked", new Date(job.window_end) - new Date(job.window_start) === 2 * 3_600_000);
    const listed = await rider.req("GET", `/api/org/${office.json.id}/jobs`);
    const row = (listed.json ?? []).find((j) => j.id === jobId);
    check("the desk sees it as a delivery with its window", !!row?.delivery && /Small box.* · hand to Ms Rivera/.test(row.delivery) && /Ready .*deliver by/.test(row.delivery), JSON.stringify(row?.delivery));

    section("Only a driver with the delivery badge");
    await admin.req("PUT", `/api/admin/drivers/${FIXTURES.driver.id}/badges`, { badges: ["medical"] });
    const refused = await driver.req("POST", `/api/driver/rides/${ride.id}/claim`);
    check("a medical-only driver is refused, and told which badge", refused.status === 403 && /Deliveries/.test(refused.json?.message ?? ""), JSON.stringify(refused.json?.message));
    const hidden = await driver.req("GET", "/api/driver/scheduled-rides");
    check("and never sees it on the board", !JSON.stringify(hidden.json ?? {}).includes(ride.id));
    await admin.req("PUT", `/api/admin/drivers/${FIXTURES.driver.id}/badges`, { badges: ["medical", "delivery"] });
    const shown = await driver.req("GET", "/api/driver/scheduled-rides");
    check("with the badge it appears, marked as a delivery", JSON.stringify(shown.json ?? {}).includes(ride.id));
    check("the driver claims it", (await driver.req("POST", `/api/driver/rides/${ride.id}/claim`)).status === 200);

    section("The handover");
    await driver.req("POST", `/api/driver/rides/${ride.id}/confirm-scheduled`);
    await db.query("UPDATE rides SET scheduled_at = NOW() - interval '5 minutes' WHERE id=$1", [ride.id]);
    check("driver starts the run", (await driver.req("POST", `/api/driver/rides/${ride.id}/start`)).status === 200);
    const noName = await driver.req("POST", `/api/driver/rides/${ride.id}/proof`, { photoUrl: "https://example.test/parcel.jpg" });
    check("a photo alone is not a handover", noName.status === 400 && /who received/i.test(noName.json?.message ?? ""), JSON.stringify(noName.json?.message));
    const proof = await driver.req("POST", `/api/driver/rides/${ride.id}/proof`, { receivedBy: "Ms Rivera", photoUrl: "https://example.test/parcel.jpg", note: "Left at reception desk" });
    check("the driver records who took it and the photo", proof.status === 200 && proof.json?.proof?.receivedBy === "Ms Rivera" && proof.json?.proof?.photoUrl === "https://example.test/parcel.jpg", JSON.stringify(proof.json?.proof));
    const { rows: [payBefore] } = await db.query("SELECT COALESCE(virtual_card_balance,'0') AS bal FROM users WHERE id=$1", [FIXTURES.driver.id]);
    check("driver completes it", (await driver.req("POST", `/api/driver/rides/${ride.id}/complete`, {})).status === 200);

    section("What the account is billed");
    const after = await rider.req("GET", `/api/org/${office.json.id}/jobs`);
    const done = (after.json ?? []).find((j) => j.id === jobId);
    check("a business account carries no facility fee, so the total is the fare", Math.abs(done.total - Number(done.actualFare)) < 0.011 && done.facilityFee === "0.00", JSON.stringify([done.total, done.actualFare, done.facilityFee]));
    check("the handover shows on the job", done.proof?.receivedBy === "Ms Rivera");
    const { rows: [split] } = await db.query("SELECT driver_earnings, platform_fee, actual_fare FROM rides WHERE id=$1", [ride.id]);
    check("the driver keeps 85% of a delivery, exactly as on a ride", Math.abs(Number(split.driver_earnings) - Number(split.actual_fare) * 0.85) < 0.011, JSON.stringify(split));
    // Recording the split on the ride is not paying anybody. The organization
    // is billed weekly and PG Ride collects the money, so unlike a cash ride
    // the driver never holds the fare: it has to reach their wallet.
    const { rows: [payAfter] } = await db.query("SELECT COALESCE(virtual_card_balance,'0') AS bal FROM users WHERE id=$1", [FIXTURES.driver.id]);
    check("the driver is actually paid for commercial work, not just credited on paper",
      Math.abs((Number(payAfter.bal) - Number(payBefore.bal)) - Number(split.driver_earnings)) < 0.011,
      `wallet ${payBefore.bal} -> ${payAfter.bal}, earnings ${split.driver_earnings}`);
    const { rows: ledger } = await db.query("SELECT amount, reason FROM wallet_transactions WHERE ride_id=$1 AND reason='ride_earnings'", [ride.id]);
    check("and it is in the ledger once, so a payout can be requested against it",
      ledger.length === 1 && Math.abs(Number(ledger[0].amount) - Number(split.driver_earnings)) < 0.011, JSON.stringify(ledger));
    await new Promise((r) => setTimeout(r, 300));
    const bookedLine = serverLog(server).split("\n").find((l) => l.includes("[commercial] delivery booked") && l.includes("Oxon Hill Title Co")) ?? "";
    check("the booking was logged by account, parcel and window", /Small box.* · hand to Ms Rivera/.test(bookedLine) && /Ready .*deliver by/.test(bookedLine) && /\$\d+\.\d\d/.test(bookedLine), bookedLine.slice(0, 200));
    section("Audit: cancelling from the rider app charges the account, never the person");
    // The requester is the rider of record, so a commercial job is reachable
    // from their own ride history. Before this was caught, that path used the
    // rider fee ladder and tried to take the fee from the requester's wallet.
    const second = await rider.req("POST", `/api/org/${office.json.id}/deliveries`, { ...body(), readyAt: inMin(120), dropContact: { name: "Mr Chen", phone: "3015550133" } });
    check("a second delivery is booked", second.status === 201, JSON.stringify(second.json?.message ?? second.status));
    const secondRide = second.json.ride.id; rideIds.push(secondRide);
    const secondJob = second.json.job.id;
    await admin.req("PATCH", `/api/admin/organizations/${office.json.id}`, { terms: { lateCancelFee: 11, freeCancelHours: 48 } });
    check("driver claims it, so a cancellation now costs the account", (await driver.req("POST", `/api/driver/rides/${secondRide}/claim`)).status === 200);
    const { rows: [walletBefore] } = await db.query("SELECT COALESCE(virtual_card_balance,'0') AS bal FROM users WHERE id=$1", [FIXTURES.rider.id]);
    const fromApp = await rider.req("POST", `/api/rides/${secondRide}/cancel`, { reason: "Not needed after all" });
    check("the app's own cancel answers with the account's fee, not the rider ladder's", fromApp.status === 200 && fromApp.json?.billedTo === "organization" && Number(fromApp.json?.cancellationFee) === 11, JSON.stringify([fromApp.status, fromApp.json?.cancellationFee, fromApp.json?.billedTo]));
    const { rows: [walletAfter] } = await db.query("SELECT COALESCE(virtual_card_balance,'0') AS bal FROM users WHERE id=$1", [FIXTURES.rider.id]);
    check("nothing was taken from the person who booked it", Number(walletAfter.bal) === Number(walletBefore.bal), `${walletBefore.bal} -> ${walletAfter.bal}`);
    const { rows: [onJob] } = await db.query("SELECT cancellation_fee FROM commercial_jobs WHERE id=$1", [secondJob]);
    check("the fee is on the job, so it reaches the statement", onJob.cancellation_fee === "11.00", JSON.stringify(onJob));
    const { rows: [cancelledRide] } = await db.query("SELECT status, stripe_payment_intent_id FROM rides WHERE id=$1", [secondRide]);
    check("the job is cancelled and no card was ever involved", cancelledRide.status === "cancelled" && !cancelledRide.stripe_payment_intent_id, JSON.stringify(cancelledRide));
    section("Audit: an SOS names the account so the facility can be rung");
    const third = await rider.req("POST", `/api/org/${office.json.id}/deliveries`, { ...body(), readyAt: inMin(150) });
    const thirdRide = third.json.ride.id; rideIds.push(thirdRide);
    await driver.req("POST", `/api/driver/rides/${thirdRide}/claim`);
    const sos = await driver.req("POST", "/api/emergency/start", { incidentType: "safety", rideId: thirdRide, location: { lat: 38.9, lng: -76.8 }, description: "Audit check" });
    check("the SOS is raised", sos.status === 200 || sos.status === 201, JSON.stringify(sos.json?.message ?? sos.status));
    await new Promise((r) => setTimeout(r, 300));
    const sosLine = serverLog(server).split("\n").reverse().find((l) => l.includes("[sos]")) ?? "";
    check("the alert names the account and the job, never the passenger", /Oxon Hill Title Co/.test(sosLine) && /J-\d{5}/.test(sosLine) && !/Ms Rivera|Mr Chen/.test(sosLine), sosLine.slice(0, 220));
    // The operator rings the facility; nothing is auto-texted to a business
    // line that may be unattended. So the number has to be in the alert, not
    // somewhere they have to go and look for it mid-emergency.
    check("and hands the operator the facility's number to ring", /Ring the facility: 3015559000 \(Night desk\)/.test(sosLine), sosLine.slice(0, 260));
    await db.query("DELETE FROM emergency_incidents WHERE ride_id=$1", [thirdRide]).catch(() => {});

    const receipt = await rider.req("GET", `/api/rides/${ride.id}/receipt`);
    if (receipt.status === 200) {
      check("a commercial receipt says the organization was billed, not the person", /Billed to the organization/.test(JSON.stringify(receipt.json)), JSON.stringify(receipt.json?.paymentMethodLabel ?? receipt.json).slice(0, 120));
    }

  } finally {
    await db.query("UPDATE driver_profiles SET badges=ARRAY['medical','delivery']::text[] WHERE user_id=$1", [FIXTURES.driver.id]).catch(() => {});
    await deleteRides(db, rideIds).catch(() => {});
    await deleteOrgs(db, orgIds).catch(() => {});
  }
}
