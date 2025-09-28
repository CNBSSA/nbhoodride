import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";

interface EmergencyIncident {
  id: string;
  incidentType: string;
  description?: string;
  location?: { lat: number; lng: number };
  status: string;
  createdAt: string;
  lastLocationUpdate?: string;
}

export default function EmergencyTracking() {
  const { token } = useParams<{ token: string }>();
  const [mapLoaded, setMapLoaded] = useState(false);

  const { data: incident, isLoading, error } = useQuery<EmergencyIncident>({
    queryKey: [`/api/emergency/incident/${token}`],
    enabled: !!token,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  useEffect(() => {
    if (incident && !mapLoaded) {
      loadMap();
    }
  }, [incident, mapLoaded]);

  const loadMap = () => {
    // Load Leaflet CSS and JS dynamically
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => {
      initializeMap();
    };
    document.head.appendChild(script);
  };

  const initializeMap = () => {
    if (!incident || !window.L) return;

    const map = window.L.map('emergency-map');
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    let marker: any = null;

    if (incident.location) {
      marker = window.L.marker([incident.location.lat, incident.location.lng]).addTo(map);
      marker.bindPopup('Emergency Location').openPopup();
      map.setView([incident.location.lat, incident.location.lng], 15);
    } else {
      // Default to PG County center
      map.setView([38.9897, -76.9378], 11);
    }

    setMapLoaded(true);

    // WebSocket for live updates
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    try {
      const ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'emergency_location_update' && data.incidentId === incident.id) {
          if (marker) {
            // Update existing marker
            marker.setLatLng([data.location.lat, data.location.lng]);
          } else {
            // Create marker if it doesn't exist
            marker = window.L.marker([data.location.lat, data.location.lng]).addTo(map);
            marker.bindPopup('Emergency Location').openPopup();
          }
          map.setView([data.location.lat, data.location.lng], 15);
        }
      };
    } catch (error) {
      console.error('WebSocket connection failed:', error);
    }
  };

  const handleCallEmergency = () => {
    window.location.href = "tel:911";
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <i className="fas fa-spinner animate-spin text-3xl text-primary mb-4" />
          <p>Loading emergency tracking...</p>
        </div>
      </div>
    );
  }

  if (error || !incident) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <i className="fas fa-exclamation-triangle text-4xl text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Emergency Not Found</h2>
            <p className="text-muted-foreground mb-4">
              This emergency tracking link may have expired or been resolved.
            </p>
            <Button onClick={handleCallEmergency} className="w-full">
              <i className="fas fa-phone mr-2" />
              Call 911
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Emergency Info Header */}
      <div className="bg-destructive text-destructive-foreground p-4">
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="bg-white/20 px-2 py-1 rounded text-sm font-bold">
              🚨 EMERGENCY TRACKING
            </span>
            <span className={`px-2 py-1 rounded text-sm font-bold ${
              incident.status === 'active' ? 'bg-orange-500' : 'bg-green-500'
            }`}>
              {incident.status.toUpperCase()}
            </span>
          </div>
          <h1 className="text-lg font-bold">
            {incident.description || incident.incidentType}
          </h1>
          <p className="text-sm opacity-90">
            Started: {new Date(incident.createdAt).toLocaleString()}
          </p>
          {incident.lastLocationUpdate && (
            <p className="text-sm opacity-90">
              Last Update: {new Date(incident.lastLocationUpdate).toLocaleTimeString()}
            </p>
          )}
        </div>
      </div>

      {/* Emergency Actions */}
      <div className="p-4 bg-card border-b">
        <div className="max-w-md mx-auto flex space-x-2">
          <Button 
            onClick={handleCallEmergency}
            className="flex-1 bg-destructive text-destructive-foreground"
            data-testid="button-call-911-tracking"
          >
            <i className="fas fa-phone mr-2" />
            Call 911
          </Button>
          <Button 
            variant="outline"
            onClick={() => window.location.reload()}
            data-testid="button-refresh-tracking"
          >
            <i className="fas fa-sync-alt" />
          </Button>
        </div>
      </div>

      {/* Map Container */}
      <div className="relative h-[calc(100vh-200px)]">
        <div id="emergency-map" className="h-full w-full"></div>
        
        {!incident.location && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
            <Card>
              <CardContent className="p-4 text-center">
                <i className="fas fa-map-marker-alt text-2xl text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  Waiting for location data...
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Safety Notice */}
      <div className="p-4 bg-muted/50 text-center">
        <p className="text-sm text-muted-foreground">
          This page shows live emergency location tracking. 
          Location updates automatically when available.
        </p>
      </div>
    </div>
  );
}

// Extend Window type for Leaflet
declare global {
  interface Window {
    L: any;
  }
}