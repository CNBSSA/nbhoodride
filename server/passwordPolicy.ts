// Password complexity policy. Extracted from server/routes.ts so it's
// importable + unit-testable. The signup form (client/src/pages/Signup.tsx)
// mirrors these rules client-side as a live checklist; if you change one,
// change the other.

export interface PasswordPolicyResult {
  valid: boolean;
  feedback: string[];
}

export function validatePasswordComplexity(password: string): PasswordPolicyResult {
  const feedback: string[] = [];
  if (password.length < 8) feedback.push("at least 8 characters");
  if (!/[A-Z]/.test(password)) feedback.push("at least 1 uppercase letter (A-Z)");
  if (!/[a-z]/.test(password)) feedback.push("at least 1 lowercase letter (a-z)");
  if (!/[0-9]/.test(password)) feedback.push("at least 1 number (0-9)");
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    feedback.push("at least 1 special character (!@#$%^&* etc.)");
  }
  return { valid: feedback.length === 0, feedback };
}
