import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Sparkles } from "lucide-react";

interface CoachMessage {
  headline: string;
  detail: string;
  suggestedAction?: string;
  metrics: Record<string, number | string>;
}

/** D2 — Driver Earnings Coach card. */
export function EarningsCoachCard() {
  const { data, isLoading } = useQuery<CoachMessage>({
    queryKey: ["/api/driver/earnings-coach"],
  });

  if (isLoading) {
    return (
      <Card data-testid="earnings-coach-loading">
        <CardContent className="p-4 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card className="border-primary/20 bg-primary/5" data-testid="earnings-coach-card">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <p className="font-semibold text-sm">Earnings Coach</p>
        </div>
        <p className="font-medium">{data.headline}</p>
        <p className="text-sm text-muted-foreground">{data.detail}</p>
        {data.suggestedAction && (
          <p className="text-xs text-primary">{data.suggestedAction}</p>
        )}
      </CardContent>
    </Card>
  );
}
