/**
 * Recipient approval: a food shop passes the delivery fee on to its customer
 * and asks for their yes before sending. The job is held off the claim board
 * until the recipient approves or the shop sends it anyway; the recipient's
 * page shows the shop and the fee; the fee stays on the shop's statement;
 * the sweep nudges, asks the shop, and gives up when the window closes.
 * No money moves anywhere in this journey.
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
  const tokenOf = (link) => String(link ?? "").split("/approve/")[1];
  try {
    const shop = await admin.req("POST", "/api/admin/organizations", { name: "Mama's Kitchen", category: "food", contactPhone: "3015559100" });
    const orgId = shop.json.id; orgIds.push(orgId);
    await admin.req("POST", `/api/admin/organizations/${orgId}/members`, { email: FIXTURES.rider.email, role: "owner" });

    section("Asking the recipient holds the job");
    const noPhone = await rider.req("POST", `/api/org/${orgId}/deliveries`, body({ askRecipient: true, dropContact: { name: "Tunde" } }));
    check("the recipient's phone is required — that is where the link goes", noPhone.status === 400 && /phone number is needed/.test(noPhone.json?.message ?? ""), JSON.stringify(noPhone.json));
    const held = await rider.req("POST", `/api/org/${orgId}/deliveries`, body({ askRecipient: true }));
    check("the delivery is booked, held, with an approval link", held.status === 201 && held.json?.job?.recipientApproval === "awaiting" && /\/approve\/[0-9a-f]{48}$/.test(held.json?.recipientApproval?.link ?? ""), JSON.stringify(held.json?.recipientApproval ?? held.json?.message));
    const heldRide = held.json.ride.id; rideIds.push(heldRide);
    const heldJob = held.json.job.id;
    const token = tokenOf(held.json.recipientApproval.link);
    const { rows: [jobRow] } = await db.query("SELECT recipient_approval_token, recipient_fee FROM commercial_jobs WHERE id=$1", [heldJob]);
    check("the fee shown is the quoted fare, frozen on the job", jobRow?.recipient_approval_token === token && Number(jobRow?.recipient_fee) === Number(held.json.ride.estimatedFare), JSON.stringify(jobRow));
    check("no driver can see a held job", !(await board()).includes(heldRide));
    const sneak = await driver.req("POST", `/api/driver/rides/${heldRide}/claim`);
    check("and cannot claim it by id either — the hold is enforced, not just hidden", sneak.status === 409 && /waiting for the recipient/.test(sneak.json?.message ?? ""), JSON.stringify(sneak.json));
    await new Promise((r) => setTimeout(r, 200));
    const textLine = serverLog(server).split("\n").reverse().find((l) => l.includes("[recipient-approval] approval link for") && l.includes("→")) ?? "";
    check("the text to the recipient is logged verbatim: shop, fee, link, the shop adds it to your bill", /Mama's Kitchen/.test(textLine) && /\$\d+\.\d\d/.test(textLine) && textLine.includes(token) && /adds to your bill/.test(textLine), textLine.slice(0, 220));
    const deskRows = await rider.req("GET", `/api/org/${orgId}/jobs`);
    const deskRow = (deskRows.json ?? []).find((j) => j.id === heldJob);
    check("the desk sees it waiting, with the token to copy", deskRow?.recipientApproval === "awaiting" && deskRow?.recipientApprovalToken === token, JSON.stringify({ a: deskRow?.recipientApproval }));

    section("The recipient's page");
    const view = await guest.req("GET", `/api/approve/${token}`);
    check("shows the shop, the parcel, the fee and the window — never the goods, never a card form", view.status === 200 && view.json?.shopName === "Mama's Kitchen" && view.json?.state === "awaiting" && Number(view.json?.fee) === Number(held.json.ride.estimatedFare) && !("cardPayments" in view.json), JSON.stringify(view.json));
    check("a made-up link is not valid", (await guest.req("GET", "/api/approve/not-a-token")).status === 404);
    const declined = await guest.req("POST", `/api/approve/${token}/decline`);
    check("the recipient can decline, and the shop is texted", declined.status === 200 && declined.json?.state === "declined" && /declined, to the shop/.test(serverLog(server)), JSON.stringify(declined.json));
    const resend = await rider.req("POST", `/api/org/${orgId}/jobs/${heldJob}/resend-approval-link`);
    check("the desk can text the link again", resend.status === 200 && tokenOf(resend.json?.link) === token, JSON.stringify(resend.json));
    check("still held after a decline", !(await board()).includes(heldRide));
    const approved = await guest.req("POST", `/api/approve/${token}/approve`);
    check("the recipient can still approve after declining, and the job is released", approved.status === 200 && approved.json?.state === "approved" && (await board()).includes(heldRide), JSON.stringify(approved.json));
    check("both sides are texted", /approved, to the recipient/.test(serverLog(server)) && /approved, to the shop/.test(serverLog(server)));
    const closedRow = (await rider.req("GET", `/api/org/${orgId}/jobs`)).json?.find((j) => j.id === heldJob);
    check("the desk reads 'approved' and no longer offers the link", closedRow?.recipientApproval === "approved" && !closedRow?.recipientApprovalToken, JSON.stringify({ a: closedRow?.recipientApproval, t: closedRow?.recipientApprovalToken }));

    section("The shop sends it anyway");
    const second = await rider.req("POST", `/api/org/${orgId}/deliveries`, body({ askRecipient: true, readyAt: inMin(95) }));
    const secondRide = second.json.ride.id; rideIds.push(secondRide);
    const anyway = await rider.req("POST", `/api/org/${orgId}/jobs/${second.json.job.id}/send-anyway`);
    check("'Send anyway' lifts the hold", anyway.status === 200 && anyway.json?.state === "none" && (await board()).includes(secondRide), JSON.stringify(anyway.json));
    const dead = await guest.req("GET", `/api/approve/${tokenOf(second.json.recipientApproval.link)}`);
    check("and the old link no longer opens anything", dead.status === 404, `status=${dead.status}`);

    section("The fee stays on the shop's statement");
    check("the driver claims the approved job", (await driver.req("POST", `/api/driver/rides/${heldRide}/claim`)).status === 200);
    await driver.req("POST", `/api/driver/rides/${heldRide}/confirm-scheduled`);
    await db.query("UPDATE rides SET scheduled_at = NOW() - interval '5 minutes' WHERE id=$1", [heldRide]);
    check("starts it", (await driver.req("POST", `/api/driver/rides/${heldRide}/start`)).status === 200);
    await driver.req("POST", `/api/driver/rides/${heldRide}/proof`, { receivedBy: "Tunde" });
    const done = await driver.req("POST", `/api/driver/rides/${heldRide}/complete`, {});
    check("and completes it, keeping 85% as on any job", done.status === 200 && Math.abs(Number(done.json?.driverEarnings) - Number(held.json.ride.estimatedFare) * 0.85) < 0.02, JSON.stringify([done.json?.driverEarnings, held.json.ride.estimatedFare]));
    const month = new Date().toISOString().slice(0, 7);
    const st = await rider.req("GET", `/api/org/${orgId}/statement?month=${month}`);
    const line = (st.json?.lines ?? []).find((l) => String(l.jobNumber) === String(held.json.job.jobNumber));
    check("the statement owes the shop's fare as for any delivery — nothing was collected from the recipient", !!line && Number(st.json?.totals?.fares) === Number(held.json.ride.estimatedFare), JSON.stringify({ fares: st.json?.totals?.fares, fare: held.json.ride.estimatedFare }));

    section("A cancelled job closes its link");
    const closing = await rider.req("POST", `/api/org/${orgId}/deliveries`, body({ askRecipient: true, readyAt: inMin(70) }));
    rideIds.push(closing.json.ride.id);
    await rider.req("POST", `/api/org/${orgId}/jobs/${closing.json.job.id}/cancel`, { reason: "Changed our mind" });
    const closedView = await guest.req("GET", `/api/approve/${tokenOf(closing.json.recipientApproval.link)}`);
    check("the recipient's page says there is nothing to answer", closedView.status === 200 && closedView.json?.state === "cancelled", JSON.stringify(closedView.json?.state));
    check("and it can no longer be approved or declined", (await guest.req("POST", `/api/approve/${tokenOf(closing.json.recipientApproval.link)}/approve`)).status === 410 && (await guest.req("POST", `/api/approve/${tokenOf(closing.json.recipientApproval.link)}/decline`)).status === 410);
    const adminHeld = await rider.req("POST", `/api/org/${orgId}/deliveries`, body({ askRecipient: true, readyAt: inMin(75) }));
    rideIds.push(adminHeld.json.ride.id);
    const adminCancel = await admin.req("POST", `/api/admin/rides/${adminHeld.json.ride.id}/cancel`, { reason: "Weather" });
    const { rows: [afterAdmin] } = await db.query("SELECT recipient_approval FROM commercial_jobs WHERE id=$1", [adminHeld.json.job.id]);
    check("PG Ride cancelling a held job closes its link too", adminCancel.status === 200 && afterAdmin?.recipient_approval === "cancelled", JSON.stringify([adminCancel.status, afterAdmin]));

    section("The sweep: nudge once, ask the shop once the parcel is ready, give up when the window closes");
    const late = await rider.req("POST", `/api/org/${orgId}/deliveries`, body({ askRecipient: true, readyAt: inMin(60) }));
    const lateJob = late.json.job.id; rideIds.push(late.json.ride.id);
    const sweep = () => admin.req("POST", "/api/admin/analytics/recipient-approval-sweep").then((r) => r.json);
    await db.query("UPDATE commercial_jobs SET created_at = NOW() - interval '16 minutes' WHERE id=$1", [lateJob]);
    const s1 = await sweep();
    const { rows: [n1] } = await db.query("SELECT recipient_nudged_at, shop_asked_at FROM commercial_jobs WHERE id=$1", [lateJob]);
    check("sixteen minutes in, the recipient is nudged once", s1?.nudged >= 1 && !!n1?.recipient_nudged_at && !n1?.shop_asked_at, JSON.stringify([s1, n1]));
    check("and not again", ((await sweep())?.nudged ?? 0) === 0);
    await db.query("UPDATE commercial_jobs SET window_start = NOW() - interval '1 minute' WHERE id=$1", [lateJob]);
    const s3 = await sweep();
    const { rows: [n3] } = await db.query("SELECT shop_asked_at FROM commercial_jobs WHERE id=$1", [lateJob]);
    check("when the parcel is ready and nobody answered, the shop is asked once", s3?.asked >= 1 && !!n3?.shop_asked_at, JSON.stringify([s3, n3]));
    await db.query("UPDATE commercial_jobs SET window_end = NOW() - interval '1 minute' WHERE id=$1", [lateJob]);
    const s4 = await sweep();
    const { rows: [n4] } = await db.query("SELECT cj.recipient_approval, r.status FROM commercial_jobs cj JOIN rides r ON r.id=cj.ride_id WHERE cj.id=$1", [lateJob]);
    check("when the window closes unanswered, the job is cancelled and nothing is charged", s4?.expired >= 1 && n4?.recipient_approval === "expired" && n4?.status === "cancelled", JSON.stringify([s4, n4]));
    const expiredView = await guest.req("GET", `/api/approve/${tokenOf(late.json.recipientApproval.link)}`);
    check("the recipient's page says so, and cannot be approved", expiredView.json?.state === "expired" && (await guest.req("POST", `/api/approve/${tokenOf(late.json.recipientApproval.link)}/approve`)).status === 410, JSON.stringify(expiredView.json?.state));

    section("The shop's default");
    const setDefault = await rider.req("PATCH", `/api/org/${orgId}/settings`, { askRecipientByDefault: true });
    check("an owner can make 'ask first' the default", setDefault.status === 200 && setDefault.json?.askRecipientByDefault === true, JSON.stringify(setDefault.json));
    const mine = await rider.req("GET", "/api/org/mine");
    check("and the desk is told", (mine.json ?? []).some((m) => m.organization.id === orgId && m.organization.askRecipientByDefault === true));
    check("nobody else can", (await driver.req("PATCH", `/api/org/${orgId}/settings`, { askRecipientByDefault: false })).status === 403);
  } finally {
    await deleteRides(db, rideIds).catch(() => {});
    await deleteOrgs(db, orgIds).catch(() => {});
  }
}
