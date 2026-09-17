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
    // Handover by name (the default): a photo alone is not a signature, an
    // outside URL is not a photo, and completing without the handover is
    // refused (2026-09-17). Journey 18b below covers the door.
    const early = await driver.req("POST", `/api/driver/rides/${ride.id}/complete`, {});
    check("a parcel cannot be completed before its handover is recorded", early.status === 409 && early.json?.needsProof === true && /who received it/.test(early.json?.message ?? ""), JSON.stringify(early.json));
    // Ending the run early completes it too, so it is gated the same way
    // (post-implementation audit, 2026-09-17).
    const earlyEnd = await driver.req("POST", `/api/rides/${ride.id}/cancel`, { reason: "ending early" });
    check("a driver cannot end a parcel run early without the handover either", earlyEnd.status === 409 && earlyEnd.json?.needsProof === true, JSON.stringify(earlyEnd.json));
    const foreign = await driver.req("POST", `/api/driver/rides/${ride.id}/proof`, { receivedBy: "Ms Rivera", photoUrl: "https://example.test/parcel.jpg" });
    check("a photo that did not come through PG Ride's upload is refused", foreign.status === 400 && /not a photo PG Ride uploaded/.test(foreign.json?.message ?? ""), JSON.stringify(foreign.json));
    const noName = await driver.req("POST", `/api/driver/rides/${ride.id}/proof`, { photoUrl: "/api/objects/db-upload/00000000-0000-4000-8000-000000000000" });
    check("a photo alone is not a handover", noName.status === 400 && /who received/i.test(noName.json?.message ?? ""), JSON.stringify(noName.json?.message));
    // A real photo goes through the same door as driver documents.
    const up = await driver.req("POST", "/api/objects/upload?store=db", {});
    const objectPath = new URL(up.json?.uploadURL ?? "http://x/").pathname;
    const put = await driver.req("PUT", objectPath, "not-really-jpeg-bytes", { "Content-Type": "image/jpeg" });
    check("the driver's phone uploads the photo through PG Ride", up.status === 200 && put.status === 200, `upload=${up.status} put=${put.status} ${objectPath}`);
    // Only the driver's own image counts: someone else's object, or a page
    // uploaded as a "photo", is refused (post-implementation audit).
    const theirs = await rider.req("POST", "/api/objects/upload?store=db", {});
    const theirsPath = new URL(theirs.json?.uploadURL ?? "http://x/").pathname;
    await rider.req("PUT", theirsPath, "someone-elses-bytes", { "Content-Type": "image/jpeg" });
    const notMine = await driver.req("POST", `/api/driver/rides/${ride.id}/proof`, { receivedBy: "Ms Rivera", photoUrl: theirsPath });
    check("an object the driver did not upload is refused as a proof", notMine.status === 403 && /not yours/.test(notMine.json?.message ?? ""), JSON.stringify(notMine.json));
    const upHtml = await driver.req("POST", "/api/objects/upload?store=db", {});
    const htmlPath = new URL(upHtml.json?.uploadURL ?? "http://x/").pathname;
    await driver.req("PUT", htmlPath, "<script>alert(1)</script>", { "Content-Type": "text/html" });
    const notPhoto = await driver.req("POST", `/api/driver/rides/${ride.id}/proof`, { receivedBy: "Ms Rivera", photoUrl: htmlPath });
    check("a page uploaded as a photo is refused", notPhoto.status === 400 && /must be a photo/.test(notPhoto.json?.message ?? ""), JSON.stringify(notPhoto.json));
    const served = await fetch(base + htmlPath, { headers: { "X-Forwarded-Proto": "https", Cookie: driver.cookieHeader() } });
    check("and even its uploader only ever gets it as a download, never a page", served.status === 200 && /attachment/.test(served.headers.get("content-disposition") ?? ""), `${served.status} ${served.headers.get("content-disposition")}`);
    const ghost = await driver.req("POST", `/api/driver/rides/${ride.id}/proof`, { receivedBy: "Ms Rivera", photoUrl: "/api/objects/db-upload/00000000-0000-4000-8000-000000000001" });
    check("a photo that was never uploaded is refused", ghost.status === 400, JSON.stringify(ghost.json));
    const proof = await driver.req("POST", `/api/driver/rides/${ride.id}/proof`, { receivedBy: "Ms Rivera", photoUrl: up.json?.uploadURL, note: "Left at reception desk", lat: DEST.lat, lng: DEST.lng });
    check("the proof carries where it was recorded, close to the drop", proof.status === 200 && proof.json?.proof?.photoUrl === objectPath && proof.json?.proof?.farFromDrop === false && Number(proof.json?.proof?.distanceFromDropMeters) < 150, JSON.stringify(proof.json?.proof));
    const swap = await driver.req("POST", `/api/driver/rides/${ride.id}/proof`, { receivedBy: "Ms Rivera", photoUrl: theirsPath });
    check("a recorded photo is not replaced", swap.status === 409 && /already has its photo/.test(swap.json?.message ?? ""), JSON.stringify(swap.json));
    const officeDesk = rider; // the rider fixture owns the office account
    const photo = await officeDesk.text("GET", objectPath);
    check("the desk that booked the job can see the photo; it belongs to the account", photo.status === 200 && /image\/jpeg/.test(photo.type), `status=${photo.status} type=${photo.type}`);
    const stranger = new Session(base); await stranger.login(FIXTURES.admin.email);
    check("an admin can see it too", (await stranger.text("GET", objectPath)).status === 200);
    check("the driver records who took it and the photo", proof.status === 200 && proof.json?.proof?.receivedBy === "Ms Rivera" && proof.json?.proof?.photoUrl === objectPath, JSON.stringify(proof.json?.proof));
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
    const second = await rider.req("POST", `/api/org/${office.json.id}/deliveries`, { ...body(), readyAt: inMin(120), dropContact: { name: "Mr Chen", phone: "3015550133" }, handover: "unattended" });
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
    section("At the door, the photo is the signature (Festus: a photo only when nobody signs)");
    const door = await rider.req("POST", `/api/org/${office.json.id}/deliveries`, { ...body(), readyAt: inMin(100), dropContact: { name: "Mrs Adeyemi", phone: "3015550144", note: "Side door, under the awning" }, handover: "unattended" });
    check("a leave-at-the-door delivery is booked with its handover recorded", door.status === 201 && door.json?.job?.handover === "unattended", JSON.stringify(door.json?.job?.handover ?? door.json?.message));
    const doorRide = door.json.ride.id; rideIds.push(doorRide);
    const doorClaim = await driver.req("POST", `/api/driver/rides/${doorRide}/claim`);
    check("the driver claims the door delivery", doorClaim.status === 200, JSON.stringify(doorClaim.json?.message ?? doorClaim.status));
    await driver.req("POST", `/api/driver/rides/${doorRide}/confirm-scheduled`);
    await db.query("UPDATE rides SET scheduled_at = NOW() - interval '5 minutes' WHERE id=$1", [doorRide]);
    const card = await driver.req("GET", "/api/driver/active-rides");
    const onCard = (card.json ?? []).find((r) => r.id === doorRide);
    check("the driver's card is told how it changes hands and who to ask for", !!onCard?.delivery && onCard.delivery.handover === "unattended" && onCard.delivery.needsPhoto === true && onCard.delivery.needsName === false && /take a photo/.test(onCard.delivery.handoverText) && onCard.delivery.dropContact?.note === "Side door, under the awning", JSON.stringify(onCard?.delivery));
    const tooEarly = await driver.req("POST", `/api/driver/rides/${doorRide}/proof`, { photoPending: true });
    check("a handover cannot be recorded before the run is on the road", tooEarly.status === 409 && /on the road/.test(tooEarly.json?.message ?? ""), JSON.stringify(tooEarly.json));
    const doorStart = await driver.req("POST", `/api/driver/rides/${doorRide}/start`);
    check("and starts the run", doorStart.status === 200, JSON.stringify(doorStart.json?.message ?? doorStart.status));
    const noPhoto = await driver.req("POST", `/api/driver/rides/${doorRide}/complete`, {});
    check("it cannot be completed without a photo of where it was left", noPhoto.status === 409 && /a photo of where it was left/.test(noPhoto.json?.message ?? ""), JSON.stringify(noPhoto.json));
    const nameOnly = await driver.req("POST", `/api/driver/rides/${doorRide}/proof`, { receivedBy: "the mat" });
    check("a name alone is not a signature at the door", nameOnly.status === 400 && /needs a photo/.test(nameOnly.json?.message ?? ""), JSON.stringify(nameOnly.json));
    // No signal at the door: the photo stays on the phone, the job completes
    // with "photo pending", and the position is recorded — 6 km away here,
    // which is flagged to the desk and never refused.
    const pending = await driver.req("POST", `/api/driver/rides/${doorRide}/proof`, { photoPending: true, lat: PICKUP.lat, lng: PICKUP.lng, note: "Left under the awning" });
    check("a photo still on the phone counts, and the distance is recorded and flagged", pending.status === 200 && pending.json?.proof?.photoPending === true && pending.json?.proof?.farFromDrop === true && Number(pending.json?.proof?.distanceFromDropMeters) > 150, JSON.stringify(pending.json?.proof));
    check("the delivery completes with the photo pending", (await driver.req("POST", `/api/driver/rides/${doorRide}/complete`, {})).status === 200);
    const rename = await driver.req("POST", `/api/driver/rides/${doorRide}/proof`, { receivedBy: "Someone else", note: "changed my mind" });
    check("after completion nothing but the pending photo can change", rename.status === 409, JSON.stringify(rename.json));
    // Six hours on, ops is paged once; a day on, the proof says the photo never came.
    const pendingSweep = () => admin.req("POST", "/api/admin/analytics/pending-proof-sweep").then((r) => r.json);
    const { rows: [{ job_id: doorJobId }] } = await db.query("SELECT id AS job_id FROM commercial_jobs WHERE ride_id=$1", [doorRide]);
    const backdate = (h) => db.query("UPDATE commercial_jobs SET proof = jsonb_set(proof, '{signedAt}', to_jsonb((NOW() - ($2 || ' hours')::interval)::text)) WHERE id=$1", [doorJobId, String(h)]);
    await backdate(7);
    const p1 = await pendingSweep();
    const { rows: [after6] } = await db.query("SELECT proof->>'photoPendingPagedAt' AS paged, proof->>'photoPending' AS pending FROM commercial_jobs WHERE id=$1", [doorJobId]);
    check("six hours with the photo still on the phone pages ops once", p1?.paged >= 1 && !!after6?.paged && after6?.pending === "true", JSON.stringify([p1, after6]));
    const p2 = await pendingSweep();
    check("and not again", (p2?.paged ?? 0) === 0 && (p2?.expired ?? 0) === 0, JSON.stringify(p2));
    await backdate(25);
    const p3 = await pendingSweep();
    const { rows: [after24] } = await db.query("SELECT proof->>'photoNeverArrived' AS never, proof->>'photoPending' AS pending, proof->>'signedAt' AS signed FROM commercial_jobs WHERE id=$1", [doorJobId]);
    check("a day on, the proof says the photo never arrived and pending clears", p3?.expired >= 1 && after24?.never === "true" && after24?.pending === "false", JSON.stringify([p3, after24]));
    const signedBefore = after24?.signed;
    const up2 = await driver.req("POST", "/api/objects/upload?store=db", {});
    const path2 = new URL(up2.json?.uploadURL ?? "http://x/").pathname;
    await driver.req("PUT", path2, "later-jpeg-bytes", { "Content-Type": "image/jpeg" });
    const followed = await driver.req("POST", `/api/driver/rides/${doorRide}/proof`, { photoUrl: up2.json?.uploadURL });
    check("a late photo is still taken, 'never arrived' clears, and the handover time is not rewritten", followed.status === 200 && followed.json?.proof?.photoUrl === path2 && followed.json?.proof?.photoPending === false && followed.json?.proof?.photoNeverArrived === false && followed.json?.proof?.signedAt === signedBefore && !!followed.json?.proof?.photoUploadedAt, JSON.stringify(followed.json?.proof));
    const deskJobs = await rider.req("GET", `/api/org/${office.json.id}/jobs`);
    const deskRow = (deskJobs.json ?? []).find((j) => j.rideId === doorRide);
    check("the desk's job row carries the handover kind, the photo and the far-away flag", deskRow?.handover === "unattended" && deskRow?.proof?.photoUrl === path2 && deskRow?.proof?.farFromDrop === true, JSON.stringify({ handover: deskRow?.handover, proof: deskRow?.proof }));

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
