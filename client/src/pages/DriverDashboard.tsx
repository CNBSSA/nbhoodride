import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
import { Link } from "wouter";
import { format } from "date-fns";
import { BarChart3, Bell, Car, ChevronRight, CalendarClock, CheckCircle2, Clock, MapPin, Banknote } from "lucide-react";
import PayoutModal from "@/components/PayoutModal";

export default function DriverDashboard() {
  const [isOnline, setIsOnline] = useState(false);
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [showCountySheet, setShowCountySheet] = useState(false);
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
    onError: () => {
      toast({
        title: "Status Update Failed",
        description: "Unable to update your status. Please try again.",
        variant: "destructive",
      });
      setIsOnline(!isOnline); // Revert the toggle
    }
  });

  const handleToggleStatus = (checked: boolean) => {
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
    } else if (lastMessage.type === 'ride_reminder') {
      toast({
        title: "Ride Reminder",
        description: lastMessage.message || "You have a scheduled ride in 30 minutes.",
      });
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([300, 100, 300]);
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
          <button className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center" data-testid="button-notifications">
            <Bell className="w-5 h-5 text-gray-600" />
          </button>
          <div className="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
            {user?.firstName?.[0] || 'D'}{user?.lastName?.[0] || 'R'}
          </div>
        </div>
      </header>

      <main className="space-y-4 p-4">
        {/* Status Toggle */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Driver Status</h2>
                <p className="text-sm text-muted-foreground">Toggle to start accepting rides</p>
              </div>
              <div className="flex items-center space-x-3">
                <Switch
                  checked={isOnline}
                  onCheckedChange={handleToggleStatus}
                  disabled={toggleStatusMutation.isPending}
                  data-testid="switch-driver-status"
                />
                <span className={`font-semibold ${isOnline ? 'text-secondary' : 'text-destructive'}`}>
                  {isOnline ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>
            {/* Today's active counties */}
            {isOnline && todayCounties.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-start gap-2">
                <MapPin className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-600 mb-1">
                    Accepting rides in {todayCounties.length === 25 ? "all Maryland counties" : `${todayCounties.length} ${todayCounties.length === 1 ? "county" : "counties"}`}
                  </p>
                  <p className="text-xs text-gray-400 truncate">
                    {todayCounties.slice(0, 5).join(", ")}{todayCounties.length > 5 ? ` +${todayCounties.length - 5} more` : ""}
                  </p>
                </div>
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
              <ActiveRideCard key={ride.id} ride={ride} />
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
            {myUpcomingRides.map((ride: any) => (
              <Card key={ride.id} className="border-green-200 bg-green-50" data-testid={`upcoming-ride-${ride.id}`}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <Badge className="bg-green-600 text-white">Claimed</Badge>
                    <span className="text-sm font-semibold text-green-700">
                      {ride.scheduledAt ? format(new Date(ride.scheduledAt), "MMM d 'at' h:mm a") : ''}
                    </span>
                  </div>
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">{ride.pickupLocation?.address || 'Pickup'}</p>
                      <p className="text-gray-500">→ {ride.destinationLocation?.address || 'Destination'}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm text-gray-600">
                    <span>Rider: {ride.rider?.firstName || 'Unknown'} {ride.rider?.lastName?.[0] || ''}.</span>
                    <span className="font-semibold text-green-700">${parseFloat(ride.estimatedFare || '0').toFixed(2)}</span>
                  </div>
                  {ride.pickupInstructions && (
                    <p className="text-xs text-gray-500 italic">"{ride.pickupInstructions}"</p>
                  )}
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

        {/* Vehicle Profile */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Your Vehicle</h3>
              <Button variant="ghost" size="sm" className="text-primary" data-testid="button-edit-vehicle">
                Edit
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
    </>
  );
}
