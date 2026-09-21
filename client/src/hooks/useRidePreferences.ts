import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { ridePreferencesOrDefaults, type RidePreferences } from "@shared/ridePreferences";

/** The one cache entry a rider's preferences live in. Both readers share it. */
export const RIDE_PREFERENCES_KEY = ["/api/user/ride-preferences"] as const;

/**
 * A rider's preferences, always a whole object.
 *
 * Signed out this request is a 401, and we take `null` for an answer rather
 * than bouncing a visitor to the sign-in page (the app-wide 401 handler treats
 * a thrown 401 as "your session died"). Because the language provider and the
 * Profile screen share this cache entry, that `null` is what both of them
 * read — so neither of them sees it: it becomes a new rider's preferences on
 * the way out (shared/ridePreferences.ts).
 */
export function useRidePreferences(): { preferences: RidePreferences; isLoading: boolean } {
  const { data, isLoading } = useQuery<Partial<RidePreferences> | null>({
    queryKey: RIDE_PREFERENCES_KEY,
    queryFn: getQueryFn<Partial<RidePreferences> | null>({ on401: "returnNull" }),
    retry: false,
  });
  return { preferences: ridePreferencesOrDefaults(data), isLoading };
}
