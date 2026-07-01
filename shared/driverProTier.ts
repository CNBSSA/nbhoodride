/** Driver Pro tiers — growth badges from ride quality (no surge tiers). */

export const DRIVER_PRO_TIERS = ["community", "pro", "elite"] as const;
export type DriverProTier = (typeof DRIVER_PRO_TIERS)[number];

export const DRIVER_PRO_LABELS: Record<DriverProTier, string> = {
  community: "Community Driver",
  pro: "Pro Driver",
  elite: "Elite Driver",
};

export interface DriverProStats {
  totalRides: number;
  avgRating: number;
  isVerifiedNeighbor?: boolean;
  qualifyingWeeks?: number;
}

/**
 * Compute display tier from lifetime stats. Thresholds align with ownership
 * pipeline without requiring share certificates.
 */
export function computeDriverProTier(stats: DriverProStats): DriverProTier {
  const rides = stats.totalRides ?? 0;
  const rating = stats.avgRating ?? 5;
  const verified = stats.isVerifiedNeighbor ?? false;
  const weeks = stats.qualifyingWeeks ?? 0;

  if (rides >= 100 && rating >= 4.8 && verified) {
    return "elite";
  }
  if (rides >= 25 && rating >= 4.5) {
    return "pro";
  }
  if (weeks >= 4 && rating >= 4.7) {
    return "pro";
  }
  return "community";
}
