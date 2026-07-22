import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Users } from "lucide-react";
import { format } from "date-fns";

interface UpcomingRide {
  id: string;
  groupId?: string | null;
  status: string;
  scheduledAt: string | null;
  pickupLocation?: { address?: string };
  destinationLocation?: { address?: string };
  pickupInstructions?: string;
  estimatedFare?: string;
  rider?: { firstName?: string; lastName?: string };
}

interface UpcomingRideGroup {
  key: string;
  rides: UpcomingRide[];
  isGroup: boolean;
  allConfirmed: boolean;
  totalFare: number;
}

interface UpcomingRideGroupCardProps {
  group: UpcomingRideGroup;
  onConfirm: (rideId: string) => void;
  isConfirming: boolean;
}

/**
 * A claimed scheduled ride — solo, or a whole shared_schedule (coworker)
 * group shown as one card. Groups fetch the driver's optimized pickup
 * order so a multi-passenger run shows a real visiting sequence instead of
 * unordered cards. "Claimed" only reserves the ride (see /claim); nothing
 * is charged and the driver can't confirm arrival until they tap Confirm,
 * which authorizes payment for every rider in the group at once.
 */
export function UpcomingRideGroupCard({ group, onConfirm, isConfirming }: UpcomingRideGroupCardProps) {
  const { rides, isGroup, allConfirmed, totalFare, key } = group;
  const anchor = rides[0];

  const { data: pickupOrderData } = useQuery<{ pickupOrder: string[] }>({
    queryKey: [`/api/shared-rides/${anchor.groupId}/pickup-order`],
    enabled: isGroup && !!anchor.groupId,
  });

  const orderedRides = (() => {
    const order = pickupOrderData?.pickupOrder;
    if (!isGroup || !order) return rides;
    return [...rides].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  })();

  return (
    <Card className="border-green-200 bg-green-50" data-testid={`upcoming-ride-group-${key}`}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <Badge className={allConfirmed ? "bg-green-700 text-white" : "bg-green-600 text-white"}>
            {allConfirmed ? "Confirmed" : "Claimed"}
          </Badge>
          <span className="text-sm font-semibold text-green-700">
            {anchor.scheduledAt ? format(new Date(anchor.scheduledAt), "MMM d 'at' h:mm a") : ""}
          </span>
        </div>

        {isGroup && (
          <div className="flex items-center gap-1 text-xs font-semibold text-blue-700">
            <Users className="w-3.5 h-3.5" />
            Coworker group · {rides.length} riders · pick up in this order
          </div>
        )}

        <div className="space-y-2">
          {orderedRides.map((ride, i) => (
            <div key={ride.id} className="flex items-start gap-2 text-sm">
              {isGroup && (
                <span
                  className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5"
                  data-testid={`pickup-order-${ride.id}`}
                >
                  {i + 1}
                </span>
              )}
              <MapPin className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium truncate">{ride.pickupLocation?.address || "Pickup"}</p>
                <p className="text-gray-500 truncate">→ {ride.destinationLocation?.address || "Destination"}</p>
                <p className="text-xs text-gray-500">
                  {ride.rider?.firstName || "Rider"} {ride.rider?.lastName?.[0] || ""}. · ${parseFloat(ride.estimatedFare || "0").toFixed(2)}
                </p>
              </div>
            </div>
          ))}
        </div>

        {isGroup && (
          <div className="flex items-center justify-between text-sm font-semibold text-green-700 pt-1 border-t border-green-200">
            <span>Total fare</span>
            <span>${totalFare.toFixed(2)}</span>
          </div>
        )}

        {anchor.pickupInstructions && (
          <p className="text-xs text-gray-500 italic">"{anchor.pickupInstructions}"</p>
        )}

        {!allConfirmed && (
          <Button
            className="w-full mt-1"
            onClick={() => onConfirm(anchor.id)}
            disabled={isConfirming}
            data-testid={`button-confirm-scheduled-${key}`}
          >
            {isConfirming
              ? "Confirming..."
              : isGroup
                ? `Confirm & Accept All ${rides.length} Riders`
                : "Confirm & Accept Ride"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
