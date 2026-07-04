import type { Request, Response, NextFunction } from "express";
import { randomBytes } from "crypto";

// Minimal CSRF protection using the double-submit-cookie pattern.
//
// On the first GET (typically the SPA boot), we issue a non-HttpOnly cookie
// `csrf_token` with a random 32-byte hex value. The client reads it from
// document.cookie and echoes it back as `X-CSRF-Token` on every state-
// changing request. The middleware compares the header against the cookie and
// rejects mismatches with 403.
//
// SameSite=Lax already blocks most cross-origin write attempts; this middleware
// is defense in depth — and a hard requirement for parity with most security
// review checklists.

const COOKIE_NAME = "csrf_token";
const HEADER_NAME = "x-csrf-token";
const TOKEN_BYTES = 32;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const segment of header.split(";")) {
    const eq = segment.indexOf("=");
    if (eq < 0) continue;
    const k = segment.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(segment.slice(eq + 1).trim());
  }
  return undefined;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function issueToken(req: Request, res: Response): string {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  res.cookie(COOKIE_NAME, token, {
    // The client (browser JS) needs to read this to echo it back as a header,
    // so it intentionally is NOT httpOnly. SameSite + same-origin policy
    // prevent cross-site reads.
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // Refresh the cookie roughly each session (1 week). It's not strictly
    // tied to the session — it just needs to be hard for an attacker to guess.
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return token;
}

function isExempt(req: Request): boolean {
  // Webhooks have their own signature verification (Stripe / Checkr).
  if (req.path.startsWith("/api/webhooks/")) return true;
  // Health checks.
  if (req.path === "/health" || req.path === "/health/ready") return true;
  return false;
}

export function csrfMiddleware(req: Request, res: Response, next: NextFunction) {
  // Make sure every visitor walks away with a token after their first request,
  // regardless of method. The cookie is set headers-out on the same response.
  const existing = readCookie(req, COOKIE_NAME);
  if (!existing) {
    issueToken(req, res);
  }

  // Safe methods don't need validation.
  if (SAFE_METHODS.has(req.method)) return next();

  // Only enforce on /api/*. Static asset POSTs (Vite dev / etc) are out of scope.
  if (!req.path.startsWith("/api/")) return next();

  if (isExempt(req)) return next();

  const headerToken = req.headers[HEADER_NAME];
  const cookieToken = existing;
  const headerVal = Array.isArray(headerToken) ? headerToken[0] : headerToken;

  if (!cookieToken || !headerVal || !constantTimeEqual(cookieToken, String(headerVal))) {
    return res.status(403).json({
      message: "CSRF token missing or invalid. Refresh the page and try again.",
      csrfFailed: true,
    });
  }

  return next();
}

// Tiny no-op endpoint handler — exists so the SPA can ping the server once
// to make sure a token cookie is in place before its first POST. Useful for
// fetch-based clients that wouldn't otherwise have made a GET.
export function csrfTokenEndpoint(_req: Request, res: Response) {
  res.json({ ok: true });
}
