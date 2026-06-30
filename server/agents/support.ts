import {
  canAutoResolveSupport,
  suggestRefundAmount,
  SUPPORT_AUTO_RESOLVE_MAX_USD,
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

/** E1 — Attempt auto-resolve for disputes ≤$25. */
export async function tryAutoResolveDispute(
  storage: IStorage,
  disputeId: string,
): Promise<SupportResolutionResult> {
  const dispute = await storage.getDisputeById(disputeId);
  if (!dispute) {
    throw new Error("Dispute not found");
  }

  const ride = await storage.getRide(dispute.rideId);
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
    metadata: { disputeId, refundAmount: requestedRefund },
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
