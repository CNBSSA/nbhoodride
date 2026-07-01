import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { ROUTE_CATEGORY_LABELS, type RouteCategory } from "@shared/communityRoutes";
import { Church, GraduationCap, MapPin, Train, Ticket } from "lucide-react";

interface CommunityRoute {
  id: string;
  name: string;
  description?: string | null;
  routeCategory: string;
  destinationLocation: { lat: number; lng: number; address: string };
}

interface CommunityRoutesCardProps {
  onSelectRoute: (route: CommunityRoute) => void;
  disabled?: boolean;
}

const CATEGORY_ICONS: Record<string, typeof MapPin> = {
  metro: Train,
  campus: GraduationCap,
  church: Church,
  venue: Ticket,
  senior: MapPin,
};

/** Quick-pick PG County community corridors on the rider home screen. */
export function CommunityRoutesCard({ onSelectRoute, disabled }: CommunityRoutesCardProps) {
  const { data: routes = [], isLoading } = useQuery<CommunityRoute[]>({
    queryKey: ["/api/community/routes"],
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading || routes.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="community-routes-card">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Community routes</p>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        {routes.map((route) => {
          const Icon = CATEGORY_ICONS[route.routeCategory] ?? MapPin;
          const catLabel = ROUTE_CATEGORY_LABELS[route.routeCategory as RouteCategory];
          return (
            <button
              key={route.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelectRoute(route)}
              className="flex-shrink-0 w-40 text-left rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2.5 active:bg-emerald-100/80 transition-colors disabled:opacity-50"
              data-testid={`community-route-${route.id}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className="w-3.5 h-3.5 text-emerald-700" />
                {catLabel && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-emerald-200 text-emerald-800">
                    {catLabel}
                  </Badge>
                )}
              </div>
              <p className="text-xs font-semibold text-gray-900 leading-tight line-clamp-2">{route.name}</p>
              {route.description && (
                <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{route.description}</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
