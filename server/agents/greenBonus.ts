import { allocateDriverBonus } from "./pricingFairness";
import type { IStorage } from "../storage";

export const GREEN_BONUS_PER_RIDE = 2.5;

export interface EvDriverSummary {
  driverId: string;
  driverProfileId: string;
  vehicleId: string;
  make: string;
  model: string;
  fuelType: string | null;
}

/** F4 — EV drivers eligible for green bonus from community fund (not surge). */
export async function getEvEligibleDrivers(storage: IStorage): Promise<EvDriverSummary[]> {
  return storage.getEvDrivers();
}

export async function isDriverEvEligible(storage: IStorage, driverUserId: string): Promise<boolean> {
  const drivers = await storage.getEvDrivers();
  return drivers.some((d) => d.driverId === driverUserId);
}

export async function allocateGreenBonusForRide(
  storage: IStorage,
  driverId: string,
  rideId?: string,
): Promise<{ allocated: boolean; amount: number }> {
  const eligible = await isDriverEvEligible(storage, driverId);
  if (!eligible) {
    return { allocated: false, amount: 0 };
  }

  if (rideId) {
    const existing = await storage.getBonusAllocations(driverId);
    const alreadyPaid = existing.some(
      (b) => b.rideId === rideId && b.reason?.startsWith("green_ev"),
    );
    if (alreadyPaid) {
      return { allocated: false, amount: 0 };
    }
  }

  const result = await allocateDriverBonus(
    storage,
    driverId,
    GREEN_BONUS_PER_RIDE,
    "green_ev — EV fleet incentive from community bonus pool",
    rideId,
    "green_fleet",
  );

  if (result.allocated) {
    await storage.createAgentAuditLog({
      agent: "green_bonus",
      action: "ev_bonus_allocated",
      userId: driverId,
      rideId,
      reasoning: `Green bonus $${GREEN_BONUS_PER_RIDE} for EV-completed ride`,
      metadata: { amount: GREEN_BONUS_PER_RIDE },
    });
  }

  return result;
}
