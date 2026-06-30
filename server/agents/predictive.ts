import { predictRideCount } from "@shared/demandForecast";
import type { IStorage } from "../storage";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** D1 — Build next-7-day demand forecast grid from historical heatmap. */
export async function runDemandForecastWorker(storage: IStorage): Promise<number> {
  const heatmap = await storage.getDemandHeatmap();
  let written = 0;
  const today = startOfDay(new Date());

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const forecastDate = new Date(today);
    forecastDate.setDate(forecastDate.getDate() + dayOffset);
    const dayOfWeek = forecastDate.getDay();

    for (const cell of heatmap) {
      const { predicted, confidence } = predictRideCount(
        cell.rideCount ?? 0,
        dayOfWeek,
        cell.hourOfDay,
      );
      await storage.upsertDemandForecast({
        gridLat: cell.gridLat,
        gridLng: cell.gridLng,
        hourOfDay: cell.hourOfDay,
        dayOfWeek,
        forecastDate,
        predictedRides: predicted,
        confidence,
      });
      written++;
    }
  }

  await storage.createAgentAuditLog({
    agent: "predictive",
    action: "forecast_generated",
    reasoning: `Wrote ${written} forecast cells for 7 days`,
    metadata: { cells: written },
  });

  return written;
}
