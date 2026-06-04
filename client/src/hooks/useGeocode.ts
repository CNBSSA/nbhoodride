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
  // Guards against setState-on-unmounted-component warnings when the
  // parent unmounts during an in-flight fetch. Without this, AbortError's
  // finally still ran setLoading(false) on a dead instance.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
        if (!ctrl.signal.aborted && mountedRef.current) {
          setCandidates(Array.isArray(body.candidates) ? body.candidates : []);
        }
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        if (mountedRef.current) {
          setError(String(err?.message ?? err));
          setCandidates([]);
        }
      } finally {
        // Only clear loading if THIS request wasn't superseded — otherwise
        // we'd flicker the spinner off between an aborted fetch and the
        // next debounced one, and (worse) hit a setState-on-unmounted
        // warning if the component unmounted while a request was inflight.
        if (!ctrl.signal.aborted && mountedRef.current) {
          setLoading(false);
        }
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
