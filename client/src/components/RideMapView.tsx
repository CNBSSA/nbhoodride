import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useRoute } from "@/hooks/useRoute";
import { metersToMiles, secondsToMinutes } from "@shared/routeGeometry";
import { Navigation, Loader2 } from "lucide-react";

interface LatLng { lat: number; lng: number }

interface RideMapViewProps {
  /** Where the trip target is (pickup while heading to rider, destination while driving them). */
  target: LatLng;
  targetLabel: string;
  /**
   * The driver's live position. If omitted, the component watches the device
   * geolocation itself (so it works even when a parent doesn't thread it in).
   */
  driver?: LatLng | null;
  /** "pickup" tints the route PG blue; "destination" tints it green. */
  leg?: "pickup" | "destination";
  height?: string;
}

/**
 * In-app driver navigation map. Draws the driver's live position, the target
 * pin, and a REAL road-following driving route between them (served by
 * /api/route). Keeps the driver inside PG Ride instead of bouncing out to
 * Google Maps — an external-nav button remains available in the ride card as
 * a fallback for drivers who prefer it.
 */
export function RideMapView({
  target,
  targetLabel,
  driver,
  leg = "destination",
  height = "260px",
}: RideMapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const driverMarkerRef = useRef<L.Marker | null>(null);
  const targetMarkerRef = useRef<L.Marker | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const fittedRef = useRef(false);

  // Self-watch geolocation only if the parent didn't provide a position.
  const [selfLoc, setSelfLoc] = useState<LatLng | null>(null);
  useEffect(() => {
    if (driver || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => setSelfLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [driver]);

  const driverLoc = driver ?? selfLoc;
  const routeColor = leg === "pickup" ? "#339AF0" : "#16a34a";

  const { route, loading } = useRoute(driverLoc, target, { enabled: !!driverLoc });

  // Init map once.
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;
    const start = driverLoc ?? target;
    mapInstanceRef.current = L.map(mapRef.current, { zoomControl: true }).setView([start.lat, start.lng], 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(mapInstanceRef.current);
  }, [driverLoc, target]);

  // Target pin.
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    targetMarkerRef.current?.remove();
    targetMarkerRef.current = L.marker([target.lat, target.lng], {
      icon: L.divIcon({
        className: "",
        html: `<div style="background:${routeColor};width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;"><span style="transform:rotate(45deg);font-size:14px;">📍</span></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 30],
      }),
    }).addTo(mapInstanceRef.current).bindPopup(`<b>${targetLabel}</b>`);
  }, [target.lat, target.lng, targetLabel, routeColor]);

  // Driver marker — moves with each position update (no full remount).
  useEffect(() => {
    if (!mapInstanceRef.current || !driverLoc) return;
    if (!driverMarkerRef.current) {
      driverMarkerRef.current = L.marker([driverLoc.lat, driverLoc.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="background:#111827;width:38px;height:38px;border-radius:50%;border:3px solid white;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 0 0 4px rgba(17,24,39,0.2),0 2px 8px rgba(0,0,0,0.35);">🚗</div>`,
          iconSize: [38, 38],
          iconAnchor: [19, 19],
        }),
        zIndexOffset: 1000,
      }).addTo(mapInstanceRef.current);
    } else {
      driverMarkerRef.current.setLatLng([driverLoc.lat, driverLoc.lng]);
    }
  }, [driverLoc?.lat, driverLoc?.lng]);

  // Route polyline. Falls back to a straight driver→target line until the
  // server route arrives (or if routing is degraded).
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const line: Array<[number, number]> = route?.coordinates?.length
      ? route.coordinates
      : driverLoc
        ? [[driverLoc.lat, driverLoc.lng], [target.lat, target.lng]]
        : [];
    if (line.length < 2) return;

    routeLineRef.current?.remove();
    routeLineRef.current = L.polyline(line, {
      color: routeColor,
      weight: 5,
      opacity: 0.85,
      lineJoin: "round",
    }).addTo(mapInstanceRef.current);

    // Fit the whole route into view once when it first appears.
    if (!fittedRef.current) {
      mapInstanceRef.current.fitBounds(routeLineRef.current.getBounds(), { padding: [40, 40] });
      fittedRef.current = true;
    }
  }, [route, driverLoc?.lat, driverLoc?.lng, target.lat, target.lng, routeColor]);

  useEffect(() => () => { mapInstanceRef.current?.remove(); mapInstanceRef.current = null; }, []);

  const miles = route ? metersToMiles(route.distanceMeters) : null;
  const mins = route ? secondsToMinutes(route.durationSeconds) : null;

  return (
    <div className="relative rounded-xl overflow-hidden border border-gray-200">
      <div ref={mapRef} style={{ height, width: "100%" }} />
      <div className="absolute top-2 left-2 z-[500] bg-white/95 backdrop-blur rounded-lg px-3 py-1.5 shadow flex items-center gap-2 text-sm">
        <Navigation className="w-4 h-4" style={{ color: routeColor }} />
        <span className="font-semibold text-gray-800">
          {leg === "pickup" ? "To pickup" : "To destination"}
        </span>
        {route && miles != null && mins != null ? (
          <span className="text-gray-500">· {miles} mi · ~{mins} min</span>
        ) : loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
        ) : null}
      </div>
    </div>
  );
}
