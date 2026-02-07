import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  Star,
  Clock,
  DollarSign,
  CheckCircle,
  XCircle,
  AlertTriangle,
  BarChart3,
  MapPin,
  Zap,
  Loader2,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DriverScorecardEntry, DemandHeatmapEntry } from "@shared/schema";

type OptimalHourEntry = {
  hour: number;
  dayOfWeek: number;
  avgRides: number;
  avgEarnings: number;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

function getRateColor(rate: number): string {
  if (rate >= 90) return "text-green-600";
  if (rate >= 70) return "text-yellow-600";
  return "text-red-600";
}

function getRateBadge(rate: number): { variant: "default" | "secondary" | "destructive"; label: string } {
  if (rate >= 90) return { variant: "default", label: "Excellent" };
  if (rate >= 70) return { variant: "secondary", label: "Good" };
  return { variant: "destructive", label: "Needs Work" };
}

function getRatingColor(rating: number): string {
  if (rating >= 4.5) return "text-green-600";
  if (rating >= 3.5) return "text-yellow-600";
  return "text-red-600";
}

export default function DriverInsights() {
  const { data: scorecard, isLoading: scorecardLoading } = useQuery<DriverScorecardEntry>({
    queryKey: ["/api/driver/scorecard"],
  });

  const { data: optimalHours, isLoading: hoursLoading } = useQuery<OptimalHourEntry[]>({
    queryKey: ["/api/driver/optimal-hours"],
  });

  const { data: heatmapData, isLoading: heatmapLoading } = useQuery<DemandHeatmapEntry[]>({
    queryKey: ["/api/demand-heatmap"],
  });

  const isLoading = scorecardLoading || hoursLoading || heatmapLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const hasData = scorecard || (optimalHours && optimalHours.length > 0) || (heatmapData && heatmapData.length > 0);

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border p-4 flex items-center space-x-3">
        <Link href="/">
          <Button variant="ghost" size="sm" className="p-2" data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-lg font-bold" data-testid="text-page-title">Performance Insights</h1>
          <p className="text-xs text-muted-foreground">Your driving performance at a glance</p>
        </div>
      </header>

      <main className="max-w-[430px] mx-auto p-4 space-y-6">
        {!hasData ? (
          <Card data-testid="card-no-data">
            <CardContent className="p-8 text-center">
              <Zap className="h-12 w-12 text-primary mx-auto mb-4" />
              <h2 className="text-lg font-semibold mb-2">No Insights Yet</h2>
              <p className="text-muted-foreground">
                Complete more rides to see insights about your performance, optimal driving hours, and demand areas.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {scorecard && (
              <section data-testid="section-scorecard">
                <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  Driver Scorecard
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  <Card data-testid="card-rides-completed">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span className="text-xs text-muted-foreground">Rides Completed</span>
                      </div>
                      <p className="text-2xl font-bold" data-testid="text-rides-completed">
                        {scorecard.totalRidesCompleted || 0}
                      </p>
                    </CardContent>
                  </Card>

                  <Card data-testid="card-total-earnings">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <DollarSign className="h-4 w-4 text-green-600" />
                        <span className="text-xs text-muted-foreground">Total Earnings</span>
                      </div>
                      <p className="text-2xl font-bold" data-testid="text-total-earnings">
                        ${parseFloat(scorecard.totalEarnings || "0").toFixed(2)}
                      </p>
                    </CardContent>
                  </Card>

                  <Card data-testid="card-acceptance-rate">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <TrendingUp className="h-4 w-4 text-primary" />
                        <span className="text-xs text-muted-foreground">Acceptance Rate</span>
                      </div>
                      <p className={`text-2xl font-bold ${getRateColor(parseFloat(scorecard.acceptanceRate || "0"))}`} data-testid="text-acceptance-rate">
                        {parseFloat(scorecard.acceptanceRate || "0").toFixed(1)}%
                      </p>
                      <Badge {...getRateBadge(parseFloat(scorecard.acceptanceRate || "0"))} className="mt-1 text-xs">
                        {getRateBadge(parseFloat(scorecard.acceptanceRate || "0")).label}
                      </Badge>
                    </CardContent>
                  </Card>

                  <Card data-testid="card-completion-rate">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle className="h-4 w-4 text-primary" />
                        <span className="text-xs text-muted-foreground">Completion Rate</span>
                      </div>
                      <p className={`text-2xl font-bold ${getRateColor(parseFloat(scorecard.completionRate || "0"))}`} data-testid="text-completion-rate">
                        {parseFloat(scorecard.completionRate || "0").toFixed(1)}%
                      </p>
                      <Badge {...getRateBadge(parseFloat(scorecard.completionRate || "0"))} className="mt-1 text-xs">
                        {getRateBadge(parseFloat(scorecard.completionRate || "0")).label}
                      </Badge>
                    </CardContent>
                  </Card>

                  <Card data-testid="card-avg-rating">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Star className="h-4 w-4 text-yellow-500" />
                        <span className="text-xs text-muted-foreground">Avg Rating</span>
                      </div>
                      <p className={`text-2xl font-bold ${getRatingColor(parseFloat(scorecard.avgRating || "0"))}`} data-testid="text-avg-rating">
                        {parseFloat(scorecard.avgRating || "0").toFixed(2)}
                      </p>
                    </CardContent>
                  </Card>

                  <Card data-testid="card-cancelled">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <XCircle className="h-4 w-4 text-red-500" />
                        <span className="text-xs text-muted-foreground">Cancelled</span>
                      </div>
                      <p className="text-2xl font-bold" data-testid="text-cancelled">
                        {scorecard.totalRidesCancelled || 0}
                      </p>
                    </CardContent>
                  </Card>

                  {(scorecard.disputeCount !== null && scorecard.disputeCount !== undefined && scorecard.disputeCount > 0) && (
                    <Card data-testid="card-disputes">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <AlertTriangle className="h-4 w-4 text-yellow-500" />
                          <span className="text-xs text-muted-foreground">Disputes</span>
                        </div>
                        <p className="text-2xl font-bold text-yellow-600" data-testid="text-disputes">
                          {scorecard.disputeCount}
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {scorecard.lastUpdated && (
                  <p className="text-xs text-muted-foreground mt-2" data-testid="text-last-updated">
                    Last updated: {new Date(scorecard.lastUpdated).toLocaleDateString()}
                  </p>
                )}
              </section>
            )}

            {optimalHours && optimalHours.length > 0 && (
              <section data-testid="section-optimal-hours">
                <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  Best Hours to Drive
                </h2>
                <Card>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" data-testid="table-optimal-hours">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left p-3 text-muted-foreground font-medium">Day</th>
                            <th className="text-left p-3 text-muted-foreground font-medium">Time</th>
                            <th className="text-right p-3 text-muted-foreground font-medium">Rides</th>
                            <th className="text-right p-3 text-muted-foreground font-medium">Earnings</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...optimalHours]
                            .sort((a, b) => b.avgEarnings - a.avgEarnings)
                            .slice(0, 10)
                            .map((entry, idx) => (
                              <tr key={idx} className="border-b border-border last:border-0" data-testid={`row-optimal-hour-${idx}`}>
                                <td className="p-3 font-medium">{DAY_NAMES[entry.dayOfWeek] || entry.dayOfWeek}</td>
                                <td className="p-3">{formatHour(entry.hour)}</td>
                                <td className="p-3 text-right">{entry.avgRides}</td>
                                <td className="p-3 text-right font-semibold text-green-600">
                                  ${Number(entry.avgEarnings).toFixed(2)}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </section>
            )}

            {heatmapData && heatmapData.length > 0 && (
              <section data-testid="section-demand-heatmap">
                <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-primary" />
                  Top Demand Areas
                </h2>
                <div className="space-y-3">
                  {[...heatmapData]
                    .sort((a, b) => (b.rideCount || 0) - (a.rideCount || 0))
                    .slice(0, 8)
                    .map((area, idx) => (
                      <Card key={idx} data-testid={`card-demand-area-${idx}`}>
                        <CardContent className="p-4 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                              <MapPin className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <p className="text-sm font-medium" data-testid={`text-demand-location-${idx}`}>
                                Area ({Number(area.gridLat).toFixed(3)}, {Number(area.gridLng).toFixed(3)})
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {DAY_NAMES[area.dayOfWeek] || area.dayOfWeek} at {formatHour(area.hourOfDay)}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold" data-testid={`text-demand-rides-${idx}`}>
                              {area.rideCount || 0} rides
                            </p>
                            <p className="text-xs text-green-600 font-medium">
                              ~${parseFloat(area.avgFare || "0").toFixed(2)} avg
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
