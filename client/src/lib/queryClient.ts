import { QueryClient, QueryCache, MutationCache, QueryFunction } from "@tanstack/react-query";
import { isUnauthorizedError } from "./authUtils";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    // API errors are JSON like {"message":"…"} and err.message feeds
    // user-facing toasts across the app — surface the human sentence, not
    // `403: {"message":…}` raw JSON. The HTTP status travels as a structured
    // property (isUnauthorizedError checks it).
    let message = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.message === "string" && parsed.message.length > 0) {
        message = parsed.message;
      }
    } catch {
      // Non-JSON body (proxy/HTML error page) — keep the raw text.
    }
    const error = new Error(message) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
}

export function getCsrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (data) headers["Content-Type"] = "application/json";
  const csrfToken = getCsrfToken();
  if (csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

// When any query or mutation fails with a 401, the session has died on the
// server (expired cookie, logged out elsewhere) while the SPA may still be
// showing cached data (staleTime: Infinity). Rather than leave the user staring
// at a cryptic "Unauthorized" toast on a page that looks logged in, send them to
// re-authenticate. A hard navigation also discards the stale in-memory cache.
//
// Guards:
// - Only on the browser, and never when already on an auth page (prevents loops;
//   the login page's own useAuth 401 is handled with on401:"returnNull" and never
//   reaches here anyway).
// - `?expired=1` lets the login page explain why they landed there.
let redirectingForAuth = false;
function handleAuthError(error: unknown) {
  if (typeof window === "undefined") return;
  if (!(error instanceof Error) || !isUnauthorizedError(error)) return;
  const path = window.location.pathname;
  if (path.startsWith("/login") || path.startsWith("/signup") ||
      path.startsWith("/forgot-password") || path.startsWith("/reset-password") ||
      path.startsWith("/verify-email")) {
    return;
  }
  if (redirectingForAuth) return;
  redirectingForAuth = true;
  window.location.href = "/login?expired=1";
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleAuthError }),
  mutationCache: new MutationCache({ onError: handleAuthError }),
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
