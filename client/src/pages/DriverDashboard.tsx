import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { VEHICLE_TYPE_LABELS, VEHICLE_TYPES, type VehicleType } from "@shared/vehicleTypes";
import { DRIVER_PRO_LABELS, type DriverProTier } from "@shared/driverProTier";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useGeolocationWatcher } from "@/hooks/useGeolocation";
import { useWebSocket } from "@/hooks/useWebSocket";
import IncomingRideRequest from "@/components/IncomingRideRequest";
import { ActiveRideCard } from "@/components/ActiveRideCard";
import { useAnalytics } from "@/hooks/useAnalytics";
import CountySelectionSheet from "@/components/CountySelectionSheet";
import VehicleEditDialog from "@/components/VehicleEditDialog";
import { NotificationBell } from "@/components/NotificationBell";
import { Link } from "wouter";
import { format } from "date-fns";
import { BarChart3, Car, ChevronRight, ChevronDown, CalendarClock, CheckCircle2, Clock, MapPin, Banknote, Bus, Users, Wallet, Power, Sparkles } from "lucide-react";
import PayoutModal from "@/components/PayoutModal";
import { LostFoundDriverCard } from "@/components/LostFoundDriverCard";
import { DriverStatusBanner } from "@/components/DriverStatusBanner";
import { UpcomingRideGroupCard } from "@/components/UpcomingRideGroupCard";
import type { RideMessagePayload } from "@shared/rideChat";
import { parseRideMessageWsEvent } from "@shared/rideChat";

