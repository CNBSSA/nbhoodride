/**
 * The day's jobs on a map: a numbered pin at each pickup, a fainter pin at
 * each destination, fitted to show them all. Read-only; the board beside
 * it carries the detail.
 */
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface MapJob {
  id: string;
  jobNumber: number;
  status: string;
  pickup: { lat: number; lng: number; address: string };
  destination: { lat: number; lng: number; address: string };
  passengerName?: string | null;
}

const COUNTY_CENTER: [number, number] = [38.83, -76.85];

const pinIcon = (label: string, tone: "pickup" | "drop") =>
  L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${tone === "pickup" ? "#0c5bb5" : "#9aa5b8"};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"><span style="transform:rotate(45deg);color:#fff;font:600 11px/1 system-ui,sans-serif">${label}</span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
  });

export function JobsMap({ jobs, height = "320px" }: { jobs: MapJob[]; height?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(COUNTY_CENTER, 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap" }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; layer.current = null; };
  }, []);

  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    const points: L.LatLngExpression[] = [];
    for (const j of jobs) {
      if (!j.pickup || !Number.isFinite(j.pickup.lat)) continue;
      const n = String(j.jobNumber).slice(-2);
      L.marker([j.pickup.lat, j.pickup.lng], { icon: pinIcon(n, "pickup") })
        .bindTooltip(`J-${String(j.jobNumber).padStart(5, "0")} · ${j.passengerName ?? ""} · ${j.status.replace("_", " ")}`)
        .addTo(layer.current);
      points.push([j.pickup.lat, j.pickup.lng]);
      if (j.destination && Number.isFinite(j.destination.lat)) {
        L.marker([j.destination.lat, j.destination.lng], { icon: pinIcon(n, "drop"), opacity: 0.85 })
          .bindTooltip(`to ${j.destination.address}`)
          .addTo(layer.current);
        L.polyline([[j.pickup.lat, j.pickup.lng], [j.destination.lat, j.destination.lng]], { color: "#0c5bb5", weight: 2, opacity: 0.35, dashArray: "4 6" }).addTo(layer.current);
        points.push([j.destination.lat, j.destination.lng]);
      }
    }
    if (points.length > 0) map.current.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 14 });
    else map.current.setView(COUNTY_CENTER, 11);
  }, [jobs]);

  return <div ref={el} style={{ height, width: "100%" }} className="rounded-lg border overflow-hidden" data-testid="portal-jobs-map" />;
}
