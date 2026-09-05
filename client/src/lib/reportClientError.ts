/**
 * Report an in-app failure to the server so the operator is alerted. Fire and
 * forget, capped per session, and never allowed to throw — an error reporter
 * that itself errors is worse than none.
 */
import { apiRequest } from "@/lib/queryClient";

const MAX_PER_SESSION = 5;
let sent = 0;
const seen = new Set<string>();

export function reportClientError(input: { kind?: "client_error" | "push_subscribe_failed"; message: string }): void {
  try {
    const message = String(input.message ?? "").slice(0, 300);
    if (!message || sent >= MAX_PER_SESSION || seen.has(message)) return;
    seen.add(message);
    sent += 1;
    apiRequest("POST", "/api/client-errors", {
      kind: input.kind ?? "client_error",
      message,
      page: typeof window !== "undefined" ? window.location.pathname : "",
    }).catch(() => {});
  } catch {
    /* never throw from the reporter */
  }
}

/** Install once: uncaught errors and unhandled promise rejections. */
export function installGlobalErrorReporting(): void {
  if (typeof window === "undefined" || (window as any).__pgrideErrorReporting) return;
  (window as any).__pgrideErrorReporting = true;
  window.addEventListener("error", (e) => {
    const msg = e?.error?.message || e?.message;
    if (msg) reportClientError({ message: `${msg}${e.filename ? ` @ ${e.filename.split("/").pop()}:${e.lineno}` : ""}` });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r: any = e?.reason;
    const msg = r?.message || (typeof r === "string" ? r : "");
    // Auth redirects surface as rejected fetches; those are handled elsewhere.
    if (msg && !/^401|Unauthorized/i.test(msg)) reportClientError({ message: `Unhandled: ${msg}` });
  });
}
