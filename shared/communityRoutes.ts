/** Community route presets — anchor corridors for quick booking. */

export const ROUTE_CATEGORIES = ["metro", "campus", "church", "venue", "senior"] as const;
export type RouteCategory = (typeof ROUTE_CATEGORIES)[number];

export const ROUTE_CATEGORY_LABELS: Record<RouteCategory, string> = {
  metro: "Metro",
  campus: "Campus",
  church: "Church",
  venue: "Events",
  senior: "Senior center",
};

export interface CommunityRouteDestination {
  lat: number;
  lng: number;
  address: string;
}

export interface CommunityRoutePreset {
  id: string;
  name: string;
  description?: string | null;
  routeCategory: string;
  destinationLocation: CommunityRouteDestination;
}

/** Pick display label for a route chip. */
export function formatCommunityRouteLabel(route: Pick<CommunityRoutePreset, "name" | "routeCategory">): string {
  const cat = ROUTE_CATEGORY_LABELS[route.routeCategory as RouteCategory];
  return cat ? `${route.name}` : route.name;
}
