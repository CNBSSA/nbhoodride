import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix for default markers in Leaflet with Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface Driver {
  id: string;
  name: string;
  location: { lat: number; lng: number };
  rating: number;
  vehicle: string;
  estimatedFare: string;
  isVerifiedNeighbor: boolean;
}

interface MapComponentProps {
  center: { lat: number; lng: number };
  drivers: Driver[];
  onDriverSelect?: (driver: Driver) => void;
  userLocation?: { lat: number; lng: number };
  height?: string;
  zoom?: number;
}

export default function MapComponent({ 
  center, 
  drivers, 
  onDriverSelect, 
  userLocation,
  height = "300px",
  zoom = 13 
}: MapComponentProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);

  useEffect(() => {
    if (!mapRef.current) return;

    // Initialize map
    if (!mapInstanceRef.current) {
      mapInstanceRef.current = L.map(mapRef.current).setView([center.lat, center.lng], zoom);
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(mapInstanceRef.current);
    }

    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    // Add user location marker if provided
    if (userLocation) {
      const userMarker = L.marker([userLocation.lat, userLocation.lng], {
        icon: L.divIcon({
          className: 'user-location-marker',
          html: '<div style="background: #3b82f6; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        })
      }).addTo(mapInstanceRef.current);
      markersRef.current.push(userMarker);
    }

    // Add driver markers
    drivers.forEach(driver => {
      const driverIcon = L.divIcon({
        className: 'driver-marker',
        html: `
          <div style="
            background: #22c55e; 
            width: 32px; 
            height: 32px; 
            border-radius: 50%; 
            border: 3px solid white; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            color: white; 
            font-size: 14px;
            font-weight: bold;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            cursor: pointer;
          ">
            🚗
          </div>
        `,
        iconSize: [38, 38],
        iconAnchor: [19, 19]
      });

      const marker = L.marker([driver.location.lat, driver.location.lng], {
        icon: driverIcon
      }).addTo(mapInstanceRef.current!);

      const popupContent = `
        <div style="min-width: 200px;">
          <h3 style="margin: 0 0 8px 0; font-weight: bold;">${driver.name}</h3>
          ${driver.isVerifiedNeighbor ? '<div style="background: #22c55e; color: white; font-size: 12px; padding: 2px 6px; border-radius: 12px; display: inline-block; margin-bottom: 4px;">Verified Neighbor</div>' : ''}
          <p style="margin: 4px 0; font-size: 14px;">⭐ ${driver.rating} • ${driver.vehicle}</p>
          <p style="margin: 4px 0; font-size: 14px; font-weight: bold; color: #3b82f6;">${driver.estimatedFare}</p>
          <button onclick="window.selectDriver && window.selectDriver('${driver.id}')" 
                  style="
                    background: #3b82f6; 
                    color: white; 
                    border: none; 
                    padding: 8px 16px; 
                    border-radius: 6px; 
                    cursor: pointer; 
                    width: 100%; 
                    margin-top: 8px;
                  ">
            Select Driver
          </button>
        </div>
      `;

      marker.bindPopup(popupContent);
      markersRef.current.push(marker);

      // Handle driver selection through global function
      if (onDriverSelect) {
        (window as any).selectDriver = (driverId: string) => {
          const selectedDriver = drivers.find(d => d.id === driverId);
          if (selectedDriver) {
            onDriverSelect(selectedDriver);
          }
        };
      }
    });

    return () => {
      // Cleanup global function
      if ((window as any).selectDriver) {
        delete (window as any).selectDriver;
      }
    };
  }, [center, drivers, userLocation, zoom, onDriverSelect]);

  return (
    <div 
      ref={mapRef} 
      style={{ height, width: '100%' }}
      className="rounded-lg overflow-hidden"
    />
  );
}
