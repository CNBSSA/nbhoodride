import type { IStorage } from "../storage";

const BONUS_PER_UNDERSUPPLY_RIDE = 3.5;

export interface FairnessEvaluation {
  undersupply: boolean;
  predictedDemand: number;
  onlineDrivers: number;
  suggestedBonus: number;
  reason: string;
}

/** D4 — Detect undersupply; allocate from community bonus pool (never surge). */
export async function evaluateUndersupply(
  storage: IStorage,
  gridLat: string,
  gridLng: string,
): Promise<FairnessEvaluation> {
  const hour = new Date().getHours();
  const day = new Date().getDay();
  const forecasts = await storage.getDemandForecasts(hour, day);
  const cell = forecasts.find(
    (f) => String(f.gridLat) === gridLat && String(f.gridLng) === gridLng,
  );
  const predictedDemand = cell?.predictedRides ?? 0;
  const onlineDrivers = (await storage.getAllDriverProfiles()).filter((d) => d.isOnline).length;
  const gap = predictedDemand - onlineDrivers * 2;
  const undersupply = gap > 2;
  const suggestedBonus = undersupply
    ? Math.min(15, Math.round(gap * BONUS_PER_UNDERSUPPLY_RIDE * 100) / 100)
    : 0;

  return {
    undersupply,
    predictedDemand,
    onlineDrivers,
    suggestedBonus,
    reason: undersupply
      ? `Predicted ${predictedDemand} rides/hr with ${onlineDrivers} drivers online — community bonus eligible`
      : "Supply balanced — no bonus needed",
  };
}

/**
 * Allocate a community bonus to a driver, atomically.
 *
 * Concurrency note (post-supervisor review):
 *
 * The previous implementation did `read balance → compare → write` as three
 * separate non-transactional SQL calls. Two concurrent callers (the
 * undersupply detector hitting from dispatch + an admin hitting the
 * /api/admin/fairness/allocate route at the same moment) could both read
 * balance=100, both pass `balance < amount` for amount=50, both deduct
 * 50, and both write allocation rows — total payout 100 against a pool
 * that should only have funded ONE of them. `Math.max(0, ...)` in
 * deductCommunityBonusPool masked the negative-balance smell while the
 * allocation rows still landed.
 *
 * Fix: `tryDeductCommunityBonusPool` does a single atomic `UPDATE ...
 * SET balance = balance - $amount WHERE balance >= $amount RETURNING`.
 * Postgres serializes the row, so concurrent callers see "your turn,
 * then their turn"; the loser's WHERE clause fails and returns 0 rows.
 * We only create the bonus_allocation row when the deduction returned
 * true.
 */
/** Ledger reason for a community bonus credited to a driver's wallet. */
export const BONUS_REASON = "community_bonus";

export async function allocateDriverBonus(
  storage: IStorage,
  driverId: string,
  amount: number,
  reason: string,
  rideId?: string,
  zoneLabel?: string,
): Promise<{ allocated: boolean; amount: number }> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { allocated: false, amount: 0 };
  }
  const deducted = await storage.tryDeductCommunityBonusPool(amount);
  if (!deducted) {
    return { allocated: false, amount: 0 };
  }
  // The bonus is money, not a row: it reaches the driver's wallet now, so it
  // is paid out on payday like everything else they earned (rates audit,
  // 2026-09-18 — before this the pool was debited and the allocation
  // recorded, and nothing ever reached the driver). If the wallet cannot be
  // credited (no such driver, database error) the pool gets its money back
  // and nothing is recorded, so a retry does not debit the pool twice.
  try {
    await storage.addVirtualCardBalance(driverId, amount, BONUS_REASON, rideId);
  } catch (creditErr) {
    await storage.fundCommunityBonusPool(amount).catch((refundErr) =>
      console.error(`[fairness] pool not refunded after a failed bonus credit ($${amount.toFixed(2)} for ${driverId}):`, refundErr));
    throw creditErr;
  }
  await storage.createBonusAllocation({
    driverId,
    rideId,
    amount: amount.toFixed(2),
    reason,
    zoneLabel,
  });
  await storage.createAgentAuditLog({
    agent: "pricing_fairness",
    action: "bonus_allocated",
    userId: driverId,
    rideId,
    reasoning: reason,
    metadata: { amount, zoneLabel },
  });
  return { allocated: true, amount };
}
