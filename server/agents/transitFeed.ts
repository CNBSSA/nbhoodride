import type { IStorage } from "../storage";

export type TransitAgency = "wmata" | "marc" | "thebus" | "metrobus_pg";

export interface TransitAlert {
  agency: TransitAgency;
  externalId?: string;
  alertType: string;
  title: string;
  summary?: string;
  severity: string;
  expiresAt?: Date;
}

const CACHE_TTL_MS = 15 * 60 * 1000;

/** Seeded PG County first/last-mile alerts when WMATA API key is unset. */
const SEED_ALERTS: TransitAlert[] = [
  {
    agency: "wmata",
    externalId: "seed-greenbelt",
    alertType: "delay",
    title: "Green Line — minor delays",
    summary: "Greenbelt ↔ Branch Ave: 5–10 min delays. Plan extra time for Metro connections.",
    severity: "warning",
    expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
  },
  {
    agency: "wmata",
    externalId: "seed-orange",
    alertType: "elevator",
    title: "New Carrollton — elevator outage",
    summary: "Use street-level access; PG Ride first-mile pickup available at station kiss-and-ride.",
    severity: "info",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  },
  {
    agency: "marc",
    externalId: "seed-marc-penn",
    alertType: "schedule",
    title: "MARC Penn Line — on time",
    summary: "Penn Line service normal. Connect at New Carrollton or Greenbelt for PG County rides.",
    severity: "info",
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
  },
  {
    agency: "thebus",
    externalId: "seed-thebus-17",
    alertType: "route",
    title: "TheBus Route 17 — detour",
    summary: "Temporary detour near Largo Town Center. Allow extra time for bus-to-ride transfers.",
    severity: "warning",
    expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
  },
];

interface WmataIncident {
  IncidentID?: string;
  IncidentType?: string;
  Description?: string;
  EndDate?: string;
}

async function fetchWmataIncidents(apiKey: string): Promise<TransitAlert[]> {
  const res = await fetch("https://api.wmata.com/Incidents.svc/json/Incidents", {
    headers: { api_key: apiKey },
  });
  if (!res.ok) {
    throw new Error(`WMATA API ${res.status}`);
  }
  const data = (await res.json()) as { Incidents?: WmataIncident[] };
  const incidents = data.Incidents ?? [];
  return incidents.slice(0, 20).map((inc) => ({
    agency: "wmata" as const,
    externalId: inc.IncidentID,
    alertType: inc.IncidentType ?? "incident",
    title: inc.IncidentType ?? "WMATA alert",
    summary: inc.Description,
    severity: "warning",
    expiresAt: inc.EndDate ? new Date(inc.EndDate) : new Date(Date.now() + CACHE_TTL_MS),
  }));
}

/** F3 — Refresh transit alert cache (WMATA live when keyed; seeded fallback). */
export async function refreshTransitFeeds(storage: IStorage): Promise<{ count: number; source: string }> {
  const apiKey = process.env.WMATA_API_KEY;
  let alerts: TransitAlert[] = [];
  let source = "seed";

  if (apiKey) {
    try {
      alerts = await fetchWmataIncidents(apiKey);
      source = "wmata_live";
    } catch (err) {
      console.error("WMATA fetch failed, using seed alerts:", err);
      alerts = SEED_ALERTS;
      source = "seed_fallback";
    }
  } else {
    alerts = SEED_ALERTS;
  }

  await storage.replaceTransitFeedCache(alerts);
  return { count: alerts.length, source };
}

export async function getTransitAlertsForRiders(
  storage: IStorage,
  agency?: TransitAgency,
): Promise<TransitAlert[]> {
  const cached = await storage.getActiveTransitAlerts(agency);
  if (cached.length > 0) {
    return cached.map((row) => ({
      agency: row.agency as TransitAgency,
      externalId: row.externalId ?? undefined,
      alertType: row.alertType,
      title: row.title,
      summary: row.summary ?? undefined,
      severity: row.severity ?? "info",
      expiresAt: row.expiresAt ?? undefined,
    }));
  }

  const { count } = await refreshTransitFeeds(storage);
  if (count === 0) return [];

  const fresh = await storage.getActiveTransitAlerts(agency);
  return fresh.map((row) => ({
    agency: row.agency as TransitAgency,
    externalId: row.externalId ?? undefined,
    alertType: row.alertType,
    title: row.title,
    summary: row.summary ?? undefined,
    severity: row.severity ?? "info",
    expiresAt: row.expiresAt ?? undefined,
  }));
}
