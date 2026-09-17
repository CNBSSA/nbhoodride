/**
 * Recipient pays: a food shop books a delivery the recipient pays for. The
 * job is held off the claim board until paid; the recipient's page shows the
 * shop and the fee; the shop can take the fee itself; a paid job appears on
 * the statement as paid by the recipient; a cancelled paid job is refunded;
 * the sweep nudges, asks the shop, and gives up when the window closes.
 * Stripe is not configured in this harness, so card payment itself is
 * marked paid in the database and the refund lands as "refund_pending".
 */
import { Session, check, section, serverLog, deleteRides, deleteOrgs, FIXTURES, PICKUP, DEST } from "./harness.mjs";

export async function run({ base, db, server }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const guest = new Session(base); await guest.csrf();
  const rideIds = [], orgIds = [];
  const inMin = (m) => new Date(Date.now() + m * 60_000).toISOString();
  const board = async () => JSON.stringify((await driver.req("GET", "/api/driver/scheduled-rides")).json ?? {});
  const body = (extra = {}) => ({
    parcelSize: "small", pickupContact: { name: "Counter", phone: "3015559100" }, dropContact: { name: "Tunde", phone: "3015550177" },
    readyAt: inMin(90), windowHours: 2, pickup: PICKUP, destination: DEST, handover: "person", ...extra,
  });
  const tokenOf = (link) => String(link ?? "").split("/pay/")[1];
  try {
    const shop = await admin.req("POST", "/api/admin/organizations", { name: "Mama's Kitchen", category: "food", contactPhone: "3015559100" });
    orgIds.push(shop.json.id);
    await admin.req("POST", `/api/admin/organizations/${shop.json.id}/members`, { email: FIXTURES.rider.email, role: "owner" });
    const orgId = shop.json.id;

    section("Booking with the recipient paying holds the job");
    const noPhone = await rider.req("POST", `/api/org/${orgId}/deliveries`, body({ payer: "recipient", dropContact: { name: "Tunde" } }));
    check("the recipient's phone is required — that is where the link goes", noPhone.status === 400 && /phone number is needed/.test(noPhone.json?.message ?? ""), JSON.stringify(noPhone.json));
    const held = await rider.req("POST", `/api/org/${orgId}/deliveries`, body({ payer: "recipient" }));
    check("the delivery is booked, held, with a pay link", held.status === 201 && held.json?.job?.payer === "recipient" && held.json?.job?.recipientPaymentStatus === "awaiting" && /\/pay\/[0-9a-f]{48}$/.test(held.json?.recipientPay?.link ?? ""), JSON.stringify(held.json?.recipientPay ?? held.json?.message));
    const heldRide = held.json.ride.id; rideIds.push(heldRide);
    const heldJob = held.json.job.id;
    const token = tokenOf(held.json.recipientPay.link);
    const { rows: [jobRow] } = await db.query("SELECT recipient_pay_token, recipient_fee FROM commercial_jobs WHERE id=$1", [heldJob]);
    check("the fee is the quoted fare, frozen on the job", jobRow?.recipient_pay_token === token && Number(jobRow?.recipient_fee) === Number(held.json.ride.estimatedFare), JSON.stringify(jobRow));
    check("no driver can see a held job", !(await board()).includes(heldRide));
    await new Promise((r) => setTimeout(r, 200));
    const textLine = serverLog(server).split("\n").reverse().find((l) => l.includes("[recipient-pay] pay link for")) ?? "";
    check("the text to the recipient is logged verbatim: shop, fee, link", /Mama's Kitchen/.test(textLine) && /\$\d+\.\d\d/.test(textLine) && textLine.includes(token) && !/Tunde/.test(textLine.split("→")[0]), textLine.slice(0, 200));
    const deskRows = await rider.req("GET", `/api/org/${orgId}/jobs`);
    const deskRow = (deskRows.json ?? []).find((j) => j.id === heldJob);
    check("the desk sees it waiting, with the token to copy", deskRow?.payer === "recipient" && deskRow?.recipientPaymentStatus === "awaiting" && deskRow?.recipientPayToken === token, JSON.stringify({ payer: deskRow?.payer, s: deskRow?.recipientPaymentStatus }));

    section("The recipient's page");
    const view = await guest.req("GET", `/api/pay/${token}`);
    check("shows the shop, the parcel, the fee and the window — never a food price", view.status === 200 && view.json?.shopName === "Mama's Kitchen" && view.json?.state === "awaiting" && Number(view.json?.fee) === Number(held.json.ride.estimatedFare) && typeof view.json?.cardPayments === "boolean", JSON.stringify(view.json));
    check("a made-up link is not valid", (await guest.req("GET", "/api/pay/not-a-token")).status === 404);
    const intent = await guest.req("POST", `/api/pay/${token}/intent`);
    check("without Stripe the page is told card payments are unavailable, in words", intent.status === 503 && /not available/.test(intent.json?.message ?? ""), JSON.stringify(intent.json));
    const declined = await guest.req("POST", `/api/pay/${token}/decline`);
    check("the recipient can decline, and the shop is texted", declined.status === 200 && declined.json?.state === "declined" && /declined, to the shop/.test(serverLog(server)), JSON.stringify(declined.json));
    const resend = await rider.req("POST", `/api/org/${orgId}/jobs/${heldJob}/resend-pay-link`);
    check("the desk can text the link again", resend.status === 200 && tokenOf(resend.json?.link) === token, JSON.stringify(resend.json));
    check("still held after a decline", !(await board()).includes(heldRide));

    section("The shop takes the fee itself and the job is released");
    const wePay = await rider.req("POST", `/api/org/${orgId}/jobs/${heldJob}/payer`, { payer: "organization" });
    check("'We'll pay' moves the fee to the account", wePay.status === 200 && wePay.json?.payer === "organization", JSON.stringify(wePay.json));
    check("and drivers can see it now", (await board()).includes(heldRide));
    const dead = await guest.req("GET", `/api/pay/${token}`);
    check("the old pay link no longer opens anything", dead.status === 404, `status=${dead.status}`);

    section("Paid by card: released, on the statement as paid by the recipient, refunded if cancelled");
    const paid = await rider.req("POST", `/api/org/${orgId}/deliveries`, body({ payer: "recipient", readyAt: inMin(95) }));
    const paidRide = paid.json.ride.id; rideIds.push(paidRide); const paidJob = paid.json.job.id;
    await db.query("UPDATE commercial_jobs SET recipient_payment_status='paid', recipient_paid_at=NOW(), recipient_payment_intent_id='pi_e2e_paid' WHERE id=$1", [paidJob]);
    check("once paid, drivers can see it", (await board()).includes(paidRide));
    check("the driver claims it", (await driver.req("POST", `/api/driver/rides/${paidRide}/claim`)).status === 200);
    await driver.req("POST", `/api/driver/rides/${paidRide}/confirm-scheduled`);
    await db.query("UPDATE rides SET scheduled_at = NOW() - interval '5 minutes' WHERE id=$1", [paidRide]);
    check("starts it", (await driver.req("POST", `/api/driver/rides/${paidRide}/start`)).status === 200);
    await driver.req("POST", `/api/driver/rides/${paidRide}/proof`, { receivedBy: "Tunde" });
    const done = await driver.req("POST", `/api/driver/rides/${paidRide}/complete`, {});
    check("and completes it, keeping 85% as on any job", done.status === 200 && Math.abs(Number(done.json?.driverEarnings) - Number(paid.json.ride.estimatedFare) * 0.85) < 0.02, JSON.stringify([done.json?.driverEarnings, paid.json.ride.estimatedFare]));
    const month = new Date().toISOString().slice(0, 7);
    const st = await rider.req("GET", `/api/org/${orgId}/statement?month=${month}`);
    const line = (st.json?.lines ?? []).find((l) => String(l.jobNumber) === String(paid.json.job.jobNumber));
    check("the statement shows the job as paid by the recipient and owes nothing for its fare", !!line && line.paidByRecipient === true && Number(st.json?.totals?.fares) === 0, JSON.stringify({ line: line?.paidByRecipient, fares: st.json?.totals?.fares, total: st.json?.totals?.total }));
    const toRefund = await rider.req("POST", `/api/org/${orgId}/deliveries`, body({ payer: "recipient", readyAt: inMin(100) }));
    const refundRide = toRefund.json.ride.id; rideIds.push(refundRide); const refundJob = toRefund.json.job.id;
    await db.query("UPDATE commercial_jobs SET recipient_payment_status='paid', recipient_paid_at=NOW(), recipient_payment_intent_id='pi_e2e_refund' WHERE id=$1", [refundJob]);
    const cancelled = await rider.req("POST", `/api/org/${orgId}/jobs/${refundJob}/cancel`, { reason: "Kitchen closed" });
    const { rows: [afterCancel] } = await db.query("SELECT recipient_payment_status FROM commercial_jobs WHERE id=$1", [refundJob]);
    check("cancelling a paid job refunds it — here Stripe is absent, so it is marked pending and ops is paged", cancelled.status === 200 && afterCancel?.recipient_payment_status === "refund_pending", JSON.stringify(afterCancel));

    section("The sweep: nudge once, ask the shop once the parcel is ready, give up when the window closes");
    const late = await rider.req("POST", `/api/org/${orgId}/deliveries`, body({ payer: "recipient", readyAt: inMin(60) }));
    const lateRide = late.json.ride.id; rideIds.push(lateRide); const lateJob = late.json.job.id;
    const sweep = (q) => admin.req("POST", "/api/admin/analytics/recipient-pay-sweep").then((r) => r.json);
    await db.query("UPDATE commercial_jobs SET created_at = NOW() - interval '16 minutes' WHERE id=$1", [lateJob]);
    const s1 = await sweep();
    const { rows: [n1] } = await db.query("SELECT recipient_nudged_at, shop_asked_at FROM commercial_jobs WHERE id=$1", [lateJob]);
    check("sixteen minutes in, the recipient is nudged once", s1?.nudged >= 1 && !!n1?.recipient_nudged_at && !n1?.shop_asked_at, JSON.stringify([s1, n1]));
    const s2 = await sweep();
    check("and not again", (s2?.nudged ?? 0) === 0, JSON.stringify(s2));
    await db.query("UPDATE commercial_jobs SET window_start = NOW() - interval '1 minute' WHERE id=$1", [lateJob]);
    const s3 = await sweep();
    const { rows: [n3] } = await db.query("SELECT shop_asked_at FROM commercial_jobs WHERE id=$1", [lateJob]);
    check("when the parcel is ready and nobody paid, the shop is asked once", s3?.asked >= 1 && !!n3?.shop_asked_at, JSON.stringify([s3, n3]));
    await db.query("UPDATE commercial_jobs SET window_end = NOW() - interval '1 minute' WHERE id=$1", [lateJob]);
    const s4 = await sweep();
    const { rows: [n4] } = await db.query("SELECT cj.recipient_payment_status, r.status FROM commercial_jobs cj JOIN rides r ON r.id=cj.ride_id WHERE cj.id=$1", [lateJob]);
    check("when the window closes unpaid, the job is cancelled and nobody is charged", s4?.expired >= 1 && n4?.recipient_payment_status === "expired" && n4?.status === "cancelled", JSON.stringify([s4, n4]));
    const expiredView = await guest.req("GET", `/api/pay/${tokenOf(late.json.recipientPay.link)}`);
    check("the recipient's page says so", expiredView.status === 200 && expiredView.json?.state === "expired", JSON.stringify(expiredView.json?.state));
    check("and can no longer be paid", (await guest.req("POST", `/api/pay/${tokenOf(late.json.recipientPay.link)}/intent`)).status === 410);
    const orphan = await rider.req("POST", `/api/org/${orgId}/deliveries`, body({ payer: "recipient", readyAt: inMin(60) }));
    const orphanRide = orphan.json.ride.id; rideIds.push(orphanRide); const orphanJob = orphan.json.job.id;
    await db.query("UPDATE commercial_jobs SET recipient_payment_status='paid', recipient_paid_at=NOW(), recipient_payment_intent_id='pi_e2e_orphan', window_end = NOW() - interval '1 minute' WHERE id=$1", [orphanJob]);
    await sweep();
    const { rows: [n5] } = await db.query("SELECT cj.recipient_payment_status, r.status FROM commercial_jobs cj JOIN rides r ON r.id=cj.ride_id WHERE cj.id=$1", [orphanJob]);
    check("a paid job nobody took by the end of its window is cancelled and refunded", n5?.status === "cancelled" && n5?.recipient_payment_status === "refund_pending", JSON.stringify(n5));

    section("The shop's default");
    const setDefault = await rider.req("PATCH", `/api/org/${orgId}/settings`, { defaultPayer: "recipient" });
    check("an owner can make recipient-pays the default", setDefault.status === 200 && setDefault.json?.defaultPayer === "recipient", JSON.stringify(setDefault.json));
    const mine = await rider.req("GET", "/api/org/mine");
    check("and the desk is told", (mine.json ?? []).some((m) => m.organization.id === orgId && m.organization.defaultPayer === "recipient"));
    const notOwner = await driver.req("PATCH", `/api/org/${orgId}/settings`, { defaultPayer: "organization" });
    check("nobody else can", notOwner.status === 403, `status=${notOwner.status}`);
  } finally {
    await deleteRides(db, rideIds).catch(() => {});
    await deleteOrgs(db, orgIds).catch(() => {});
  }
}
