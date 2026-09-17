/**
 * Commercial routes — one door for everything an organization can do.
 *
 *   /api/admin/organizations/*   the operator: create accounts, attach people,
 *                                book on an organization's behalf, statements
 *   /api/org/*                   members: what my organizations are, book,
 *                                list jobs, statements — every route passes
 *                                through requireMember, which loads the
 *                                caller's role in THAT organization or answers
 *                                403. Nothing here reads across organizations.
 *
 * The whole surface answers 404 while the commercial feature flag is off.
 */

import type { Express, NextFunction, Request, Response } from "express";
import { featureFlags } from "../featureFlags";
import type { IStorage } from "../storage";
import type { Ride } from "@shared/schema";
import { canBook, canManageMembers, canSeeStatement, currentMonthKey, formatJobNumber, type OrgRole } from "@shared/commercial";
import { opsAlert, formatOpsAlert } from "../telegramOps";
import {
  CommercialError, addMemberByEmail, createOrganization, firstBookingMember, getOrganization,
  listMembers, listOrganizations, membershipRole, organizationsForUser, removeMember, updateOrganization,
} from "./organizations";
import { bookJob, jobForRide, listJobs } from "./jobs";
import { acceptInvitation, describeInvitation, inviteByEmail, listOpenInvitations, revokeInvitation } from "./invitations";
import { sendOrganizationInviteEmail } from "../emailService";
import { resolveAppUrl } from "../appUrl";
import { INVITATION_DAYS } from "@shared/invitations";
import { bookDelivery } from "./deliveries";
import { archiveRecipient, listRecipients, saveRecipient } from "./recipients";
import { approvalView, approveByRecipient, declineByRecipient, resendApprovalLink, sendAnyway, setReleaseHook, startRecipientApproval } from "./recipientApproval";
import { buildStatement, statementToCsv, statementToHtml } from "./statements";
import { cancelJob } from "./cancel";
import { bookWillCallReturn, createStandingOrder, listStandingOrders, materializeAllStandingOrders, materializeStandingOrder, setStandingOrderActive, standingOrderJobCounts } from "./standingOrders";
import { describeTerms, orgTerms } from "@shared/commercialTerms";
import { chargeStatement, describePaymentMethod, issueStatement, listStatements, runWeeklyBilling, savePaymentMethod, startPaymentMethodSetup } from "./billing";
import { describeBillingStatus, previousBillingWeek } from "@shared/billingCycle";

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

export interface CommercialDeps {
  storage: IStorage;
  isAuthenticated: Handler;
  isAdminOrSessionAuth: Handler;
  /** Tell drivers covering the pickup county about a new open scheduled ride. */
  notifyDriversOfScheduledRide: (ride: Ride, pickupCounty: string | null) => void;
  /** Tell one signed-in user something now (socket) and on their phone (push). */
  notifyUser: (userId: string, payload: { type: string; rideId: string; message: string; title: string }) => void;
}

const userIdOf = (req: any): string | undefined => req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;

const fail = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof CommercialError) return res.status(err.status).json({ message: err.message });
  console.error(fallback, err);
  return res.status(500).json({ message: fallback });
};

const parseRange = (q: any): { from?: Date; to?: Date } => {
  const out: { from?: Date; to?: Date } = {};
  if (typeof q.from === "string" && q.from) { const d = new Date(q.from); if (!Number.isNaN(d.getTime())) out.from = d; }
  if (typeof q.to === "string" && q.to) { const d = new Date(q.to); if (!Number.isNaN(d.getTime())) out.to = d; }
  return out;
};

