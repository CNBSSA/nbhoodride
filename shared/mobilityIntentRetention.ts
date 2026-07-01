/** Privacy retention for mobility_intents (raw utterances may contain PII). */

/** Days to retain full utterance rows before purge (PR #46 follow-up). */
export const MOBILITY_INTENT_RETENTION_DAYS = 90;

export function getMobilityIntentPurgeCutoff(
  now: Date = new Date(),
  retentionDays = MOBILITY_INTENT_RETENTION_DAYS,
): Date {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  return cutoff;
}
