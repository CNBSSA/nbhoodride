import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { MapPin, Clock, User, DollarSign, Navigation, CheckCircle } from 'lucide-react';
import { RideHelpers } from '@/services/rideService';

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
  const [actualFare, setActualFare] = useState(ride.actualFare || ride.estimatedFare || '');
  const [isUpdating, setIsUpdating] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
    mutationFn: async ({ rideId, fare }: { rideId: string; fare: number }) => {
      const response = await apiRequest('POST', `/api/driver/rides/${rideId}/complete`, {
        actualFare: fare
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver/active-rides"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/earnings/today"] });
      toast({
        title: "Ride Completed!",
        description: "Trip completed successfully. Great job!",
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
    const fare = parseFloat(actualFare);
    if (isNaN(fare) || fare <= 0) {
      toast({
        title: "Invalid Fare",
        description: "Please enter a valid fare amount.",
        variant: "destructive",
      });
      return;
    }
    setIsUpdating(true);
    completeRideMutation.mutate({ rideId: ride.id, fare });
  };

  const getStatusDisplay = () => {
    switch (ride.status) {
      case 'accepted':
        return (
          <div className="space-y-4">
            <Badge variant="secondary" className="text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950">
              <Navigation className="w-3 h-3 mr-1" />
              Driver Assigned
            </Badge>
            <p className="text-sm text-muted-foreground">
              Navigate to pickup location and start the ride when you arrive.
            </p>
            <Button 
              onClick={handleStartRide}
              disabled={isUpdating}
              className="w-full"
              data-testid={`button-start-ride-${ride.id}`}
            >
              <Navigation className="w-4 h-4 mr-2" />
              {isUpdating ? "Starting..." : "Start Ride"}
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
            <p className="text-sm text-muted-foreground">
              Trip is in progress. Drive to destination safely.
            </p>
            <div className="space-y-2">
              <Label htmlFor={`fare-${ride.id}`}>Final Fare Amount</Label>
              <Input
                id={`fare-${ride.id}`}
                type="number"
                step="0.01"
                min="0"
                value={actualFare}
                onChange={(e) => setActualFare(e.target.value)}
                placeholder="Enter final fare"
                data-testid={`input-fare-${ride.id}`}
              />
            </div>
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
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Active Ride</CardTitle>
          <Badge variant="outline" className={RideHelpers.getStatusColor(ride.status)}>
            {RideHelpers.formatRideStatus(ride.status)}
          </Badge>
        </div>
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