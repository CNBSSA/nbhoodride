/**
 * A rider's ride preferences, and what they are when we do not have them.
 *
 * These are read in two places that share one query cache entry
 * (`/api/user/ride-preferences`): the app-wide language provider, which asks
 * for them on every page including ones a signed-out visitor can open, and the
 * Profile screen, which shows and edits them.
 *
 * Signed out (or with a session that has just died) that request is a 401, and
 * the provider deliberately takes `null` for an answer rather than bouncing a
 * visitor to the sign-in page. Both readers share the cache entry, so that
 * `null` is what Profile reads too — and a default written as
 * `const { data = {...} }` does not apply to `null`, only to `undefined`. That
 * is how a rider tapping Profile met the error screen with "null is not an
 * object (evaluating 'calmRideMode')" (Chima Igwe, 2026-09-20).
 *
 * So nothing reads the raw answer: both go through `ridePreferencesOrDefaults`,
 * which turns nothing at all into the same preferences a new rider has.
 */

export type CalmRideMode = string;

export interface RidePreferences {
  calmRideMode: CalmRideMode;
  preferredLanguage: string;
  minimizeNotifications: boolean;
}

/** What a rider has before they have chosen anything (shared/schema.ts defaults). */
export const DEFAULT_RIDE_PREFERENCES: RidePreferences = {
  calmRideMode: "off",
  preferredLanguage: "en",
  minimizeNotifications: false,
};

/**
 * The preferences to show, whatever came back: a whole answer, a partial one,
 * nothing, or the `null` of a request that was not authorised.
 */
export function ridePreferencesOrDefaults(data: Partial<RidePreferences> | null | undefined): RidePreferences {
  if (!data || typeof data !== "object") return { ...DEFAULT_RIDE_PREFERENCES };
  return {
    calmRideMode: typeof data.calmRideMode === "string" && data.calmRideMode ? data.calmRideMode : DEFAULT_RIDE_PREFERENCES.calmRideMode,
    preferredLanguage: typeof data.preferredLanguage === "string" && data.preferredLanguage ? data.preferredLanguage : DEFAULT_RIDE_PREFERENCES.preferredLanguage,
    minimizeNotifications: typeof data.minimizeNotifications === "boolean" ? data.minimizeNotifications : DEFAULT_RIDE_PREFERENCES.minimizeNotifications,
  };
}
