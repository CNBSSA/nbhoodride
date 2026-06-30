import type { IStorage } from "../storage";

export interface ProposalInput {
  agent: string;
  action: string;
  userId?: string;
  rideId?: string;
  reasoning?: string;
  payload?: Record<string, unknown>;
}

/** E3 — Queue agent action for admin approve-and-apply. */
export async function createAgentProposal(
  storage: IStorage,
  input: ProposalInput,
) {
  const proposal = await storage.createAgentActionProposal(input);
  await storage.createAgentAuditLog({
    agent: input.agent,
    action: "proposal_created",
    userId: input.userId,
    rideId: input.rideId,
    reasoning: input.reasoning,
    metadata: { proposalId: proposal.id, action: input.action, payload: input.payload },
  });
  return proposal;
}

export async function approveAndApplyProposal(
  storage: IStorage,
  proposalId: string,
  adminId: string,
  note?: string,
): Promise<{ applied: boolean; message: string }> {
  const proposal = await storage.getAgentActionProposal(proposalId);
  if (!proposal || proposal.status !== "pending") {
    throw new Error("Proposal not found or already reviewed");
  }

  let message = "Approved";
  let applied = false;

  if (proposal.action === "manual_dispute_review" && proposal.payload) {
    const disputeId = proposal.payload.disputeId as string | undefined;
    const refundAmount = Number(proposal.payload.requestedRefund ?? 0);
    if (disputeId && refundAmount > 0) {
      await storage.adminResolveDispute(
        disputeId,
        note ?? `Admin approved: $${refundAmount} credit`,
        adminId,
        refundAmount,
      );
      applied = true;
      message = `Dispute resolved with $${refundAmount} refund`;
    }
  } else if (proposal.action === "compliance_block" && proposal.userId) {
    await storage.adminUpdateDriverProfile(proposal.userId, { isSuspended: true });
    applied = true;
    message = "Driver suspended pending compliance";
  } else if (proposal.action === "bonus_allocation" && proposal.payload) {
    const { driverId, amount, reason, rideId, zoneLabel } = proposal.payload as Record<
      string,
      string | number
    >;
    const { allocateDriverBonus } = await import("./pricingFairness");
    const result = await allocateDriverBonus(
      storage,
      String(driverId),
      Number(amount),
      String(reason ?? "Admin approved bonus"),
      rideId ? String(rideId) : undefined,
      zoneLabel ? String(zoneLabel) : undefined,
    );
    applied = result.allocated;
    message = result.allocated
      ? `Bonus $${result.amount} allocated`
      : "Bonus pool insufficient";
  }

  await storage.updateAgentActionProposal(proposalId, {
    status: applied ? "applied" : "approved",
    reviewedBy: adminId,
    reviewNote: note,
  });

  await storage.createAgentAuditLog({
    agent: proposal.agent,
    action: applied ? "proposal_applied" : "proposal_approved",
    userId: proposal.userId ?? undefined,
    rideId: proposal.rideId ?? undefined,
    reasoning: note ?? proposal.reasoning ?? undefined,
    metadata: { proposalId, applied },
  });

  return { applied, message };
}

export async function rejectProposal(
  storage: IStorage,
  proposalId: string,
  adminId: string,
  note?: string,
): Promise<void> {
  await storage.updateAgentActionProposal(proposalId, {
    status: "rejected",
    reviewedBy: adminId,
    reviewNote: note,
  });
  await storage.createAgentAuditLog({
    agent: "admin",
    action: "proposal_rejected",
    userId: adminId,
    reasoning: note,
    metadata: { proposalId },
  });
}
