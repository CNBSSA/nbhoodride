import { useEffect } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, MapPin, Shield } from "lucide-react";

/**
 * Install a no-referrer policy for THIS page only. The share token lives
 * in the URL (`/guardian/:token`) — without this, the browser would
 * include the full URL in the Referer header when this page loads any
 * external resource (map tile, font, analytics script in the future),
 * leaking the secret to those vendors. document.referrer scrubbing on
 * the server side handles logs; this scrub handles the browser side.
 */
function useNoReferrerPolicy() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);
}

interface GuardianTrackResponse {
  status: string;
  pickup?: { address?: string };
  destination?: { address?: string };
  guardianName?: string;
  updatedAt?: string;
}

export default function GuardianTrack() {
  useNoReferrerPolicy();
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, error } = useQuery<GuardianTrackResponse>({
    queryKey: [`/api/guardian/track/${token}`],
    enabled: !!token,
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">This tracking link is invalid or has expired.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 max-w-md mx-auto" data-testid="guardian-track-page">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold">PG Ride — Family Track</h1>
      </div>
      <Card>
        <CardContent className="p-4 space-y-3">
          {data.guardianName && (
            <p className="text-sm text-muted-foreground">Watching ride for {data.guardianName}</p>
          )}
          {data.status === "no_active_ride" ? (
            <p className="text-sm">No active ride right now. Check back when they start a trip.</p>
          ) : (
            <>
              <p className="text-sm font-semibold capitalize">Status: {(data.status || "").replace(/_/g, " ")}</p>
              {data.pickup?.address && (
                <div className="flex gap-2 text-sm">
                  <MapPin className="w-4 h-4 shrink-0 text-green-600" />
                  <span>{data.pickup.address}</span>
                </div>
              )}
              {data.destination?.address && (
                <div className="flex gap-2 text-sm">
                  <MapPin className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{data.destination.address}</span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
