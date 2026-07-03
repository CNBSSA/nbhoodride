import { useEffect, useRef, useState } from "react";

export interface DrivingRoute {
  coordinates: Array<[number, number]>;
  distanceMeters: number;
  durationSeconds: number;
}

interface LatLng { lat: number; lng: number }

/**
 * Fetches a driving route (road-following polyline + ETA) from the server
 * proxy for the in-app driver map.
 *
 * The route is keyed on the TARGET, not the live driver position — otherwise
 * every GPS tick would refetch. It fetches once when the target (leg) changes
 * or `from` first becomes available, then refreshes on an interval using the
 * latest position (read from a ref), so the drawn route stays roughly current
 * as the driver moves without hammering the endpoint. Stale requests abort.
 */
export function useRoute(
  from: LatLng | null | undefined,
  to: LatLng | null | undefined,
  opts: { enabled?: boolean; refreshMs?: number } = {},
) {
  const { enabled = true, refreshMs = 25000 } = opts;
  const [route, setRoute] = useState<DrivingRoute | null>(null);
  const [loading, setLoading] = useState(false);
  const fromRef = useRef(from);
  fromRef.current = from;
  const abortRef = useRef<AbortController | null>(null);

  // Target identity — refetch when the leg changes, not on every from-tick.
  const toKey = to ? `${to.lat.toFixed(5)},${to.lng.toFixed(5)}` : "";
  const hasFrom = !!from;

  useEffect(() => {
    if (!enabled || !to || !hasFrom) {
      setRoute(null);
      return;
    }

    const fetchRoute = async () => {
      const f = fromRef.current;
      if (!f) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/route?fromLat=${f.lat}&fromLng=${f.lng}&toLat=${to.lat}&toLng=${to.lng}`,
          { credentials: "include", signal: ctrl.signal },
        );
        if (!res.ok) throw new Error("route failed");
        const data = (await res.json()) as { route: DrivingRoute };
        if (data?.route?.coordinates?.length) setRoute(data.route);
      } catch (err) {
        if ((err as any)?.name !== "AbortError") {
          // Keep whatever route we last had rather than blanking the map.
        }
      } finally {
        if (abortRef.current === ctrl) setLoading(false);
      }
    };

    fetchRoute();
    const id = setInterval(fetchRoute, refreshMs);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
    // toKey captures target changes; hasFrom flips false→true once.
  }, [enabled, toKey, hasFrom, refreshMs]);

  return { route, loading };
}
