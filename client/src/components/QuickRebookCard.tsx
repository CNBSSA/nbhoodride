import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Repeat, MapPin } from "lucide-react";

interface FrequentTrip {
  destinationLocation: { lat: number; lng: number; address: string };
  rideCount: number;
  lastRideAt: string;
}

interface QuickRebookCardProps {
  onSelectDestination: (route: { destinationLocation: FrequentTrip["destinationLocation"]; name: string }) => void;
  disabled?: boolean;
}

/**
 * "You've been here before" — a one-tap shortcut for a rider's repeated
 * destination (2+ completed rides in the last 30 days), so returning riders
 * don't have to retype the same address every time. Never books on its own;
 * tapping it only pre-fills the normal booking flow for confirmation.
 */
export function QuickRebookCard({ onSelectDestination, disabled }: QuickRebookCardProps) {
  const { data: trip } = useQuery<FrequentTrip | null>({
    queryKey: ["/api/rides/frequent-trip"],
    staleTime: 5 * 60 * 1000,
  });

  if (!trip) return null;

  return (
    <div
      className="flex items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 px-3 py-2.5"
      data-testid="quick-rebook-card"
    >
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Repeat className="w-4 h-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold text-primary uppercase tracking-wide leading-none mb-1">
          You go here often
        </p>
        <p className="text-xs text-gray-700 truncate flex items-center gap-1">
          <MapPin className="w-3 h-3 text-gray-400 flex-shrink-0" />
          {trip.destinationLocation.address}
        </p>
      </div>
      <Button
        size="sm"
        disabled={disabled}
        className="h-8 text-xs flex-shrink-0"
        onClick={() =>
          onSelectDestination({ destinationLocation: trip.destinationLocation, name: trip.destinationLocation.address })
        }
        data-testid="button-quick-rebook"
      >
        Book again
      </Button>
    </div>
  );
}
