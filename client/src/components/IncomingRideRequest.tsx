import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Timer, MapPin, Navigation, Route, Users } from "lucide-react";

interface IncomingRideRequestProps {
  ride: {
    id: string;
    pickupLocation: { address: string; lat: number; lng: number };
    destinationLocation: { address: string; lat: number; lng: number };
    estimatedFare: string;
    pickupInstructions?: string;
    createdAt: string;
    rideType?: string;
    groupId?: string;
    pickupStops?: Array<{ address: string; lat: number; lng: number }>;
    rider: {
      firstName: string;
      lastName: string;
      rating: number;
    };
    // From WebSocket new_ride_request message (optional enrichment)
    isGroupRide?: boolean;
    groupType?: string;
    scheduleCode?: string;
    filledSlots?: number;
    maxSlots?: number;
    pickupStopsWs?: Array<{ address: string; lat: number; lng: number }>;
  };
  onAccept: (rideId: string) => void;
  onDecline: (rideId: string) => void;
}

const REQUEST_TIMEOUT_SECONDS = 90;

export default function IncomingRideRequest({ ride, onAccept, onDecline }: IncomingRideRequestProps) {
  const [isResponding, setIsResponding] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(() => {
    const created = new Date(ride.createdAt).getTime();
    const elapsed = Math.floor((Date.now() - created) / 1000);
    return Math.max(0, REQUEST_TIMEOUT_SECONDS - elapsed);
  });
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (secondsLeft === 0 && !isResponding) {
      onDecline(ride.id);
    }
  }, [secondsLeft, isResponding, ride.id, onDecline]);

  const acceptMutation = useMutation({
    mutationFn: async (rideId: string) => {
      const response = await apiRequest('POST', `/api/driver/rides/${rideId}/accept`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver/pending-rides"] });
      onAccept(ride.id);
    },
    onError: () => {
      toast({
        title: "Failed to Accept",
        description: "Unable to accept this ride. It may no longer be available.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setIsResponding(false);
    }
  });

  const declineMutation = useMutation({
    mutationFn: async (rideId: string) => {
      const response = await apiRequest('POST', `/api/driver/rides/${rideId}/decline`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver/pending-rides"] });
      onDecline(ride.id);
    },
    onError: () => {
      toast({
        title: "Failed to Decline",
        description: "Unable to decline this ride.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setIsResponding(false);
    }
  });

  const handleAccept = () => {
    setIsResponding(true);
    acceptMutation.mutate(ride.id);
  };

  const handleDecline = () => {
    setIsResponding(true);
    declineMutation.mutate(ride.id);
  };

  const formatTimeAgo = (dateString: string) => {
    const now = new Date();
    const created = new Date(dateString);
    const diffMinutes = Math.floor((now.getTime() - created.getTime()) / (1000 * 60));
    
    if (diffMinutes < 1) return "Just now";
    if (diffMinutes === 1) return "1 minute ago";
    return `${diffMinutes} minutes ago`;
  };

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <span key={i} className={i < rating ? "text-yellow-500" : "text-muted-foreground"}>
        ★
      </span>
    ));
  };

  const timerPercent = Math.round((secondsLeft / REQUEST_TIMEOUT_SECONDS) * 100);
  const isUrgent = secondsLeft <= 15;
  const isGroupRide = !!(ride.isGroupRide || ride.groupId || ride.rideType === 'multi_stop' || ride.rideType === 'shared_schedule');
  const isMultiStop = ride.rideType === 'multi_stop' || ride.groupType === 'multi_stop';
  const isSharedSchedule = ride.rideType === 'shared_schedule' || ride.groupType === 'shared_schedule';
  const allPickupStops = ride.pickupStops || ride.pickupStopsWs || [];

  return (
    <Card className={`border-2 animate-in slide-in-from-top duration-300 overflow-hidden ${
      isUrgent ? 'border-red-400 bg-red-50/50 dark:bg-red-950/20' : isGroupRide ? 'border-purple-400 bg-purple-50/30' : 'border-primary bg-primary/5'
    }`} data-testid={`incoming-ride-${ride.id}`}>
      <div className="relative h-1.5 bg-gray-200 dark:bg-gray-700">
        <div
          className={`h-full transition-all duration-1000 ease-linear rounded-r ${
            isUrgent ? 'bg-red-500' : timerPercent > 50 ? 'bg-green-500' : 'bg-orange-400'
          }`}
          style={{ width: `${timerPercent}%` }}
          data-testid={`timer-bar-${ride.id}`}
        />
      </div>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Timer className={`w-4 h-4 ${isUrgent ? 'text-red-500 animate-pulse' : 'text-gray-400'}`} />
            <span className={`text-xs font-semibold ${isUrgent ? 'text-red-600' : 'text-gray-500'}`} data-testid={`timer-text-${ride.id}`}>
              {secondsLeft > 0 ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')} to respond` : 'Expired'}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">{formatTimeAgo(ride.createdAt)}</span>
        </div>

        {/* Group ride badge */}
        {isGroupRide && (
          <div className={`flex items-center gap-2 mb-3 px-3 py-1.5 rounded-xl text-xs font-semibold ${isMultiStop ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}>
            {isMultiStop ? <Route className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />}
            {isMultiStop ? (
              <span>Multi-Stop Ride — {allPickupStops.length > 0 ? allPickupStops.length : 'Multiple'} pickup stops · You collect all passengers</span>
            ) : (
              <span>Shared Schedule {ride.scheduleCode ? `(${ride.scheduleCode})` : ''} — {ride.filledSlots ?? 1}/{ride.maxSlots ?? 3} riders · More profitable!</span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center text-primary-foreground font-bold text-lg">
              {ride.rider.firstName?.[0]}{ride.rider.lastName?.[0]}
            </div>
            <div>
              <h3 className="font-semibold text-lg">
                {ride.rider.firstName} {ride.rider.lastName?.[0]}.
              </h3>
              <div className="flex items-center space-x-1">
                <div className="flex text-sm">
                  {renderStars(ride.rider.rating)}
                </div>
                <span className="text-sm text-muted-foreground">{ride.rider.rating.toFixed(1)}</span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-secondary">${ride.estimatedFare}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Estimated fare</p>
          </div>
        </div>

        <div className="space-y-2 mb-4 p-3 bg-white dark:bg-gray-900 rounded-xl border">
          {/* Multi-stop: show numbered stops */}
          {isMultiStop && allPickupStops.length > 0 ? (
            <>
              {allPickupStops.map((stop, i) => (
                <div key={i} className="flex items-start space-x-3">
                  <div className="w-4 h-4 bg-blue-500 text-white rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 mt-0.5">{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-gray-400 uppercase font-medium">{i === 0 ? 'First Pickup' : `Stop ${i + 1}`}</p>
                    <p className="font-medium text-sm truncate">{stop.address}</p>
                  </div>
                </div>
              ))}
              <div className="border-l-2 border-dashed border-gray-200 ml-2 h-2" />
              <div className="flex items-start space-x-3">
                <Navigation className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-gray-400 uppercase font-medium">Shared Destination</p>
                  <p className="font-medium text-sm truncate">{ride.destinationLocation.address}</p>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start space-x-3">
                <MapPin className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-gray-400 uppercase font-medium">Pickup</p>
                  <p className="font-medium text-sm truncate">{ride.pickupLocation.address}</p>
                  {ride.pickupInstructions && (
                    <p className="text-xs text-blue-600 mt-0.5 italic">
                      "{ride.pickupInstructions}"
                    </p>
                  )}
                </div>
              </div>
              <div className="border-l-2 border-dashed border-gray-200 ml-2 h-2" />
              <div className="flex items-start space-x-3">
                <Navigation className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-gray-400 uppercase font-medium">Destination</p>
                  <p className="font-medium text-sm truncate">{ride.destinationLocation.address}</p>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex space-x-3">
          <Button
            variant="outline"
            className="flex-1 border-gray-300"
            onClick={handleDecline}
            disabled={isResponding || secondsLeft === 0}
            data-testid={`button-decline-ride-${ride.id}`}
          >
            <i className="fas fa-times mr-2" />
            Decline
          </Button>
          <Button
            className={`flex-1 ${isUrgent ? 'bg-red-600 hover:bg-red-700 animate-pulse' : ''}`}
            onClick={handleAccept}
            disabled={isResponding || secondsLeft === 0}
            data-testid={`button-accept-ride-${ride.id}`}
          >
            <i className="fas fa-check mr-2" />
            Accept Ride
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}