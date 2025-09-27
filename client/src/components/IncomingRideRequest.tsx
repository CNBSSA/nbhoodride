import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface IncomingRideRequestProps {
  ride: {
    id: string;
    pickupLocation: { address: string; lat: number; lng: number };
    destinationLocation: { address: string; lat: number; lng: number };
    estimatedFare: string;
    pickupInstructions?: string;
    createdAt: string;
    rider: {
      firstName: string;
      lastName: string;
      rating: number;
    };
  };
  onAccept: (rideId: string) => void;
  onDecline: (rideId: string) => void;
}

export default function IncomingRideRequest({ ride, onAccept, onDecline }: IncomingRideRequestProps) {
  const [isResponding, setIsResponding] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  return (
    <Card className="border-primary bg-primary/5 animate-in slide-in-from-top duration-300">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center text-primary-foreground">
              <i className="fas fa-user" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">
                {ride.rider.firstName} {ride.rider.lastName?.[0]}.
              </h3>
              <div className="flex items-center space-x-2">
                <div className="flex text-sm">
                  {renderStars(ride.rider.rating)}
                </div>
                <span className="text-sm text-muted-foreground">
                  • {formatTimeAgo(ride.createdAt)}
                </span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-secondary">${ride.estimatedFare}</p>
            <p className="text-sm text-muted-foreground">Estimated fare</p>
          </div>
        </div>

        <div className="space-y-3 mb-4">
          <div className="flex items-start space-x-3">
            <div className="w-3 h-3 bg-secondary rounded-full mt-2" />
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">Pickup</p>
              <p className="font-medium">{ride.pickupLocation.address}</p>
              {ride.pickupInstructions && (
                <p className="text-sm text-muted-foreground mt-1">
                  Note: {ride.pickupInstructions}
                </p>
              )}
            </div>
          </div>
          
          <div className="flex items-start space-x-3">
            <div className="w-3 h-3 bg-primary rounded-full mt-2" />
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">Destination</p>
              <p className="font-medium">{ride.destinationLocation.address}</p>
            </div>
          </div>
        </div>

        <div className="flex space-x-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleDecline}
            disabled={isResponding}
            data-testid={`button-decline-ride-${ride.id}`}
          >
            <i className="fas fa-times mr-2" />
            Decline
          </Button>
          <Button
            className="flex-1"
            onClick={handleAccept}
            disabled={isResponding}
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