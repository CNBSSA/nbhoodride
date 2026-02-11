import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { MapPin, Clock, User, DollarSign, Navigation, CheckCircle, Route, ExternalLink } from 'lucide-react';
import { RideHelpers } from '@/services/rideService';
import { useAnalytics } from "@/hooks/useAnalytics";
import { RideProgressStepper } from "@/components/RideProgressStepper";

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
    estimatedFare: string;
    actualFare?: string;
    acceptedAt?: string;
    startedAt?: string;
    rider?: {
      firstName: string;
      lastName: string;
      rating: string;
    };
  };
}

export function ActiveRideCard({ ride }: ActiveRideCardProps) {
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
              <Button 
                variant="outline"
                onClick={() => openNavigation(ride.pickupLocation.lat, ride.pickupLocation.lng, ride.pickupLocation.address)}
                className="w-full border-blue-200 text-blue-700 hover:bg-blue-50"
                data-testid={`button-navigate-pickup-${ride.id}`}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Navigate to Pickup (Google Maps)
              </Button>
            )}
            <Button 
              onClick={handleStartRide}
              disabled={isUpdating}
              className="w-full"
              data-testid={`button-start-ride-${ride.id}`}
            >
              <Navigation className="w-4 h-4 mr-2" />
              {isUpdating ? "Starting..." : "Arrived — Start Ride"}
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

            {ride.destinationLocation?.lat && ride.destinationLocation?.lng && (
              <Button 
                variant="outline"
                onClick={() => openNavigation(ride.destinationLocation.lat, ride.destinationLocation.lng, ride.destinationLocation.address)}
                className="w-full border-purple-200 text-purple-700 hover:bg-purple-50"
                data-testid={`button-navigate-destination-${ride.id}`}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Navigate to Destination (Google Maps)
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
    </Card>
  );
}