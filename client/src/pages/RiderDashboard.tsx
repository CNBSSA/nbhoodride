import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useLocation } from "wouter";
import MapComponent from "@/components/MapComponent";
import ScheduleRideModal from "@/components/ScheduleRideModal";
import SOSModal from "@/components/SOSModal";
import { RideProgressStepper } from "@/components/RideProgressStepper";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAnalytics } from "@/hooks/useAnalytics";
import {
  MapPin, Navigation, Bell, Star, Clock, X, Shield, Car,
  Loader2, CheckCircle, Route, ThumbsUp, Search, Calendar, DollarSign, CalendarClock, UserCheck
} from "lucide-react";
import { format } from "date-fns";

interface Driver {
  id: string;
  userId: string;
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
  const total = Math.max(7.65, Math.min(100, 4.00 + 0.29 * durationMinutes + 0.90 * roadMiles));
  if (total <= 10) return `$${total.toFixed(2)}`;
  return `$${Math.max(7.65, Math.round(total - 1))}-${Math.min(100, Math.round(total + 1.5))}`;
}

function estimateArrival(miles: number): string {
  const minutes = Math.max(1, Math.round((miles * 1.3 / 25) * 60));
  if (minutes <= 1) return "~1 min";
  if (minutes <= 5) return `~${minutes} min`;
  return `${minutes - 2}-${minutes} min`;
}

type BookingPanel = "idle" | "search" | "drivers" | "confirm";

