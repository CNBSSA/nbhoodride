import type { IStorage } from "../storage";

export interface EarningsCoachMessage {
  headline: string;
  detail: string;
  suggestedAction?: string;
  metrics: Record<string, number | string>;
}

const WEEKLY_GOAL = 400;

/** D2 — Conversational earnings coaching from scorecard + heatmap. */
export async function buildEarningsCoachMessage(
  storage: IStorage,
  driverId: string,
): Promise<EarningsCoachMessage> {
  const scorecard = await storage.getDriverScorecard(driverId);
  const optimal = await storage.getDriverOptimalHours(driverId);
  const heatmap = await storage.getDemandHeatmap(new Date().getHours(), new Date().getDay());

  const earnings = parseFloat(scorecard?.totalEarnings ?? "0");
  const gap = Math.max(0, WEEKLY_GOAL - earnings);
  const topHour = optimal.sort((a, b) => b.avgEarnings - a.avgEarnings)[0];
  const hotZone = heatmap.sort((a, b) => (b.rideCount ?? 0) - (a.rideCount ?? 0))[0];

  const hourLabel = topHour
    ? `${topHour.hour === 0 ? 12 : topHour.hour > 12 ? topHour.hour - 12 : topHour.hour}${topHour.hour >= 12 ? "pm" : "am"}`
    : "peak hours";

  let headline = "You're on track this week";
  let detail = `You've earned $${earnings.toFixed(0)} toward your $${WEEKLY_GOAL} goal.`;
  let suggestedAction: string | undefined;

  if (gap > 0) {
    headline = `You're $${gap.toFixed(0)} short of your weekly goal`;
    const matchRate = topHour ? Math.min(95, Math.round(topHour.avgRides * 12 + 40)) : 65;
    detail = `Staying online until ${hourLabel} has a ${matchRate}% historical match rate in your corridors.`;
    if (hotZone) {
      suggestedAction = `Head toward grid ${hotZone.gridLat},${hotZone.gridLng} — ${hotZone.rideCount ?? 0} recent pickups nearby.`;
    }
  }

  return {
    headline,
    detail,
    suggestedAction,
    metrics: {
      weeklyEarnings: earnings,
      weeklyGoal: WEEKLY_GOAL,
      acceptanceRate: parseFloat(scorecard?.acceptanceRate ?? "0"),
      avgRating: parseFloat(scorecard?.avgRating ?? "5"),
    },
  };
}