export function registerCommercialRoutes(app: Express, deps: CommercialDeps): void {
  const { storage, isAuthenticated, isAdminOrSessionAuth } = deps;

  /** The feature flag is a hard gate: off means the surface does not exist. */
  const gate: Handler = (_req, res, next) => {
    if (!featureFlags.commercialEnabled) return res.status(404).json({ message: "Not found" });
    next();
  };
  // A held delivery, once the recipient has paid, is offered to drivers the
  // same way a freshly booked one is.
  setReleaseHook((ride, pickupCounty) => deps.notifyDriversOfScheduledRide(ride, pickupCounty));

  /** Load the caller's role in :orgId; 403 when they hold none. */
  const requireMember = (allowed?: (role: OrgRole) => boolean): Handler => async (req: any, res, next) => {
    try {
      const userId = userIdOf(req);
      const orgId = String(req.params.orgId ?? "");
      if (!userId || !orgId) return res.status(403).json({ message: "Not a member of this organization." });
      const role = await membershipRole(userId, orgId);
      if (!role) return res.status(403).json({ message: "Not a member of this organization." });
      if (allowed && !allowed(role)) return res.status(403).json({ message: "Your role in this organization does not allow that." });
      req.orgRole = role;
      req.orgId = orgId;
      next();
    } catch (err) {
      fail(res, err, "Could not check organization membership");
    }
  };

  async function book(res: Response, organizationId: string, requesterId: string, body: any) {
    const booked = await bookJob(storage, {
      organizationId,
      requesterId,
      passengerName: body.passengerName,
      passengerPhone: body.passengerPhone,
      pickup: body.pickup,
      destination: body.destination,
      scheduledAt: body.scheduledAt,
      vehicleType: body.vehicleType,
      notes: body.notes,
      poNumber: body.poNumber,
    });
    deps.notifyDriversOfScheduledRide(booked.ride, booked.pickupCounty);
    const org = await getOrganization(organizationId);
    // Mirrored to the server log so the booking is on record when Telegram is unreachable.
    console.log(`[commercial] job booked :: Account: ${org?.name ?? organizationId} | Job: ${formatJobNumber(booked.job.jobNumber)} | ride ${booked.ride.id}`);
    opsAlert(formatOpsAlert("🏢 Commercial job booked", [
      ["Account", org?.name ?? organizationId],
      ["Job", formatJobNumber(booked.job.jobNumber)],
      ["Leaves", booked.ride.scheduledAt ? new Date(booked.ride.scheduledAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""],
      ["Pickup", booked.ride.pickupLocation?.address?.split(",").slice(0, 2).join(",")],
      ["Fare", `$${Number(booked.ride.estimatedFare ?? 0).toFixed(2)} + $${Number(booked.job.facilityFee).toFixed(2)} facility fee`],
    ]));
    res.status(201).json({ ride: booked.ride, job: { ...booked.job, jobLabel: formatJobNumber(booked.job.jobNumber) } });
  }

  // ── Operator ──
  app.post("/api/admin/organizations", gate, isAdminOrSessionAuth, async (req, res) => {
    try { res.status(201).json(await createOrganization(req.body ?? {})); }
    catch (err) { fail(res, err, "Could not create the organization"); }
  });
  app.get("/api/admin/organizations", gate, isAdminOrSessionAuth, async (_req, res) => {
    try { res.json(await listOrganizations()); }
    catch (err) { fail(res, err, "Could not list organizations"); }
  });
  app.get("/api/admin/organizations/:id", gate, isAdminOrSessionAuth, async (req, res) => {
    try {
      const org = await getOrganization(req.params.id);
      if (!org) return res.status(404).json({ message: "Organization not found." });
      res.json({ ...org, members: await listMembers(org.id) });
    } catch (err) { fail(res, err, "Could not load the organization"); }
  });
  app.patch("/api/admin/organizations/:id", gate, isAdminOrSessionAuth, async (req, res) => {
    try { res.json(await updateOrganization(req.params.id, req.body ?? {})); }
    catch (err) { fail(res, err, "Could not update the organization"); }
  });
  app.post("/api/admin/organizations/:id/members", gate, isAdminOrSessionAuth, async (req, res) => {
    try {
      if (!(await getOrganization(req.params.id))) return res.status(404).json({ message: "Organization not found." });
      res.status(201).json(await addMemberByEmail(req.params.id, req.body?.email, req.body?.role ?? "requester"));
    } catch (err) { fail(res, err, "Could not add the member"); }
  });
  app.delete("/api/admin/organizations/:id/members/:userId", gate, isAdminOrSessionAuth, async (req, res) => {
    try { res.json({ removed: await removeMember(req.params.id, req.params.userId) }); }
    catch (err) { fail(res, err, "Could not remove the member"); }
  });
  app.post("/api/admin/organizations/:id/jobs", gate, isAdminOrSessionAuth, async (req: any, res) => {
    try {
      // Booked on the organization's behalf: the ride belongs to the member
      // named in the request, else the first person who can book for it, else
      // the operator doing the booking (Phase 0: a facility with no logins yet).
      const requesterId = (typeof req.body?.requesterId === "string" && req.body.requesterId) || (await firstBookingMember(req.params.id)) || userIdOf(req);
      if (!requesterId) return res.status(400).json({ message: "No one to book this for." });
      await book(res, req.params.id, requesterId, req.body ?? {});
    } catch (err) { fail(res, err, "Could not book the job"); }
  });
  app.get("/api/admin/organizations/:id/jobs", gate, isAdminOrSessionAuth, async (req, res) => {
    try { res.json(await listJobs(req.params.id, parseRange(req.query))); }
    catch (err) { fail(res, err, "Could not list jobs"); }
  });
  app.get("/api/admin/organizations/:id/statement", gate, isAdminOrSessionAuth, async (req, res) => {
    try { await sendStatement(res, req.params.id, req.query); }
    catch (err) { fail(res, err, "Could not build the statement"); }
  });

  // ── Members ──
  app.get("/api/org/mine", gate, isAuthenticated, async (req: any, res) => {
    try {
      const userId = userIdOf(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      res.json(await organizationsForUser(userId));
    } catch (err) { fail(res, err, "Could not list your organizations"); }
  });
  app.get("/api/org/:orgId/jobs", gate, isAuthenticated, requireMember(), async (req: any, res) => {
    try { res.json(await listJobs(req.orgId, parseRange(req.query))); }
    catch (err) { fail(res, err, "Could not list jobs"); }
  });
  app.post("/api/org/:orgId/jobs", gate, isAuthenticated, requireMember(canBook), async (req: any, res) => {
    try { await book(res, req.orgId, userIdOf(req)!, req.body ?? {}); }
    catch (err) { fail(res, err, "Could not book the job"); }
  });
  app.get("/api/org/:orgId/statement", gate, isAuthenticated, requireMember(canSeeStatement), async (req: any, res) => {
    try { await sendStatement(res, req.orgId, req.query); }
    catch (err) { fail(res, err, "Could not build the statement"); }
  });
  app.get("/api/org/:orgId/members", gate, isAuthenticated, requireMember(canManageMembers), async (req: any, res) => {
    try { res.json(await listMembers(req.orgId)); }
    catch (err) { fail(res, err, "Could not list members"); }
  });
  app.get("/api/org/:orgId", gate, isAuthenticated, requireMember(), async (req: any, res) => {
    try {
      const org = await getOrganization(req.orgId);
      if (!org) return res.status(404).json({ message: "Organization not found." });
      const { stripeCustomerId: _s, notes: _n, ...safe } = org;
      const terms = orgTerms(org.terms);
      const { defaultPaymentMethodId: _pm, ...rest } = safe as any;
      res.json({
        ...rest, terms, termsText: describeTerms(terms), role: req.orgRole,
        billingText: describePaymentMethod(org),
        hasPaymentMethod: !!org.defaultPaymentMethodId,
      });
    } catch (err) { fail(res, err, "Could not load the organization"); }
  });
  // Adding a person: an existing account is attached as before; an email
  // with no account is INVITED — a link they open to set up their sign-in
  // and land in this desk (2026-09-16; until then the desk was told "they
  // need to sign up first", through the rider app).
  app.post("/api/org/:orgId/members", gate, isAuthenticated, requireMember(canManageMembers), async (req: any, res) => {
    try {
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const role = req.body?.role ?? "requester";
      const existing = email ? await storage.getUserByEmail(email) : null;
      if (existing && !existing.deletedAt) return res.status(201).json(await addMemberByEmail(req.orgId, email, role));
      const inviter = await storage.getUser(userIdOf(req)!);
      const appUrl = resolveAppUrl(`${req.protocol}://${req.get("host")}`);
      const inv = await inviteByEmail(req.orgId, email, role, userIdOf(req)!, appUrl);
      let emailSent = false;
      try {
        await sendOrganizationInviteEmail({ email: inv.email, organizationName: inv.organizationName, inviterName: inviter?.firstName ?? null, link: inv.link, days: INVITATION_DAYS });
        emailSent = true;
      } catch (err) {
        console.error(`[invite] email to ${inv.email} not sent; the desk gets the link to send itself:`, (err as any)?.message ?? err);
      }
      res.status(202).json({ invited: true, ...inv, emailSent });
    } catch (err) { fail(res, err, "Could not add the member"); }
  });
  // ── Recipient approval (shared/recipientApproval.ts) ──
  app.post("/api/org/:orgId/jobs/:jobId/send-anyway", gate, isAuthenticated, requireMember(canBook), async (req: any, res) => {
    try { res.json(await sendAnyway(req.orgId, String(req.params.jobId))); }
    catch (err) { fail(res, err, "Could not send it"); }
  });
  app.post("/api/org/:orgId/jobs/:jobId/resend-approval-link", gate, isAuthenticated, requireMember(canBook), async (req: any, res) => {
    try { res.json(await resendApprovalLink(req.orgId, String(req.params.jobId), resolveAppUrl(`${req.protocol}://${req.get("host")}`))); }
    catch (err) { fail(res, err, "Could not resend the link"); }
  });
  app.patch("/api/org/:orgId/settings", gate, isAuthenticated, requireMember((r) => r === "owner"), async (req: any, res) => {
    try {
      const patch: Record<string, unknown> = {};
      if (req.body?.askRecipientByDefault !== undefined) patch.askRecipientByDefault = req.body.askRecipientByDefault;
      const org = await updateOrganization(req.orgId, patch);
      res.json({ askRecipientByDefault: org.askRecipientByDefault });
    } catch (err) { fail(res, err, "Could not save the setting"); }
  });
  // ── The recipient book (shared/recipients.ts) ──
  app.get("/api/org/:orgId/recipients", gate, isAuthenticated, requireMember(canBook), async (req: any, res) => {
    try { res.json(await listRecipients(req.orgId)); }
    catch (err) { fail(res, err, "Could not list recipients"); }
  });
  app.post("/api/org/:orgId/recipients", gate, isAuthenticated, requireMember(canBook), async (req: any, res) => {
    try { res.status(201).json(await saveRecipient(req.orgId, req.body ?? {}, userIdOf(req)!)); }
    catch (err) { fail(res, err, "Could not save the recipient"); }
  });
  app.delete("/api/org/:orgId/recipients/:id", gate, isAuthenticated, requireMember(canBook), async (req: any, res) => {
    try { res.json({ removed: await archiveRecipient(req.orgId, String(req.params.id)) }); }
    catch (err) { fail(res, err, "Could not remove the recipient"); }
  });

  app.post("/api/admin/analytics/recipient-approval-sweep", gate, isAdminOrSessionAuth, async (req: any, res) => {
    try { const { sweepRecipientApproval } = await import("./recipientApproval"); res.json(await sweepRecipientApproval(new Date(), resolveAppUrl(`${req.protocol}://${req.get("host")}`))); }
    catch (err) { fail(res, err, "Could not run the sweep"); }
  });
  // The recipient's side: no account, the token is the capability. Rate-limited in routes.ts.
  app.get("/api/approve/:token", gate, async (req, res) => {
    try { res.json(await approvalView(String(req.params.token))); }
    catch (err) { fail(res, err, "Could not read this delivery"); }
  });
  app.post("/api/approve/:token/approve", gate, async (req, res) => {
    try { res.json(await approveByRecipient(String(req.params.token))); }
    catch (err) { fail(res, err, "Could not record that"); }
  });
  app.post("/api/approve/:token/decline", gate, async (req, res) => {
    try { res.json(await declineByRecipient(String(req.params.token))); }
    catch (err) { fail(res, err, "Could not record that"); }
  });
  app.post("/api/admin/analytics/pending-proof-sweep", gate, isAdminOrSessionAuth, async (_req, res) => {
    try { const { sweepPendingProofPhotos } = await import("./badges"); res.json(await sweepPendingProofPhotos()); }
    catch (err) { fail(res, err, "Could not run the sweep"); }
  });

  app.get("/api/org/:orgId/invitations", gate, isAuthenticated, requireMember(canManageMembers), async (req: any, res) => {
    try { res.json(await listOpenInvitations(req.orgId)); }
    catch (err) { fail(res, err, "Could not list invitations"); }
  });
  app.delete("/api/org/:orgId/invitations/:id", gate, isAuthenticated, requireMember(canManageMembers), async (req: any, res) => {
    try { res.json({ revoked: await revokeInvitation(req.orgId, String(req.params.id)) }); }
    catch (err) { fail(res, err, "Could not revoke the invitation"); }
  });
  // The invitee's side: no account yet, so no auth. Rate-limited in routes.ts.
  app.get("/api/org/invitations/:token", gate, async (req, res) => {
    try { res.json(await describeInvitation(String(req.params.token))); }
    catch (err) { fail(res, err, "Could not read the invitation"); }
  });
  app.post("/api/org/invitations/:token/accept", gate, async (req: any, res) => {
    try {
      const result = await acceptInvitation(String(req.params.token), req.body ?? {});
      if (!result.existing) {
        req.session.userId = result.userId;
        await storage.updateLastLogin(result.userId).catch(() => {});
      }
      res.json({ organizationId: result.organizationId, organizationName: result.organizationName, existing: result.existing });
    } catch (err) { fail(res, err, "Could not accept the invitation"); }
  });
  app.delete("/api/org/:orgId/members/:userId", gate, isAuthenticated, requireMember(canManageMembers), async (req: any, res) => {
    try {
      if (req.params.userId === userIdOf(req)) return res.status(400).json({ message: "You cannot remove yourself. Ask another owner, or PG Ride." });
      res.json({ removed: await removeMember(req.orgId, req.params.userId) });
    } catch (err) { fail(res, err, "Could not remove the member"); }
  });
  app.post("/api/org/:orgId/jobs/:jobId/cancel", gate, isAuthenticated, requireMember(canBook), async (req: any, res) => {
    try {
      const result = await cancelJob(req.orgId, req.params.jobId, userIdOf(req)!, String(req.body?.reason ?? ""));
      const org = await getOrganization(req.orgId);
      const job = await jobForRide(result.ride.id);
      const label = job ? formatJobNumber(job.jobNumber) : result.ride.id;
      console.log(`[commercial] job cancelled :: Account: ${org?.name ?? req.orgId} | Job: ${label} | fee ${result.cancellationFee}${result.driverId ? ` | driver ${result.driverId}` : ""}`);
      if (result.driverId) {
        deps.notifyUser(result.driverId, {
          type: "ride_cancelled",
          rideId: result.ride.id,
          title: "Job cancelled",
          message: `${org?.name ?? "The organization"} cancelled ${label} (${result.ride.scheduledAt ? new Date(result.ride.scheduledAt).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }) : "scheduled"}).`,
        });
      }
      opsAlert(formatOpsAlert("🏢 Commercial job cancelled", [["Account", org?.name ?? req.orgId], ["Job", label], ["Fee", `$${result.cancellationFee}`], ["Reason", String(req.body?.reason ?? "").slice(0, 120)]]));
      res.json({ ride: result.ride, cancellationFee: result.cancellationFee, reason: result.reason });
    } catch (err) { fail(res, err, "Could not cancel the job"); }
  });

  // ── Deliveries: a job with no passenger ──
  app.post("/api/org/:orgId/deliveries", gate, isAuthenticated, requireMember(canBook), async (req: any, res) => {
    try {
      const booked = await bookDelivery(storage, { ...(req.body ?? {}), organizationId: req.orgId, requesterId: userIdOf(req)! });
      const org = await getOrganization(req.orgId);
      // "Remember this recipient": the book fills itself from the booking.
      // A book entry never blocks a delivery, but a failure is reported so
      // the desk is told, not left to wonder (post-implementation audit).
      let remembered: { ok: boolean; reason?: string } | null = null;
      if (req.body?.rememberRecipient === true) {
        try {
          await saveRecipient(req.orgId, {
            name: booked.job.dropContact?.name, phone: booked.job.dropContact?.phone, note: booked.job.dropContact?.note,
            address: booked.ride.destinationLocation as any, handover: booked.job.handover,
          }, userIdOf(req)!);
          remembered = { ok: true };
        } catch (err: any) {
          remembered = { ok: false, reason: err instanceof CommercialError ? err.message : "the book could not be written" };
          console.log(`[recipients] not remembered: ${remembered.reason}`);
        }
      }
      // Ask the recipient: the job is HELD — not offered to any driver —
      // until the recipient approves the fee from the link they are texted,
      // or the shop sends it anyway (shared/recipientApproval.ts).
      // Otherwise drivers hear about it now.
      let recipientApproval: { link: string; textSent: boolean; state: string } | null = null;
      if (req.body?.askRecipient === true) {
        const started = await startRecipientApproval(booked.job.id, resolveAppUrl(`${req.protocol}://${req.get("host")}`));
        recipientApproval = { link: started.link, textSent: started.textSent, state: "awaiting" };
      } else {
        deps.notifyDriversOfScheduledRide(booked.ride, booked.pickupCounty);
      }
      opsAlert(formatOpsAlert("📦 Delivery booked", [
        ["Account", org?.name ?? req.orgId],
        ["Job", formatJobNumber(booked.job.jobNumber)],
        ["Parcel", booked.job.parcelSize],
        ["To", booked.job.dropContact?.name],
        ["Fare", `$${Number(booked.ride.estimatedFare ?? 0).toFixed(2)}`],
        ["Recipient", recipientApproval ? "asked to approve the fee (held until they do)" : "not asked"],
      ]));
      res.status(201).json({ ride: booked.ride, job: { ...booked.job, jobLabel: formatJobNumber(booked.job.jobNumber), recipientApproval: recipientApproval ? "awaiting" : "none" }, recipientApproval, remembered });
    } catch (err) { fail(res, err, "Could not book the delivery"); }
  });

  // ── Standing orders and will-call returns ──
  app.get("/api/org/:orgId/standing-orders", gate, isAuthenticated, requireMember(), async (req: any, res) => {
    try {
      const [orders, counts] = await Promise.all([listStandingOrders(req.orgId), standingOrderJobCounts(req.orgId)]);
      res.json(orders.map((o) => ({ ...o, jobCount: counts[o.id] ?? 0 })));
    } catch (err) { fail(res, err, "Could not list standing orders"); }
  });
  app.post("/api/org/:orgId/standing-orders", gate, isAuthenticated, requireMember(canBook), async (req: any, res) => {
    try {
      const order = await createStandingOrder({ ...(req.body ?? {}), organizationId: req.orgId, createdBy: userIdOf(req)! });
      // Book its first week now, so the desk sees the jobs it just asked for.
      const booked = await materializeStandingOrder(storage, order, new Date(), (b) => deps.notifyDriversOfScheduledRide(b.ride, b.pickupCounty));
      const org = await getOrganization(req.orgId);
      console.log(`[commercial] standing order created :: Account: ${org?.name ?? req.orgId} | order ${order.id} | ${booked} job${booked === 1 ? "" : "s"} booked`);
      opsAlert(formatOpsAlert("🗓 Standing order created", [["Account", org?.name ?? req.orgId], ["Passenger", order.passengerName], ["Jobs booked", booked]]));
      res.status(201).json({ ...order, booked });
    } catch (err) { fail(res, err, "Could not create the standing order"); }
  });
  for (const [path, active] of [["pause", false], ["resume", true]] as Array<[string, boolean]>) {
    app.post(`/api/org/:orgId/standing-orders/:id/${path}`, gate, isAuthenticated, requireMember(canBook), async (req: any, res) => {
      try {
        const order = await setStandingOrderActive(req.orgId, req.params.id, active);
        const booked = active ? await materializeStandingOrder(storage, order, new Date(), (b) => deps.notifyDriversOfScheduledRide(b.ride, b.pickupCounty)) : 0;
        res.json({ ...order, booked });
      } catch (err) { fail(res, err, `Could not ${path} the standing order`); }
    });
  }
  app.post("/api/org/:orgId/jobs/:jobId/return", gate, isAuthenticated, requireMember(canBook), async (req: any, res) => {
    try {
      const booked = await bookWillCallReturn(storage, req.orgId, req.params.jobId, userIdOf(req)!, req.body?.readyInMinutes);
      deps.notifyDriversOfScheduledRide(booked.ride, booked.pickupCounty);
      const org = await getOrganization(req.orgId);
      const label = formatJobNumber(booked.job.jobNumber);
      const leaves = booked.ride.scheduledAt ? new Date(booked.ride.scheduledAt).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) : "";
      console.log(`[commercial] will-call return :: Account: ${org?.name ?? req.orgId} | Job: ${label} | leaves ${leaves}`);
      opsAlert(formatOpsAlert("🔔 Will-call return — passenger ready", [["Account", org?.name ?? req.orgId], ["Job", label], ["Leaves", leaves], ["Pickup", booked.ride.pickupLocation?.address?.split(",").slice(0, 2).join(",")]]));
      res.status(201).json({ ride: booked.ride, job: { ...booked.job, jobLabel: label } });
    } catch (err) { fail(res, err, "Could not book the return"); }
  });

  // ── Billing: the week's statements and how the account pays ──
  app.get("/api/org/:orgId/statements", gate, isAuthenticated, requireMember(canSeeStatement), async (req: any, res) => {
    try {
      const rows = await listStatements(req.orgId);
      res.json(rows.map((s) => ({ ...s, statusText: describeBillingStatus(s.status, s.total, s.periodLabel) })));
    } catch (err) { fail(res, err, "Could not list statements"); }
  });
  app.post("/api/org/:orgId/billing/setup-intent", gate, isAuthenticated, requireMember(canSeeStatement), async (req: any, res) => {
    try { res.json(await startPaymentMethodSetup(req.orgId)); }
    catch (err) { fail(res, err, "Could not start the payment setup"); }
  });
  app.post("/api/org/:orgId/billing/payment-method", gate, isAuthenticated, requireMember(canSeeStatement), async (req: any, res) => {
    try {
      const id = String(req.body?.paymentMethodId ?? "").trim();
      if (!id) return res.status(400).json({ message: "A payment method is needed." });
      const saved = await savePaymentMethod(req.orgId, id);
      const org = await getOrganization(req.orgId);
      opsAlert(formatOpsAlert("🏦 Commercial account added a payment method", [["Account", org?.name ?? req.orgId], ["Kind", saved.kind]]));
      res.json({ ...saved, billingText: describePaymentMethod({ ...org, defaultPaymentMethodKind: saved.kind }) });
    } catch (err) { fail(res, err, "Could not save the payment method"); }
  });

  // Operator: issue and collect on demand; the Monday run does both by itself.
  app.post("/api/admin/organizations/:id/statements", gate, isAdminOrSessionAuth, async (req, res) => {
    try {
      const weekKey = typeof req.body?.week === "string" && req.body.week ? req.body.week : previousBillingWeek().weekKey;
      res.json(await issueStatement(req.params.id, weekKey));
    } catch (err) { fail(res, err, "Could not issue the statement"); }
  });
  app.post("/api/admin/commercial-statements/:statementId/charge", gate, isAdminOrSessionAuth, async (req, res) => {
    try { res.json(await chargeStatement(req.params.statementId)); }
    catch (err) { fail(res, err, "Could not collect the statement"); }
  });
  app.post("/api/admin/analytics/weekly-billing", gate, isAdminOrSessionAuth, async (req, res) => {
    try { res.json(await runWeeklyBilling(new Date(), typeof req.body?.week === "string" && req.body.week ? req.body.week : undefined)); }
    catch (err) { fail(res, err, "Could not run the weekly billing"); }
  });

  // Operator: run the standing-order sweep now (the minute sweep runs it too).
  app.post("/api/admin/analytics/materialize-standing-orders", gate, isAdminOrSessionAuth, async (_req, res) => {
    try { res.json(await materializeAllStandingOrders(storage, new Date(), (b) => deps.notifyDriversOfScheduledRide(b.ride, b.pickupCounty))); }
    catch (err) { fail(res, err, "Could not run the standing-order sweep"); }
  });

  async function sendStatement(res: Response, organizationId: string, query: any) {
    const month = typeof query.month === "string" && query.month ? query.month : currentMonthKey();
    const statement = await buildStatement(organizationId, month);
    const format = String(query.format ?? "json");
    const stem = `${statement.organization.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "statement"}-${statement.window.monthKey}`;
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${stem}.csv"`);
      return res.send(statementToCsv(statement));
    }
    if (format === "html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(statementToHtml(statement));
    }
    res.json(statement);
  }
}
