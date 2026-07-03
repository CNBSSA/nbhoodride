import { useEffect, useRef, useState } from "react";

export interface AddressSuggestion {
  label: string;
  lat: number;
  lng: number;
}

/**
 * Debounced address autocomplete backed by the server proxy
 * (/api/geocode/suggest). Returns live suggestions as the user types.
 *
 * Why a server proxy instead of hitting Nominatim from the browser:
 *  - No CORS / shared-IP rate limiting (all riders would share one IP).
 *  - The server sets the required User-Agent and biases to Maryland.
 *  - Returns multiple candidates so the rider PICKS the right address
 *    instead of the old flow silently booking a single limit=1 guess.
 *
 * Stale requests are aborted so a slow response for "123 M" can't
 * overwrite the results for "123 Main St".
 */
export function useGeocodeSuggest(
  query: string,
  opts: { minLength?: number; limit?: number; debounceMs?: number; enabled?: boolean } = {},
) {
  const { minLength = 3, limit = 5, debounceMs = 300, enabled = true } = opts;
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!enabled || q.length < minLength) {
      setSuggestions([]);
      setLoading(false);
      abortRef.current?.abort();
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(
          `/api/geocode/suggest?q=${encodeURIComponent(q)}&limit=${limit}`,
          { credentials: "include", signal: ctrl.signal },
        );
        if (!res.ok) throw new Error("suggest failed");
        const data = (await res.json()) as { suggestions: AddressSuggestion[] };
        setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
      } catch (err) {
        if ((err as any)?.name !== "AbortError") setSuggestions([]);
      } finally {
        // Only clear loading if this request wasn't superseded.
        if (abortRef.current === ctrl) setLoading(false);
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [query, minLength, limit, debounceMs, enabled]);

  return { suggestions, loading };
}
