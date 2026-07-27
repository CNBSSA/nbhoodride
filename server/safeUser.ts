import type { User } from "@shared/schema";

const SENSITIVE_USER_FIELDS = [
  "password",
  "passwordResetToken",
  "passwordResetExpiry",
  "emailVerificationToken",
  "emailVerificationExpiry",
  "stripeCustomerId",
  "stripePaymentMethodId",
] as const;

/** Strip secrets and payment identifiers before sending a user to the client. */
export function toSafeUser<T extends User>(user: T): Omit<T, (typeof SENSITIVE_USER_FIELDS)[number]> {
  const copy = { ...user } as Record<string, unknown>;
  for (const key of SENSITIVE_USER_FIELDS) {
    delete copy[key];
  }
  return copy as Omit<T, (typeof SENSITIVE_USER_FIELDS)[number]>;
}
