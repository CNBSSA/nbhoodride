import { useCallback, useEffect, useRef, useState } from "react";

export type GeocodeCandidate = {
  label: string;
  lat: number;
  lng: number;
  source: string;
};

/**
 * Server-proxied geocoding suggestions for an autocomplete field.
 *
 * Use this from any "type a destination" UX. Returns the top-N matching
 * candidates so the UI can render a dropdown — replaces the old limit=1
 * pattern that silently dropped good candidates in positions 2-5.
 *
 * Debounces requests by 350 ms and cancels stale requests so fast typing
 * doesn't pile up in-flight calls or land a stale result.
 */
export function useGeocodeSuggest(query: string, opts: { minLength?: number; limit?: number } = {}) {
  const minLength = opts.minLength ?? 3;
  const limit = opts.limit ?? 5;
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < minLength) {
      setCandidates([]);
      setLoading(false);
      setError(null);
      return;
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/geocode/suggest?q=${encodeURIComponent(trimmed)}&limit=${limit}`,
          { credentials: "include", signal: ctrl.signal }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { candidates: GeocodeCandidate[] };
        setCandidates(Array.isArray(body.candidates) ? body.candidates : []);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setError(String(err?.message ?? err));
        setCandidates([]);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      abortRef.current?.abort();
    };
  }, [query, minLength, limit]);

  return { candidates, loading, error };
}

/** One-shot geocode for callers that don't want a suggestion dropdown. */
export function useGeocodeForward() {
  return useCallback(async (query: string): Promise<GeocodeCandidate | null> => {
    const trimmed = query.trim();
    if (trimmed.length < 3) return null;
    const res = await fetch(`/api/geocode/forward?q=${encodeURIComponent(trimmed)}`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { candidate: GeocodeCandidate | null };
    return body.candidate ?? null;
  }, []);
}
