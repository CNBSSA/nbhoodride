/**
 * Emergency (SOS) share links — how long a link keeps working.
 *
 * When a rider triggers SOS, the app mints an unguessable share link so a
 * guardian can watch their live location. That capability must not last
 * forever: once the incident is resolved, the link stays readable for a
 * grace period (so a guardian who opens it a little later still sees the
 * outcome) and then goes dark, the same way guardian ride links expire.
 * Before this, a resolved incident's link answered indefinitely.
 */

export const EMERGENCY_SHARE_GRACE_HOURS = 24;

export const EMERGENCY_SHARE_EXPIRED_MESSAGE =
  `This emergency link has expired. The incident was resolved more than ${EMERGENCY_SHARE_GRACE_HOURS} hours ago.`;

export interface EmergencyShareState {
  status?: string | null;
  resolvedAt?: Date | string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
}

const toMs = (v: Date | string | null | undefined): number | undefined => {
  if (v === null || v === undefined) return undefined;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : undefined;
};

/**
 * True while the share link should still answer: the incident is not
 * resolved, or it was resolved less than the grace period ago. A resolved
 * incident with no usable timestamp is treated as expired.
 */
export function emergencyShareLinkOpen(incident: EmergencyShareState, now: Date = new Date()): boolean {
  if (incident.status !== "resolved") return true;
  const since = toMs(incident.resolvedAt) ?? toMs(incident.updatedAt) ?? toMs(incident.createdAt);
  if (since === undefined) return false;
  return now.getTime() - since < EMERGENCY_SHARE_GRACE_HOURS * 3_600_000;
}