export default function RiderDashboard() {
  // ── Booking flow state ──
  const [panel, setPanel] = useState<BookingPanel>("idle");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");
  const [fareEstimate, setFareEstimate] = useState<any>(null);
  const [estimatedDistance, setEstimatedDistance] = useState<number | null>(null);
  const [estimatedDuration, setEstimatedDuration] = useState<number | null>(null);
  const [pickupInstructions, setPickupInstructions] = useState("");
  const [geocoding, setGeocoding] = useState(false);
  const [calculatingFare, setCalculatingFare] = useState(false);

  // ── UI state ──
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isSOSModalOpen, setIsSOSModalOpen] = useState(false);
  const [realtimeDrivers, setRealtimeDrivers] = useState<Record<string, { lat: number; lng: number }>>({});
  const [recentlyCompletedRide, setRecentlyCompletedRide] = useState<any>(null);
  const [quickRating, setQuickRating] = useState(0);
  const [quickRatingSubmitted, setQuickRatingSubmitted] = useState(false);

  const destinationInputRef = useRef<HTMLInputElement>(null);
  const lastProcessedMessageRef = useRef<string | null>(null);
  const activeRidesRef = useRef<any[]>([]);

  // ── Hooks ──
  const { user } = useAuth();
  const { location, error: locationError, requestLocation } = useGeolocation();
  const { lastMessage } = useWebSocket();
  const { toast } = useToast();
  const [, setWouterLocation] = useLocation();
  const { trackPageView, trackFeatureUsed, trackRideSearch, trackRideBooked } = useAnalytics();

  useEffect(() => { trackPageView("rider_dashboard"); }, [trackPageView]);

  // Listen for "I need a ride" tap from the ModeSelector while already in rider mode
  useEffect(() => {
    const handler = () => {
      setPanel("search");
      setTimeout(() => destinationInputRef.current?.focus(), 150);
    };
    window.addEventListener('pgride:open-booking', handler);
    return () => window.removeEventListener('pgride:open-booking', handler);
  }, []);

  const currentLat = location?.latitude ?? 38.9073;
  const currentLng = location?.longitude ?? -76.7781;

  // ── Data queries (all declared before any useEffects that reference their results) ──
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

  const { data: nearbyDrivers = [], isLoading: driversLoading } = useQuery<any[]>({
    queryKey: ['/api/rides/nearby-drivers', userLocation.lat, userLocation.lng],
    queryFn: async () => {
      const res = await fetch(`/api/rides/nearby-drivers?lat=${userLocation.lat}&lng=${userLocation.lng}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch nearby drivers');
      return res.json();
    },
    refetchInterval: panel === "idle" ? 30000 : false,
    placeholderData: (prev) => prev,
  });

  const { data: activeRides = [], refetch: refetchActiveRides } = useQuery<any[]>({
    queryKey: ['/api/rides/active'],
    refetchInterval: 5000,
  });
  activeRidesRef.current = activeRides;

  const { data: scheduledRides = [] } = useQuery<any[]>({
    queryKey: ['/api/rides/scheduled'],
    refetchInterval: 30000,
  });

  // ── Derived data ──
  const drivers: Driver[] = nearbyDrivers.map((driver: any) => {
    const realtimeLocation = realtimeDrivers[driver.id];
    const driverLocation = realtimeLocation || driver.currentLocation || { lat: currentLat, lng: currentLng };
    const distMiles = calculateDistance(userLocation.lat, userLocation.lng, driverLocation.lat, driverLocation.lng);
    return {
      id: driver.id,
      userId: driver.userId,
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

  // ── Geocode destination with debounce ──
  useEffect(() => {
    if (destinationAddress.length < 5) {
      setDestCoords(null);
      setFareEstimate(null);
      return;
    }
    const timer = setTimeout(async () => {
      setGeocoding(true);
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
          const dLat = (lat - userLocation.lat) * Math.PI / 180;
          const dLng = (lng - userLocation.lng) * Math.PI / 180;
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(userLocation.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
          const dist = Math.round(3959 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.3 * 10) / 10;
          const dur = Math.round((dist / 25) * 60);
          setEstimatedDistance(dist);
          setEstimatedDuration(dur);
          setPanel("drivers");
        } else {
          setDestCoords(null);
        }
      } catch {
        setDestCoords(null);
      } finally {
        setGeocoding(false);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [destinationAddress, userLocation.lat, userLocation.lng]);

  // ── Calculate fare when driver is selected ──
  useEffect(() => {
    if (!selectedDriverId || !estimatedDistance || !estimatedDuration) return;
    setCalculatingFare(true);
    // Build a client-side fallback fare so the rider can always confirm
    const roadMiles = estimatedDistance * 1.3;
    const baseFare = 4.00;
    const timeCharge = parseFloat((0.29 * estimatedDuration).toFixed(2));
    const distanceCharge = parseFloat((0.90 * roadMiles).toFixed(2));
    const total = parseFloat(Math.max(7.65, Math.min(100, baseFare + timeCharge + distanceCharge)).toFixed(2));
    const fallbackFare = { baseFare, timeCharge, distanceCharge, total };

    apiRequest('POST', '/api/rides/calculate-fare', {
      distance: estimatedDistance,
      duration: estimatedDuration,
      driverId: selectedDriverId,
    }).then(r => r.json()).then(data => {
      setFareEstimate(data);
    }).catch(() => {
      // Use client-side estimate if API fails — booking still proceeds
      setFareEstimate(fallbackFare);
    }).finally(() => {
      setCalculatingFare(false);
      setPanel("confirm");
    });
  }, [selectedDriverId, estimatedDistance, estimatedDuration]);

  // ── Mutations ──
  const bookRideMutation = useMutation({
    mutationFn: async (rideData: any) => {
      const response = await apiRequest('POST', '/api/rides', rideData);
      return response.json();
    },
    onSuccess: () => {
      trackRideBooked();
      toast({ title: "Ride Booked!", description: "Your driver is on the way." });
      queryClient.invalidateQueries({ queryKey: ["/api/rides"] });
      resetBooking();
    },
    onError: () => {
      toast({ title: "Booking Failed", description: "Unable to book your ride. Please try again.", variant: "destructive" });
    }
  });

  const cancelRide = useMutation({
    mutationFn: async (rideId: string) => {
      const response = await apiRequest('POST', `/api/rides/${rideId}/cancel`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/rides/active'] });
      toast({ title: "Ride Cancelled", description: "Your ride has been cancelled." });
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
      toast({ title: "Thanks for rating!", description: "Your feedback helps our community." });
      setTimeout(() => {
        setRecentlyCompletedRide(null);
        setQuickRating(0);
        setQuickRatingSubmitted(false);
      }, 2000);
    },
  });

  // ── Helpers ──
  const resetBooking = useCallback(() => {
    setPanel("idle");
    setDestinationAddress("");
    setDestCoords(null);
    setSelectedDriverId("");
    setFareEstimate(null);
    setEstimatedDistance(null);
    setEstimatedDuration(null);
    setPickupInstructions("");
    setGeocoding(false);
    setCalculatingFare(false);
  }, []);

  const handleConfirmRide = () => {
    if (!destinationAddress || !selectedDriverId) {
      toast({ title: "Missing Information", description: "Please enter a destination and select a driver.", variant: "destructive" });
      return;
    }
    if (!destCoords) {
      toast({ title: "Address Not Found", description: "We couldn't locate that destination. Try a more specific address.", variant: "destructive" });
      return;
    }
    bookRideMutation.mutate({
      pickupLocation: { lat: userLocation.lat, lng: userLocation.lng, address: userLocation.address },
      destinationLocation: { lat: destCoords.lat, lng: destCoords.lng, address: destinationAddress },
      pickupInstructions,
      driverId: selectedDriverId,
      estimatedFare: fareEstimate?.total || 0,
      paymentMethod: 'card',
    });
  };

  const getDriverETA = (ride: any): number | null => {
    const driverId = ride.driverId || ride.driver?.id;
    const driverLoc = driverId ? realtimeDrivers[driverId] : null;
    if (!driverLoc) return null;
    const target = ride.status === 'in_progress' ? ride.destinationLocation : ride.pickupLocation;
    if (!target?.lat || !target?.lng) return null;
    const dist = calculateDistance(driverLoc.lat, driverLoc.lng, target.lat, target.lng);
    return Math.max(1, Math.round((dist * 1.3 / 25) * 60));
  };

  // ── WebSocket messages ──
  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type !== 'driver_location' && lastProcessedMessageRef.current === `${lastMessage.type}-${lastMessage.rideId}`) return;
    if (lastMessage.type !== 'driver_location') lastProcessedMessageRef.current = `${lastMessage.type}-${lastMessage.rideId}`;

    if (lastMessage.type === 'driver_location') {
      setRealtimeDrivers(prev => ({ ...prev, [lastMessage.driverId]: lastMessage.location }));
    } else if (lastMessage.type === 'ride_accepted') {
      refetchActiveRides();
      toast({ title: "Driver Accepted!", description: lastMessage.driverName ? `${lastMessage.driverName} is on the way!` : "Your driver is on the way!" });
      navigator.vibrate?.([200, 100, 200]);
    } else if (lastMessage.type === 'ride_started') {
      refetchActiveRides();
      toast({ title: "Ride Started", description: "You're on your way!" });
    } else if (lastMessage.type === 'ride_completed') {
      const completedRide = activeRidesRef.current.find((r: any) => r.id === lastMessage.rideId);
      setRecentlyCompletedRide(completedRide
        ? { ...completedRide, actualFare: lastMessage.actualFare || completedRide.actualFare }
        : { id: lastMessage.rideId, actualFare: lastMessage.actualFare });
      refetchActiveRides();
      queryClient.invalidateQueries({ queryKey: ['/api/virtual-card/balance'] });
      toast({ title: "Ride Complete!", description: `Final fare: $${parseFloat(lastMessage.actualFare || '0').toFixed(2)}. Please rate your driver!` });
      navigator.vibrate?.([200]);
    } else if (lastMessage.type === 'ride_cancelled') {
      refetchActiveRides();
      toast({ title: "Ride Cancelled", description: "Your ride has been cancelled.", variant: "destructive" });
    } else if (lastMessage.type === 'ride_update') {
      refetchActiveRides();
    } else if (lastMessage.type === 'scheduled_ride_claimed') {
      queryClient.invalidateQueries({ queryKey: ['/api/rides/scheduled'] });
      toast({
        title: "Ride Claimed!",
        description: `${lastMessage.driverName || 'A driver'} has claimed your scheduled ride. You're all set!`,
      });
      navigator.vibrate?.([200, 100, 200]);
    } else if (lastMessage.type === 'ride_reminder') {
      queryClient.invalidateQueries({ queryKey: ['/api/rides/scheduled'] });
      toast({
        title: "Ride Reminder",
        description: lastMessage.message || "Your scheduled ride is in 30 minutes.",
      });
      navigator.vibrate?.([300, 100, 300]);
    }
  }, [lastMessage, refetchActiveRides, toast]);

  // ── Derived UI values ──
  const activeRide = activeRides[0] || null;
  const panelHeight = panel === "idle" ? "h-auto"
    : panel === "drivers" ? "h-[65vh]"
    : "h-[70vh]";

  // ── Render ──
  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden bg-gray-100">

      {/* Full-screen map background */}
      <div className="absolute inset-0 z-0" style={{ bottom: panel === "idle" ? "140px" : "0" }}>
        <MapComponent
          center={{ lat: currentLat, lng: currentLng }}
          drivers={drivers}
          userLocation={userLocation}
          height="100%"
        />
      </div>

      {/* Top header */}
      <div className="relative z-20 flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 bg-white/90 backdrop-blur-sm rounded-2xl px-3 py-2 shadow-sm">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <MapPin className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-[10px] text-gray-500 font-medium leading-none">Your location</p>
            <p className="text-xs font-semibold text-gray-900 leading-tight max-w-[180px] truncate">
              {locationError ? "Location unavailable" : userLocation.address}
            </p>
          </div>
          <button onClick={requestLocation} className="ml-1 text-blue-600" data-testid="button-refresh-location">
            <Navigation className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button className="w-9 h-9 bg-white/90 backdrop-blur-sm rounded-full shadow-sm flex items-center justify-center" data-testid="button-notifications">
            <Bell className="w-4 h-4 text-gray-600" />
          </button>
          <div className="w-9 h-9 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm">
            {user?.firstName?.[0] || 'U'}{user?.lastName?.[0] || ''}
          </div>
        </div>
      </div>

      {/* Active ride overlay */}
      {activeRide && (
        <div className="relative z-20 mx-4 mt-2">
          <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-lg p-3 border border-blue-100">
            <RideProgressStepper status={activeRide.status} compact />
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-2">
                {activeRide.status === 'pending' && <><Loader2 className="w-4 h-4 text-orange-500 animate-spin" /><span className="text-sm font-semibold text-orange-600">Finding your driver...</span></>}
                {activeRide.status === 'accepted' && <><Car className="w-4 h-4 text-blue-600" /><span className="text-sm font-semibold text-blue-600">Driver is on the way!</span></>}
                {activeRide.status === 'driver_arriving' && <><Navigation className="w-4 h-4 text-green-600" /><span className="text-sm font-semibold text-green-600">Driver arriving!</span></>}
                {activeRide.status === 'in_progress' && <><Route className="w-4 h-4 text-purple-600" /><span className="text-sm font-semibold text-purple-600">Ride in progress</span></>}
              </div>
              <div className="flex items-center gap-2">
                {getDriverETA(activeRide) !== null && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                    ~{getDriverETA(activeRide)} min
                  </span>
                )}
                <span className="text-sm font-bold text-gray-900">${parseFloat(activeRide.estimatedFare || '0').toFixed(2)}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
              <div className="w-2 h-2 bg-red-500 rounded-full flex-shrink-0" />
              <span className="truncate">{activeRide.destinationLocation?.address || 'En route...'}</span>
            </div>
            {(activeRide.status === 'pending' || activeRide.status === 'accepted') && (
              <button
                onClick={() => cancelRide.mutate(activeRide.id)}
                disabled={cancelRide.isPending}
                className="mt-2 w-full text-xs text-red-500 border border-red-200 rounded-xl py-1.5 hover:bg-red-50 transition-colors"
                data-testid={`btn-cancel-ride-${activeRide.id}`}
              >
                {cancelRide.isPending ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : <X className="w-3 h-3 inline mr-1" />}
                Cancel Ride
              </button>
            )}
          </div>
        </div>
      )}

      {/* Completed ride / rating card */}
      {recentlyCompletedRide && (
        <div className="relative z-20 mx-4 mt-2">
          <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-lg p-4 border-2 border-green-200">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <span className="font-bold text-green-700">You've Arrived!</span>
              <span className="ml-auto font-bold text-lg text-green-700">
                ${parseFloat(recentlyCompletedRide.actualFare || recentlyCompletedRide.estimatedFare || '0').toFixed(2)}
              </span>
            </div>
            {!quickRatingSubmitted ? (
              <>
                <p className="text-xs text-gray-500 mb-2 text-center">How was your ride?</p>
                <div className="flex justify-center gap-1 mb-2">
                  {[1, 2, 3, 4, 5].map(v => (
                    <button key={v} onClick={() => setQuickRating(v)} className="p-0.5" data-testid={`quick-star-${v}`}>
                      <Star className={`w-7 h-7 ${v <= quickRating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} />
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    className="flex-1 bg-green-600 hover:bg-green-700 h-9 text-sm"
                    disabled={quickRating === 0 || submitQuickRating.isPending}
                    onClick={() => recentlyCompletedRide?.id && submitQuickRating.mutate({ rideId: recentlyCompletedRide.id, rating: quickRating })}
                    data-testid="btn-submit-quick-rating"
                  >
                    {submitQuickRating.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><ThumbsUp className="w-3 h-3 mr-1" />{quickRating > 0 ? `Rate ${quickRating}★` : 'Tap a Star'}</>}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setRecentlyCompletedRide(null); setQuickRating(0); }} className="px-3" data-testid="btn-dismiss-completed">
                    <X className="w-4 h-4 text-gray-400" />
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-center py-2 text-green-700 font-semibold text-sm">Thanks for your rating!</div>
            )}
          </div>
        </div>
      )}

      {/* SOS button — only in idle mode */}
      {panel === "idle" && (
        <button
          onClick={() => { trackFeatureUsed("sos_activated"); setIsSOSModalOpen(true); }}
          className="absolute right-4 z-[56] w-12 h-12 rounded-full bg-red-600 text-white shadow-lg shadow-red-600/40 flex items-center justify-center text-xs font-black transition-all active:scale-95"
          style={{ bottom: 'calc(192px + env(safe-area-inset-bottom, 0px))' }}
          data-testid="button-sos"
        >
          SOS
        </button>
      )}

      {/* ── FULL-SCREEN SEARCH OVERLAY (keyboard-safe: input at top, keyboard opens below) ── */}
      {panel === "search" && (
        <div className="absolute inset-0 z-[60] bg-white flex flex-col">
          {/* Input row — pinned to top so keyboard never covers it */}
          <div className="flex items-center gap-2 px-3 pt-4 pb-3 border-b border-gray-100 flex-shrink-0">
            <button
              onClick={resetBooking}
              className="w-11 h-11 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 active:bg-gray-200"
              data-testid="button-close-booking"
            >
              <X className="w-5 h-5 text-gray-700" />
            </button>
            <div className="flex-1 relative">
              <Input
                ref={destinationInputRef}
                value={destinationAddress}
                onChange={e => {
                  setDestinationAddress(e.target.value);
                  setSelectedDriverId("");
                  setFareEstimate(null);
                  setDestCoords(null);
                }}
                placeholder="Where are you going?"
                className="h-12 rounded-2xl pr-9 font-medium border-gray-200 focus:border-blue-400"
                autoFocus
                data-testid="input-destination"
              />
              {geocoding && <Loader2 className="w-4 h-4 text-blue-500 animate-spin absolute right-3 top-4" />}
              {destinationAddress && !geocoding && (
                <button
                  onClick={() => { setDestinationAddress(""); setDestCoords(null); setFareEstimate(null); }}
                  className="absolute right-3 top-3.5"
                >
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              )}
            </div>
          </div>

          {/* Pickup row */}
          <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border-b border-green-100 flex-shrink-0">
            <div className="w-3 h-3 bg-green-500 rounded-full flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-green-700 uppercase tracking-wider leading-none mb-0.5">Pickup</p>
              <p className="text-sm text-gray-700 truncate">{userLocation.address}</p>
            </div>
          </div>

          {/* Results — shows above the keyboard since input is at top */}
          <div className="flex-1 overflow-y-auto px-4 py-6">
            {!destinationAddress && (
              <div className="text-center">
                <Search className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                <p className="text-base font-medium text-gray-400 mb-1">Where are you going?</p>
                <p className="text-sm text-gray-300">Type any address in PG County, MD</p>
              </div>
            )}
            {destinationAddress.length > 0 && destinationAddress.length < 5 && (
              <p className="text-center text-gray-400 text-sm">Keep typing...</p>
            )}
            {destinationAddress.length >= 5 && geocoding && (
              <div className="text-center">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
                <p className="text-sm text-gray-400">Finding your destination...</p>
              </div>
            )}
            {destinationAddress.length >= 5 && !geocoding && !destCoords && (
              <div className="text-center">
                <MapPin className="w-8 h-8 text-red-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-red-400 mb-1">Address not found</p>
                <p className="text-xs text-gray-400">Try a more specific address in PG County, MD</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── BOTTOM SHEET: idle / drivers / confirm ── */}
      {panel !== "search" && (
      <div
        className={`absolute left-0 right-0 z-[55] bg-white rounded-t-3xl shadow-2xl transition-all duration-300 ease-in-out flex flex-col ${
          panel === "idle" ? "h-auto" : panel === "drivers" ? "h-[65vh]" : "h-[70vh]"
        }`}
        style={{
          bottom: panel === "idle" ? "calc(64px + env(safe-area-inset-bottom, 0px))" : "0",
          maxHeight: panel === "idle" ? "160px" : "80vh",
        }}
      >
        {/* Drag handle */}
        <div
          className="flex justify-center pt-3 pb-1 flex-shrink-0 cursor-pointer"
          onClick={() => panel !== "idle" && resetBooking()}
        >
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>

        {/* ── IDLE: "Where to?" bar ── */}
        {panel === "idle" && (
          <div className="px-4 pb-5 pt-1 flex-shrink-0">
            <button
              className="w-full flex items-center gap-3 bg-gray-100 active:bg-gray-200 transition-colors rounded-2xl px-4 py-4 text-left"
              onClick={() => {
                trackRideSearch();
                setPanel("search");
                setTimeout(() => destinationInputRef.current?.focus(), 100);
              }}
              data-testid="button-book-ride"
            >
              <Search className="w-5 h-5 text-gray-400 flex-shrink-0" />
              <span className="text-gray-500 text-base font-medium">Where to?</span>
            </button>
            <div className="flex gap-3 mt-3">
              <button
                onClick={() => setIsScheduleModalOpen(true)}
                className="flex-1 flex items-center gap-2 justify-center bg-orange-50 text-orange-600 rounded-xl py-3 text-sm font-semibold active:bg-orange-100 transition-colors"
                data-testid="button-schedule-ride"
              >
                <Calendar className="w-4 h-4" />
                Schedule
              </button>
              {drivers.length > 0 && (
                <div className="flex-1 flex items-center gap-2 justify-center bg-blue-50 text-blue-600 rounded-xl py-3 text-sm font-semibold">
                  <Car className="w-4 h-4" />
                  {drivers.length} nearby
                </div>
              )}
            </div>

            {/* Upcoming scheduled rides */}
            {scheduledRides.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
                  <CalendarClock className="w-3.5 h-3.5" /> Upcoming Scheduled Rides
                </p>
                {scheduledRides.map((ride: any) => (
                  <div
                    key={ride.id}
                    className="flex items-start justify-between bg-orange-50 rounded-xl p-3 border border-orange-100"
                    data-testid={`scheduled-ride-${ride.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-orange-700">
                        {ride.scheduledAt ? format(new Date(ride.scheduledAt), "EEE, MMM d 'at' h:mm a") : ''}
                      </p>
                      <p className="text-xs text-gray-600 truncate mt-0.5">
                        → {ride.destinationLocation?.address || 'Destination'}
                      </p>
                      <div className="mt-1 flex items-center gap-1">
                        {ride.driver?.firstName ? (
                          <span className="text-xs text-green-700 font-semibold flex items-center gap-1">
                            <UserCheck className="w-3 h-3" />
                            {ride.driver.firstName} {ride.driver.lastName?.[0] || ''}.
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 italic">Waiting for a driver to claim…</span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs font-bold text-gray-700 ml-2 shrink-0">
                      ${parseFloat(ride.estimatedFare || '0').toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── DRIVERS / CONFIRM ── */}
        {(panel === "drivers" || panel === "confirm") && (
          <>
            {/* Destination display with Change button (no keyboard triggered) */}
            <div className="flex items-center gap-3 px-4 pt-1 pb-3 border-b border-gray-100 flex-shrink-0">
              <button
                onClick={resetBooking}
                className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 active:bg-gray-200"
                data-testid="button-close-booking"
              >
                <X className="w-4 h-4 text-gray-600" />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide leading-none mb-0.5">Destination</p>
                <p className="text-sm font-semibold text-gray-900 truncate">{destinationAddress}</p>
              </div>
              <button
                onClick={() => setPanel("search")}
                className="text-xs text-blue-600 font-semibold bg-blue-50 px-3 py-1.5 rounded-full flex-shrink-0 active:bg-blue-100"
              >
                Change
              </button>
            </div>

            {/* Pickup row */}
            <div className="flex items-center gap-2 px-4 py-2 bg-green-50 flex-shrink-0">
              <div className="w-2.5 h-2.5 bg-green-500 rounded-full flex-shrink-0" />
              <p className="text-xs text-gray-600 truncate">{userLocation.address}</p>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-4 pb-2">

              {/* Pickup instructions */}
              <div className="mt-3">
                <Input
                  placeholder="Pickup instructions (optional)"
                  value={pickupInstructions}
                  onChange={e => setPickupInstructions(e.target.value)}
                  className="h-9 text-xs rounded-xl border-gray-200"
                  data-testid="input-pickup-instructions"
                />
              </div>

              {/* Driver list */}
              {(panel === "drivers" || panel === "confirm") && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-gray-800">Choose your driver</p>
                    <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{drivers.length} nearby</span>
                  </div>
                  {driversLoading ? (
                    <div className="text-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-blue-500 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">Finding drivers...</p>
                    </div>
                  ) : drivers.length === 0 ? (
                    <div className="text-center py-8">
                      <Car className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm font-medium text-gray-500">No drivers nearby right now</p>
                      <p className="text-xs text-gray-400 mt-1">Try again in a moment</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {drivers.map(driver => (
                        <button
                          key={driver.id}
                          onClick={() => setSelectedDriverId(driver.userId)}
                          className={`w-full flex items-center gap-3 p-3 rounded-2xl border-2 transition-all text-left ${
                            selectedDriverId === driver.userId
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-transparent bg-gray-50 hover:border-gray-200'
                          }`}
                          data-testid={`driver-option-${driver.id}`}
                        >
                          <div className={`w-11 h-11 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${
                            selectedDriverId === driver.userId ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
                          }`}>
                            {driver.name.split(' ').map((n: string) => n[0]).join('')}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1">
                              <span className="font-semibold text-sm">{driver.name}</span>
                              {driver.isVerifiedNeighbor && <Shield className="w-3.5 h-3.5 text-green-500" />}
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-gray-500">
                              <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                              <span>{driver.rating.toFixed(1)}</span>
                              <span className="text-gray-300">·</span>
                              <Clock className="w-3 h-3" />
                              <span>{driver.estimatedTime}</span>
                            </div>
                            <p className="text-xs text-gray-400 truncate">{driver.vehicle}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="font-bold text-sm text-blue-600">{driver.estimatedFare}</p>
                            {selectedDriverId === driver.userId && <CheckCircle className="w-4 h-4 text-blue-500 ml-auto mt-0.5" />}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Fare breakdown */}
              {panel === "confirm" && fareEstimate && (
                <div className="mt-3 bg-green-50 border border-green-200 rounded-2xl p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <DollarSign className="w-4 h-4 text-green-600" />
                    <span className="text-sm font-semibold text-gray-700">Fare Breakdown</span>
                    <span className="ml-auto text-xs text-gray-400 flex items-center gap-1">
                      <Shield className="w-3 h-3" /> No surge
                    </span>
                  </div>
                  <div className="space-y-1 text-xs text-gray-600">
                    <div className="flex justify-between"><span>Base fare</span><span className="font-medium">${fareEstimate.baseFare?.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span>Time ({estimatedDuration} min)</span><span className="font-medium">${fareEstimate.timeCharge?.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span>Distance ({estimatedDistance} mi)</span><span className="font-medium">${fareEstimate.distanceCharge?.toFixed(2)}</span></div>
                    <div className="flex justify-between font-bold text-sm text-gray-800 pt-1 border-t border-green-200 mt-1">
                      <span>Total</span>
                      <span className="text-green-700" data-testid="text-total-fare">${fareEstimate.total?.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )}

              {calculatingFare && (
                <div className="flex items-center gap-2 justify-center mt-3 text-blue-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Getting exact fare...</span>
                </div>
              )}
            </div>

            {/* Sticky confirm button */}
            {(panel === "drivers" || panel === "confirm") && (
              <div
                className="px-4 pt-2 border-t border-gray-100 bg-white flex-shrink-0"
                style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom, 1.5rem))' }}
              >
                {fareEstimate && selectedDriverId && (
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-2 px-1">
                    <span>Via Virtual PG Card</span>
                    <span className="font-bold text-sm text-gray-800">${fareEstimate.total?.toFixed(2)}</span>
                  </div>
                )}
                <Button
                  onClick={handleConfirmRide}
                  disabled={!selectedDriverId || !destinationAddress || bookRideMutation.isPending || calculatingFare}
                  className="w-full h-14 text-base font-bold rounded-2xl shadow-lg shadow-blue-600/25"
                  data-testid="button-confirm-booking"
                >
                  {bookRideMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" />Booking...</>
                  ) : calculatingFare ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" />Calculating fare...</>
                  ) : fareEstimate && selectedDriverId ? (
                    `Confirm Ride — $${fareEstimate.total?.toFixed(2)}`
                  ) : selectedDriverId ? (
                    "Confirm Booking"
                  ) : (
                    "Select a Driver"
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      )}

      {/* Modals */}
      <ScheduleRideModal isOpen={isScheduleModalOpen} onClose={() => setIsScheduleModalOpen(false)} drivers={drivers} userLocation={userLocation} />
      <SOSModal isOpen={isSOSModalOpen} onClose={() => setIsSOSModalOpen(false)} />
    </div>
  );
}
