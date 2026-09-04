/**
 * When the email-verification login gate applies.
 *
 * Two rules, both about not locking out legitimate riders:
 *
 * 1. A grace period after launch (EMAIL_VERIFICATION_MANDATORY_AFTER).
 * 2. Deliverability. Requiring a rider to click a verification link when the
 *    server cannot send one is a deadlock: it blocks every legitimate user and
 *    stops no attacker, since nobody can verify either way. Signups already
 *    pass a stronger control — an admin approves each account by hand — so
 *    when outbound email is not operational the gate stands down.
 *
 * Waivers are recorded per user (emailVerificationWaivedAt) rather than
 * recomputed at each login. Without that, repairing email delivery would
 * instantly lock out everyone who signed up during the outage — the rule
 * would change under people who had already been let in.
 */

export const EMAIL_VERIFICATION_MANDATORY_AFTER = new Date("2026-08-10T00:00:00.000Z");

export function isEmailVerificationMandatory(now: Date = new Date()): boolean {
  return now.getTime() >= EMAIL_VERIFICATION_MANDATORY_AFTER.getTime();
}

export interface VerificationGateUser {
  registrationCompletedAt?: Date | string | null;
  emailVerifiedAt?: Date | string | null;
  emailVerificationWaivedAt?: Date | string | null;
  isAdmin?: boolean | null;
  isSuperAdmin?: boolean | null;
}

export type VerificationGateDecision =
  /** Refuse the login until the address is verified. */
  | { allow: false }
  /** Let them in; `waive` means record a waiver so this stays true later. */
  | { allow: true; waive: boolean; reason: "verified" | "waived_previously" | "not_mandatory" | "legacy_account" | "admin" | "email_undeliverable" };

export function evaluateEmailVerificationGate(
  user: VerificationGateUser,
  options: { emailDeliverable: boolean; now?: Date },
): VerificationGateDecision {
  const { emailDeliverable, now = new Date() } = options;

  if (user.emailVerifiedAt) return { allow: true, waive: false, reason: "verified" };
  if (user.emailVerificationWaivedAt) return { allow: true, waive: false, reason: "waived_previously" };
  if (user.isAdmin || user.isSuperAdmin) return { allow: true, waive: false, reason: "admin" };
  if (!isEmailVerificationMandatory(now)) return { allow: true, waive: false, reason: "not_mandatory" };
  // Accounts predating the verification flow never had a link to click.
  if (!user.registrationCompletedAt) return { allow: true, waive: false, reason: "legacy_account" };

  if (!emailDeliverable) {
    // Waive and remember, so fixing email later doesn't lock this rider out.
    return { allow: true, waive: true, reason: "email_undeliverable" };
  }

  return { allow: false };
}
