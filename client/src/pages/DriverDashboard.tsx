import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useGeolocationWatcher } from "@/hooks/useGeolocation";
import { useWebSocket } from "@/hooks/useWebSocket";
import IncomingRideRequest from "@/components/IncomingRideRequest";
import { ActiveRideCard } from "@/components/ActiveRideCard";

export default function DriverDashboard() {
  const [isOnline, setIsOnline] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Real-time GPS tracking for drivers
  const { location, error: locationError, isWatching, startWatching, stopWatching } = useGeolocationWatcher();
  const { sendMessage, isConnected, lastMessage } = useWebSocket();
  
  // Use ref to store latest location for GPS tracking
  const locationRef = useRef(location);
  const lastLocationUpdateRef = useRef<number>(0);

  // Get driver earnings and trips
  const { data: todayEarnings } = useQuery({
    queryKey: ["/api/driver/earnings/today"],
    enabled: !!user?.isDriver,
  });

  const { data: weekEarnings } = useQuery({
    queryKey: ["/api/driver/earnings/week"],
    enabled: !!user?.isDriver,
  });

  const { data: todayTrips = [] } = useQuery({
    queryKey: ["/api/driver/rides/today"],
    enabled: !!user?.isDriver,
  });

  // Get pending ride requests (reduced polling, relies primarily on WebSocket)
  const { data: pendingRides = [], refetch: refetchPendingRides } = useQuery({
    queryKey: ["/api/driver/pending-rides"],
    enabled: !!user?.isDriver && isOnline,
    refetchInterval: 30000, // Reduced to 30 seconds, rely on WebSocket updates
  });

  // Get active rides for this driver (reduced polling, relies primarily on WebSocket)
  const { data: activeRides = [], refetch: refetchActiveRides } = useQuery({
    queryKey: ["/api/driver/active-rides"],
    enabled: !!user?.isDriver,
    refetchInterval: 30000, // Reduced to 30 seconds, rely on WebSocket updates
  });

  // Toggle driver status
  const toggleStatusMutation = useMutation({
    mutationFn: async (isOnline: boolean) => {
      const response = await apiRequest('POST', '/api/driver/toggle-status', { isOnline });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: isOnline ? "You're Online" : "You're Offline",
        description: isOnline ? "You'll start receiving ride requests" : "You won't receive ride requests",
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
    setIsOnline(checked);
    toggleStatusMutation.mutate(checked);
    
    // Start/stop GPS tracking when going online/offline
    if (checked) {
      startWatching();
      // Reset throttle timer when going online to ensure immediate location update
      lastLocationUpdateRef.current = 0;
    } else {
      stopWatching();
    }
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
        
        // Also update location in database
        apiRequest('POST', '/api/driver/location', {
          lat: location.latitude,
          lng: location.longitude
        }).catch((error) => {
          console.error('Failed to update driver location:', error);
          // Retry logic could be added here
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

  // Sync online status from user data
  useEffect(() => {
    if (user?.driverProfile?.isOnline !== undefined) {
      setIsOnline(user.driverProfile.isOnline);
      if (user.driverProfile.isOnline) {
        startWatching();
      }
    }
  }, [user?.driverProfile?.isOnline, startWatching]);

  // Handle real-time ride status updates via WebSocket (scoped to current driver)
  useEffect(() => {
    if (!lastMessage || !user?.id) return;

    // Only process events for this driver
    if (lastMessage.type === 'new_ride_request' && lastMessage.driverId === user.id) {
      refetchPendingRides();
      toast({
        title: "New Ride Request!",
        description: "You have a new ride request waiting.",
      });
    } else if ((lastMessage.type === 'ride_accepted' || lastMessage.type === 'ride_declined') && lastMessage.driverId === user.id) {
      refetchPendingRides();
      refetchActiveRides();
    } else if ((lastMessage.type === 'ride_started' || lastMessage.type === 'ride_completed') && lastMessage.driverId === user.id) {
      refetchActiveRides();
      // Also refresh earnings when ride is completed
      if (lastMessage.type === 'ride_completed') {
        queryClient.invalidateQueries({ queryKey: ["/api/driver/earnings/today"] });
      }
    }
  }, [lastMessage, user?.id, refetchPendingRides, refetchActiveRides, queryClient, toast]);

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
      {/* Header */}
      <header className="bg-card border-b border-border p-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <i className="fas fa-car text-primary text-2xl" />
          <div>
            <h1 className="text-lg font-bold">Driver Dashboard</h1>
            <p className="text-xs text-muted-foreground">PG Ride Community</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <Button variant="ghost" size="sm" className="p-2 rounded-full" data-testid="button-notifications">
            <i className="fas fa-bell" />
          </Button>
          <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-primary-foreground text-sm font-bold">
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

        {/* Vehicle Profile */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Your Vehicle</h3>
              <Button variant="ghost" size="sm" className="text-primary" data-testid="button-edit-vehicle">
                Edit
              </Button>
            </div>
            <div className="flex items-center space-x-3">
              <img
                src="https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=64&h=48&fit=crop"
                alt="Driver's vehicle"
                className="w-16 h-12 rounded object-cover"
              />
              <div>
                <p className="font-medium" data-testid="text-vehicle-info">2022 Honda Accord</p>
                <p className="text-sm text-muted-foreground" data-testid="text-vehicle-plate">MD ABC-1234</p>
                <p className="text-sm text-muted-foreground" data-testid="text-vehicle-color">Blue</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Driver Stats */}
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold mb-3">Driver Stats</h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-primary" data-testid="text-total-trips">127</p>
                <p className="text-sm text-muted-foreground">Total Trips</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-secondary" data-testid="text-driver-rating">4.9</p>
                <p className="text-sm text-muted-foreground">Rating</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-accent" data-testid="text-acceptance-rate">96%</p>
                <p className="text-sm text-muted-foreground">Acceptance</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
