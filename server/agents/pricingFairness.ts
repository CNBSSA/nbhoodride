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

export async function allocateDriverBonus(
  storage: IStorage,
  driverId: string,
  amount: number,
  reason: string,
  rideId?: string,
  zoneLabel?: string,
): Promise<{ allocated: boolean; amount: number }> {
  const pool = await storage.getCommunityBonusPool();
  const balance = parseFloat(pool.balance ?? "0");
  if (balance < amount || amount <= 0) {
    return { allocated: false, amount: 0 };
  }
  await storage.deductCommunityBonusPool(amount);
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
