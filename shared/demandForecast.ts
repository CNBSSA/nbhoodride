/** D1 — Simple demand forecast from historical heatmap cells. */

export function predictRideCount(
  historicalCount: number,
  dayOfWeek: number,
  hourOfDay: number,
): { predicted: number; confidence: number } {
  const weekendBoost = dayOfWeek === 0 || dayOfWeek === 6 ? 1.12 : 1.0;
  const rushHour =
    (hourOfDay >= 7 && hourOfDay <= 9) || (hourOfDay >= 17 && hourOfDay <= 19)
      ? 1.18
      : 1.0;
  const base = Math.max(0, historicalCount);
  const predicted = Math.max(1, Math.round(base * weekendBoost * rushHour));
  const confidence =
    base >= 15 ? 0.9 : base >= 8 ? 0.75 : base >= 3 ? 0.55 : 0.35;
  return { predicted, confidence };
}

export function mergeHeatmapWithForecast<
  T extends { rideCount?: number | null; hourOfDay: number; dayOfWeek: number },
>(cells: T[]): Array<T & { predictedRides: number; forecastConfidence: number }> {
  return cells.map((cell) => {
    const { predicted, confidence } = predictRideCount(
      cell.rideCount ?? 0,
      cell.dayOfWeek,
      cell.hourOfDay,
    );
    return {
      ...cell,
      predictedRides: predicted,
      forecastConfidence: confidence,
    };
  });
}
