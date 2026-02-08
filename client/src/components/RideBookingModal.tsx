import { useState, useEffect, useCallback, useRef } from "react";
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
  baseFare: number;
  timeCharge: number;
  distanceCharge: number;
  surgeAdjustment: number;
  subtotal: number;
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
  const [pickupManuallyEdited, setPickupManuallyEdited] = useState(false);
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
    } else {
      setDestinationAddress("");
      setPickupInstructions("");
      setSelectedDriver("");
      setFareEstimate(null);
      setDestCoords(null);
      setEstimatedDistance(null);
      setEstimatedDuration(null);
      setPickupManuallyEdited(false);
    }
  }, [isOpen, trackRideSearch]);

  // Calculate fare when destination changes
  const calculateFareMutation = useMutation({
    mutationFn: async ({ distance, duration, driverId }: { distance: number; duration: number; driverId?: string }) => {
      const response = await apiRequest('POST', '/api/rides/calculate-fare', {
        distance,
        duration,
        driverId,
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

  const [destCoords, setDestCoords] = useState<{lat: number, lng: number} | null>(null);
  const [estimatedDistance, setEstimatedDistance] = useState<number | null>(null);
  const [estimatedDuration, setEstimatedDuration] = useState<number | null>(null);

  const selectedDriverRef = useRef(selectedDriver);
  selectedDriverRef.current = selectedDriver;

  const calculateFare = useCallback((distance: number, duration: number, driverId?: string) => {
    calculateFareMutation.mutate({ distance, duration, driverId });
  }, [calculateFareMutation.mutate]);

  useEffect(() => {
    if (destinationAddress.length < 5) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(destinationAddress)}&limit=1&countrycodes=us`,
          { headers: { 'User-Agent': 'PGRide-Community-Rideshare/1.0' } }
        );
        const results = await res.json();
        if (results.length > 0) {
          const lat = parseFloat(results[0].lat);
          const lng = parseFloat(results[0].lon);
          setDestCoords({ lat, lng });
          const R = 3959;
          const dLat = (lat - userLocation.lat) * Math.PI / 180;
          const dLng = (lng - userLocation.lng) * Math.PI / 180;
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(userLocation.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
          const straightLineDist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const distance = Math.round(straightLineDist * 1.3 * 10) / 10;
          const duration = Math.round((distance / 25) * 60);
          setEstimatedDistance(distance);
          setEstimatedDuration(duration);
          calculateFare(distance, duration, selectedDriverRef.current || undefined);
        }
      } catch {
        setDestCoords(null);
        setEstimatedDistance(null);
        setEstimatedDuration(null);
        setFareEstimate(null);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [destinationAddress, userLocation.lat, userLocation.lng, calculateFare]);

  useEffect(() => {
    if (selectedDriver && estimatedDistance && estimatedDuration) {
      calculateFare(estimatedDistance, estimatedDuration, selectedDriver);
    }
  }, [selectedDriver, estimatedDistance, estimatedDuration, calculateFare]);

  useEffect(() => {
    if (isOpen && userLocation && !pickupManuallyEdited) {
      setPickupAddress(userLocation.address);
    }
  }, [isOpen, userLocation?.address, pickupManuallyEdited]);

  const handleBookRide = () => {
    if (!destinationAddress || !selectedDriver) {
      toast({
        title: "Missing Information",
        description: "Please select a destination and driver.",
        variant: "destructive",
      });
      return;
    }

    if (!destCoords) {
      toast({
        title: "Address Not Found",
        description: "We couldn't locate that destination. Please enter a valid address.",
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
        lat: destCoords.lat,
        lng: destCoords.lng,
        address: destinationAddress
      },
      pickupInstructions,
      driverId: selectedDriver,
      estimatedFare: fareEstimate?.total || 0,
      paymentMethod: 'card'
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
                onChange={(e) => {
                  setPickupAddress(e.target.value);
                  setPickupManuallyEdited(true);
                }}
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
                    <span className="text-muted-foreground">Base fare</span>
                    <span>${fareEstimate.baseFare.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Time ({estimatedDuration ?? '...'} min)</span>
                    <span>${fareEstimate.timeCharge.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Distance ({estimatedDistance ?? '...'} mi)</span>
                    <span>${fareEstimate.distanceCharge.toFixed(2)}</span>
                  </div>
                  {fareEstimate.surgeAdjustment !== 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Surge</span>
                      <span className={fareEstimate.surgeAdjustment < 0 ? "text-green-600" : "text-red-600"}>
                        {fareEstimate.surgeAdjustment < 0 ? "-" : "+"}${Math.abs(fareEstimate.surgeAdjustment).toFixed(2)}
                      </span>
                    </div>
                  )}
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
