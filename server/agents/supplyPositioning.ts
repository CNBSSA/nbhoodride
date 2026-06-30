import { deliverUserNotification } from "../notificationService";
import type { IStorage } from "../storage";

export interface PositioningNudge {
  zoneLabel: string;
  gridLat: string;
  gridLng: string;
  hourOfDay: number;
  predictedRides: number;
  driversNeeded: number;
  message: string;
}

/** D3 — Suggest where offline drivers should position for upcoming demand. */
export async function getPositioningNudges(
  storage: IStorage,
  driverId: string,
): Promise<PositioningNudge[]> {
  const forecasts = await storage.getDemandForecasts(
    new Date().getHours(),
    new Date().getDay(),
  );
  const profile = await storage.getDriverProfile(driverId);
  const loc = profile?.currentLocation as { lat: number; lng: number } | null;

  const top = forecasts
    .filter((f) => (f.predictedRides ?? 0) >= 3)
    .sort((a, b) => (b.predictedRides ?? 0) - (a.predictedRides ?? 0))
    .slice(0, 3);

  return top.map((f) => {
    const driversNeeded = Math.max(1, Math.ceil((f.predictedRides ?? 0) / 4));
    const distNote =
      loc && f.gridLat && f.gridLng
        ? ""
        : "";
    return {
      zoneLabel: `${f.gridLat},${f.gridLng}`,
      gridLat: String(f.gridLat),
      gridLng: String(f.gridLng),
      hourOfDay: f.hourOfDay,
      predictedRides: f.predictedRides ?? 0,
      driversNeeded,
      message: `${driversNeeded} driver${driversNeeded === 1 ? "" : "s"} needed near ${f.gridLat},${f.gridLng} between ${f.hourOfDay}:00–${f.hourOfDay + 1}:00${distNote}.`,
    };
  });
}

/** Push supply nudges to offline drivers covering a hot zone. */
export async function sendSupplyPositioningNudges(storage: IStorage): Promise<number> {
  const forecasts = await storage.getDemandForecasts(
    new Date().getHours(),
    new Date().getDay(),
  );
  const hot = forecasts
    .filter((f) => (f.predictedRides ?? 0) >= 5)
    .sort((a, b) => (b.predictedRides ?? 0) - (a.predictedRides ?? 0))[0];
  if (!hot) return 0;

  const drivers = await storage.getAllDriverProfiles();
  let sent = 0;
  for (const d of drivers) {
    if (d.isOnline) continue;
    const nudges = await getPositioningNudges(storage, d.userId);
    if (nudges.length === 0) continue;
    const n = nudges[0]!;
    await deliverUserNotification(d.userId, {
      type: "supply_positioning",
      title: "Demand building nearby",
      body: n.message,
      data: { gridLat: n.gridLat, gridLng: n.gridLng },
      url: "/driver",
    });
    sent++;
  }
  return sent;
}
