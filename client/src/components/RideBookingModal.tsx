import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAnalytics } from "@/hooks/useAnalytics";

interface Driver {
  id: string;
  name: string;
  rating: number;
  vehicle: string;
  estimatedTime: string;
  estimatedFare: string;
  isVerifiedNeighbor: boolean;
  profileImage?: string;
}

interface FareEstimate {
  timeCharge: number;
  distanceCharge: number;
  subtotal: number;
  discount: number;
  total: number;
  formula: string;
}

interface RideBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  drivers: Driver[];
  userLocation: { lat: number; lng: number; address: string };
}

export default function RideBookingModal({ 
  isOpen, 
  onClose, 
  drivers,
  userLocation 
}: RideBookingModalProps) {
  const [pickupAddress, setPickupAddress] = useState(userLocation.address);
  const [destinationAddress, setDestinationAddress] = useState("");
  const [pickupInstructions, setPickupInstructions] = useState("");
  const [selectedDriver, setSelectedDriver] = useState<string>("");
  const [fareEstimate, setFareEstimate] = useState<FareEstimate | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { trackRideSearch, trackRideBooked } = useAnalytics();

  useEffect(() => {
    if (isOpen) {
      trackRideSearch();
    }
  }, [isOpen, trackRideSearch]);

  // Calculate fare when destination changes
  const calculateFareMutation = useMutation({
    mutationFn: async ({ distance, duration }: { distance: number; duration: number }) => {
      const response = await apiRequest('POST', '/api/rides/calculate-fare', {
        distance,
        duration
      });
      return response.json();
    },
    onSuccess: (data) => {
      setFareEstimate(data);
    }
  });

  // Book ride mutation
  const bookRideMutation = useMutation({
    mutationFn: async (rideData: any) => {
      const response = await apiRequest('POST', '/api/rides', rideData);
      return response.json();
    },
    onSuccess: () => {
      trackRideBooked();
      toast({
        title: "Ride Booked!",
        description: "Your driver is on the way. You'll receive updates shortly.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/rides"] });
      onClose();
    },
    onError: () => {
      toast({
        title: "Booking Failed",
        description: "Unable to book your ride. Please try again.",
        variant: "destructive",
      });
    }
  });

  // Mock fare calculation for demo (replace with actual geocoding)
  useEffect(() => {
    if (destinationAddress.length > 3) {
      // Mock distance and duration calculation
      const mockDistance = 8.2; // miles
      const mockDuration = 18; // minutes
      calculateFareMutation.mutate({ distance: mockDistance, duration: mockDuration });
    }
  }, [destinationAddress]);

  // Sync pickup address with userLocation changes
  useEffect(() => {
    if (isOpen && userLocation) {
      setPickupAddress(userLocation.address);
    }
  }, [isOpen, userLocation?.address]);

  const handleBookRide = () => {
    if (!destinationAddress || !selectedDriver) {
      toast({
        title: "Missing Information",
        description: "Please select a destination and driver.",
        variant: "destructive",
      });
      return;
    }

    const rideData = {
      pickupLocation: {
        lat: userLocation.lat,
        lng: userLocation.lng,
        address: pickupAddress
      },
      destinationLocation: {
        lat: userLocation.lat + 0.01, // Mock destination coordinates
        lng: userLocation.lng + 0.01,
        address: destinationAddress
      },
      pickupInstructions,
      driverId: selectedDriver,
      estimatedFare: fareEstimate?.total || 0,
      paymentMethod: 'card' // Virtual card is the only payment method
    };

    bookRideMutation.mutate(rideData);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center max-w-[430px] mx-auto">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <Card className="relative z-10 w-full h-[90vh] rounded-t-xl border-0 shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Book a Ride</h2>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-close-booking">
            <i className="fas fa-times" />
          </Button>
        </div>
        
        <CardContent className="p-4 space-y-4 overflow-y-auto h-full pb-20">
          {/* Pickup Location */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Pickup Location</label>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-secondary rounded-full" />
              <Input
                value={pickupAddress}
                onChange={(e) => setPickupAddress(e.target.value)}
                placeholder="Enter pickup address"
                data-testid="input-pickup-address"
              />
            </div>
            <Textarea
              placeholder="Pickup instructions (optional): e.g., Meet me at the main entrance"
              value={pickupInstructions}
              onChange={(e) => setPickupInstructions(e.target.value)}
              rows={2}
              className="text-sm"
              data-testid="textarea-pickup-instructions"
            />
          </div>

          {/* Destination */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Destination</label>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-destructive rounded-full" />
              <Input
                value={destinationAddress}
                onChange={(e) => setDestinationAddress(e.target.value)}
                placeholder="Where are you going?"
                data-testid="input-destination"
              />
            </div>
          </div>

          {/* Fare Estimate */}
          {fareEstimate && (
            <Card className="bg-muted">
              <CardContent className="p-4">
                <h3 className="font-semibold mb-2">Fare Estimate</h3>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Distance: 8.2 miles</span>
                    <span>${fareEstimate.distanceCharge.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Time: 18 minutes</span>
                    <span>${fareEstimate.timeCharge.toFixed(2)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-semibold">
                    <span>Total (Virtual Card)</span>
                    <span data-testid="text-total-fare">${fareEstimate.total.toFixed(2)}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {fareEstimate.formula}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Available Drivers */}
          <div>
            <h3 className="font-semibold mb-3">Choose Your Driver</h3>
            <div className="space-y-2">
              {drivers.map((driver) => (
                <label
                  key={driver.id}
                  className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-muted"
                  data-testid={`driver-option-${driver.id}`}
                >
                  <input
                    type="radio"
                    name="driver"
                    value={driver.id}
                    checked={selectedDriver === driver.id}
                    onChange={(e) => setSelectedDriver(e.target.value)}
                    className="mr-3"
                  />
                  <img
                    src={driver.profileImage || `https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=50&h=50&fit=crop&crop=face`}
                    alt={`Driver ${driver.name}`}
                    className="w-10 h-10 rounded-full mr-3"
                  />
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-medium">{driver.name}</span>
                      {driver.isVerifiedNeighbor && (
                        <span className="bg-secondary text-secondary-foreground text-xs px-2 py-1 rounded-full">
                          Verified
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-1 text-sm">
                      <div className="text-yellow-500">★★★★★</div>
                      <span className="text-muted-foreground">{driver.rating} • {driver.estimatedTime}</span>
                    </div>
                  </div>
                  <span className="font-semibold">{driver.estimatedFare}</span>
                </label>
              ))}
            </div>
          </div>
        </CardContent>

        <div className="absolute bottom-0 left-0 right-0 p-4 bg-card border-t">
          <Button
            onClick={handleBookRide}
            disabled={bookRideMutation.isPending || !selectedDriver || !destinationAddress || !fareEstimate}
            className="w-full"
            data-testid="button-confirm-booking"
          >
            {bookRideMutation.isPending ? "Booking..." : "Confirm Booking"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
