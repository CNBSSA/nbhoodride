import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useGeolocationWatcher } from "@/hooks/useGeolocation";
import { useWebSocket } from "@/hooks/useWebSocket";

export default function DriverDashboard() {
  const [isOnline, setIsOnline] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Real-time GPS tracking for drivers
  const { location, error: locationError, isWatching, startWatching, stopWatching } = useGeolocationWatcher();
  const { sendMessage, isConnected } = useWebSocket();

  // Get driver earnings and trips
  const { data: todayTrips = [] } = useQuery({
    queryKey: ["/api/rides", "driver", "today"],
    enabled: !!user?.isDriver,
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
    } else {
      stopWatching();
    }
  };

  // Send location updates via WebSocket when location changes and driver is online
  useEffect(() => {
    if (location && isOnline && isConnected && user?.id) {
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
      }).catch(console.error);
    }
  }, [location, isOnline, isConnected, user?.id, sendMessage]);

  // Sync online status from user data
  useEffect(() => {
    if (user?.driverProfile?.isOnline !== undefined) {
      setIsOnline(user.driverProfile.isOnline);
      if (user.driverProfile.isOnline) {
        startWatching();
      }
    }
  }, [user?.driverProfile?.isOnline, startWatching]);

  // Mock earnings data (replace with real data from backend)
  const todayEarnings = {
    fare: 87.50,
    tips: 12.50,
    total: 100.00
  };

  const weekEarnings = {
    fare: 456.75,
    tips: 68.25,
    total: 525.00
  };

  const mockTrips = [
    {
      id: 1,
      route: "Largo Metro → Woodmore",
      time: "2:30 PM",
      distance: "8.2 miles",
      fare: 18.50,
      tip: 3.00
    },
    {
      id: 2,
      route: "FedEx Field → Bowie",
      time: "4:15 PM", 
      distance: "12.1 miles",
      fare: 24.75,
      tip: 5.00
    }
  ];

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

        {/* Earnings Dashboard */}
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-4">
              <h3 className="text-sm font-medium text-muted-foreground">Today's Earnings</h3>
              <p className="text-2xl font-bold" data-testid="text-today-earnings">
                ${todayEarnings.total.toFixed(2)}
              </p>
              <p className="text-sm text-secondary">+${todayEarnings.tips.toFixed(2)} tips</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <h3 className="text-sm font-medium text-muted-foreground">This Week</h3>
              <p className="text-2xl font-bold" data-testid="text-week-earnings">
                ${weekEarnings.total.toFixed(2)}
              </p>
              <p className="text-sm text-secondary">+${weekEarnings.tips.toFixed(2)} tips</p>
            </CardContent>
          </Card>
        </div>

        {/* Today's Trips */}
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Today's Trips</h3>
            {mockTrips.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <i className="fas fa-route text-3xl mb-2" />
                <p>No trips completed today</p>
                <p className="text-sm">Go online to start receiving ride requests</p>
              </div>
            ) : (
              <div className="space-y-3">
                {mockTrips.map((trip) => (
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
