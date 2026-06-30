import {
  canAutoResolveSupport,
  suggestRefundAmount,
  SUPPORT_AUTO_RESOLVE_MAX_USD,
  SUPPORT_AUTO_RESOLVE_30D_MAX_USD,
} from "@shared/supportPolicy";
import { deliverUserNotification } from "../notificationService";
import type { IStorage } from "../storage";
import { createAgentProposal } from "./agentProposals";

export interface SupportResolutionResult {
  disputeId: string;
  autoResolved: boolean;
  refundAmount: number;
  message: string;
  needsAdminReview: boolean;
  proposalId?: string;
}

/**
 * E1 — Attempt auto-resolve for disputes ≤$25.
 *
 * Idempotency / abuse guards (post-supervisor review):
 *   1. Status check — only `pending` disputes are eligible. A `resolved`
 *      dispute returning here means the caller is replaying; we re-emit
 *      the prior verdict instead of crediting again.
 *   2. Per-ride uniqueness — if any prior dispute on the same ride was
 *      already auto-resolved (regardless of reporter), escalate. Without
 *      this a rider could file two disputes back-to-back on the same
 *      ride for "fare_dispute" + "duplicate_charge" and drain two
 *      credits.
 *   3. Cumulative cap — if the reporter has crossed
 *      SUPPORT_AUTO_RESOLVE_30D_MAX_USD ($50) of auto-credits in the
 *      last 30 days, escalate. This is the cap that prevents a steady
 *      drumbeat of small-dollar disputes from drifting past human review.
 *   4. Ride existence — if the dispute references a non-existent ride,
 *      escalate. Belt-and-braces against orphan dispute rows.
 *
 * Anything that fails a guard becomes a proposal for admin review, NOT a
 * silent reject. The proposal carries the reason so the admin queue
 * shows why it bounced.
 */
export async function tryAutoResolveDispute(
  storage: IStorage,
  disputeId: string,
): Promise<SupportResolutionResult> {
  const dispute = await storage.getDisputeById(disputeId);
  if (!dispute) {
    throw new Error("Dispute not found");
  }

  // Guard 1 — idempotency on the dispute itself.
  if (dispute.status !== "pending") {
    return {
      disputeId,
      autoResolved: false,
      refundAmount: 0,
      message: "This report was already handled.",
      needsAdminReview: false,
    };
  }

  const ride = await storage.getRide(dispute.rideId);
  // Guard 4 — orphan / missing ride.
  if (!ride) {
    const proposal = await createAgentProposal(storage, {
      agent: "support",
      action: "manual_dispute_review",
      userId: dispute.reporterId,
      rideId: dispute.rideId,
      reasoning: "Referenced ride no longer exists",
      payload: { disputeId },
    });
    return {
      disputeId,
      autoResolved: false,
      refundAmount: 0,
      message: "Your report was escalated to our team.",
      needsAdminReview: true,
      proposalId: proposal.id,
    };
  }

  // Guard 2 — per-ride uniqueness. If anything was already paid out for
  // this ride (via a prior auto-resolve OR a prior admin refund), don't
  // pay out again automatically.
  const priorDisputes = await storage.getDisputesByRide(dispute.rideId);
  const alreadyResolvedHere = priorDisputes.some(
    (d) => d.id !== disputeId && d.status === "resolved",
  );
  const rideAlreadyRefunded =
    ride.refundedAmount != null && parseFloat(ride.refundedAmount) > 0;
  if (alreadyResolvedHere || rideAlreadyRefunded) {
    const proposal = await createAgentProposal(storage, {
      agent: "support",
      action: "manual_dispute_review",
      userId: dispute.reporterId,
      rideId: dispute.rideId,
      reasoning: "This ride already has a resolved dispute or refund — needs human review",
      payload: { disputeId, priorRefund: ride.refundedAmount ?? null },
    });
    return {
      disputeId,
      autoResolved: false,
      refundAmount: 0,
      message: "Your report was escalated to our team.",
      needsAdminReview: true,
      proposalId: proposal.id,
    };
  }

  const rideFare = parseFloat(ride?.actualFare ?? ride?.estimatedFare ?? "0");
  const requestedRefund = suggestRefundAmount(dispute.issueType, rideFare);

  if (!canAutoResolveSupport({
    issueType: dispute.issueType,
    requestedRefund,
    rideFare,
  })) {
    const proposal = await createAgentProposal(storage, {
      agent: "support",
      action: "manual_dispute_review",
      userId: dispute.reporterId,
      rideId: dispute.rideId,
      reasoning: `Dispute ${dispute.issueType} exceeds $${SUPPORT_AUTO_RESOLVE_MAX_USD} auto-resolve cap`,
      payload: { disputeId, requestedRefund, rideFare },
    });
    return {
      disputeId,
      autoResolved: false,
      refundAmount: 0,
      message: "Your report was escalated to our team.",
      needsAdminReview: true,
      proposalId: proposal.id,
    };
  }

  // Guard 3 — cumulative cap. A series of small disputes that individually
  // fit under $25 should still trigger human review once the rolling 30-day
  // total crosses $50. The lookback is anchored to now so a long-history
  // user re-paying old credits doesn't keep counting them forever.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const cumulativeAutoCredit = await storage.sumAutoCreditByReporterSince(
    dispute.reporterId,
    since,
  );
  if (cumulativeAutoCredit + requestedRefund > SUPPORT_AUTO_RESOLVE_30D_MAX_USD) {
    const proposal = await createAgentProposal(storage, {
      agent: "support",
      action: "manual_dispute_review",
      userId: dispute.reporterId,
      rideId: dispute.rideId,
      reasoning: `Cumulative 30-day auto-credit would exceed $${SUPPORT_AUTO_RESOLVE_30D_MAX_USD} (already $${cumulativeAutoCredit.toFixed(2)})`,
      payload: { disputeId, requestedRefund, cumulativeAutoCredit },
    });
    return {
      disputeId,
      autoResolved: false,
      refundAmount: 0,
      message: "Your report was escalated to our team.",
      needsAdminReview: true,
      proposalId: proposal.id,
    };
  }

  await storage.adminResolveDispute(
    disputeId,
    `Auto-resolved by Support Agent: $${requestedRefund.toFixed(2)} PG Card credit`,
    null,
    requestedRefund,
  );

  await storage.createAgentAuditLog({
    agent: "support",
    action: "auto_resolve_dispute",
    userId: dispute.reporterId,
    rideId: dispute.rideId,
    reasoning: `${dispute.issueType} — $${requestedRefund} credit`,
    metadata: { disputeId, refundAmount: requestedRefund, cumulativeAutoCredit },
  });

  await deliverUserNotification(dispute.reporterId, {
    type: "support_resolved",
    title: "Issue resolved",
    body: `We credited $${requestedRefund.toFixed(2)} to your PG Card.`,
    data: { disputeId, refundAmount: requestedRefund },
    url: "/payments",
  });

  return {
    disputeId,
    autoResolved: true,
    refundAmount: requestedRefund,
    message: `Credited $${requestedRefund.toFixed(2)} to your PG Card.`,
    needsAdminReview: false,
  };
}
