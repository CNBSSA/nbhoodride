export function isUnauthorizedError(error: Error): boolean {
  // Preferred: the structured status set by throwIfResNotOk. The regex stays
  // as a fallback for any error still carrying the old "401: …Unauthorized"
  // prefix format.
  return (error as Error & { status?: number }).status === 401
    || /^401: .*Unauthorized/.test(error.message);
}