import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useWebSocket } from "@/hooks/useWebSocket";
import MapComponent from "@/components/MapComponent";
import RideBookingModal from "@/components/RideBookingModal";
import SOSModal from "@/components/SOSModal";

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

export default function RiderDashboard() {
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [isSOSModalOpen, setIsSOSModalOpen] = useState(false);
  const [realtimeDrivers, setRealtimeDrivers] = useState<Record<string, {lat: number, lng: number}>>({});
  const { user } = useAuth();
  const { location, error: locationError, requestLocation } = useGeolocation();
  const { lastMessage } = useWebSocket();

  const userLocation = location ? {
    lat: location.latitude,
    lng: location.longitude,
    address: "Largo, MD 20774" // Mock address - in production, use reverse geocoding
  } : {
    lat: 38.9073,
    lng: -76.7781,
    address: "Prince George's County, MD" // Default location when geolocation is unavailable
  };

  // Get nearby drivers - always use userLocation which has fallback
  const { data: nearbyDrivers = [], isLoading } = useQuery({
    queryKey: [`/api/rides/nearby-drivers?lat=${userLocation.lat}&lng=${userLocation.lng}`],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const mapCenter = userLocation || { lat: 38.9073, lng: -76.7781 }; // Default to Largo, MD

  // Handle real-time driver location updates via WebSocket
  useEffect(() => {
    if (lastMessage?.type === 'driver_location') {
      setRealtimeDrivers(prev => ({
        ...prev,
        [lastMessage.driverId]: lastMessage.location
      }));
    }
  }, [lastMessage]);

  // Transform driver data for components with real-time locations
  const drivers: Driver[] = nearbyDrivers.map((driver: any) => {
    const realtimeLocation = realtimeDrivers[driver.id];
    const location = realtimeLocation || driver.currentLocation || { 
      lat: mapCenter.lat + (Math.random() - 0.5) * 0.01, 
      lng: mapCenter.lng + (Math.random() - 0.5) * 0.01 
    };
    
    return {
      id: driver.id,
      name: `${driver.user.firstName} ${driver.user.lastName?.[0] || ''}.`,
      location,
      rating: parseFloat(driver.user.rating) || 5.0,
      vehicle: driver.vehicles[0] ? `${driver.vehicles[0].year} ${driver.vehicles[0].make} ${driver.vehicles[0].model}` : "Vehicle",
      estimatedFare: "$12-15", // Mock fare - calculate based on distance
      estimatedTime: "2-5 min",
      isVerifiedNeighbor: driver.isVerifiedNeighbor,
      profileImage: driver.user.profileImageUrl,
    };
  });

  return (
    <>
      {/* Header */}
      <header className="bg-card border-b border-border p-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <i className="fas fa-car text-primary text-2xl" />
          <div>
            <h1 className="text-lg font-bold">PG Ride</h1>
            <p className="text-xs text-muted-foreground">Community Rideshare</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <Button variant="ghost" size="sm" className="p-2 rounded-full" data-testid="button-notifications">
            <i className="fas fa-bell" />
          </Button>
          <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-primary-foreground text-sm font-bold">
            {user?.firstName?.[0] || 'U'}{user?.lastName?.[0] || ''}
          </div>
        </div>
      </header>

      <main className="space-y-4">
        {/* Location Header */}
        <div className="bg-card p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">Your Location</p>
              <p className="font-semibold">
                {locationError ? "Location unavailable" : userLocation?.address || "Loading..."}
              </p>
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              className="p-2 rounded-full" 
              onClick={requestLocation}
              data-testid="button-refresh-location"
            >
              <i className="fas fa-location-arrow" />
            </Button>
          </div>
        </div>

        {/* Map */}
        <div className="px-4">
          <MapComponent
            center={mapCenter}
            drivers={drivers}
            userLocation={userLocation || undefined}
            height="300px"
          />
        </div>

        {/* Quick Actions */}
        <div className="px-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Button 
              onClick={() => setIsBookingModalOpen(true)}
              className="p-4 text-center font-semibold flex flex-col items-center space-y-2"
              data-testid="button-book-ride"
            >
              <i className="fas fa-plus text-xl" />
              <span>Book a Ride</span>
            </Button>
            <Button 
              variant="secondary"
              className="p-4 text-center font-semibold flex flex-col items-center space-y-2"
              data-testid="button-schedule-ride"
            >
              <i className="fas fa-calendar text-xl" />
              <span>Schedule</span>
            </Button>
          </div>
        </div>

        {/* Nearby Drivers */}
        <div className="px-4 pb-4">
          <h3 className="font-semibold mb-3">Available Drivers Nearby</h3>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              <i className="fas fa-spinner animate-spin text-2xl mb-2" />
              <p>Finding nearby drivers...</p>
            </div>
          ) : drivers.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                <i className="fas fa-car text-3xl mb-2" />
                <p>No drivers available nearby</p>
                <p className="text-sm">Try again in a few minutes</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {drivers.slice(0, 3).map((driver) => (
                <Card key={driver.id} className="border border-border">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <img
                          src={driver.profileImage || "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=50&h=50&fit=crop&crop=face"}
                          alt={`Driver ${driver.name}`}
                          className="w-12 h-12 rounded-full object-cover"
                        />
                        <div>
                          <div className="flex items-center space-x-2">
                            <h4 className="font-semibold" data-testid={`driver-name-${driver.id}`}>
                              {driver.name}
                            </h4>
                            {driver.isVerifiedNeighbor && (
                              <span className="bg-secondary text-secondary-foreground text-xs px-2 py-1 rounded-full">
                                Verified Neighbor
                              </span>
                            )}
                          </div>
                          <div className="flex items-center space-x-1 text-sm">
                            <div className="text-yellow-500">
                              {"★".repeat(Math.floor(driver.rating))}
                            </div>
                            <span className="text-muted-foreground" data-testid={`driver-rating-${driver.id}`}>
                              {driver.rating}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground" data-testid={`driver-vehicle-${driver.id}`}>
                            {driver.vehicle}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">{driver.estimatedTime}</p>
                        <p className="text-lg font-bold text-primary" data-testid={`driver-fare-${driver.id}`}>
                          {driver.estimatedFare}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Emergency SOS Button */}
      <Button
        onClick={() => setIsSOSModalOpen(true)}
        className="fixed bottom-24 right-4 w-14 h-14 rounded-full bg-destructive text-destructive-foreground shadow-lg text-xl font-bold z-40"
        data-testid="button-sos"
      >
        SOS
      </Button>

      {/* Modals */}
      <RideBookingModal
        isOpen={isBookingModalOpen}
        onClose={() => setIsBookingModalOpen(false)}
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
