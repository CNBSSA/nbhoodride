/**
 * Whether cookies are marked `Secure` (HTTPS-only). True in production.
 *
 * E2E_INSECURE_COOKIES=1 turns it off so the browser-based layout audit can
 * drive a production-mode build over plain http://127.0.0.1: Chromium accepts
 * Secure cookies on loopback, but WebKit (Safari's engine) drops them, which
 * left the audit unable to log in. Only the e2e harness sets this — never set
 * it on Railway.
 */
export function secureCookies(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  return process.env.E2E_INSECURE_COOKIES !== "1";
}
