/**
 * Driver badges — who is cleared for which kind of commercial work.
 *
 * Any approved driver may take an ordinary rider. Commercial work is
 * different: a facility's passenger needs a driver who has been cleared for
 * medical transport, and a parcel needs one cleared for deliveries. A badge
 * is granted by the operator after whatever the agreement and the insurer
 * require; the app's job is to make sure an unbadged driver never sees the
 * work and cannot claim it if they somehow do.
 *
 * Badges decide what a driver is SHOWN, never which app they open: one
 * driver app, one claim board, rides and jobs in the same list.
 */

export const DRIVER_BADGES = ["medical", "delivery"] as const;
export type DriverBadge = (typeof DRIVER_BADGES)[number];

export const BADGE_LABELS: Record<DriverBadge, string> = {
  medical: "Medical transport",
  delivery: "Deliveries",
};

export const BADGE_REQUIREMENTS: Record<DriverBadge, string> = {
  medical: "Background check on file, passenger-assistance training, and the vehicle the facility's riders need.",
  delivery: "Background check on file and a vehicle with usable cargo space.",
};

export const isDriverBadge = (v: unknown): v is DriverBadge => DRIVER_BADGES.includes(v as DriverBadge);

/** Only known badges, de-duplicated, in a stable order. */
export function normalizeBadges(raw: unknown): DriverBadge[] {
  const list = Array.isArray(raw) ? raw : [];
  return DRIVER_BADGES.filter((b) => list.includes(b));
}

export type JobKind = "ride" | "delivery";

/**
 * The badge a commercial job needs, from what the job IS and who booked it.
 *
 * A parcel needs the delivery badge whoever sends it. A person on a medical
 * account's job needs the medical badge. A person on a business or food
 * account's job — an employee's ride, a guest collected from the airport —
 * is an ordinary ride and needs no badge at all. Until 2026-09-16 the badge
 * followed the category alone, so every business job, rides included, went
 * only to parcel-cleared drivers.
 */
export function requiredBadge(category: string | null | undefined, kind: JobKind = "ride"): DriverBadge | null {
  if (kind === "delivery") return "delivery";
  if (category === "medical") return "medical";
  return null;
}

/** May this driver take this job? An ordinary ride has no category and needs nothing. */
export function driverMayTake(badges: unknown, category: string | null | undefined, kind: JobKind = "ride"): boolean {
  const needed = requiredBadge(category, kind);
  if (!needed) return true;
  return normalizeBadges(badges).includes(needed);
}

/** What a driver is told when they are not cleared for the work. */
export function badgeRefusalMessage(category: string | null | undefined, kind: JobKind = "ride"): string {
  const needed = requiredBadge(category, kind);
  if (!needed) return "This job is not available to you.";
  return `This job needs the ${BADGE_LABELS[needed]} badge. ${BADGE_REQUIREMENTS[needed]} Ask PG Ride to add it to your account.`;
}

export function describeBadges(badges: unknown): string {
  const list = normalizeBadges(badges);
  if (list.length === 0) return "Ordinary rides only";
  return list.map((b) => BADGE_LABELS[b]).join(" · ");
}
