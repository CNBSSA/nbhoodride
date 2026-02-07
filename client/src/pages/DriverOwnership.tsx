import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Award, Clock, TrendingUp, Star, DollarSign } from "lucide-react";

export default function DriverOwnership() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery<{
    ownership: any;
    weeklyHours: any[];
    certificates: any[];
    profitHistory: any[];
  }>({ queryKey: ["/api/driver/ownership"] });

  if (isLoading) {
    return <div className="p-4 text-center" data-testid="loading-ownership">Loading ownership info...</div>;
  }

  const ownership = data?.ownership;
  const weeklyHours = data?.weeklyHours || [];
  const certificates = data?.certificates || [];
  const profitHistory = data?.profitHistory || [];

  const totalQualWeeks = ownership?.totalQualifyingWeeks || 0;
  const totalMinutes = ownership?.totalLifetimeMinutes || 0;
  const totalHours = totalMinutes / 60;

  const adHocProgress = Math.min((totalQualWeeks / 12) * 100, 100);
  const lifetimeHoursNeeded = 5640;
  const lifetimeProgress = Math.min((totalHours / lifetimeHoursNeeded) * 100, 100);

  const statusLabels: Record<string, string> = {
    none: "Not Yet Qualified",
    ad_hoc: "Ad-Hoc Owner",
    lifetime: "Lifetime Owner",
  };

  const statusColors: Record<string, string> = {
    none: "outline",
    ad_hoc: "secondary",
    lifetime: "default",
  };

  return (
    <div className="p-4 space-y-6" data-testid="driver-ownership-page">
      <h2 className="text-xl font-bold flex items-center gap-2">
        <Award className="w-6 h-6 text-yellow-600" />
        Ownership Dashboard
      </h2>

      <Card data-testid="ownership-status-card">
        <CardHeader>
          <CardTitle className="text-lg">Your Ownership Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-4">
            <Badge variant={statusColors[ownership?.status] as any || "outline"} className="text-sm px-3 py-1">
              {statusLabels[ownership?.status] || "Unknown"}
            </Badge>
            {ownership?.hasAdverseRecord && <Badge variant="destructive">Adverse Record</Badge>}
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Qualifying Weeks</span>
                <span className="font-bold">{totalQualWeeks} / 12</span>
              </div>
              <Progress value={adHocProgress} className="h-3" data-testid="progress-qualifying-weeks" />
              <p className="text-xs text-muted-foreground mt-1">Need 12 weeks of 40+ hours with 4.85+ rating for ad-hoc ownership</p>
            </div>

            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Lifetime Hours</span>
                <span className="font-bold">{totalHours.toFixed(1)} / {lifetimeHoursNeeded}</span>
              </div>
              <Progress value={lifetimeProgress} className="h-3" data-testid="progress-lifetime-hours" />
              <p className="text-xs text-muted-foreground mt-1">Need 5,640 total hours (1,880/yr for 3 years) for lifetime ownership</p>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <Star className="w-4 h-4 text-yellow-500" />
              <span>Your Rating: <span className="font-bold">{user?.rating || "N/A"}</span></span>
              <span className="text-muted-foreground">(Minimum 4.85 required)</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {certificates.length > 0 && (
        <Card data-testid="certificates-card">
          <CardHeader>
            <CardTitle className="text-lg">Your Share Certificates</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {certificates.map((cert: any) => (
                <div key={cert.id} className="flex items-center justify-between border rounded-lg p-3" data-testid={`cert-${cert.id}`}>
                  <div>
                    <p className="font-mono text-sm">{cert.certificateNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      Issued: {new Date(cert.issuedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-green-600">{parseFloat(cert.sharePercentage || "0").toFixed(2)}%</p>
                    <Badge>{cert.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card data-testid="weekly-hours-card">
        <CardHeader>
          <CardTitle className="text-lg">Weekly Hours History</CardTitle>
        </CardHeader>
        <CardContent>
          {weeklyHours.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No hours recorded yet. Complete rides to start tracking!</p>
          ) : (
            <div className="space-y-2">
              {weeklyHours.slice(0, 12).map((week: any) => (
                <div key={week.id} className="flex items-center justify-between border-b py-2 last:border-0" data-testid={`week-${week.id}`}>
                  <div>
                    <p className="text-sm font-medium">Week of {week.weekStart}</p>
                    <p className="text-xs text-muted-foreground">{week.rideCount || 0} rides</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold">{((week.totalMinutes || 0) / 60).toFixed(1)} hrs</span>
                    {week.qualifiesWeek ? (
                      <Badge className="bg-green-500">Qualifies</Badge>
                    ) : (
                      <Badge variant="outline">Below 40h</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {profitHistory.length > 0 && (
        <Card data-testid="profit-history-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <DollarSign className="w-5 h-5" /> Profit Distribution History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {profitHistory.map((dist: any) => (
                <div key={dist.id} className="flex items-center justify-between border rounded-lg p-3" data-testid={`profit-dist-${dist.id}`}>
                  <div>
                    <p className="font-medium">FY {dist.declaration?.fiscalYear}</p>
                    <p className="text-xs text-muted-foreground">
                      Share: {parseFloat(dist.sharePercentage || "0").toFixed(2)}% | Type: {dist.ownershipType}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-green-600">${parseFloat(dist.amount || "0").toFixed(2)}</p>
                    <Badge variant={dist.status === "paid" ? "default" : "secondary"}>{dist.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
