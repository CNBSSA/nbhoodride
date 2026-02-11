import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAnalytics } from "@/hooks/useAnalytics";
import { MapPin, Navigation, User, DollarSign, CheckCircle, ChevronRight, Star, Shield, Loader2 } from "lucide-react";

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
    },
    onError: (error, variables) => {
      if (!fareEstimate) {
        toast({
          title: "Fare Calculation Failed",
          description: "Unable to estimate fare. Please check your destination and try again.",
          variant: "destructive",
        });
      }
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
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const handleResize = () => {
      setViewportHeight(vv.height);
    };
    handleResize();
    vv.addEventListener('resize', handleResize);
    return () => vv.removeEventListener('resize', handleResize);
  }, [isOpen]);

  const calculateFareRef = useRef(calculateFareMutation.mutate);
  calculateFareRef.current = calculateFareMutation.mutate;

  const calculateFare = useCallback((distance: number, duration: number, driverId?: string) => {
    calculateFareRef.current({ distance, duration, driverId });
  }, []);

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
      setTimeout(() => {
        confirmBtnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
  }, [selectedDriver, estimatedDistance, estimatedDuration, calculateFare]);

  useEffect(() => {
    if (isOpen && userLocation && !pickupManuallyEdited) {
      setPickupAddress(userLocation.address);
    }
  }, [isOpen, userLocation?.address, pickupManuallyEdited]);

  const handleBookRide = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
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

  const bookingStep = !destinationAddress || !destCoords ? 1 : !selectedDriver ? 2 : 3;

  const stepLabels = [
    { num: 1, label: 'Route', icon: MapPin },
    { num: 2, label: 'Driver', icon: User },
    { num: 3, label: 'Confirm', icon: CheckCircle },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center max-w-[430px] mx-auto" style={viewportHeight ? { height: `${viewportHeight}px`, top: 'auto', bottom: 0 } : undefined}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <Card className="relative z-10 w-full rounded-t-2xl border-0 shadow-2xl flex flex-col" style={{ maxHeight: viewportHeight ? `${viewportHeight - 16}px` : 'calc(100dvh - 2rem)' }}>
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <h2 className="text-lg font-bold">Book a Ride</h2>
          <Button variant="ghost" size="sm" onClick={onClose} className="rounded-full w-8 h-8 p-0" data-testid="button-close-booking">
            <i className="fas fa-times text-gray-400" />
          </Button>
        </div>

        <div className="flex items-center justify-center gap-0 px-6 pb-3 flex-shrink-0">
          {stepLabels.map((step, i) => {
            const isComplete = bookingStep > step.num;
            const isCurrent = bookingStep === step.num;
            return (
              <div key={step.num} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                    isComplete ? 'bg-green-500 text-white' : isCurrent ? 'bg-blue-600 text-white ring-2 ring-blue-200' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {isComplete ? <CheckCircle className="w-3.5 h-3.5" /> : <step.icon className="w-3.5 h-3.5" />}
                  </div>
                  <span className={`text-[9px] mt-0.5 font-semibold ${isCurrent ? 'text-blue-600' : isComplete ? 'text-green-600' : 'text-gray-400'}`}>
                    {step.label}
                  </span>
                </div>
                {i < stepLabels.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-2 mt-[-10px] rounded ${isComplete ? 'bg-green-400' : 'bg-gray-200'}`} />
                )}
              </div>
            );
          })}
        </div>
        
        <CardContent className="p-4 space-y-4 overflow-y-auto flex-1">
          <div className="space-y-3 p-3 bg-gray-50 dark:bg-gray-900 rounded-xl">
            <div className="flex items-start gap-3">
              <div className="flex flex-col items-center mt-1">
                <div className="w-3 h-3 bg-green-500 rounded-full" />
                <div className="w-0.5 h-6 bg-gray-300 my-0.5" />
                <div className="w-3 h-3 bg-red-500 rounded-full" />
              </div>
              <div className="flex-1 space-y-2">
                <div>
                  <label className="text-[10px] text-gray-400 uppercase font-semibold">Pickup</label>
                  <Input
                    value={pickupAddress}
                    onChange={(e) => {
                      setPickupAddress(e.target.value);
                      setPickupManuallyEdited(true);
                    }}
                    placeholder="Enter pickup address"
                    className="h-9 text-sm bg-white dark:bg-gray-800"
                    data-testid="input-pickup-address"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase font-semibold">Destination</label>
                  <Input
                    value={destinationAddress}
                    onChange={(e) => setDestinationAddress(e.target.value)}
                    placeholder="Where are you going?"
                    className="h-9 text-sm bg-white dark:bg-gray-800"
                    data-testid="input-destination"
                  />
                </div>
              </div>
            </div>
            <Textarea
              placeholder="Pickup instructions (optional): e.g., Meet at the main entrance"
              value={pickupInstructions}
              onChange={(e) => setPickupInstructions(e.target.value)}
              rows={2}
              className="text-xs bg-white dark:bg-gray-800"
              data-testid="textarea-pickup-instructions"
            />
          </div>

          {calculateFareMutation.isPending && (
            <div className="flex items-center justify-center gap-2 py-3 text-blue-600">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Calculating fare...</span>
            </div>
          )}

          {fareEstimate && (
            <Card className="bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-950/20 dark:to-blue-950/20 border-green-200">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4 text-green-600" />
                  <h3 className="font-semibold text-sm">Fare Breakdown</h3>
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Base fare</span>
                    <span className="font-medium">${fareEstimate.baseFare.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Time ({estimatedDuration ?? '...'} min)</span>
                    <span className="font-medium">${fareEstimate.timeCharge.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Distance ({estimatedDistance ?? '...'} mi)</span>
                    <span className="font-medium">${fareEstimate.distanceCharge.toFixed(2)}</span>
                  </div>
                  {fareEstimate.surgeAdjustment !== 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Adjustment</span>
                      <span className={fareEstimate.surgeAdjustment < 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                        {fareEstimate.surgeAdjustment < 0 ? "-" : "+"}${Math.abs(fareEstimate.surgeAdjustment).toFixed(2)}
                      </span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between font-bold text-sm pt-1">
                    <span>Total</span>
                    <span className="text-green-700" data-testid="text-total-fare">${fareEstimate.total.toFixed(2)}</span>
                  </div>
                </div>
                <p className="text-[10px] text-gray-400 mt-2 flex items-center gap-1">
                  <Shield className="w-3 h-3" /> No surge pricing — transparent rates always
                </p>
              </CardContent>
            </Card>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm">Choose Your Driver</h3>
              <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{drivers.length} available</span>
            </div>
            <div className="space-y-2">
              {drivers.length === 0 && (
                <div className="text-center py-6 text-gray-400">
                  <User className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No drivers nearby right now</p>
                  <p className="text-xs">Try again in a moment</p>
                </div>
              )}
              {drivers.map((driver) => (
                <label
                  key={driver.id}
                  className={`flex items-center p-3 rounded-xl cursor-pointer transition-all ${
                    selectedDriver === driver.id
                      ? 'bg-blue-50 dark:bg-blue-950/30 border-2 border-blue-400 shadow-sm'
                      : 'border-2 border-transparent bg-white dark:bg-gray-900 hover:border-gray-200 shadow-sm'
                  }`}
                  data-testid={`driver-option-${driver.id}`}
                >
                  <input
                    type="radio"
                    name="driver"
                    value={driver.id}
                    checked={selectedDriver === driver.id}
                    onChange={(e) => setSelectedDriver(e.target.value)}
                    className="sr-only"
                  />
                  <div className={`w-11 h-11 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 mr-3 ${
                    selectedDriver === driver.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {driver.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-sm">{driver.name}</span>
                      {driver.isVerifiedNeighbor && (
                        <Shield className="w-3.5 h-3.5 text-green-500" />
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                      <span>{driver.rating.toFixed(1)}</span>
                      <span className="text-gray-300">|</span>
                      <span>{driver.estimatedTime}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-sm">{driver.estimatedFare}</span>
                    {selectedDriver === driver.id && (
                      <CheckCircle className="w-4 h-4 text-blue-600 ml-auto mt-0.5" />
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
        </CardContent>

        <div className="p-4 bg-card border-t flex-shrink-0 space-y-2" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 1rem))' }}>
          {fareEstimate && selectedDriver && (
            <div className="flex items-center justify-between text-xs text-gray-500 px-1">
              <span>Paid via Virtual PG Card</span>
              <span className="font-bold text-sm text-gray-900 dark:text-gray-100">${fareEstimate.total.toFixed(2)}</span>
            </div>
          )}
          <Button
            ref={confirmBtnRef}
            onClick={handleBookRide}
            disabled={bookRideMutation.isPending || !selectedDriver || !destinationAddress || (!fareEstimate && !calculateFareMutation.isPending)}
            className="w-full h-14 text-base font-semibold rounded-xl shadow-lg"
            size="lg"
            data-testid="button-confirm-booking"
          >
            {bookRideMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Booking...</>
            ) : calculateFareMutation.isPending && selectedDriver ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Updating fare...</>
            ) : fareEstimate && selectedDriver ? (
              `Confirm Ride — $${fareEstimate.total.toFixed(2)}`
            ) : !destinationAddress ? (
              'Enter Destination'
            ) : !destCoords ? (
              'Looking up address...'
            ) : !selectedDriver ? (
              'Select a Driver'
            ) : (
              'Confirm Booking'
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
