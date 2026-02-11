import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useLocation } from "wouter";
import MapComponent from "@/components/MapComponent";
import RideBookingModal from "@/components/RideBookingModal";
import ScheduleRideModal from "@/components/ScheduleRideModal";
import SOSModal from "@/components/SOSModal";
import { RideProgressStepper } from "@/components/RideProgressStepper";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAnalytics } from "@/hooks/useAnalytics";
import { MapPin, Plus, Calendar, Navigation, Bell, AlertTriangle, Star, Clock, X, ChevronRight, Shield, Phone, Car, Loader2, CheckCircle, Route, ThumbsUp, DollarSign, Timer, Banknote } from "lucide-react";

interface Driver {
  id: string;
  name: string;
  location: { lat: number; lng: number };
  rating: number;
  vehicle: string;
  estimatedFare: string;
  estimatedTime: string;
  isVerifiedNeighbor: boolean;
  profileImage?: string;
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateFare(miles: number): string {
  const roadMiles = miles * 1.3;
  const durationMinutes = Math.round((roadMiles / 25) * 60);
  const baseFare = 4.00;
  const timeCharge = 0.29 * durationMinutes;
  const distanceCharge = 0.90 * roadMiles;
  const total = Math.max(7.65, Math.min(100, baseFare + timeCharge + distanceCharge));
  if (total <= 10) {
    return `$${total.toFixed(2)}`;
  }
  const fareLow = Math.max(7.65, Math.round(total - 1));
  const fareHigh = Math.min(100, Math.round(total + 1.5));
  return `$${fareLow}-${fareHigh}`;
}

function estimateArrival(miles: number): string {
  const roadMiles = miles * 1.3;
  const minutes = Math.max(1, Math.round((roadMiles / 25) * 60));
  if (minutes <= 1) return "~1 min";
  if (minutes <= 3) return `~${minutes} min`;
  if (minutes <= 5) return `${minutes - 1}-${minutes} min`;
  return `${minutes - 2}-${minutes} min`;
}

export default function RiderDashboard() {
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isSOSModalOpen, setIsSOSModalOpen] = useState(false);
  const [realtimeDrivers, setRealtimeDrivers] = useState<Record<string, {lat: number, lng: number}>>({});
  const [recentlyCompletedRide, setRecentlyCompletedRide] = useState<any>(null);
  const [quickRating, setQuickRating] = useState(0);
  const [quickRatingHover, setQuickRatingHover] = useState(0);
  const [quickRatingSubmitted, setQuickRatingSubmitted] = useState(false);
  const [, setLocation] = useLocation();
  const lastProcessedMessageRef = useRef<string | null>(null);
  const { user } = useAuth();
  const { location, error: locationError, requestLocation } = useGeolocation();
  const { lastMessage } = useWebSocket();
  const { toast } = useToast();
  const { trackPageView, trackFeatureUsed } = useAnalytics();

  useEffect(() => {
    trackPageView("rider_dashboard");
  }, [trackPageView]);

  const currentLat = location ? location.latitude : 38.9073;
  const currentLng = location ? location.longitude : -76.7781;