export default function DriverDashboard() {
  const [isOnline, setIsOnline] = useState(false);
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [showEarnings, setShowEarnings] = useState(false);
  const [showVehicleEdit, setShowVehicleEdit] = useState(false);
  const [showCountySheet, setShowCountySheet] = useState(false);
  const [incomingRideMessages, setIncomingRideMessages] = useState<Record<string, RideMessagePayload>>({});
  const [todayCounties, setTodayCounties] = useState<string[]>([]);
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { trackPageView, trackFeatureUsed } = useAnalytics();
  
  // Real-time GPS tracking for drivers
  const { location, error: locationError, isWatching, startWatching, stopWatching } = useGeolocationWatcher();
  const { sendMessage, isConnected, lastMessage } = useWebSocket();
  
  // Use ref to store latest location for GPS tracking
  const locationRef = useRef(location);
  const lastLocationUpdateRef = useRef<number>(0);

  // Get driver's vehicles
  const { data: driverVehicles = [] } = useQuery<any[]>({
    queryKey: ["/api/vehicles"],
    enabled: !!user?.isDriver,
  });

  const { data: lostFoundData } = useQuery<{ asDriver: any[] }>({
    queryKey: ["/api/lost-found/mine"],
    enabled: !!user?.isDriver,
    refetchInterval: 60000,
  });

  const { data: proTierData } = useQuery<{
    tier: DriverProTier;
    label: string;
    stats: { totalRides: number; avgRating: string; qualifyingWeeks: number };
  }>({
    queryKey: ["/api/driver/pro-tier"],
    enabled: !!user?.isDriver,
  });

  const evMutation = useMutation({
    mutationFn: async ({ vehicleId, isEv }: { vehicleId: string; isEv: boolean }) => {
      const res = await apiRequest("PATCH", `/api/driver/vehicle/${vehicleId}/ev`, { isEv, fuelType: isEv ? "ev" : "gas" });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      toast({
        title: data.vehicle?.isEv ? "EV fleet enrolled" : "EV flag removed",
        description: data.vehicle?.isEv
          ? `Eligible for $${data.greenBonusPerRide} green bonus per completed ride.`
          : undefined,
      });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const vehicleTypeMutation = useMutation({
    mutationFn: async ({ vehicleId, vehicleType }: { vehicleId: string; vehicleType: VehicleType }) => {
      const res = await apiRequest("PATCH", `/api/driver/vehicle/${vehicleId}/type`, { vehicleType });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      toast({ title: "Vehicle type updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  // Get driver earnings and trips
  const { data: todayEarnings } = useQuery<{fare: number, tips: number, total: number, rideCount: number}>({
    queryKey: ["/api/driver/earnings/today"],
    enabled: !!user?.isDriver,
  });

  const { data: weekEarnings } = useQuery<{fare: number, tips: number, total: number, rideCount: number}>({
    queryKey: ["/api/driver/earnings/week"],
    enabled: !!user?.isDriver,
  });

  const { data: todayTrips = [] } = useQuery<any[]>({
    queryKey: ["/api/driver/rides/today"],
    enabled: !!user?.isDriver,
  });

  // Get pending ride requests (reduced polling, relies primarily on WebSocket)
  const { data: pendingRides = [], refetch: refetchPendingRides } = useQuery<any[]>({
    queryKey: ["/api/driver/pending-rides"],
    enabled: !!user?.isDriver && isOnline,
    refetchInterval: 30000,
  });

  // Get active rides for this driver (reduced polling, relies primarily on WebSocket)
  const { data: activeRides = [], refetch: refetchActiveRides } = useQuery<any[]>({
    queryKey: ["/api/driver/active-rides"],
    enabled: !!user?.isDriver,
    refetchInterval: 30000,
  });

  // Get scheduled rides: open (unclaimed) + mine (claimed by me)
  const { data: scheduledRidesData, refetch: refetchScheduledRides } = useQuery<{ open: any[]; mine: any[] }>({
    queryKey: ["/api/driver/scheduled-rides"],
    enabled: !!user?.isDriver,
    refetchInterval: 60000,
    select: (data) => data,
  });
  const openScheduledRides = scheduledRidesData?.open ?? [];
  const myUpcomingRides = scheduledRidesData?.mine ?? [];

  // Group upcoming rides by groupId — a shared_schedule (coworker) group
  // shows up as one card per rider in myUpcomingRides, but they're all one
  // ride to confirm/claim together. Ungrouped (solo scheduled) rides get a
  // synthetic single-ride "group" so the same rendering path covers both.
  const upcomingGroups = (() => {
    const byKey = new Map<string, any[]>();
    for (const ride of myUpcomingRides) {
      const key = ride.groupId || ride.id;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(ride);
    }
    return Array.from(byKey.entries()).map(([key, groupRides]) => ({
      key,
      rides: groupRides,
      isGroup: groupRides.length > 1,
      allConfirmed: groupRides.every((r) => r.status === "accepted"),
      totalFare: groupRides.reduce((sum, r) => sum + parseFloat(r.estimatedFare || "0"), 0),
    }));
  })();

  // Circuit runs — whole-run claim board (docs/CIRCUITS_LAUNCH_PLAN.md item 5)
  const { data: circuitRunsData, refetch: refetchCircuitRuns } = useQuery<{ open: any[]; mine: any[] }>({
    queryKey: ["/api/driver/circuit-runs"],
    enabled: !!user?.isDriver,
    refetchInterval: 60000,
  });
  const openCircuitRuns = circuitRunsData?.open ?? [];
  const myCircuitRuns = circuitRunsData?.mine ?? [];

  const claimCircuitRunMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const response = await apiRequest('POST', `/api/driver/circuit-runs/${groupId}/claim`);
      return response.json();
    },
    onSuccess: (data) => {
      refetchCircuitRuns();
      refetchScheduledRides();
      toast({
        title: "Run claimed!",
        description: `You're driving this circuit run — ${data.seats} seat${data.seats === 1 ? "" : "s"} booked so far. Riders have been notified.`,
      });
    },
    onError: (error: any) => {
      toast({ title: "Claim failed", description: error.message || "Another driver may have claimed this run first.", variant: "destructive" });
      refetchCircuitRuns();
    },
  });

  // Confirm & accept a claimed circuit run — same two-step reason as
  // confirmScheduledMutation below: claiming a run doesn't authorize
  // payment, so this is the explicit step that does.
  const confirmCircuitRunMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const response = await apiRequest('POST', `/api/driver/circuit-runs/${groupId}/confirm`);
      return response.json();
    },
    onSuccess: (data) => {
      refetchCircuitRuns();
      const count = data?.confirmed?.length ?? 1;
      toast({
        title: "Run Confirmed!",
        description: `You're set for ${count} rider${count === 1 ? "" : "s"} on this run. Payment authorized.`,
      });
    },
    onError: (error: any) => {
      toast({ title: "Couldn't Confirm Run", description: error.message || "Please try again.", variant: "destructive" });
      refetchCircuitRuns();
    },
  });

  // Claim a scheduled ride
  const claimRideMutation = useMutation({
    mutationFn: async (rideId: string) => {
      const response = await apiRequest('POST', `/api/driver/rides/${rideId}/claim`);
      return response.json();
    },
    onSuccess: () => {
      refetchScheduledRides();
      toast({ title: "Ride Claimed!", description: "You've claimed this scheduled ride. The rider has been notified." });
    },
    onError: (error: any) => {
      toast({ title: "Claim Failed", description: error.message || "Another driver may have claimed this first.", variant: "destructive" });
      refetchScheduledRides();
    },
  });

  // Confirm & accept a claimed scheduled ride (or every ride in its group) —
  // this is the step that actually authorizes payment and unblocks arrival
  // confirmation. Claiming alone deliberately does neither, so this has to
  // be a separate, explicit driver action.
  const confirmScheduledMutation = useMutation({
    mutationFn: async (rideId: string) => {
      const response = await apiRequest('POST', `/api/driver/rides/${rideId}/confirm-scheduled`);
      return response.json();
    },
    onSuccess: (data) => {
      refetchScheduledRides();
      const count = data?.confirmed?.length ?? 1;
      toast({
        title: "Ride Confirmed!",
        description: count > 1
          ? `You're set for all ${count} riders in this group. Payment authorized.`
          : "Payment authorized. You're all set for pickup.",
      });
    },
    onError: (error: any) => {
      toast({ title: "Couldn't Confirm Ride", description: error.message || "Please try again.", variant: "destructive" });
      refetchScheduledRides();
    },
  });

  // Permanent county preferences (for pre-filling the daily selection sheet)
  const { data: countyPrefs } = useQuery<{ acceptedCounties: string[] }>({
    queryKey: ["/api/driver/counties"],
    enabled: !!user?.isDriver,
  });

  // Toggle driver status
  const toggleStatusMutation = useMutation({
    mutationFn: async ({ isOnline, dailyCounties }: { isOnline: boolean; dailyCounties?: string[] }) => {
      const response = await apiRequest('POST', '/api/driver/toggle-status', { isOnline, dailyCounties });
      return response.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: vars.isOnline ? "You're Online" : "You're Offline",
        description: vars.isOnline ? "You'll start receiving ride requests" : "You won't receive ride requests",
      });
    },
    onError: (error: any) => {
      // Surface the actual server message instead of a generic "Please try
      // again" — same pattern as the driver-profile fix in PR #20. If the
      // toggle silently fails (CSRF, validation, anything) the driver could
      // see the optimistic UI flicker on, then off, with no idea why.
      toast({
        title: "Status Update Failed",
        description: error?.message || "Unable to update your status. Please try again.",
        variant: "destructive",
      });
      // Re-sync from the server's truth instead of guessing with !isOnline,
      // which was racing the optimistic update and could land on the wrong
      // value depending on timing.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    }
  });

  const handleToggleStatus = (checked: boolean) => {
    const approved =
      user?.driverProfile?.isVerifiedNeighbor ||
      user?.driverProfile?.approvalStatus === "approved";
    if (checked && !approved) {
      toast({
        title: "Approval required",
        description:
          "Finish document upload and wait for administrator approval before going online.",
        variant: "destructive",
      });
      return;
    }
    if (checked) {
      // Show county selection before going online
      setShowCountySheet(true);
    } else {
      setIsOnline(false);
      setTodayCounties([]);
      trackFeatureUsed("driver_toggle_offline");
      toggleStatusMutation.mutate({ isOnline: false });
      stopWatching();
    }
  };

  const handleCountyConfirm = (counties: string[]) => {
    setShowCountySheet(false);
    setIsOnline(true);
    setTodayCounties(counties);
    trackFeatureUsed("driver_toggle_online");
    toggleStatusMutation.mutate({ isOnline: true, dailyCounties: counties });
    startWatching();
    lastLocationUpdateRef.current = 0;
  };

  // Update location ref whenever location changes
  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  // Send location updates via WebSocket when location changes and driver is online
  // SECURITY/PERFORMANCE: Throttled to once every 5 seconds to prevent server flooding
  useEffect(() => {
    if (location && isOnline && isConnected && user?.id) {
      const now = Date.now();
      const timeSinceLastUpdate = now - lastLocationUpdateRef.current;
      
      // Only send update if at least 5 seconds have passed since last update
      if (timeSinceLastUpdate >= 5000) {
        lastLocationUpdateRef.current = now;
        
        sendMessage({
          type: 'location_update',
          userId: user.id,
          location: {
            lat: location.latitude,
            lng: location.longitude
          }
        });
      }
    }
  }, [location, isOnline, isConnected, user?.id, sendMessage]);

  // Track GPS waypoints for active rides - interval decoupled from location changes
  useEffect(() => {
    // Find active "in_progress" ride
    const activeRide = activeRides.find((ride: any) => ride.status === 'in_progress');
    
    if (!activeRide || !isWatching) {
      return;
    }

    // Send initial waypoint immediately
    const currentLocation = locationRef.current;
    if (currentLocation && activeRide?.id) {
      apiRequest('POST', `/api/driver/rides/${activeRide.id}/track-location`, {
        lat: currentLocation.latitude,
        lng: currentLocation.longitude
      }).catch(console.error);
    }

    // Send GPS waypoint every 5 seconds during active ride
    const intervalId = setInterval(() => {
      const currentLocation = locationRef.current;
      if (currentLocation && activeRide?.id) {
        apiRequest('POST', `/api/driver/rides/${activeRide.id}/track-location`, {
          lat: currentLocation.latitude,
          lng: currentLocation.longitude
        }).catch((error) => {
          console.error('Failed to track location:', error);
        });
      }
    }, 5000); // Track every 5 seconds

    return () => clearInterval(intervalId);
  }, [activeRides, isWatching]);

  useEffect(() => {
    trackPageView("driver_dashboard");
  }, [trackPageView]);

  // Sync online status from user data
  useEffect(() => {
    if (user?.driverProfile?.isOnline !== undefined) {
      setIsOnline(user.driverProfile.isOnline);
      if (user.driverProfile.isOnline) {
        startWatching();
        // Restore today's county session from DB
        apiRequest('GET', '/api/driver/daily-session')
          .then(r => r.json())
          .then(session => {
            if (session?.dailyCounties?.length) setTodayCounties(session.dailyCounties);
          })
          .catch(() => {});
      }
    }
  }, [user?.driverProfile?.isOnline]);

  // Handle real-time ride status updates via WebSocket (scoped to current driver)
  useEffect(() => {
    if (!lastMessage || !user?.id) return;

    if (lastMessage.type === 'new_ride_request') {
      refetchPendingRides();
      toast({
        title: "New Ride Request!",
        description: lastMessage.riderName ? `${lastMessage.riderName} needs a ride` : "You have a new ride request waiting.",
      });
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([200, 100, 200, 100, 200]);
      }
    } else if (lastMessage.type === 'new_scheduled_ride') {
      refetchScheduledRides();
      const scheduledTime = lastMessage.scheduledAt
        ? format(new Date(lastMessage.scheduledAt), "MMM d 'at' h:mm a")
        : '';
      const isUrgent = !!lastMessage.urgent;
      toast({
        title: isUrgent ? "⚠ Urgent: Rider Needs a Driver!" : "New Scheduled Ride Available",
        description: isUrgent
          ? `A rider has no driver yet for ${scheduledTime}. Claim it now!`
          : `${lastMessage.riderName || 'A rider'} needs a driver for ${scheduledTime}. Claim it before another driver does!`,
        variant: isUrgent ? "destructive" : "default",
      });
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(isUrgent ? [300, 100, 300, 100, 300] : [100, 50, 100]);
      }
    } else if (lastMessage.type === 'scheduled_ride_taken') {
      refetchScheduledRides();
    } else if (lastMessage.type === 'circuit_run_taken') {
      refetchCircuitRuns();
    } else if (lastMessage.type === 'ride_reminder') {
      toast({
        title: "Ride Reminder",
        description: lastMessage.message || "You have a scheduled ride in 30 minutes.",
      });
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([300, 100, 300]);
      }
    } else if (lastMessage.type === 'ride_message' || lastMessage.type === 'ride_quick_message') {
      const payload = parseRideMessageWsEvent(lastMessage as Record<string, unknown>);
      if (payload) {
        setIncomingRideMessages((prev) => ({ ...prev, [payload.rideId]: payload }));
        toast({
          title: payload.senderRole === 'rider' ? 'Rider message' : 'Driver message',
          description: payload.body,
        });
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([100]);
        }
      }
    } else if (lastMessage.type === 'ride_accepted' || lastMessage.type === 'ride_declined') {
      refetchPendingRides();
      refetchActiveRides();
    } else if (lastMessage.type === 'ride_started' || lastMessage.type === 'ride_completed') {
      refetchActiveRides();
      if (lastMessage.type === 'ride_completed') {
        queryClient.invalidateQueries({ queryKey: ["/api/driver/earnings/today"] });
      }
    } else if (lastMessage.type === 'ride_cancelled') {
      refetchPendingRides();
      refetchActiveRides();
      toast({
        title: "Ride Cancelled",
        description: "A ride has been cancelled by the rider.",
        variant: "destructive",
      });
    }
  }, [lastMessage, user?.id, refetchPendingRides, refetchActiveRides, refetchScheduledRides, queryClient, toast]);

  // Transform ride data for display
  const transformedTrips = todayTrips.map((ride: any) => ({
    id: ride.id,
    route: `${ride.pickupLocation?.address || 'Unknown'} → ${ride.destinationLocation?.address || 'Unknown'}`,
    time: new Date(ride.completedAt || ride.createdAt).toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit' 
    }),
    distance: `${ride.distance || '0'} miles`,
    fare: parseFloat(ride.actualFare || '0'),
    tip: parseFloat(ride.tipAmount || '0')
  }));

  const driverApproved =
    user?.driverProfile?.isVerifiedNeighbor ||
    user?.driverProfile?.approvalStatus === "approved";

  return (
    <>
      <CountySelectionSheet
        open={showCountySheet}
        defaultCounties={countyPrefs?.acceptedCounties ?? []}
        onConfirm={handleCountyConfirm}
        onCancel={() => setShowCountySheet(false)}
      />
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-600 rounded-xl flex items-center justify-center">
            <Car className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Driver Dashboard</h1>
            <p className="text-xs text-gray-500">PG Ride Community</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell
            buttonClassName="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center"
            iconClassName="w-5 h-5"
          />
          <div className="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
            {user?.firstName?.[0] || 'D'}{user?.lastName?.[0] || 'R'}
          </div>
        </div>
      </header>

      <DriverStatusBanner
        approvalStatus={user?.driverProfile?.approvalStatus}
        isVerifiedNeighbor={user?.driverProfile?.isVerifiedNeighbor}
      />

      <main className="space-y-4 p-4">
        {/* Go-Online hero — action first. The driver's whole job on open is to
            go online and catch requests; money reports live behind a tap below. */}
        <Card className={`border-0 text-white shadow-lg ${isOnline ? 'bg-gradient-to-br from-green-600 to-emerald-700' : 'bg-gradient-to-br from-primary to-blue-900'}`}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-12 w-12 rounded-full bg-white/15 flex items-center justify-center shrink-0">
                  <Power className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-xl font-bold leading-tight">{isOnline ? "You're online" : "You're offline"}</h2>
                  <p className="text-sm text-white/80 truncate">
                    {isOnline ? "Waiting for ride requests…" : "Go online to start earning"}
                  </p>
                </div>
              </div>
              <div className="rounded-full bg-white/15 p-1 shrink-0">
                <Switch
                  checked={isOnline}
                  onCheckedChange={handleToggleStatus}
                  disabled={toggleStatusMutation.isPending || !driverApproved}
                  data-testid="switch-driver-status"
                />
              </div>
            </div>
            {locationError && (
              <p className="text-sm text-white/90 mt-3 bg-white/10 rounded-md p-2" data-testid="driver-location-error">
                Location unavailable: {locationError}. Enable location services to receive nearby requests.
              </p>
            )}
            {/* Today's active counties */}
            {isOnline && todayCounties.length > 0 && (
              <div className="mt-4 pt-3 border-t border-white/20 flex items-start gap-2">
                <MapPin className="w-4 h-4 text-white/80 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white/90 mb-0.5">
                    Accepting rides in {todayCounties.length === 25 ? "all Maryland counties" : `${todayCounties.length} ${todayCounties.length === 1 ? "county" : "counties"}`}
                  </p>
                  <p className="text-xs text-white/60 truncate">
                    {todayCounties.slice(0, 5).join(", ")}{todayCounties.length > 5 ? ` +${todayCounties.length - 5} more` : ""}
                  </p>
                </div>
              </div>
            )}
            {/* When idle & offline, reinforce our identity instead of a wall of numbers. */}
            {!isOnline && (
              <div className="mt-4 pt-3 border-t border-white/20 flex items-center gap-2 text-white/85">
                <Sparkles className="w-4 h-4 shrink-0" />
                <p className="text-xs">Every trip builds your ownership stake — you drive <span className="font-semibold">and</span> own a piece.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active Rides */}
        {activeRides.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-primary">
              Active Rides ({activeRides.length})
            </h3>
            {activeRides.map((ride: any) => (
              <ActiveRideCard
                key={ride.id}
                ride={ride}
                incomingRideMessage={incomingRideMessages[ride.id] ?? null}
                driverLocation={location ? { lat: location.latitude, lng: location.longitude } : null}
              />
            ))}
          </div>
        )}

        {/* My Upcoming Claimed Scheduled Rides */}
        {myUpcomingRides.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              Your Upcoming Rides ({myUpcomingRides.length})
            </h3>
            {upcomingGroups.map((group) => (
              <UpcomingRideGroupCard
                key={group.key}
                group={group}
                onConfirm={(rideId) => confirmScheduledMutation.mutate(rideId)}
                isConfirming={
                  confirmScheduledMutation.isPending &&
                  confirmScheduledMutation.variables === group.rides[0].id
                }
              />
            ))}
          </div>
        )}

        {/* Circuit runs — claim the whole run (docs/CIRCUITS_LAUNCH_PLAN.md) */}
        {(openCircuitRuns.length > 0 || myCircuitRuns.length > 0) && (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
              <Bus className="w-5 h-5" />
              Circuit Runs
            </h3>
            {myCircuitRuns.map((run: any) => (
              <Card key={run.groupId} className="border-green-300 bg-green-50/50" data-testid={`my-circuit-run-${run.groupId}`}>
                <CardContent className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{run.circuitName}</span>
                      <Badge className={run.allConfirmed ? "bg-green-700 text-white" : "bg-green-600 text-white"}>
                        {run.allConfirmed ? "Confirmed" : "Claimed"}
                      </Badge>
                      {run.anchorName && <Badge variant="outline">{run.anchorName}</Badge>}
                    </div>
                    <span className="font-semibold text-green-700">${run.totalFare}</span>
                  </div>
                  <p className="text-sm text-gray-700">
                    {run.runAt ? format(new Date(run.runAt), "EEE, MMM d 'at' h:mm a") : ''}
                    <span className="text-gray-500"> · {run.seatsBooked} of {run.seatsTotal} seats booked</span>
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {run.pickup?.address} → {run.destination?.address}
                  </p>
                  {!run.allConfirmed && (
                    <Button
                      className="w-full mt-1"
                      onClick={() => confirmCircuitRunMutation.mutate(run.groupId)}
                      disabled={confirmCircuitRunMutation.isPending && confirmCircuitRunMutation.variables === run.groupId}
                      data-testid={`button-confirm-circuit-run-${run.groupId}`}
                    >
                      {confirmCircuitRunMutation.isPending && confirmCircuitRunMutation.variables === run.groupId
                        ? "Confirming..."
                        : "Confirm & Accept Run"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
            {openCircuitRuns.map((run: any) => (
              <Card key={run.groupId} className="border-primary/30" data-testid={`open-circuit-run-${run.groupId}`}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{run.circuitName}</span>
                      {run.anchorName && <Badge variant="outline">{run.anchorName}</Badge>}
                    </div>
                    <span className="font-semibold text-green-700">${run.totalFare}</span>
                  </div>
                  <p className="text-sm text-gray-700">
                    {run.runAt ? format(new Date(run.runAt), "EEE, MMM d 'at' h:mm a") : ''}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {run.pickup?.address} → {run.destination?.address}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-600 flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {run.seatsBooked} of {run.seatsTotal} seats booked · ${run.farePerSeat}/seat
                    </span>
                    <Button
                      size="sm"
                      onClick={() => claimCircuitRunMutation.mutate(run.groupId)}
                      disabled={claimCircuitRunMutation.isPending}
                      data-testid={`button-claim-run-${run.groupId}`}
                    >
                      {claimCircuitRunMutation.isPending ? "Claiming..." : "Claim run"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Open Scheduled Rides — available to claim */}
        {openScheduledRides.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-blue-700 flex items-center gap-2">
              <CalendarClock className="w-5 h-5" />
              Scheduled Rides to Claim ({openScheduledRides.length})
            </h3>
            {openScheduledRides.map((ride: any) => {
              const minsAway = ride.scheduledAt
                ? Math.round((new Date(ride.scheduledAt).getTime() - Date.now()) / 60000)
                : null;
              const isUrgent = minsAway !== null && minsAway <= 120;
              const isCritical = minsAway !== null && minsAway <= 15;

              return (
              <Card key={ride.id} className={isCritical ? "border-red-400 bg-red-50" : isUrgent ? "border-amber-400 bg-amber-50" : "border-blue-200"} data-testid={`open-scheduled-ride-${ride.id}`}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={isCritical ? "border-red-500 text-red-700" : isUrgent ? "border-amber-500 text-amber-700" : "border-blue-400 text-blue-700"}>
                        <Clock className="w-3 h-3 mr-1" />
                        {ride.scheduledAt ? format(new Date(ride.scheduledAt), "MMM d 'at' h:mm a") : ''}
                      </Badge>
                      {minsAway !== null && minsAway <= 120 && (
                        <Badge className={isCritical ? "bg-red-600 text-white" : "bg-amber-500 text-white"}>
                          {isCritical ? `${minsAway}m — URGENT` : `${minsAway}m away`}
                        </Badge>
                      )}
                    </div>
                    <span className="font-semibold text-green-700">${parseFloat(ride.estimatedFare || '0').toFixed(2)}</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">{ride.pickupLocation?.address || 'Pickup'}</p>
                      <p className="text-gray-500">→ {ride.destinationLocation?.address || 'Destination'}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm text-gray-600">
                    <span>Rider: {ride.rider?.firstName || 'Rider'} {ride.rider?.lastName?.[0] || ''}. ★{parseFloat(ride.rider?.rating || '5').toFixed(1)}</span>
                    {ride.rideType === "shared_schedule" && (
                      <Badge variant="secondary" className="text-[10px]">Coworker group · claim all seats</Badge>
                    )}
                  </div>
                  {ride.pickupInstructions && (
                    <p className="text-xs text-gray-500 italic">"{ride.pickupInstructions}"</p>
                  )}
                  <Button
                    className="w-full mt-2"
                    onClick={() => claimRideMutation.mutate(ride.id)}
                    disabled={claimRideMutation.isPending}
                    data-testid={`button-claim-ride-${ride.id}`}
                  >
                    {claimRideMutation.isPending ? "Claiming..." : "Claim This Ride"}
                  </Button>
                </CardContent>
              </Card>
              );
            })}
          </div>
        )}

        {/* Incoming Ride Requests */}
        {isOnline && pendingRides.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-primary">
              Incoming Ride Requests ({pendingRides.length})
            </h3>
            {pendingRides.map((ride: any) => (
              <IncomingRideRequest
                key={ride.id}
                ride={{
                  ...ride,
                  rider: {
                    firstName: ride.rider?.firstName || "Unknown",
                    lastName: ride.rider?.lastName || "",
                    rating: parseFloat(ride.rider?.rating || "5.0")
                  }
                }}
                onAccept={(rideId) => {
                  refetchPendingRides();
                }}
                onDecline={(rideId) => {
                  refetchPendingRides();
                }}
              />
            ))}
          </div>
        )}

        {/* Earnings & Wallet — the financial "report" is tucked behind a tap.
            A driver opens this when they want the numbers; it doesn't greet
            them with a wall of dollar figures every time they open the app. */}
        <Card>
          <button
            type="button"
            onClick={() => setShowEarnings((v) => !v)}
            className="w-full p-4 flex items-center justify-between"
            data-testid="button-toggle-earnings"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                <Wallet className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div className="text-left">
                <p className="font-semibold">Earnings &amp; Wallet</p>
                <p className="text-xs text-muted-foreground">
                  {showEarnings ? "Tap to hide" : "Tap to view earnings, wallet & payouts"}
                </p>
              </div>
            </div>
            <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${showEarnings ? 'rotate-180' : ''}`} />
          </button>
        </Card>

        {showEarnings && (
        <div className="space-y-4">
        {/* Earnings Dashboard */}
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-4">
              <h3 className="text-sm font-medium text-muted-foreground">Today's Earnings</h3>
              <p className="text-2xl font-bold" data-testid="text-today-earnings">
                ${(todayEarnings?.total || 0).toFixed(2)}
              </p>
              <p className="text-sm text-secondary">+${(todayEarnings?.tips || 0).toFixed(2)} tips</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <h3 className="text-sm font-medium text-muted-foreground">This Week</h3>
              <p className="text-2xl font-bold" data-testid="text-week-earnings">
                ${(weekEarnings?.total || 0).toFixed(2)}
              </p>
              <p className="text-sm text-secondary">+${(weekEarnings?.tips || 0).toFixed(2)} tips</p>
            </CardContent>
          </Card>
        </div>

        {/* Payout Card */}
        <Card className="border-green-200 dark:border-green-800">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                <Banknote className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="font-semibold">Wallet Balance</p>
                <p className="text-2xl font-bold text-green-700 dark:text-green-300" data-testid="text-wallet-balance">
                  ${parseFloat(user?.virtualCardBalance || '0').toFixed(2)}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-green-500 text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950"
              onClick={() => setShowPayoutModal(true)}
              data-testid="button-request-payout"
            >
              Withdraw
            </Button>
          </CardContent>
        </Card>

        {/* Performance Insights Link */}
        <Link href="/driver/insights">
          <Card className="cursor-pointer hover:border-primary transition-colors" data-testid="card-performance-insights">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <BarChart3 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold">View Performance Insights</p>
                  <p className="text-xs text-muted-foreground">Scorecard, optimal hours & demand areas</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </CardContent>
          </Card>
        </Link>

        {/* Today's Trips */}
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Today's Trips</h3>
            {transformedTrips.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <i className="fas fa-route text-3xl mb-2" />
                <p>No trips completed today</p>
                <p className="text-sm">Go online to start receiving ride requests</p>
              </div>
            ) : (
              <div className="space-y-3">
                {transformedTrips.map((trip) => (
                  <div key={trip.id} className="flex items-center justify-between" data-testid={`trip-${trip.id}`}>
                    <div>
                      <p className="font-medium">{trip.route}</p>
                      <p className="text-sm text-muted-foreground">
                        {trip.time} • {trip.distance}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">${trip.fare.toFixed(2)}</p>
                      <p className="text-sm text-secondary">+${trip.tip.toFixed(2)} tip</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        </div>
        )}

        {/* Rate Card */}
        <Card>
          <CardContent className="p-4">
            <Link href="/driver/rate-card">
              <div className="flex items-center justify-between cursor-pointer" data-testid="link-rate-card">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                    <i className="fas fa-dollar-sign text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Your Rate Card</h3>
                    <p className="text-sm text-muted-foreground">Set your fares per mile, per minute, and more</p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </div>
            </Link>
          </CardContent>
        </Card>

        <LostFoundDriverCard reports={lostFoundData?.asDriver ?? []} />

        {proTierData && proTierData.tier !== "community" && (
          <Card className="border-amber-200 bg-amber-50/50" data-testid="driver-pro-tier-card">
            <CardContent className="p-4 flex items-center gap-3">
              <Badge className="bg-amber-600 text-white">{proTierData.label}</Badge>
              <p className="text-sm text-muted-foreground">
                {proTierData.stats.totalRides} trips · {parseFloat(proTierData.stats.avgRating || "5").toFixed(1)}★
                {proTierData.stats.qualifyingWeeks > 0 && ` · ${proTierData.stats.qualifyingWeeks} qualifying weeks`}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Vehicle Profile */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Your Vehicle</h3>
              <Button
                variant="ghost"
                size="sm"
                className="text-primary"
                onClick={() => setShowVehicleEdit(true)}
                data-testid="button-edit-vehicle"
              >
                {driverVehicles.length > 0 ? "Edit" : "Add"}
              </Button>
            </div>
            {driverVehicles.length > 0 ? (
              <div className="flex items-center space-x-3">
                <div className="w-16 h-12 rounded bg-muted flex items-center justify-center">
                  <i className="fas fa-car text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium" data-testid="text-vehicle-info">
                    {driverVehicles[0].year} {driverVehicles[0].make} {driverVehicles[0].model}
                  </p>
                  <p className="text-sm text-muted-foreground" data-testid="text-vehicle-plate">
                    {driverVehicles[0].licensePlate || 'No plate'}
                  </p>
                  <p className="text-sm text-muted-foreground" data-testid="text-vehicle-color">
                    {driverVehicles[0].color || 'Unknown color'}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    {driverVehicles[0].isEv && (
                      <Badge className="bg-green-600 text-white text-[10px]">⚡ EV — Green bonus eligible</Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-2 border-t">
                    <div>
                      <p className="text-sm font-medium">Electric vehicle</p>
                      <p className="text-xs text-muted-foreground">Community green bonus pool (not surge)</p>
                    </div>
                    <Switch
                      checked={!!driverVehicles[0].isEv}
                      onCheckedChange={(checked) =>
                        evMutation.mutate({ vehicleId: driverVehicles[0].id, isEv: checked })
                      }
                      disabled={evMutation.isPending}
                      data-testid="switch-ev-vehicle"
                    />
                  </div>
                  <div className="mt-3 pt-2 border-t space-y-2">
                    <p className="text-sm font-medium">Vehicle type for riders</p>
                    <div className="flex flex-wrap gap-1.5">
                      {VEHICLE_TYPES.map((type) => {
                        const active = (driverVehicles[0].vehicleType ?? "standard") === type;
                        return (
                          <Button
                            key={type}
                            type="button"
                            size="sm"
                            variant={active ? "default" : "outline"}
                            className="h-8 text-xs"
                            disabled={vehicleTypeMutation.isPending}
                            onClick={() =>
                              vehicleTypeMutation.mutate({
                                vehicleId: driverVehicles[0].id,
                                vehicleType: type,
                              })
                            }
                            data-testid={`driver-vehicle-type-${type}`}
                          >
                            {VEHICLE_TYPE_LABELS[type]}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground">
                <i className="fas fa-car text-2xl mb-2" />
                <p className="text-sm">No vehicle registered yet</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Driver Stats */}
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold mb-3">Driver Stats</h3>
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-primary" data-testid="text-total-trips">
                  {user?.totalRides || 0}
                </p>
                <p className="text-sm text-muted-foreground">Total Trips</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-secondary" data-testid="text-driver-rating">
                  {user?.rating ? parseFloat(user.rating).toFixed(1) : 'N/A'}
                </p>
                <p className="text-sm text-muted-foreground">Rating</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      <PayoutModal
        open={showPayoutModal}
        onClose={() => setShowPayoutModal(false)}
        availableBalance={parseFloat(user?.virtualCardBalance || '0')}
      />

      <VehicleEditDialog
        isOpen={showVehicleEdit}
        onClose={() => setShowVehicleEdit(false)}
        vehicle={driverVehicles[0] ?? null}
      />
    </>
  );
}
