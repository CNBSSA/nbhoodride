// Client-side CSRF wiring.
//
// Counterpart to server/csrfProtection.ts. The server issues a non-HttpOnly
// `csrf_token` cookie on safe requests; we read it from document.cookie and
// echo it back as `X-CSRF-Token` on every state-changing same-origin request.
//
// We monkey-patch window.fetch once at app boot so every direct fetch() call
// across the codebase gets the header automatically — easier than tracking
// down every call site.

const COOKIE_NAME = "csrf_token";
const HEADER_NAME = "X-CSRF-Token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function readCookie(name: string): string | undefined {
  const cookies = typeof document !== "undefined" ? document.cookie : "";
  if (!cookies) return undefined;
  for (const segment of cookies.split(";")) {
    const eq = segment.indexOf("=");
    if (eq < 0) continue;
    const k = segment.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(segment.slice(eq + 1).trim());
  }
  return undefined;
}

function isSameOrigin(url: string): boolean {
  // Relative URLs are always same-origin.
  if (url.startsWith("/") || !url.includes("://")) return true;
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function installCsrfFetch(): void {
  if (typeof window === "undefined") return;
  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = (init.method ?? (typeof input === "object" && "method" in input ? (input as Request).method : "GET")).toUpperCase();
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;

    if (SAFE_METHODS.has(method) || !isSameOrigin(url)) {
      return originalFetch(input, init);
    }

    const token = readCookie(COOKIE_NAME);
    if (!token) {
      // No token yet — make a best-effort GET to /api/csrf to provision one,
      // then retry the original request. This handles the very first
      // mutation right after a hard reload.
      return originalFetch("/api/csrf", { credentials: "include" })
        .then(() => {
          const refreshed = readCookie(COOKIE_NAME);
          const headers = new Headers(init.headers || {});
          if (refreshed) headers.set(HEADER_NAME, refreshed);
          return originalFetch(input, { ...init, headers, credentials: init.credentials ?? "include" });
        });
    }

    const headers = new Headers(init.headers || {});
    headers.set(HEADER_NAME, token);
    return originalFetch(input, {
      ...init,
      headers,
      credentials: init.credentials ?? "include",
    });
  };
}
