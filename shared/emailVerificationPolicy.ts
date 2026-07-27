/**
 * Email verification is encouraged at signup but not required until the grace
 * period ends. Update EMAIL_VERIFICATION_MANDATORY_AFTER when extending grace.
 */
export const EMAIL_VERIFICATION_MANDATORY_AFTER = new Date("2026-08-10T00:00:00.000Z");

export function isEmailVerificationMandatory(now: Date = new Date()): boolean {
  return now.getTime() >= EMAIL_VERIFICATION_MANDATORY_AFTER.getTime();
}
