/** Pre-approved in-ride quick messages (no free-text chat). */
export const QUICK_RIDE_MESSAGES = {
  rider_coming_out: { label: "I'm on my way out", from: "rider" as const },
  rider_here: { label: "I'm at the pickup spot", from: "rider" as const },
  rider_late: { label: "Running 2 min late", from: "rider" as const },
  rider_wrong_entrance: { label: "Wrong entrance — see note", from: "rider" as const },
  driver_here: { label: "I'm here", from: "driver" as const },
  driver_traffic: { label: "Stuck in traffic — on my way", from: "driver" as const },
  driver_two_min: { label: "Arriving in ~2 minutes", from: "driver" as const },
} as const;

export type QuickRideMessageKey = keyof typeof QUICK_RIDE_MESSAGES;

export function getQuickMessageText(key: string): string | null {
  const entry = QUICK_RIDE_MESSAGES[key as QuickRideMessageKey];
  return entry?.label ?? null;
}

export function isQuickMessageAllowedForRole(
  key: string,
  role: "rider" | "driver",
): boolean {
  const entry = QUICK_RIDE_MESSAGES[key as QuickRideMessageKey];
  if (!entry) return false;
  return entry.from === role;
}
