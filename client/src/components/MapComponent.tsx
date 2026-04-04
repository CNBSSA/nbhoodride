import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

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
  estimatedTime?: string;
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

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = L.map(mapRef.current).setView([center.lat, center.lng], zoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(mapInstanceRef.current);
    }

    // Clear existing markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // User location dot
    if (userLocation) {
      const userMarker = L.marker([userLocation.lat, userLocation.lng], {
        icon: L.divIcon({
          className: '',
          html: '<div style="background:#3b82f6;width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 0 0 3px rgba(59,130,246,0.3),0 2px 6px rgba(0,0,0,0.3);"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7]
        })
      }).addTo(mapInstanceRef.current);
      markersRef.current.push(userMarker);
    }

    // Set up global selectDriver handler if prop provided
    if (onDriverSelect) {
      (window as any).selectDriver = (driverId: string) => {
        const driver = drivers.find(d => d.id === driverId);
        if (driver) onDriverSelect(driver);
      };
    }

    // Driver markers
    drivers.forEach(driver => {
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:#22c55e;width:36px;height:36px;border-radius:50%;border:3px solid white;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:pointer;">🚗</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });

      const marker = L.marker([driver.location.lat, driver.location.lng], { icon })
        .addTo(mapInstanceRef.current!);

      // Popup shows info only — driver selection is done via the list in the booking panel
      const verified = driver.isVerifiedNeighbor
        ? '<span style="background:#22c55e;color:white;font-size:11px;padding:2px 6px;border-radius:10px;display:inline-block;margin-bottom:4px;">✓ Verified Neighbor</span><br/>'
        : '';

      const selectBtn = onDriverSelect
        ? `<button onclick="window.selectDriver && window.selectDriver('${driver.id}')" style="background:#3b82f6;color:white;border:none;padding:8px 0;border-radius:8px;cursor:pointer;width:100%;margin-top:8px;font-size:14px;font-weight:600;">Select Driver</button>`
        : `<p style="margin:8px 0 0;font-size:12px;color:#6b7280;text-align:center;">Use the booking panel to select</p>`;

      const popup = `
        <div style="min-width:190px;font-family:system-ui,sans-serif;">
          <p style="margin:0 0 4px;font-weight:700;font-size:15px;">${driver.name}</p>
          ${verified}
          <p style="margin:2px 0;font-size:13px;color:#374151;">⭐ ${driver.rating} &nbsp;·&nbsp; ${driver.vehicle}</p>
          <p style="margin:4px 0;font-size:14px;font-weight:700;color:#3b82f6;">${driver.estimatedFare}${driver.estimatedTime ? ` &nbsp;·&nbsp; ${driver.estimatedTime}` : ''}</p>
          ${selectBtn}
        </div>`;

      marker.bindPopup(popup, { maxWidth: 220, className: 'pg-ride-popup' });

      // Also trigger onDriverSelect when marker is clicked (without popup), if provided
      if (onDriverSelect) {
        marker.on('click', () => onDriverSelect(driver));
      }

      markersRef.current.push(marker);
    });

    return () => {
      if ((window as any).selectDriver) delete (window as any).selectDriver;
    };
  }, [center, drivers, userLocation, zoom, onDriverSelect]);

  // Pan map when center changes significantly
  useEffect(() => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([center.lat, center.lng], zoom, { animate: true });
    }
  }, [center.lat, center.lng, zoom]);

  return (
    <div
      ref={mapRef}
      style={{ height, width: '100%' }}
      className="rounded-lg overflow-hidden"
    />
  );
}
