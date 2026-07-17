import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useLocation } from "wouter";
import MapComponent from "@/components/MapComponent";
import { useGeocodeSuggest, type AddressSuggestion } from "@/hooks/useGeocode";
import ScheduleRideModal from "@/components/ScheduleRideModal";
import MultiStopBookingSheet from "@/components/MultiStopBookingSheet";
import SharedScheduleSheet from "@/components/SharedScheduleSheet";
import JoinScheduleModal from "@/components/JoinScheduleModal";
import CircuitsTimetableSheet from "@/components/CircuitsTimetableSheet";
import SOSModal from "@/components/SOSModal";
import LostFoundModal from "@/components/LostFoundModal";
import { RideProgressStepper } from "@/components/RideProgressStepper";
import { NotificationBell } from "@/components/NotificationBell";
import { RideChat } from "@/components/RideChat";
import type { RideMessagePayload } from "@shared/rideChat";
import { parseRideMessageWsEvent } from "@shared/rideChat";
import { MobilityIntentCard, type IntentResolution } from "@/components/MobilityIntentCard";
import { TransitAlertsCard } from "@/components/TransitAlertsCard";
import { RideForFriendFields } from "@/components/RideForFriendFields";
import { VehicleTypePicker } from "@/components/VehicleTypePicker";
import { CommunityRoutesCard } from "@/components/CommunityRoutesCard";
import { ExplainableMatchCard } from "@/components/ExplainableMatchCard";
import type { VehicleType } from "@shared/vehicleTypes";
import { VEHICLE_TYPE_LABELS } from "@shared/vehicleTypes";
import { RideSurface } from "@/genui/RideSurface";
import type { RideSurfaceSpec } from "@shared/genui/schema";
import { rankDriversByTrustAndEta } from "@shared/trustScore";
import { updateRideWidget, clearRideWidget } from "@/hooks/useRideWidget";
import { useLocale } from "@/hooks/useLocale";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAnalytics } from "@/hooks/useAnalytics";
import {
  MapPin, Navigation, Star, Clock, X, Shield, Car,
  Loader2, CheckCircle, Route, ThumbsUp, Search, Calendar, DollarSign, CalendarClock, UserCheck, Users, AlertTriangle, Bus
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
  distanceMiles: number;
  trust?: {
    trustScore: number;
    matchReason: string;
    isFavorite?: boolean;
    separationDegrees?: number;
  };
  proTier?: "community" | "pro" | "elite";
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
  const [rideForFriend, setRideForFriend] = useState(false);
  const [passengerName, setPassengerName] = useState("");
  const [passengerPhone, setPassengerPhone] = useState("");
  const [requestedVehicleType, setRequestedVehicleType] = useState<VehicleType>("standard");
  const [calculatingFare, setCalculatingFare] = useState(false);

  // ── UI state ──
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isMultiStopOpen, setIsMultiStopOpen] = useState(false);
  const [isSharedScheduleOpen, setIsSharedScheduleOpen] = useState(false);
  const [isJoinScheduleOpen, setIsJoinScheduleOpen] = useState(false);
  const [isCircuitsOpen, setIsCircuitsOpen] = useState(false);
  const [isSOSModalOpen, setIsSOSModalOpen] = useState(false);
  const [isLostFoundOpen, setIsLostFoundOpen] = useState(false);
  const [incomingRideMessage, setIncomingRideMessage] = useState<RideMessagePayload | null>(null);
  const [realtimeDrivers, setRealtimeDrivers] = useState<Record<string, { lat: number; lng: number }>>({});
  const [recentlyCompletedRide, setRecentlyCompletedRide] = useState<any>(null);
  const [quickRating, setQuickRating] = useState(0);
  const [quickRatingSubmitted, setQuickRatingSubmitted] = useState(false);
  // Tracks urgency state per scheduled ride: 'at_risk' | 'no_driver' | 'driver_dropped'
  const [rideUrgency, setRideUrgency] = useState<Record<string, 'at_risk' | 'no_driver' | 'driver_dropped'>>({});

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
    address: geocodeData?.address || (location ? "Getting address..." : "Maryland, MD"),
  };

  const { data: nearbyDrivers = [], isLoading: driversLoading } = useQuery<any[]>({
    queryKey: ['/api/rides/nearby-drivers', userLocation.lat, userLocation.lng, requestedVehicleType],
    queryFn: async () => {
      const vtParam = requestedVehicleType !== "standard" ? `&vehicleType=${requestedVehicleType}` : "";
      const res = await fetch(
        `/api/rides/nearby-drivers?lat=${userLocation.lat}&lng=${userLocation.lng}${vtParam}`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to fetch nearby drivers');
      return res.json();
    },
    refetchInterval: panel === "idle" ? 30000 : false,
    placeholderData: (prev) => prev,
  });

  const { data: favoriteDrivers = { driverIds: [] as string[] } } = useQuery<{ driverIds: string[] }>({
    queryKey: ['/api/trust/favorites'],
    enabled: panel === "drivers" || panel === "confirm",
  });

  const toggleFavoriteMutation = useMutation({
    mutationFn: async ({ driverId, isFavorite }: { driverId: string; isFavorite: boolean }) => {
      const method = isFavorite ? "DELETE" : "POST";
      await apiRequest(method, `/api/trust/favorites/${driverId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/trust/favorites'] });
      queryClient.invalidateQueries({ queryKey: ['/api/rides/nearby-drivers'] });
    },
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

  const { data: sharedGroup } = useQuery<any>({
    queryKey: ['/api/shared-rides/my-group'],
    refetchInterval: 10000,
    enabled: !!activeRides[0],
  });

  // ── Derived data ──
  const drivers: Driver[] = rankDriversByTrustAndEta(
    nearbyDrivers.map((driver: any) => {
      const realtimeLocation = realtimeDrivers[driver.id];
      const driverLocation = realtimeLocation || driver.currentLocation || { lat: currentLat, lng: currentLng };
      const distMiles = calculateDistance(userLocation.lat, userLocation.lng, driverLocation.lat, driverLocation.lng);
      return {
        id: driver.id,
        userId: driver.userId,
        name: `${driver.user.firstName} ${driver.user.lastName?.[0] || ''}.`,
        location: driverLocation,
        rating: parseFloat(driver.user.rating) || 5.0,
        vehicle: driver.vehicles[0]
          ? `${driver.vehicles[0].year} ${driver.vehicles[0].make} ${driver.vehicles[0].model}${driver.vehicles[0].isEv ? " ⚡" : ""}${driver.vehicles[0].vehicleType && driver.vehicles[0].vehicleType !== "standard" ? ` · ${VEHICLE_TYPE_LABELS[driver.vehicles[0].vehicleType as VehicleType] ?? driver.vehicles[0].vehicleType}` : ""}`
          : "Vehicle",
        estimatedFare: estimateFare(distMiles),
        estimatedTime: estimateArrival(distMiles),
        isVerifiedNeighbor: driver.isVerifiedNeighbor,
        profileImage: driver.user.profileImageUrl,
        distanceMiles: distMiles,
        isOnline: driver.isOnline ?? true,
        trustScore: driver.trust?.trustScore ?? 0,
        trust: driver.trust,
        proTier: driver.proTier,
      };
    }),
  ).map(({ isOnline: _o, trustScore: _t, ...driver }) => driver);

  // ── Address autocomplete ──
  // Live suggestions as the rider types (server-proxied geocode). The rider
  // PICKS a suggestion via handlePickDestination — we no longer auto-book a
  // single unseen limit=1 guess. `suggestLoading` drives the input spinner.
  const { suggestions: addressSuggestions, loading: suggestLoading } = useGeocodeSuggest(
    destinationAddress,
    { enabled: panel === "search" && !destCoords },
  );

  const handlePickDestination = useCallback((s: AddressSuggestion) => {
    setDestinationAddress(s.label);
    setDestCoords({ lat: s.lat, lng: s.lng });
    setSelectedDriverId("");
    setFareEstimate(null);
    const dLat = (s.lat - userLocation.lat) * Math.PI / 180;
    const dLng = (s.lng - userLocation.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(userLocation.lat * Math.PI / 180) * Math.cos(s.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    const dist = Math.round(3959 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.3 * 10) / 10;
    const dur = Math.round((dist / 25) * 60);
    setEstimatedDistance(dist);
    setEstimatedDuration(dur);
    setPanel("drivers");
  }, [userLocation.lat, userLocation.lng]);

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

  const handleMobilityIntent = useCallback((result: IntentResolution) => {
    if (result.parsed.intentType === "book_ride" && !result.destinationAddress) {
      setPanel("search");
      setTimeout(() => destinationInputRef.current?.focus(), 100);
      return;
    }
    if (result.destinationAddress) {
      setDestinationAddress(result.destinationAddress);
      if (result.destination) {
        setDestCoords({ lat: result.destination.lat, lng: result.destination.lng });
      }
      trackRideSearch();
      setPanel("search");
      if (result.autonomyLevel >= 2 && drivers.length > 0) {
        setSelectedDriverId(drivers[0]!.userId);
        setPanel("drivers");
      }
    }
  }, [drivers, trackRideSearch]);

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
    setRideForFriend(false);
    setPassengerName("");
    setPassengerPhone("");
    setRequestedVehicleType("standard");
    setCalculatingFare(false);
  }, []);

  const handleConfirmRide = () => {
    if (!destinationAddress || !selectedDriverId) {
      toast({ title: "Missing Information", description: "Please enter a destination and select a driver.", variant: "destructive" });
      return;
    }
    if (!destCoords) {
      // The rider typed an address but never tapped a suggestion. Resolve it
      // server-side (same geocoder that powers the dropdown) instead of
      // punting the problem back to them.
      apiRequest("GET", `/api/geocode/suggest?q=${encodeURIComponent(destinationAddress)}&limit=1`)
        .then((r) => r.json())
        .then(({ suggestions }: { suggestions: Array<{ label: string; lat: number; lng: number }> }) => {
          const top = suggestions?.[0];
          if (!top) {
            toast({ title: "Address Not Found", description: "We couldn't locate that destination. Try a more specific address.", variant: "destructive" });
            return;
          }
          // Apply the resolved address; fare re-estimates from the new
          // distance, so ask for one confirming tap rather than booking
          // against a stale/absent fare.
          setDestinationAddress(top.label);
          setDestCoords({ lat: top.lat, lng: top.lng });
          const dLat = (top.lat - userLocation.lat) * Math.PI / 180;
          const dLng = (top.lng - userLocation.lng) * Math.PI / 180;
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(userLocation.lat * Math.PI / 180) * Math.cos(top.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
          const dist = Math.round(3959 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.3 * 10) / 10;
          setEstimatedDistance(dist);
          setEstimatedDuration(Math.round((dist / 25) * 60));
          toast({ title: "Address confirmed", description: `Going to ${top.label}. Tap Book again to confirm your ride.` });
        })
        .catch(() => {
          toast({ title: "Address Not Found", description: "We couldn't locate that destination. Try a more specific address.", variant: "destructive" });
        });
      return;
    }
    if (rideForFriend && passengerName.trim().length < 2) {
      toast({ title: "Passenger name required", description: "Enter who will be riding.", variant: "destructive" });
      return;
    }
    bookRideMutation.mutate({
      pickupLocation: { lat: userLocation.lat, lng: userLocation.lng, address: userLocation.address },
      destinationLocation: { lat: destCoords.lat, lng: destCoords.lng, address: destinationAddress },
      pickupInstructions,
      driverId: selectedDriverId,
      estimatedFare: fareEstimate?.total || 0,
      paymentMethod: 'card',
      bookedForFriend: rideForFriend,
      passengerName: rideForFriend ? passengerName.trim() : undefined,
      passengerPhone: rideForFriend && passengerPhone.trim() ? passengerPhone.trim() : undefined,
      requestedVehicleType: requestedVehicleType !== "standard" ? requestedVehicleType : undefined,
    });
  };

  const handleCommunityRouteSelect = useCallback((route: {
    destinationLocation: { lat: number; lng: number; address: string };
    name: string;
  }) => {
    const lat = route.destinationLocation.lat;
    const lng = route.destinationLocation.lng;
    setDestinationAddress(route.destinationLocation.address || route.name);
    setDestCoords({ lat, lng });
    const dLat = (lat - userLocation.lat) * Math.PI / 180;
    const dLng = (lng - userLocation.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(userLocation.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    const dist = Math.round(3959 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.3 * 10) / 10;
    const dur = Math.round((dist / 25) * 60);
    setEstimatedDistance(dist);
    setEstimatedDuration(dur);
    trackRideSearch();
    setPanel("drivers");
  }, [trackRideSearch, userLocation.lat, userLocation.lng]);

  const handleVehicleTypeChange = useCallback((type: VehicleType) => {
    setRequestedVehicleType(type);
    setSelectedDriverId("");
    setFareEstimate(null);
    queryClient.invalidateQueries({ queryKey: ['/api/rides/nearby-drivers'] });
  }, []);

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
      const loc = lastMessage.location ?? (
        typeof lastMessage.lat === 'number' && typeof lastMessage.lng === 'number'
          ? { lat: lastMessage.lat, lng: lastMessage.lng }
          : null
      );
      if (loc) {
        const activeRide = activeRidesRef.current.find((r: any) => r.id === lastMessage.rideId)
          ?? activeRidesRef.current[0];
        const driverId = lastMessage.driverId ?? activeRide?.driverId ?? 'active-driver';
        setRealtimeDrivers(prev => ({ ...prev, [driverId]: loc }));
      }
    } else if (lastMessage.type === 'ride_message' || lastMessage.type === 'ride_quick_message') {
      const payload = parseRideMessageWsEvent(lastMessage as Record<string, unknown>);
      if (payload) {
        setIncomingRideMessage(payload);
        toast({
          title: payload.senderRole === 'driver' ? 'Driver message' : 'Rider message',
          description: payload.body,
        });
        navigator.vibrate?.([100]);
      }
    } else if (lastMessage.type === 'ride_accepted') {
      refetchActiveRides();
      toast({ title: "Driver Accepted!", description: lastMessage.driverName ? `${lastMessage.driverName} is on the way!` : "Your driver is on the way!" });
      navigator.vibrate?.([200, 100, 200]);
    } else if (lastMessage.type === 'driver_arrived') {
      refetchActiveRides();
      toast({ title: "Your Driver Has Arrived! 📍", description: "Your driver is at the pickup spot — head outside." });
      navigator.vibrate?.([300, 120, 300]);
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
      setRideUrgency(prev => { const n = {...prev}; delete n[lastMessage.rideId]; return n; });
      toast({
        title: "Driver Found!",
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
    } else if (lastMessage.type === 'scheduled_ride_at_risk') {
      setRideUrgency(prev => ({ ...prev, [lastMessage.rideId]: 'at_risk' }));
      queryClient.invalidateQueries({ queryKey: ['/api/rides/scheduled'] });
      toast({
        title: "Looking for Your Driver",
        description: lastMessage.message || "We're urgently notifying available drivers.",
        variant: "destructive",
      });
      navigator.vibrate?.([200, 100, 200, 100, 200]);
    } else if (lastMessage.type === 'scheduled_ride_no_driver') {
      setRideUrgency(prev => ({ ...prev, [lastMessage.rideId]: 'no_driver' }));
      queryClient.invalidateQueries({ queryKey: ['/api/rides/scheduled'] });
      toast({
        title: "No Driver Found Yet",
        description: lastMessage.message || "You can cancel this ride at no charge.",
        variant: "destructive",
      });
      navigator.vibrate?.([400, 200, 400]);
    } else if (lastMessage.type === 'scheduled_ride_driver_dropped') {
      setRideUrgency(prev => ({ ...prev, [lastMessage.rideId]: 'driver_dropped' }));
      queryClient.invalidateQueries({ queryKey: ['/api/rides/scheduled'] });
      toast({
        title: "Driver Went Offline",
        description: lastMessage.message || "We're finding you a new driver right away.",
        variant: "destructive",
      });
      navigator.vibrate?.([300, 100, 300]);
    }
  }, [lastMessage, refetchActiveRides, toast]);

  // ── Derived UI values ──
  const activeRide = activeRides[0] || null;
  const { translate } = useLocale();

  useEffect(() => {
    if (activeRide && ["accepted", "driver_arriving", "in_progress", "pending"].includes(activeRide.status)) {
      updateRideWidget({
        rideId: activeRide.id,
        status: activeRide.status,
        etaMinutes: getDriverETA(activeRide) ?? undefined,
      });
    } else {
      clearRideWidget();
    }
  }, [activeRide?.id, activeRide?.status]);

  const { data: rideSurface } = useQuery<RideSurfaceSpec>({
    queryKey: ["/api/mobility/surface", activeRide?.id],
    enabled: !!activeRide?.id,
    refetchInterval: 10000,
  });

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
          destination={
            activeRide?.destinationLocation?.lat
              ? { lat: activeRide.destinationLocation.lat, lng: activeRide.destinationLocation.lng }
              : destCoords
          }
          activeDriver={
            activeRide && ["accepted", "driver_arriving", "in_progress"].includes(activeRide.status)
              ? realtimeDrivers[activeRide.driverId] ?? null
              : null
          }
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
          <NotificationBell
            buttonClassName="w-9 h-9 bg-white/90 backdrop-blur-sm rounded-full shadow-sm flex items-center justify-center"
          />
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
            {sharedGroup && (
              <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-purple-700 bg-purple-50 dark:bg-purple-950/30 rounded-lg px-2 py-1.5">
                <Users className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Shared ride · {sharedGroup.totalRiders} riders</span>
                {sharedGroup.discountAmount && (
                  <span className="ml-auto text-green-600 font-bold">-${parseFloat(sharedGroup.discountAmount).toFixed(2)} saved</span>
                )}
              </div>
            )}
            {['accepted', 'driver_arriving', 'in_progress'].includes(activeRide.status) && (
              <div className="mt-2">
                <RideChat
                  rideId={activeRide.id}
                  role="rider"
                  incomingMessage={incomingRideMessage?.rideId === activeRide.id ? incomingRideMessage : null}
                />
              </div>
            )}
            {rideSurface && (
              <div className="mt-2 pt-2 border-t border-gray-100">
                <RideSurface
                  spec={rideSurface}
                  onAction={(action) => {
                    if (action === "open_sos") setIsSOSModalOpen(true);
                  }}
                />
              </div>
            )}
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
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 text-xs px-2"
                    onClick={() => setIsLostFoundOpen(true)}
                    data-testid="btn-lost-item-completed"
                  >
                    Left item?
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
              {suggestLoading && <Loader2 className="w-4 h-4 text-blue-500 animate-spin absolute right-3 top-4" />}
              {destinationAddress && !suggestLoading && (
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

          {/* Suggestions — live address matches the rider picks from */}
          <div className="flex-1 overflow-y-auto">
            {!destinationAddress && (
              <div className="text-center px-4 py-6">
                <Search className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                <p className="text-base font-medium text-gray-400 mb-1">Where are you going?</p>
                <p className="text-sm text-gray-300">Start typing any address in Maryland</p>
              </div>
            )}
            {destinationAddress.length > 0 && destinationAddress.length < 3 && (
              <p className="text-center text-gray-400 text-sm px-4 py-6">Keep typing...</p>
            )}
            {destinationAddress.length >= 3 && addressSuggestions.map((s, i) => (
              <button
                key={`${s.lat},${s.lng},${i}`}
                onClick={() => handlePickDestination(s)}
                className="w-full text-left px-4 py-3.5 flex items-start gap-3 border-b border-gray-50 active:bg-blue-50 hover:bg-gray-50"
                data-testid={`suggestion-${i}`}
              >
                <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-4 h-4 text-gray-500" />
                </div>
                <span className="text-sm text-gray-800 leading-snug pt-1">{s.label}</span>
              </button>
            ))}
            {destinationAddress.length >= 3 && !suggestLoading && addressSuggestions.length === 0 && (
              <div className="text-center px-4 py-6">
                <MapPin className="w-8 h-8 text-red-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-red-400 mb-1">No matching address</p>
                <p className="text-xs text-gray-400">Try a more specific street, city, or place</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── BOTTOM SHEET: idle / drivers / confirm ── */}
      {panel !== "search" && (
      <div
        className={`absolute left-0 right-0 z-[55] bg-white rounded-t-3xl shadow-2xl transition-all duration-300 ease-in-out flex flex-col overflow-hidden ${
          panel === "idle" ? "h-auto" : panel === "drivers" ? "h-[65vh]" : "h-[70vh]"
        }`}
        style={{
          bottom: panel === "idle" ? "calc(64px + env(safe-area-inset-bottom, 0px))" : "0",
          maxHeight: panel === "idle" ? "420px" : "80vh",
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
          <div className="px-4 pb-5 pt-1 space-y-3 overflow-y-auto min-h-0">
            <button
              className="w-full flex items-center gap-3 bg-purple-600 text-white active:bg-purple-700 transition-colors rounded-2xl px-4 py-3.5 text-left shadow-md"
              onClick={() => setIsSharedScheduleOpen(true)}
              data-testid="button-shift-coworker-ride"
            >
              <Users className="w-5 h-5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-sm">Ride home with coworkers</p>
                <p className="text-[11px] text-purple-100">Pick shift end · share code · up to 3 riders · 30% off</p>
              </div>
            </button>

            <button
              type="button"
              className="w-full text-left text-sm font-semibold text-primary"
              onClick={() => setIsJoinScheduleOpen(true)}
              data-testid="button-join-coworker-code"
            >
              Have a coworker&apos;s group code? Join here
            </button>

            <MobilityIntentCard
              onResolved={handleMobilityIntent}
              onGuardianShare={(url) => {
                navigator.clipboard?.writeText(url).catch(() => {});
                toast({ title: "Link copied", description: "Share with family to track your ride." });
              }}
              disabled={!!activeRide}
            />
            <TransitAlertsCard />
            <CommunityRoutesCard onSelectRoute={handleCommunityRouteSelect} disabled={!!activeRide} />
            <button
              className="w-full flex items-center gap-3 bg-gray-100 active:bg-gray-200 transition-colors rounded-2xl px-4 py-3 text-left"
              onClick={() => {
                trackRideSearch();
                setPanel("search");
                setTimeout(() => destinationInputRef.current?.focus(), 100);
              }}
              data-testid="button-book-ride"
            >
              <Search className="w-5 h-5 text-gray-400 flex-shrink-0" />
              <span className="text-gray-500 text-base font-medium">Book now — where to?</span>
            </button>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setIsScheduleModalOpen(true)}
                className="flex-1 flex items-center gap-1.5 justify-center bg-orange-50 text-orange-600 rounded-xl py-3 text-xs font-semibold active:bg-orange-100 transition-colors"
                data-testid="button-schedule-ride"
              >
                <Calendar className="w-3.5 h-3.5" />
                Schedule
              </button>
              <button
                onClick={() => setIsMultiStopOpen(true)}
                className="flex-1 flex items-center gap-1.5 justify-center bg-blue-50 text-blue-600 rounded-xl py-3 text-xs font-semibold active:bg-blue-100 transition-colors"
                data-testid="button-multi-stop"
              >
                <MapPin className="w-3.5 h-3.5" />
                Multi-Stop
              </button>
              <button
                onClick={() => setIsSharedScheduleOpen(true)}
                className="flex-1 flex items-center gap-1.5 justify-center bg-purple-50 text-purple-600 rounded-xl py-3 text-xs font-semibold active:bg-purple-100 transition-colors"
                data-testid="button-share-schedule"
              >
                <Users className="w-3.5 h-3.5" />
                Group schedule
              </button>
              <button
                onClick={() => setIsJoinScheduleOpen(true)}
                className="flex-1 flex items-center gap-1.5 justify-center bg-green-50 text-green-600 rounded-xl py-3 text-xs font-semibold active:bg-green-100 transition-colors"
                data-testid="button-join-schedule"
              >
                <UserCheck className="w-3.5 h-3.5" />
                Group code
              </button>
            </div>

            {/* Circuits — the published weekly timetable (launch centerpiece) */}
            <button
              onClick={() => setIsCircuitsOpen(true)}
              className="w-full mt-2 flex items-center justify-between bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 active:bg-primary/10 transition-colors"
              data-testid="button-circuits"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-primary">
                <Bus className="w-4 h-4" />
                This Week's Circuits
              </span>
              <span className="text-xs text-gray-500">Guaranteed seats · no surge</span>
            </button>

            {/* Upcoming scheduled rides */}
            {scheduledRides.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
                  <CalendarClock className="w-3.5 h-3.5" /> Upcoming Scheduled Rides
                </p>
                {scheduledRides.map((ride: any) => {
                  const urgency = rideUrgency[ride.id];
                  const hasDriver = !!ride.driver?.firstName;
                  const minsAway = ride.scheduledAt
                    ? Math.round((new Date(ride.scheduledAt).getTime() - Date.now()) / 60000)
                    : null;

                  const cardStyle = urgency === 'no_driver'
                    ? "bg-red-50 border-red-200"
                    : urgency === 'at_risk' || urgency === 'driver_dropped'
                    ? "bg-amber-50 border-amber-200"
                    : hasDriver
                    ? "bg-green-50 border-green-200"
                    : "bg-orange-50 border-orange-100";

                  return (
                    <div
                      key={ride.id}
                      className={`flex items-start justify-between rounded-xl p-3 border ${cardStyle}`}
                      data-testid={`scheduled-ride-${ride.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <p className="text-xs font-bold text-gray-800">
                            {ride.scheduledAt ? format(new Date(ride.scheduledAt), "EEE, MMM d 'at' h:mm a") : ''}
                          </p>
                          {minsAway !== null && minsAway <= 120 && (
                            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                              minsAway <= 15 ? 'bg-red-100 text-red-700' :
                              minsAway <= 60 ? 'bg-amber-100 text-amber-700' :
                              'bg-blue-100 text-blue-700'
                            }`}>
                              {minsAway < 1 ? 'Now' : `${minsAway}m`}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 truncate">
                          → {ride.destinationLocation?.address || 'Destination'}
                        </p>
                        <div className="mt-1.5 flex items-center gap-1">
                          {urgency === 'no_driver' ? (
                            <span className="text-xs text-red-700 font-semibold flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              No driver found — cancel is free
                            </span>
                          ) : urgency === 'at_risk' ? (
                            <span className="text-xs text-amber-700 font-semibold flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              Urgently finding your driver…
                            </span>
                          ) : urgency === 'driver_dropped' ? (
                            <span className="text-xs text-amber-700 font-semibold flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              Driver went offline — finding a new one…
                            </span>
                          ) : hasDriver ? (
                            <span className="text-xs text-green-700 font-semibold flex items-center gap-1">
                              <UserCheck className="w-3 h-3" />
                              {ride.driver.firstName} {ride.driver.lastName?.[0] || ''}. confirmed
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400 italic flex items-center gap-1">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Waiting for a driver to claim…
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs font-bold text-gray-700 ml-2 shrink-0">
                        ${parseFloat(ride.estimatedFare || '0').toFixed(2)}
                      </span>
                    </div>
                  );
                })}
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

              {/* Vehicle type + pickup instructions */}
              <div className="mt-3 space-y-3">
                {(panel === "drivers" || panel === "confirm") && (
                  <VehicleTypePicker
                    value={requestedVehicleType}
                    onChange={handleVehicleTypeChange}
                  />
                )}
                <Input
                  placeholder="Pickup instructions (optional)"
                  value={pickupInstructions}
                  onChange={e => setPickupInstructions(e.target.value)}
                  className="h-9 text-xs rounded-xl border-gray-200"
                  data-testid="input-pickup-instructions"
                />
              </div>

              {panel === "confirm" && (
                <div className="mt-3">
                  <RideForFriendFields
                    enabled={rideForFriend}
                    onEnabledChange={setRideForFriend}
                    passengerName={passengerName}
                    onPassengerNameChange={setPassengerName}
                    passengerPhone={passengerPhone}
                    onPassengerPhoneChange={setPassengerPhone}
                  />
                </div>
              )}

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
                      {drivers.map(driver => {
                        const isFavorite =
                          driver.trust?.isFavorite ||
                          favoriteDrivers.driverIds.includes(driver.userId);
                        return (
                          <ExplainableMatchCard
                            key={driver.id}
                            driverName={driver.name}
                            trust={driver.trust}
                            proTier={driver.proTier}
                            eta={driver.estimatedTime}
                            fare={driver.estimatedFare}
                            selected={selectedDriverId === driver.userId}
                            isFavorite={isFavorite}
                            onSelect={() => setSelectedDriverId(driver.userId)}
                            onFavorite={() =>
                              toggleFavoriteMutation.mutate({
                                driverId: driver.userId,
                                isFavorite,
                              })
                            }
                          />
                        );
                      })}
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
                    {(fareEstimate.promoDiscount ?? 0) > 0 && (
                      <div className="flex justify-between text-orange-600 font-semibold">
                        <span>🎉 PG Welcome Credit ({fareEstimate.promoRidesRemaining} left)</span>
                        <span>-${fareEstimate.promoDiscount?.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-sm text-gray-800 pt-1 border-t border-green-200 mt-1">
                      <span>Total</span>
                      <span className="text-green-700" data-testid="text-total-fare">
                        ${(fareEstimate.promoDiscount ?? 0) > 0 ? fareEstimate.totalAfterPromo?.toFixed(2) : fareEstimate.total?.toFixed(2)}
                      </span>
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
                    <span className="font-bold text-sm text-gray-800">
                      ${(fareEstimate.promoDiscount ?? 0) > 0 ? fareEstimate.totalAfterPromo?.toFixed(2) : fareEstimate.total?.toFixed(2)}
                    </span>
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
                    `Confirm Ride — $${(fareEstimate.promoDiscount ?? 0) > 0 ? fareEstimate.totalAfterPromo?.toFixed(2) : fareEstimate.total?.toFixed(2)}`
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
      <LostFoundModal
        isOpen={isLostFoundOpen}
        onClose={() => setIsLostFoundOpen(false)}
        rideId={recentlyCompletedRide?.id ?? null}
      />
      <MultiStopBookingSheet
        isOpen={isMultiStopOpen}
        onClose={() => setIsMultiStopOpen(false)}
        drivers={drivers}
        userLocation={userLocation}
      />
      <SharedScheduleSheet
        isOpen={isSharedScheduleOpen}
        onClose={() => setIsSharedScheduleOpen(false)}
        drivers={drivers}
        userLocation={userLocation}
      />
      <JoinScheduleModal
        isOpen={isJoinScheduleOpen}
        onClose={() => setIsJoinScheduleOpen(false)}
        userLocation={userLocation}
      />
      <CircuitsTimetableSheet
        isOpen={isCircuitsOpen}
        onClose={() => setIsCircuitsOpen(false)}
      />
    </div>
  );
}
