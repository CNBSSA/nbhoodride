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
 * A rider's report of a problem with a ride.
 *
 * Until 2026-10-05 this agent could settle a small report itself by crediting
 * the rider's Virtual PG Card. The card was removed on the Chairman's order
 * (work order #451), and with the wallet switched off that credit had nowhere
 * to land, so in production every report already went to a person. That is
 * now the only path: a pending report becomes a proposal in the admin queue,
 * where a card refund or a reply is decided by a human. A report that was
 * already handled is not sent twice.
 */
export async function tryAutoResolveDispute(
  storage: IStorage,
  disputeId: string,
): Promise<SupportResolutionResult> {
  const dispute = await storage.getDisputeById(disputeId);
  if (!dispute) {
    throw new Error("Dispute not found");
  }

  // Idempotency on the dispute itself.
  if (dispute.status !== "pending") {
    return {
      disputeId,
      autoResolved: false,
      refundAmount: 0,
      message: "This report was already handled.",
      needsAdminReview: false,
    };
  }

  const proposal = await createAgentProposal(storage, {
    agent: "support",
    action: "manual_dispute_review",
    userId: dispute.reporterId,
    rideId: dispute.rideId,
    reasoning: "Riders pay by card only — a card refund or a reply needs a human",
    payload: { disputeId, issueType: dispute.issueType },
  });
  return {
    disputeId,
    autoResolved: false,
    refundAmount: 0,
    message: "Your report was sent to our team.",
    needsAdminReview: true,
    proposalId: proposal.id,
  };
}
