import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Minus, Plus, Info } from "lucide-react";
import { Link } from "wouter";
import { SUGGESTED_RATES, calculateFareWithRates } from "@/services/fareCalculator";

interface RateCardData {
  minimumFare: string;
  baseFare: string;
  perMinuteRate: string;
  perMileRate: string;
  surgeAdjustment: string;
  useSuggested: boolean;
}

const RATE_FIELDS = [
  { key: "minimumFare" as const, label: "Minimum fare", step: 0.25, min: 3.00, max: 25.00, prefix: "$", decimals: 2 },
  { key: "baseFare" as const, label: "Base fare", step: 0.50, min: 0, max: 15.00, prefix: "$", decimals: 2 },
  { key: "perMinuteRate" as const, label: "Per minute", step: 0.01, min: 0.05, max: 2.00, prefix: "$", decimals: 2 },
  { key: "perMileRate" as const, label: "Per mile", step: 0.05, min: 0.25, max: 5.00, prefix: "$", decimals: 2 },
  { key: "surgeAdjustment" as const, label: "Surge", step: 0.25, min: -10.00, max: 10.00, prefix: "$", decimals: 2 },
];

export default function DriverRateCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: rateCard, isLoading } = useQuery<RateCardData>({
    queryKey: ["/api/driver/rate-card"],
    enabled: !!user?.isDriver,
  });

  const [customRates, setCustomRates] = useState<Record<string, number>>({
    minimumFare: SUGGESTED_RATES.minimumFare,
    baseFare: SUGGESTED_RATES.baseFare,
    perMinuteRate: SUGGESTED_RATES.perMinuteRate,
    perMileRate: SUGGESTED_RATES.perMileRate,
    surgeAdjustment: SUGGESTED_RATES.surgeAdjustment,
  });
  const [useSuggested, setUseSuggested] = useState(true);

  useEffect(() => {
    if (rateCard) {
      setUseSuggested(rateCard.useSuggested);
      setCustomRates({
        minimumFare: parseFloat(rateCard.minimumFare),
        baseFare: parseFloat(rateCard.baseFare),
        perMinuteRate: parseFloat(rateCard.perMinuteRate),
        perMileRate: parseFloat(rateCard.perMileRate),
        surgeAdjustment: parseFloat(rateCard.surgeAdjustment),
      });
    }
  }, [rateCard]);

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("PUT", "/api/driver/rate-card", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver/rate-card"] });
      toast({ title: "Rate Card Saved", description: "Your rates have been updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save rate card.", variant: "destructive" });
    },
  });

  const handleAdjust = (key: string, delta: number) => {
    const field = RATE_FIELDS.find((f) => f.key === key)!;
    setCustomRates((prev) => {
      const newVal = Math.round((prev[key] + delta) * 100) / 100;
      return { ...prev, [key]: Math.max(field.min, Math.min(field.max, newVal)) };
    });
  };

  const handleSubmit = () => {
    saveMutation.mutate({
      ...customRates,
      useSuggested,
    });
  };

  const handleToggleSuggested = (checked: boolean) => {
    setUseSuggested(checked);
    if (checked) {
      setCustomRates({
        minimumFare: SUGGESTED_RATES.minimumFare,
        baseFare: SUGGESTED_RATES.baseFare,
        perMinuteRate: SUGGESTED_RATES.perMinuteRate,
        perMileRate: SUGGESTED_RATES.perMileRate,
        surgeAdjustment: SUGGESTED_RATES.surgeAdjustment,
      });
    }
  };

  const activeRates = useSuggested
    ? SUGGESTED_RATES
    : {
        minimumFare: customRates.minimumFare,
        baseFare: customRates.baseFare,
        perMinuteRate: customRates.perMinuteRate,
        perMileRate: customRates.perMileRate,
        surgeAdjustment: customRates.surgeAdjustment,
      };
  const sampleFare = calculateFareWithRates(5, 15, activeRates);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white dark:from-gray-900 dark:to-gray-800">
      <div className="bg-blue-600 text-white px-4 py-4 flex items-center gap-3">
        <Link href="/">
          <button className="p-1" data-testid="button-back-rate-card">
            <ArrowLeft className="h-5 w-5" />
          </button>
        </Link>
        <h1 className="text-lg font-bold">Your rate cards</h1>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-4">
        <div className="bg-blue-100 dark:bg-blue-900 rounded-lg px-4 py-2 text-center">
          <span className="text-sm font-semibold text-blue-800 dark:text-blue-200 uppercase tracking-wide">
            EVERYDAY
          </span>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Everyday rate card</CardTitle>
            <div className="flex text-sm text-muted-foreground mt-1">
              <span className="w-1/3 font-semibold text-blue-600">SUGGESTED</span>
              <span className="w-1/3 font-semibold text-center">CUSTOM</span>
              <span className="w-1/3" />
            </div>
          </CardHeader>
          <CardContent className="space-y-0">
            {RATE_FIELDS.map((field) => {
              const suggestedVal = (SUGGESTED_RATES as any)[field.key] as number;
              const customVal = customRates[field.key];
              const isSurge = field.key === "surgeAdjustment";

              return (
                <div
                  key={field.key}
                  className="flex items-center py-3 border-b last:border-b-0"
                  data-testid={`rate-row-${field.key}`}
                >
                  <div className="w-1/3">
                    <p className="text-xs text-muted-foreground">{field.label}</p>
                    <p className="font-bold text-sm flex items-center gap-1">
                      {field.prefix}
                      {suggestedVal.toFixed(field.decimals)}
                      {field.key === "minimumFare" && (
                        <Info className="h-3 w-3 text-blue-500" />
                      )}
                    </p>
                    {isSurge && (
                      <p className="text-xs text-muted-foreground">
                        {suggestedVal === 0 ? "Optimized" : suggestedVal > 0 ? "Boost" : "Discount"}
                      </p>
                    )}
                  </div>

                  <div className="w-1/3 text-center">
                    <p className="font-semibold text-sm" data-testid={`text-custom-${field.key}`}>
                      {isSurge
                        ? `${customVal >= 0 ? "" : "-"}$${Math.abs(customVal).toFixed(field.decimals)}`
                        : `${field.prefix}${customVal.toFixed(field.decimals)}`}
                    </p>
                  </div>

                  <div className="w-1/3 flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0"
                      disabled={useSuggested || customVal <= field.min}
                      onClick={() => handleAdjust(field.key, -field.step)}
                      data-testid={`button-decrease-${field.key}`}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0"
                      disabled={useSuggested || customVal >= field.max}
                      onClick={() => handleAdjust(field.key, field.step)}
                      data-testid={`button-increase-${field.key}`}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })}

            <div className="flex items-center justify-between pt-4">
              <span className="text-sm font-medium">Use suggested rate card</span>
              <Switch
                checked={useSuggested}
                onCheckedChange={handleToggleSuggested}
                data-testid="switch-use-suggested"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-2">Sample fare (5 miles, 15 min)</p>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Base fare</span>
                <span>${sampleFare.baseFare.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Time (15 min × ${activeRates.perMinuteRate.toFixed(2)})</span>
                <span>${sampleFare.timeCharge.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Distance (5 mi × ${activeRates.perMileRate.toFixed(2)})</span>
                <span>${sampleFare.distanceCharge.toFixed(2)}</span>
              </div>
              {sampleFare.surgeAdjustment !== 0 && (
                <div className="flex justify-between">
                  <span>Surge</span>
                  <span className={sampleFare.surgeAdjustment < 0 ? "text-green-600" : "text-red-600"}>
                    {sampleFare.surgeAdjustment < 0 ? "-" : "+"}${Math.abs(sampleFare.surgeAdjustment).toFixed(2)}
                  </span>
                </div>
              )}
              <div className="flex justify-between font-bold border-t pt-1 mt-1">
                <span>Total</span>
                <span>${sampleFare.total.toFixed(2)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Button
          className="w-full h-12 text-lg font-bold"
          onClick={handleSubmit}
          disabled={saveMutation.isPending}
          data-testid="button-submit-rate-card"
        >
          {saveMutation.isPending ? "Saving..." : "Submit"}
        </Button>
      </div>
    </div>
  );
}
