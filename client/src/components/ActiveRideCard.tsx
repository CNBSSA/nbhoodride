import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { MapPin, Clock, User, DollarSign, Navigation, CheckCircle, Route, ExternalLink, UserX, XCircle } from 'lucide-react';
import { RideHelpers } from '@/services/rideService';
import { useAnalytics } from "@/hooks/useAnalytics";
import { RideProgressStepper } from "@/components/RideProgressStepper";
import { RideChat } from "@/components/RideChat";
import { RideMapView } from "@/components/RideMapView";
import type { RideMessagePayload } from "@shared/rideChat";
import { formatPassengerLabel } from "@shared/rideForFriend";

interface ActiveRideCardProps {
  ride: {
    id: string;
    status: string;
    pickupLocation: {
      address: string;
      lat: number;
      lng: number;
    };
    destinationLocation: {
      address: string;
      lat: number;
      lng: number;
    };
    pickupInstructions?: string;
    bookedForFriend?: boolean;
    passengerName?: string;
    passengerPhone?: string;
    estimatedFare: string;
    actualFare?: string;
    acceptedAt?: string;
    startedAt?: string;
    arrivedAt?: string;
    rider?: {
      firstName: string;
      lastName: string;
      rating: string;
    };
  };
  incomingRideMessage?: RideMessagePayload | null;
  /** Driver's live position (from the dashboard's geolocation), for the in-app map. */
  driverLocation?: { lat: number; lng: number } | null;
}

