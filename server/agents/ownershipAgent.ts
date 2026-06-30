import type { IStorage } from "../storage";

export interface OwnershipProjection {
  status: string;
  onTrack: boolean;
  weeksToAdHoc: number | null;
  hoursToLifetime: number | null;
  projectedQuarterlyShare: number;
  narrative: string;
}

const AD_HOC_WEEKS = 12;
const LIFETIME_MINUTES = 338400; // 5,640 hours

/** D5 — Ownership progress projections for driver dashboard. */
export async function getOwnershipProjections(
  storage: IStorage,
  driverId: string,
): Promise<OwnershipProjection> {
  const ownership = await storage.getOrCreateOwnership(driverId);
  const weeklyHours = await storage.getDriverWeeklyHoursHistory(driverId, 8);
  const certs = await storage.getShareCertificates(driverId);
  const profits = await storage.getDriverProfitDistributions(driverId);

  const qualWeeks = ownership.totalQualifyingWeeks ?? 0;
  const lifetimeMinutes = ownership.totalLifetimeMinutes ?? 0;
  const avgWeeklyMinutes =
    weeklyHours.length > 0
      ? weeklyHours.reduce((s: number, w) => s + (w.totalMinutes ?? 0), 0) / weeklyHours.length
      : 0;

  const weeksToAdHoc =
    ownership.status === "none"
      ? Math.max(0, AD_HOC_WEEKS - qualWeeks)
      : null;
  const hoursToLifetime =
    ownership.status !== "lifetime"
      ? Math.max(0, Math.round((LIFETIME_MINUTES - lifetimeMinutes) / 60))
      : null;

  const recentProfit = profits.reduce(
    (s: number, p) => s + parseFloat(p.amount ?? "0"),
    0,
  );
  const sharePct = certs.reduce(
    (s: number, c) => s + parseFloat(c.sharePercentage ?? "0"),
    0,
  );
  const projectedQuarterlyShare = recentProfit > 0 ? recentProfit * 1.05 : sharePct * 12;

  const onTrack =
    ownership.status === "lifetime" ||
    (weeksToAdHoc !== null && weeksToAdHoc <= 4 && avgWeeklyMinutes >= 2400) ||
    ownership.status === "ad_hoc";

  let narrative = "Keep driving consistently to build qualifying weeks.";
  if (ownership.status === "ad_hoc") {
    narrative = `Ad-hoc owner with ${sharePct.toFixed(2)}% share — on track for lifetime at current pace.`;
  } else if (ownership.status === "lifetime") {
    narrative = `Lifetime owner — projected quarterly distribution ~$${projectedQuarterlyShare.toFixed(0)} if profits hold.`;
  } else if (weeksToAdHoc !== null && weeksToAdHoc <= 3) {
    narrative = `You're ${weeksToAdHoc} qualifying week(s) from ad-hoc ownership.`;
  }

  return {
    status: ownership.status ?? "none",
    onTrack,
    weeksToAdHoc,
    hoursToLifetime,
    projectedQuarterlyShare: Math.round(projectedQuarterlyShare * 100) / 100,
    narrative,
  };
}
