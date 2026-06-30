import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Train, AlertTriangle, Info } from "lucide-react";

interface TransitAlert {
  agency: string;
  alertType: string;
  title: string;
  summary?: string;
  severity: string;
}

const AGENCY_LABELS: Record<string, string> = {
  wmata: "WMATA",
  marc: "MARC",
  thebus: "TheBus",
  metrobus_pg: "Metrobus",
};

/** F3 — First/last-mile transit alerts for riders (research lane). */
export function TransitAlertsCard() {
  const { data, isLoading } = useQuery<{ alerts: TransitAlert[] }>({
    queryKey: ["/api/transit/alerts"],
    staleTime: 5 * 60 * 1000,
  });

  const alerts = data?.alerts ?? [];
  if (isLoading) return null;
  if (alerts.length === 0) return null;

  return (
    <Card className="border-blue-100 bg-blue-50/50" data-testid="transit-alerts-card">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-blue-900">
          <Train className="w-4 h-4" />
          Transit & first/last mile
        </div>
        <ul className="space-y-2 max-h-32 overflow-y-auto">
          {alerts.slice(0, 4).map((alert, i) => (
            <li key={`${alert.agency}-${i}`} className="text-xs">
              <div className="flex items-start gap-1.5">
                {alert.severity === "warning" ? (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                ) : (
                  <Info className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                      {AGENCY_LABELS[alert.agency] ?? alert.agency}
                    </Badge>
                    <span className="font-medium text-gray-800">{alert.title}</span>
                  </div>
                  {alert.summary && (
                    <p className="text-muted-foreground mt-0.5 line-clamp-2">{alert.summary}</p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