  const { data: geocodeData } = useQuery<{ address: string }>({
    queryKey: ['/api/geocode/reverse', currentLat, currentLng],
    queryFn: async () => {
      const res = await fetch(`/api/geocode/reverse?lat=${currentLat}&lng=${currentLng}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Geocode failed');
      return res.json();
    },
    staleTime: 60000,
    retry: 1,
  });

  const userLocation = {
    lat: currentLat,
    lng: currentLng,
    address: geocodeData?.address || (location ? "Getting address..." : "Prince George's County, MD"),
  };

  const { data: nearbyDrivers = [], isLoading } = useQuery<any[]>({
    queryKey: [`/api/rides/nearby-drivers?lat=${userLocation.lat}&lng=${userLocation.lng}`],
    refetchInterval: 30000,
  });

  const { data: activeRides = [], refetch: refetchActiveRides } = useQuery<any[]>({
    queryKey: ['/api/rides/active'],
    refetchInterval: 5000,
  });

  const { data: scheduledRides = [] } = useQuery<any[]>({
    queryKey: ['/api/rides/scheduled'],
    refetchInterval: 30000,
  });

  const cancelRide = useMutation({
    mutationFn: async (rideId: string) => {
      const response = await apiRequest('POST', `/api/rides/${rideId}/cancel`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/rides/active'] });
      queryClient.invalidateQueries({ queryKey: ['/api/rides/scheduled'] });
      toast({
        title: "Ride Cancelled",
        description: "Your ride has been cancelled.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to cancel ride",
        variant: "destructive",
      });
    },
  });

  const submitQuickRating = useMutation({
    mutationFn: async ({ rideId, rating }: { rideId: string; rating: number }) => {
      const response = await apiRequest('POST', `/api/rides/${rideId}/rating`, { rating });
      return response.json();
    },
    onSuccess: () => {
      setQuickRatingSubmitted(true);
      queryClient.invalidateQueries({ queryKey: ["/api/rides/for-rating"] });
      toast({
        title: "Thanks for rating!",
        description: "Your feedback helps our community.",
      });
      setTimeout(() => {
        setRecentlyCompletedRide(null);
        setQuickRating(0);
        setQuickRatingHover(0);
        setQuickRatingSubmitted(false);
      }, 2000);
    },
    onError: () => {
      toast({
        title: "Rating failed",
        description: "Could not submit your rating. You can rate later from the Rides tab.",
        variant: "destructive",
      });
    },
  });

  const getElapsedTime = (startedAt: string) => {
    const start = new Date(startedAt).getTime();
    const now = Date.now();
    const diffMin = Math.max(0, Math.floor((now - start) / 60000));
    return diffMin;
  };

  const getDriverETA = (ride: any) => {
    const driverId = ride.driverId || ride.driver?.id;
    const driverLoc = driverId ? realtimeDrivers[driverId] : null;
    if (!driverLoc) return null;
    const target = ride.status === 'in_progress' ? ride.destinationLocation : ride.pickupLocation;
    if (!target?.lat || !target?.lng) return null;
    const dist = calculateDistance(driverLoc.lat, driverLoc.lng, target.lat, target.lng);
    const roadMiles = dist * 1.3;
    const minutes = Math.max(1, Math.round((roadMiles / 25) * 60));
    return { minutes, miles: roadMiles };
  };

  const mapCenter = userLocation || { lat: 38.9073, lng: -76.7781 };

  const activeRidesRef = useRef(activeRides);
  activeRidesRef.current = activeRides;

  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type !== 'driver_location' && lastProcessedMessageRef.current === `${lastMessage.type}-${lastMessage.rideId}`) {
      return;
    }
    if (lastMessage.type !== 'driver_location') {
      lastProcessedMessageRef.current = `${lastMessage.type}-${lastMessage.rideId}`;
    }

    if (lastMessage.type === 'driver_location') {
      setRealtimeDrivers(prev => ({
        ...prev,
        [lastMessage.driverId]: lastMessage.location
      }));
    } else if (lastMessage.type === 'ride_accepted') {
      refetchActiveRides();
      toast({
        title: "Driver Accepted!",
        description: lastMessage.driverName ? `${lastMessage.driverName} is on the way to pick you up.` : "Your driver is on the way to pick you up.",
      });
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
    } else if (lastMessage.type === 'ride_started') {
      refetchActiveRides();
      toast({
        title: "Ride Started",
        description: "You're on your way! Enjoy the ride.",
      });
    } else if (lastMessage.type === 'ride_completed') {
      const currentActiveRides = activeRidesRef.current;
      const completedRide = currentActiveRides.find((r: any) => r.id === lastMessage.rideId);
      if (completedRide) {
        setRecentlyCompletedRide({
          ...completedRide,
          actualFare: lastMessage.actualFare || completedRide.actualFare || completedRide.estimatedFare,
        });
      } else {
        setRecentlyCompletedRide({
          id: lastMessage.rideId,
          actualFare: lastMessage.actualFare || lastMessage.estimatedFare,
          estimatedFare: lastMessage.estimatedFare,
        });
      }
      refetchActiveRides();
      queryClient.invalidateQueries({ queryKey: ['/api/virtual-card/balance'] });
      const fare = lastMessage.actualFare ? `$${parseFloat(lastMessage.actualFare).toFixed(2)}` : '';
      toast({
        title: "Ride Complete!",
        description: fare ? `Final fare: ${fare}. Please rate your driver!` : "You've arrived! Please rate your driver.",
      });
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([200]);
      }
    } else if (lastMessage.type === 'ride_cancelled') {
      refetchActiveRides();
      toast({
        title: "Ride Cancelled",
        description: "Your ride has been cancelled.",
        variant: "destructive",
      });
    } else if (lastMessage.type === 'ride_update') {
      refetchActiveRides();
    }
  }, [lastMessage, refetchActiveRides, toast]);

  const drivers: Driver[] = nearbyDrivers.map((driver: any) => {
    const realtimeLocation = realtimeDrivers[driver.id];
    const driverLocation = realtimeLocation || driver.currentLocation || {
      lat: mapCenter.lat,
      lng: mapCenter.lng
    };

    const distMiles = calculateDistance(userLocation.lat, userLocation.lng, driverLocation.lat, driverLocation.lng);
    
    return {
      id: driver.id,
      name: `${driver.user.firstName} ${driver.user.lastName?.[0] || ''}.`,
      location: driverLocation,
      rating: parseFloat(driver.user.rating) || 5.0,
      vehicle: driver.vehicles[0] ? `${driver.vehicles[0].year} ${driver.vehicles[0].make} ${driver.vehicles[0].model}` : "Vehicle",
      estimatedFare: estimateFare(distMiles),
      estimatedTime: estimateArrival(distMiles),
      isVerifiedNeighbor: driver.isVerifiedNeighbor,
      profileImage: driver.user.profileImageUrl,
    };
  });

  return (
    <>
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
            <MapPin className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">PG Ride</h1>
            <p className="text-xs text-gray-500">Community Rideshare</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center" data-testid="button-notifications">
            <Bell className="w-5 h-5 text-gray-600" />
          </button>
          <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
            {user?.firstName?.[0] || 'U'}{user?.lastName?.[0] || ''}
          </div>
        </div>
      </header>

      <main className="bg-gray-50">
        <div className="bg-white px-4 py-3 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
                <Navigation className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">Your Location</p>
                <p className="text-sm font-semibold text-gray-900">
                  {locationError ? "Location unavailable" : userLocation?.address || "Loading..."}
                </p>
              </div>
            </div>
            <button
              onClick={requestLocation}
              className="text-xs text-blue-600 font-medium px-3 py-1.5 rounded-full bg-blue-50 hover:bg-blue-100 transition-colors"
              data-testid="button-refresh-location"
            >
              Update
            </button>
          </div>
        </div>

        <div className="px-4 pt-4">
          <div className="rounded-2xl overflow-hidden shadow-sm border border-gray-200">
            <MapComponent
              center={mapCenter}
              drivers={drivers}
              userLocation={userLocation || undefined}
              height="250px"
            />
          </div>
        </div>

        {recentlyCompletedRide && (
          <div className="px-4 pt-4">
            <Card className="border-2 border-green-300 bg-gradient-to-b from-green-50 to-white dark:from-green-950/20 dark:to-gray-900 shadow-lg animate-in slide-in-from-top duration-500" data-testid="ride-completed-card">
              <CardContent className="p-4">
                <RideProgressStepper status="completed" compact />

                <div className="flex items-center justify-center gap-2 my-3">
                  <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                    <CheckCircle className="w-6 h-6 text-green-600" />
                  </div>
                  <div>
                    <p className="font-bold text-green-700 text-lg leading-tight">You've Arrived!</p>
                    <p className="text-xs text-gray-500">Thanks for riding with PG Ride</p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 bg-green-100/60 dark:bg-green-900/30 rounded-xl mb-3">
                  <div className="text-center flex-1">
                    <p className="text-[10px] text-gray-500 uppercase font-medium">Final Fare</p>
                    <p className="text-xl font-bold text-green-700" data-testid="completed-ride-fare">
                      ${parseFloat(recentlyCompletedRide.actualFare || recentlyCompletedRide.estimatedFare || '0').toFixed(2)}
                    </p>
                  </div>
                  {recentlyCompletedRide.driver && (
                    <div className="text-center flex-1 border-l border-green-200">
                      <p className="text-[10px] text-gray-500 uppercase font-medium">Driver</p>
                      <p className="text-sm font-semibold">{recentlyCompletedRide.driver.firstName} {recentlyCompletedRide.driver.lastName?.[0]}.</p>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5 mb-3">
                  <div className="flex items-start gap-2">
                    <div className="w-2.5 h-2.5 bg-green-500 rounded-full mt-1.5 flex-shrink-0" />
                    <p className="text-xs text-gray-600 truncate">{recentlyCompletedRide.pickupLocation?.address}</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-2.5 h-2.5 bg-red-500 rounded-full mt-1.5 flex-shrink-0" />
                    <p className="text-xs text-gray-600 truncate">{recentlyCompletedRide.destinationLocation?.address}</p>
                  </div>
                </div>

                {!quickRatingSubmitted ? (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-center text-gray-700">How was your ride?</p>
                    <div className="flex justify-center gap-1" data-testid="quick-rating-stars">
                      {[1, 2, 3, 4, 5].map((starVal) => (
                        <button
                          key={starVal}
                          type="button"
                          onClick={() => setQuickRating(starVal)}
                          onMouseEnter={() => setQuickRatingHover(starVal)}
                          onMouseLeave={() => setQuickRatingHover(0)}
                          className="p-1 transition-transform hover:scale-110 active:scale-95"
                          data-testid={`quick-star-${starVal}`}
                        >
                          <Star className={`w-8 h-8 transition-colors ${
                            starVal <= (quickRatingHover || quickRating)
                              ? 'fill-yellow-400 text-yellow-400'
                              : 'text-gray-300'
                          }`} />
                        </button>
                      ))}
                    </div>
                    {quickRating > 0 && (
                      <p className="text-xs text-center text-gray-500">
                        {quickRating === 1 && "Poor"}
                        {quickRating === 2 && "Fair"}
                        {quickRating === 3 && "Good"}
                        {quickRating === 4 && "Very Good"}
                        {quickRating === 5 && "Excellent!"}
                      </p>
                    )}
                    <div className="flex gap-2 mt-2">
                      <Button
                        className="flex-1 bg-green-600 hover:bg-green-700"
                        onClick={() => {
                          if (quickRating > 0 && recentlyCompletedRide?.id) {
                            submitQuickRating.mutate({ rideId: recentlyCompletedRide.id, rating: quickRating });
                          }
                        }}
                        disabled={quickRating === 0 || submitQuickRating.isPending}
                        data-testid="btn-submit-quick-rating"
                      >
                        {submitQuickRating.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        ) : (
                          <ThumbsUp className="w-4 h-4 mr-2" />
                        )}
                        {quickRating > 0 ? `Rate ${quickRating} Star${quickRating > 1 ? 's' : ''}` : 'Tap a Star'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRecentlyCompletedRide(null);
                          setQuickRating(0);
                          setQuickRatingHover(0);
                        }}
                        className="text-gray-400 px-3"
                        data-testid="btn-dismiss-completed"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <button
                      onClick={() => {
                        setRecentlyCompletedRide(null);
                        setLocation('/ratings');
                      }}
                      className="text-xs text-blue-600 hover:underline text-center w-full mt-1"
                      data-testid="btn-rate-later"
                    >
                      Write a detailed review instead
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-3 animate-in fade-in duration-300">
                    <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-1" />
                    <p className="font-semibold text-green-700">Thanks for your rating!</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {activeRides.length > 0 && (
          <div className="px-4 pt-4 space-y-3">
            {activeRides.map((ride: any) => {
              const eta = getDriverETA(ride);
              const elapsedMin = ride.startedAt ? getElapsedTime(ride.startedAt) : 0;
              return (
              <Card key={ride.id} className="border-2 border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 shadow-md overflow-hidden" data-testid={`active-ride-card-${ride.id}`}>
                <CardContent className="p-4">
                  <div className="mb-4">
                    <RideProgressStepper status={ride.status} compact />
                  </div>

                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {ride.status === 'pending' && (
                        <div className="flex items-center gap-2">
                          <Loader2 className="w-5 h-5 text-orange-500 animate-spin" />
                          <span className="font-semibold text-orange-600" data-testid={`ride-status-${ride.id}`}>Finding your driver...</span>
                        </div>
                      )}
                      {ride.status === 'accepted' && (
                        <div className="flex items-center gap-2">
                          <Car className="w-5 h-5 text-blue-600 animate-bounce" />
                          <span className="font-semibold text-blue-600" data-testid={`ride-status-${ride.id}`}>Driver is on the way!</span>
                        </div>
                      )}
                      {ride.status === 'driver_arriving' && (
                        <div className="flex items-center gap-2">
                          <Navigation className="w-5 h-5 text-green-600" />
                          <span className="font-semibold text-green-600" data-testid={`ride-status-${ride.id}`}>Driver arriving!</span>
                        </div>
                      )}
                      {ride.status === 'in_progress' && (
                        <div className="flex items-center gap-2">
                          <Route className="w-5 h-5 text-purple-600" />
                          <span className="font-semibold text-purple-600" data-testid={`ride-status-${ride.id}`}>Ride in progress</span>
                        </div>
                      )}
                    </div>
                    <span className="text-sm font-bold text-blue-600" data-testid={`ride-fare-${ride.id}`}>
                      ${parseFloat(ride.estimatedFare || '0').toFixed(2)}
                    </span>
                  </div>

                  {(ride.status === 'accepted' || ride.status === 'driver_arriving') && eta && (
                    <div className="flex items-center gap-3 mb-3 p-2.5 bg-blue-100/70 dark:bg-blue-900/40 rounded-xl" data-testid={`ride-eta-${ride.id}`}>
                      <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                        <Timer className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-blue-800 dark:text-blue-200">
                          Arriving in ~{eta.minutes} min
                        </p>
                        <p className="text-xs text-blue-600 dark:text-blue-400">
                          {eta.miles.toFixed(1)} miles away
                        </p>
                      </div>
                    </div>
                  )}

                  {ride.status === 'in_progress' && (
                    <div className="grid grid-cols-3 gap-2 mb-3" data-testid={`ride-live-stats-${ride.id}`}>
                      <div className="bg-purple-100/60 dark:bg-purple-900/30 p-2.5 rounded-xl text-center">
                        <Clock className="w-4 h-4 text-purple-600 mx-auto mb-0.5" />
                        <p className="text-lg font-bold text-purple-700">{elapsedMin}</p>
                        <p className="text-[9px] text-gray-500 uppercase">Min</p>
                      </div>
                      <div className="bg-blue-100/60 dark:bg-blue-900/30 p-2.5 rounded-xl text-center">
                        {eta ? (
                          <>
                            <Navigation className="w-4 h-4 text-blue-600 mx-auto mb-0.5" />
                            <p className="text-lg font-bold text-blue-700">~{eta.minutes}</p>
                            <p className="text-[9px] text-gray-500 uppercase">Min Left</p>
                          </>
                        ) : (
                          <>
                            <Route className="w-4 h-4 text-blue-600 mx-auto mb-0.5" />
                            <p className="text-lg font-bold text-blue-700">--</p>
                            <p className="text-[9px] text-gray-500 uppercase">ETA</p>
                          </>
                        )}
                      </div>
                      <div className="bg-green-100/60 dark:bg-green-900/30 p-2.5 rounded-xl text-center">
                        <Banknote className="w-4 h-4 text-green-600 mx-auto mb-0.5" />
                        <p className="text-lg font-bold text-green-700">${parseFloat(ride.estimatedFare || '0').toFixed(0)}</p>
                        <p className="text-[9px] text-gray-500 uppercase">Est. Fare</p>
                      </div>
                    </div>
                  )}

                  {ride.driver && (
                    <div className="flex items-center gap-3 mb-3 p-3 bg-white dark:bg-gray-900 rounded-xl border" data-testid={`ride-driver-info-${ride.id}`}>
                      <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-lg flex-shrink-0">
                        {ride.driver.firstName?.[0]}{ride.driver.lastName?.[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{ride.driver.firstName} {ride.driver.lastName?.[0]}.</p>
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                          <span>{parseFloat(ride.driver.rating || '5').toFixed(1)}</span>
                        </div>
                        {ride.driver.vehicle && (
                          <p className="text-xs text-gray-500 truncate">{ride.driver.vehicle}</p>
                        )}
                        {ride.driver.licensePlate && (
                          <p className="text-xs font-semibold text-gray-700 mt-0.5">{ride.driver.licensePlate}</p>
                        )}
                      </div>
                      {ride.driver.phone && (
                        <a href={`tel:${ride.driver.phone}`} className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0" data-testid={`btn-call-driver-${ride.id}`}>
                          <Phone className="w-4 h-4 text-green-600" />
                        </a>
                      )}
                    </div>
                  )}

                  <div className="space-y-2 mb-3">
                    <div className="flex items-start gap-2">
                      <div className="w-2.5 h-2.5 bg-green-500 rounded-full mt-1.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-[10px] text-gray-400 uppercase font-medium">Pickup</p>
                        <p className="text-xs text-gray-700" data-testid={`ride-pickup-${ride.id}`}>{ride.pickupLocation?.address || 'Loading...'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="w-2.5 h-2.5 bg-red-500 rounded-full mt-1.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-[10px] text-gray-400 uppercase font-medium">Destination</p>
                        <p className="text-xs text-gray-700" data-testid={`ride-destination-${ride.id}`}>{ride.destinationLocation?.address || 'Loading...'}</p>
                      </div>
                    </div>
                  </div>

                  {ride.status === 'pending' && (
                    <div className="mb-3">
                      <div className="w-full bg-gray-200 rounded-full h-1 overflow-hidden">
                        <div className="bg-orange-400 h-1 rounded-full animate-pulse" style={{ width: '60%' }} />
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1 text-center">Searching for the best driver match...</p>
                    </div>
                  )}

                  {(ride.status === 'pending' || ride.status === 'accepted') && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => cancelRide.mutate(ride.id)}
                      disabled={cancelRide.isPending}
                      data-testid={`btn-cancel-ride-${ride.id}`}
                    >
                      {cancelRide.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <X className="w-3 h-3 mr-1" />}
                      Cancel Ride
                    </Button>
                  )}
                </CardContent>
              </Card>
              );
            })}
          </div>
        )}

        <div className="px-4 pt-4">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setIsBookingModalOpen(true)}
              className="flex items-center gap-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl p-4 shadow-md shadow-blue-600/20 transition-all active:scale-[0.98]"
              data-testid="button-book-ride"
            >
              <div className="w-11 h-11 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <Plus className="w-6 h-6 text-white" />
              </div>
              <div className="text-left">
                <p className="font-bold text-sm leading-tight">Book a Ride</p>
                <p className="text-[11px] text-blue-100 mt-0.5">Find a driver now</p>
              </div>
            </button>
            <button
              onClick={() => setIsScheduleModalOpen(true)}
              className="flex items-center gap-3 bg-white hover:bg-gray-50 text-gray-900 rounded-2xl p-4 shadow-sm border border-gray-200 transition-all active:scale-[0.98]"
              data-testid="button-schedule-ride"
            >
              <div className="w-11 h-11 bg-orange-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <Calendar className="w-6 h-6 text-orange-500" />
              </div>
              <div className="text-left">
                <p className="font-bold text-sm leading-tight">Schedule</p>
                <p className="text-[11px] text-gray-500 mt-0.5">Plan ahead</p>
              </div>
            </button>
          </div>
        </div>

        <div className="px-4 pt-5 pb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-gray-900">Available Drivers Nearby</h3>
            <span className="text-xs text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
              {drivers.length} available
            </span>
          </div>
          {isLoading ? (
            <div className="text-center py-10">
              <div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-gray-500">Finding nearby drivers...</p>
            </div>
          ) : drivers.length === 0 ? (
            <Card className="border border-gray-200 shadow-none bg-white">
              <CardContent className="py-10 text-center">
                <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <MapPin className="w-7 h-7 text-gray-400" />
                </div>
                <p className="font-semibold text-gray-700 mb-1">No drivers available</p>
                <p className="text-sm text-gray-500">Try again in a few minutes</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2.5">
              {drivers.slice(0, 5).map((driver) => (
                <button
                  key={driver.id}
                  onClick={() => setIsBookingModalOpen(true)}
                  className="w-full bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-3 hover:border-blue-200 hover:bg-blue-50/30 transition-all text-left active:scale-[0.99]"
                  data-testid={`driver-card-${driver.id}`}
                >
                  <img
                    src={driver.profileImage || "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=50&h=50&fit=crop&crop=face"}
                    alt={driver.name}
                    className="w-12 h-12 rounded-xl object-cover flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <h4 className="font-semibold text-gray-900 text-sm" data-testid={`driver-name-${driver.id}`}>
                        {driver.name}
                      </h4>
                      {driver.isVerifiedNeighbor && (
                        <Shield className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-1 mb-0.5">
                      <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                      <span className="text-xs font-medium text-gray-700" data-testid={`driver-rating-${driver.id}`}>
                        {driver.rating.toFixed(1)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 truncate" data-testid={`driver-vehicle-${driver.id}`}>
                      {driver.vehicle}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="flex items-center gap-1 text-gray-500 mb-1">
                      <Clock className="w-3 h-3" />
                      <span className="text-xs">{driver.estimatedTime}</span>
                    </div>
                    <p className="text-base font-bold text-blue-600" data-testid={`driver-fare-${driver.id}`}>
                      {driver.estimatedFare}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        {scheduledRides.length > 0 && (
          <div className="px-4 pb-4">
            <h3 className="font-bold text-gray-900 mb-3">Upcoming Scheduled Rides</h3>
            <div className="space-y-2.5">
              {scheduledRides.map((ride: any) => (
                <Card key={ride.id} className="border border-gray-200 shadow-none">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-7 h-7 bg-orange-50 rounded-lg flex items-center justify-center">
                            <Calendar className="w-4 h-4 text-orange-500" />
                          </div>
                          <span className="font-semibold text-sm text-gray-900" data-testid={`scheduled-ride-time-${ride.id}`}>
                            {new Date(ride.scheduledAt).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true
                            })}
                          </span>
                        </div>
                        <div className="space-y-1.5 ml-9">
                          <div className="flex items-start gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full mt-1.5 flex-shrink-0" />
                            <span className="text-xs text-gray-600" data-testid={`scheduled-ride-pickup-${ride.id}`}>
                              {ride.pickupLocation?.address || 'Pickup location'}
                            </span>
                          </div>
                          <div className="flex items-start gap-2">
                            <div className="w-2 h-2 bg-red-500 rounded-full mt-1.5 flex-shrink-0" />
                            <span className="text-xs text-gray-600" data-testid={`scheduled-ride-destination-${ride.id}`}>
                              {ride.destinationLocation?.address || 'Destination'}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 ml-9">
                          <span className="text-sm font-bold text-blue-600" data-testid={`scheduled-ride-fare-${ride.id}`}>
                            Est. ${parseFloat(ride.estimatedFare || '0').toFixed(2)}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => cancelRide.mutate(ride.id)}
                        disabled={cancelRide.isPending}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded-xl"
                        data-testid={`button-cancel-scheduled-${ride.id}`}
                      >
                        {cancelRide.isPending ? (
                          <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <X className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        <div className="h-24" />
      </main>

      <button
        onClick={() => { trackFeatureUsed("sos_activated"); setIsSOSModalOpen(true); }}
        className="fixed bottom-24 right-4 w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/30 flex items-center justify-center text-sm font-black z-40 transition-all active:scale-95"
        data-testid="button-sos"
      >
        SOS
      </button>

      <RideBookingModal
        isOpen={isBookingModalOpen}
        onClose={() => setIsBookingModalOpen(false)}
        drivers={drivers}
        userLocation={userLocation}
      />

      <ScheduleRideModal
        isOpen={isScheduleModalOpen}
        onClose={() => setIsScheduleModalOpen(false)}
        drivers={drivers}
        userLocation={userLocation}
      />

      <SOSModal
        isOpen={isSOSModalOpen}
        onClose={() => setIsSOSModalOpen(false)}
      />
    </>
  );
}
