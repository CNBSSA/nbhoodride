/** Lost & found status workflow for completed rides. */

export const LOST_FOUND_CATEGORIES = [
  "phone",
  "wallet",
  "keys",
  "bag",
  "clothing",
  "other",
] as const;
export type LostFoundCategory = (typeof LOST_FOUND_CATEGORIES)[number];

export const LOST_FOUND_STATUSES = [
  "reported",
  "driver_notified",
  "driver_has_item",
  "returned",
  "closed_not_found",
  "closed_no_response",
] as const;
export type LostFoundStatus = (typeof LOST_FOUND_STATUSES)[number];

export const OPEN_LOST_FOUND_STATUSES = new Set<LostFoundStatus>([
  "reported",
  "driver_notified",
  "driver_has_item",
]);

export const TERMINAL_LOST_FOUND_STATUSES = new Set<LostFoundStatus>([
  "returned",
  "closed_not_found",
  "closed_no_response",
]);

const DRIVER_TRANSITIONS: Record<string, LostFoundStatus[]> = {
  reported: ["driver_has_item", "closed_not_found"],
  driver_notified: ["driver_has_item", "closed_not_found"],
  driver_has_item: ["returned"],
};

const RIDER_TRANSITIONS: Record<string, LostFoundStatus[]> = {
  driver_has_item: ["returned"],
};

export function canTransitionLostFound(
  from: string,
  to: string,
  actor: "driver" | "rider" | "admin",
): boolean {
  if (TERMINAL_LOST_FOUND_STATUSES.has(from as LostFoundStatus)) return false;
  if (actor === "admin") return LOST_FOUND_STATUSES.includes(to as LostFoundStatus);
  if (actor === "driver") {
    return (DRIVER_TRANSITIONS[from] ?? []).includes(to as LostFoundStatus);
  }
  return (RIDER_TRANSITIONS[from] ?? []).includes(to as LostFoundStatus);
}

export function statusLabel(status: string): string {
  switch (status) {
    case "reported":
      return "Reported";
    case "driver_notified":
      return "Driver notified";
    case "driver_has_item":
      return "Driver has item";
    case "returned":
      return "Returned";
    case "closed_not_found":
      return "Not in vehicle";
    case "closed_no_response":
      return "Closed — no response";
    default:
      return status;
  }
}