export function ActiveRideCard({ ride, incomingRideMessage, driverLocation }: ActiveRideCardProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { trackRideCompleted } = useAnalytics();

  // Get real-time ride stats for in-progress rides
  const { data: rideStats, isLoading: isLoadingStats, isError: isErrorStats } = useQuery<{ distance: number; duration: number; estimatedFare: number }>({
    queryKey: [`/api/driver/rides/${ride.id}/stats`],
    enabled: ride.status === 'in_progress',
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // "I've Arrived" — transitions accepted → driver_arriving and fires the
  // rider's "Driver Arrived" notification. Sends the driver's current GPS so
  // the server can soft-check the pickup geofence (missing coords is fine —
  // the check is advisory, not blocking).
  const confirmArrivalMutation = useMutation({
    mutationFn: async (rideId: string) => {
      const coords = await new Promise<{ driverLat?: number; driverLng?: number }>((resolve) => {
        if (!navigator.geolocation) return resolve({});
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ driverLat: pos.coords.latitude, driverLng: pos.coords.longitude }),
          () => resolve({}),
          { timeout: 4000, maximumAge: 10000 },
        );
      });
      const response = await apiRequest('POST', `/api/driver/rides/${rideId}/confirm-arrival`, coords);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver/active-rides"] });
      toast({
        title: "Rider Notified 📍",
        description: "We let your rider know you're here. They're heading out.",
      });
    },
    onError: () => {
      toast({
        title: "Couldn't confirm arrival",
        description: "Please try again — or tap Start Ride once your rider is in.",
        variant: "destructive",
      });
    },
    onSettled: () => setIsUpdating(false),
  });

  const handleConfirmArrival = () => {
    setIsUpdating(true);
    confirmArrivalMutation.mutate(ride.id);
  };

  const startRideMutation = useMutation({
    mutationFn: async (rideId: string) => {
      const response = await apiRequest('POST', `/api/driver/rides/${rideId}/start`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver/active-rides"] });
      toast({
        title: "Ride Started!",
        description: "Trip is now in progress. Drive safely!",
      });
    },
    onError: () => {
      toast({
        title: "Failed to Start Ride",
        description: "Unable to start the ride. Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setIsUpdating(false);
    }
  });

  const completeRideMutation = useMutation({
    mutationFn: async (rideId: string) => {
      const response = await apiRequest('POST', `/api/driver/rides/${rideId}/complete`, {});
      return response.json();
    },
    onSuccess: (data) => {
      trackRideCompleted();
      queryClient.invalidateQueries({ queryKey: ["/api/driver/active-rides"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/earnings/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/rides/today"] });
      const fare = parseFloat(data.actualFare || data.estimatedFare || '0').toFixed(2);
      const distance = rideStats?.distance ? `${rideStats.distance.toFixed(1)} mi` : '';
      const duration = rideStats?.duration ? `${rideStats.duration} min` : '';
      const summary = [distance, duration].filter(Boolean).join(' • ');
      toast({
        title: `Ride Complete — $${fare} Earned!`,
        description: summary ? `Trip: ${summary}. Great job!` : "Trip completed successfully. Great job!",
      });
    },
    onError: () => {
      toast({
        title: "Failed to Complete Ride",
        description: "Unable to complete the ride. Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setIsUpdating(false);
    }
  });

  const handleStartRide = () => {
    setIsUpdating(true);
    startRideMutation.mutate(ride.id);
  };

  const handleCompleteRide = () => {
    setIsUpdating(true);
    completeRideMutation.mutate(ride.id);
  };

  // ── Rider no-show wait timer ──────────────────────────────────────────────
  // Ticks while waiting at pickup; the server enforces the same 5-minute
  // window and a geofence check, this just keeps the driver informed.
  const NO_SHOW_WAIT_MS = 5 * 60 * 1000;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ride.status !== 'driver_arriving' || !ride.arrivedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ride.status, ride.arrivedAt]);

  const waitedMs = ride.arrivedAt ? now - new Date(ride.arrivedAt).getTime() : 0;
  const noShowRemainingMs = Math.max(0, NO_SHOW_WAIT_MS - waitedMs);
  const noShowReady = !!ride.arrivedAt && noShowRemainingMs === 0;
  const remainingLabel = `${Math.floor(noShowRemainingMs / 60000)}:${String(Math.floor((noShowRemainingMs % 60000) / 1000)).padStart(2, '0')}`;

  const noShowMutation = useMutation({
    mutationFn: async (rideId: string) => {
      const coords = await new Promise<{ driverLat?: number; driverLng?: number }>((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error("Location access is required to report a no-show."));
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ driverLat: pos.coords.latitude, driverLng: pos.coords.longitude }),
          () => reject(new Error("Couldn't read your location — location access is required to report a no-show.")),
          { timeout: 6000, maximumAge: 10000 },
        );
      });
      const response = await apiRequest('POST', `/api/driver/rides/${rideId}/no-show`, coords);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || "Couldn't report the no-show.");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver/active-rides"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/earnings/today"] });
      toast({
        title: "No-Show Recorded",
        description: `You've been credited $${Number(data.driverCut ?? 0).toFixed(2)} for your time. You're free to take new rides.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't Report No-Show", description: err.message, variant: "destructive" });
    },
    onSettled: () => setIsUpdating(false),
  });

  // ── Driver cancel (post-accept) ───────────────────────────────────────────
  // Free for the rider, but counts against the driver's reliability standing —
  // the confirm step says so plainly.
  const [showDriverCancelConfirm, setShowDriverCancelConfirm] = useState(false);
  const driverCancelMutation = useMutation({
    mutationFn: async (rideId: string) => {
      const response = await apiRequest('POST', `/api/rides/${rideId}/cancel`, { reason: "Driver cancelled" });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver/active-rides"] });
      toast({
        title: "Ride Cancelled",
        description: "The rider was fully refunded and is being rematched. Repeated cancellations affect your reliability standing.",
      });
    },
    onError: () => {
      toast({ title: "Couldn't Cancel", description: "Please try again.", variant: "destructive" });
    },
    onSettled: () => { setIsUpdating(false); setShowDriverCancelConfirm(false); },
  });

  const openNavigation = (lat: number, lng: number, label: string) => {
    const encodedLabel = encodeURIComponent(label);
    const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=&travelmode=driving`;
    window.open(googleMapsUrl, '_blank');
  };

  const getStatusDisplay = () => {
    switch (ride.status) {
      case 'accepted':
        return (
          <div className="space-y-3">
            <Badge variant="secondary" className="text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950">
              <Navigation className="w-3 h-3 mr-1" />
              Driver Assigned — Head to Pickup
            </Badge>
            {ride.pickupLocation?.lat && ride.pickupLocation?.lng && (
              <RideMapView
                target={{ lat: ride.pickupLocation.lat, lng: ride.pickupLocation.lng }}
                targetLabel={ride.pickupLocation.address || "Pickup"}
                driver={driverLocation}
                leg="pickup"
              />
            )}
            {ride.pickupLocation?.lat && ride.pickupLocation?.lng && (
              <Button
                variant="outline"
                onClick={() => openNavigation(ride.pickupLocation.lat, ride.pickupLocation.lng, ride.pickupLocation.address)}
                className="w-full border-blue-200 text-blue-700 hover:bg-blue-50"
                data-testid={`button-navigate-pickup-${ride.id}`}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Open in Google Maps
              </Button>
            )}
            <RideChat rideId={ride.id} role="driver" incomingMessage={incomingRideMessage ?? null} />
            <Button
              onClick={handleConfirmArrival}
              disabled={isUpdating}
              className="w-full"
              data-testid={`button-confirm-arrival-${ride.id}`}
            >
              <MapPin className="w-4 h-4 mr-2" />
              {isUpdating ? "Notifying rider..." : "I've Arrived at Pickup"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setShowDriverCancelConfirm(true)}
              disabled={isUpdating}
              className="w-full text-red-500 hover:text-red-600 hover:bg-red-50"
              data-testid={`button-driver-cancel-${ride.id}`}
            >
              <XCircle className="w-4 h-4 mr-2" />
              Cancel This Ride
            </Button>
          </div>
        );
      case 'driver_arriving':
        return (
          <div className="space-y-3">
            <Badge variant="secondary" className="text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950">
              <MapPin className="w-3 h-3 mr-1" />
              At Pickup — Waiting for Rider
            </Badge>
            <p className="text-sm text-muted-foreground">
              Your rider has been notified you're here. Tap Start Ride once they're in the car.
            </p>
            {ride.pickupLocation?.lat && ride.pickupLocation?.lng && (
              <RideMapView
                target={{ lat: ride.pickupLocation.lat, lng: ride.pickupLocation.lng }}
                targetLabel={ride.pickupLocation.address || "Pickup"}
                driver={driverLocation}
                leg="pickup"
                height="200px"
              />
            )}
            <RideChat rideId={ride.id} role="driver" incomingMessage={incomingRideMessage ?? null} />
            <Button
              onClick={handleStartRide}
              disabled={isUpdating}
              className="w-full bg-green-600 hover:bg-green-700"
              data-testid={`button-start-ride-${ride.id}`}
            >
              <Navigation className="w-4 h-4 mr-2" />
              {isUpdating ? "Starting..." : "Start Ride"}
            </Button>

            {/* Rider no-show: unlocks after the full wait window at pickup.
                The server independently verifies both the wait and that the
                driver's GPS is still inside the pickup geofence. */}
            {ride.arrivedAt && (
              noShowReady ? (
                <Button
                  variant="outline"
                  onClick={() => { setIsUpdating(true); noShowMutation.mutate(ride.id); }}
                  disabled={isUpdating}
                  className="w-full border-amber-300 text-amber-700 hover:bg-amber-50"
                  data-testid={`button-no-show-${ride.id}`}
                >
                  <UserX className="w-4 h-4 mr-2" />
                  {isUpdating ? "Reporting..." : "Rider Didn't Show — End Ride"}
                </Button>
              ) : (
                <p className="text-xs text-center text-muted-foreground" data-testid={`text-no-show-timer-${ride.id}`}>
                  If your rider doesn't show, you can end this ride in {remainingLabel}
                </p>
              )
            )}
            <Button
              variant="ghost"
              onClick={() => setShowDriverCancelConfirm(true)}
              disabled={isUpdating}
              className="w-full text-red-500 hover:text-red-600 hover:bg-red-50"
              data-testid={`button-driver-cancel-${ride.id}`}
            >
              <XCircle className="w-4 h-4 mr-2" />
              Cancel This Ride
            </Button>
          </div>
        );
      case 'in_progress':
        return (
          <div className="space-y-4">
            <Badge variant="secondary" className="text-purple-600 bg-purple-50 dark:text-purple-400 dark:bg-purple-950">
              <Clock className="w-3 h-3 mr-1" />
              In Progress
            </Badge>

            {/* In-app navigation map to the destination (the main driving view). */}
            {ride.destinationLocation?.lat && ride.destinationLocation?.lng && (
              <RideMapView
                target={{ lat: ride.destinationLocation.lat, lng: ride.destinationLocation.lng }}
                targetLabel={ride.destinationLocation.address || "Destination"}
                driver={driverLocation}
                leg="destination"
                height="300px"
              />
            )}

            {/* GPS Tracking Info Banner */}
            <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center text-sm text-blue-900 dark:text-blue-100">
                <Route className="w-4 h-4 mr-2 flex-shrink-0" />
                <span>GPS tracking active - Real-time distance and fare calculation</span>
              </div>
            </div>

            {/* Real-time Stats */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-muted p-3 rounded-lg text-center">
                <p className="text-xs text-muted-foreground mb-1">Distance</p>
                {isLoadingStats ? (
                  <p className="text-lg font-bold">...</p>
                ) : isErrorStats ? (
                  <p className="text-lg font-bold text-destructive">Error</p>
                ) : (
                  <p className="text-lg font-bold" data-testid={`text-distance-${ride.id}`}>
                    {rideStats?.distance.toFixed(2) || '0.00'} mi
                  </p>
                )}
              </div>
              <div className="bg-muted p-3 rounded-lg text-center">
                <p className="text-xs text-muted-foreground mb-1">Duration</p>
                {isLoadingStats ? (
                  <p className="text-lg font-bold">...</p>
                ) : isErrorStats ? (
                  <p className="text-lg font-bold text-destructive">Error</p>
                ) : (
                  <p className="text-lg font-bold" data-testid={`text-duration-${ride.id}`}>
                    {rideStats?.duration || 0} min
                  </p>
                )}
              </div>
              <div className="bg-muted p-3 rounded-lg text-center">
                <p className="text-xs text-muted-foreground mb-1">Current Fare</p>
                {isLoadingStats ? (
                  <p className="text-lg font-bold">...</p>
                ) : isErrorStats ? (
                  <p className="text-lg font-bold text-destructive">Error</p>
                ) : (
                  <p className="text-lg font-bold text-green-600" data-testid={`text-current-fare-${ride.id}`}>
                    ${rideStats?.estimatedFare.toFixed(2) || '5.00'}
                  </p>
                )}
              </div>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              Base $4.00 + $0.29/min + $0.90/mi ($7.65 min, $100 max)
            </p>

            <RideChat rideId={ride.id} role="driver" incomingMessage={incomingRideMessage ?? null} />

            {ride.destinationLocation?.lat && ride.destinationLocation?.lng && (
              <Button 
                variant="outline"
                onClick={() => openNavigation(ride.destinationLocation.lat, ride.destinationLocation.lng, ride.destinationLocation.address)}
                className="w-full border-purple-200 text-purple-700 hover:bg-purple-50"
                data-testid={`button-navigate-destination-${ride.id}`}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Open in Google Maps
              </Button>
            )}
            
            <Button 
              onClick={handleCompleteRide}
              disabled={isUpdating}
              className="w-full"
              data-testid={`button-complete-ride-${ride.id}`}
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              {isUpdating ? "Completing..." : "Complete Ride"}
            </Button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Card className="border-l-4 border-l-primary" data-testid={`card-active-ride-${ride.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between mb-2">
          <CardTitle className="text-lg">Active Ride</CardTitle>
          <Badge variant="outline" className={RideHelpers.getStatusColor(ride.status)}>
            {RideHelpers.formatRideStatus(ride.status)}
          </Badge>
        </div>
        <RideProgressStepper status={ride.status} compact />
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Rider Information */}
        {ride.rider && (
          <div className="flex items-center space-x-3 p-3 bg-muted rounded-lg">
            <User className="w-5 h-5 text-muted-foreground" />
            <div>
              <p className="font-medium" data-testid={`text-rider-name-${ride.id}`}>
                {ride.rider.firstName} {ride.rider.lastName}
              </p>
              <p className="text-sm text-muted-foreground">
                Rating: {parseFloat(ride.rider.rating || "5.0").toFixed(1)} ⭐
              </p>
              {ride.bookedForFriend && ride.passengerName && (
                <p className="text-xs text-purple-700 font-medium mt-1">
                  {formatPassengerLabel(true, ride.passengerName, ride.rider.firstName)}
                </p>
              )}
              {ride.passengerPhone && (
                <p className="text-xs text-muted-foreground">📞 {ride.passengerPhone}</p>
              )}
            </div>
          </div>
        )}

        {/* Trip Details */}
        <div className="space-y-3">
          <div className="flex items-start space-x-3">
            <MapPin className="w-5 h-5 text-green-600 mt-0.5" />
            <div>
              <p className="font-medium text-green-600">Pickup</p>
              <p className="text-sm text-muted-foreground" data-testid={`text-pickup-${ride.id}`}>
                {ride.pickupLocation?.address}
              </p>
              {ride.pickupInstructions && (
                <p className="text-xs text-muted-foreground mt-1">
                  "{ride.pickupInstructions}"
                </p>
              )}
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <MapPin className="w-5 h-5 text-red-600 mt-0.5" />
            <div>
              <p className="font-medium text-red-600">Destination</p>
              <p className="text-sm text-muted-foreground" data-testid={`text-destination-${ride.id}`}>
                {ride.destinationLocation?.address}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <DollarSign className="w-5 h-5 text-muted-foreground" />
            <div>
              <p className="font-medium">Estimated Fare</p>
              <p className="text-sm text-muted-foreground" data-testid={`text-fare-${ride.id}`}>
                ${parseFloat(ride.estimatedFare || '0').toFixed(2)}
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons Based on Status */}
        {getStatusDisplay()}
      </CardContent>

      {/* Driver-cancel confirmation — free for the rider, a strike for the driver */}
      {showDriverCancelConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6" data-testid="driver-cancel-confirm-overlay">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 w-full max-w-sm shadow-xl">
            <h3 className="font-bold mb-1">Cancel this ride?</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Your rider will be fully refunded and rematched at no charge to them.
              Cancelling accepted rides counts against your reliability standing.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowDriverCancelConfirm(false)}
                data-testid="btn-driver-cancel-keep"
              >
                Keep Ride
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={driverCancelMutation.isPending}
                onClick={() => { setIsUpdating(true); driverCancelMutation.mutate(ride.id); }}
                data-testid="btn-driver-cancel-confirm"
              >
                {driverCancelMutation.isPending ? "Cancelling..." : "Cancel Ride"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}