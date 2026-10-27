/**
 * What may leave PG Ride in an error report (Sentry work order, Chairman
 * 2026-10-27). PG Ride holds riders' names, phones, home addresses, passengers'
 * details and drivers' documents, so a report carries a stack trace, a
 * scrubbed message and a handful of opaque tags — and nothing else.
 *
 * Pure functions with no Sentry import, so the rules are unit-tested and the
 * server module (server/errorReporting.ts) is a thin wrapper around them.
 * Everything fails closed: an event that cannot be scrubbed is not sent.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STREET_WORDS = "Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Boulevard|Blvd|Way|Place|Pl|Highway|Hwy|Parkway|Pkwy|Circle|Cir|Terrace|Ter";

/** Replace anything in a string that could identify a person or open a door. */
export function scrubText(input: unknown, maxLength = 1000): string {
  let s = typeof input === "string" ? input : String(input ?? "");
  if (s.length > maxLength) s = s.slice(0, maxLength);
  return s
    // Connection strings and URLs that carry a password.
    .replace(/\bpostgres(?:ql)?:\/\/[^\s'"]+/gi, "[database-url]")
    .replace(/\bhttps?:\/\/[^/\s:@]+:[^@\s]+@[^\s'"]+/gi, "[credentialed-url]")
    // Secrets by shape.
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [token]")
    .replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+/g, "[stripe-key]")
    .replace(/\bwhsec_[A-Za-z0-9]+/g, "[webhook-secret]")
    // People.
    .replace(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone]")
    // Places.
    .replace(new RegExp(`\\b\\d{1,6}\\s+(?:[A-Za-z0-9.'-]+\\s+){1,5}(?:${STREET_WORDS})\\b\\.?`, "gi"), "[address]")
    .replace(/-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/g, "[location]")
    // Any other long opaque string is treated as a credential; a UUID is an
    // id (a ride, a user) and is what makes a report debuggable, so it stays.
    .replace(/[A-Za-z0-9_-]{32,}/g, (m) => (UUID.test(m) ? m : "[token]"));
}

/** The HTTP status an error carries, when it carries one. */
export function errorStatus(err: unknown): number | null {
  const e = err as { status?: unknown; statusCode?: unknown } | null | undefined;
  const n = Number(e?.status ?? e?.statusCode);
  return Number.isInteger(n) && n >= 100 && n <= 599 ? n : null;
}

/** A client's mistake (4xx) or a validation failure is not a fault in PG Ride. */
export function isExpectedError(err: unknown): boolean {
  const status = errorStatus(err);
  if (status !== null && status >= 400 && status < 500) return true;
  const name = (err as { name?: unknown } | null | undefined)?.name;
  return name === "ZodError";
}

/** Tags that may go out, by name; their values are scrubbed and clipped. */
export const ALLOWED_TAGS = ["kind", "route", "job", "source"] as const;

export function safeTags(tags: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ALLOWED_TAGS) {
    const v = tags?.[key];
    if (v !== undefined && v !== null && v !== "") out[key] = scrubText(v, 100);
  }
  return out;
}

/** An id that is safe to send: opaque, never an email or a name. */
export function safeUserId(id: unknown): string | undefined {
  if (typeof id !== "string" || !id || id.length > 64) return undefined;
  if (id.includes("@") || /\s/.test(id)) return undefined;
  return id;
}

const FRAME_KEYS = ["filename", "abs_path", "function", "module", "lineno", "colno", "in_app"];

/**
 * The event as it may be sent, or null when it cannot be made safe. The
 * allowlist is the point: request data, cookies, headers, breadcrumbs, extra
 * data, local variables, source lines and every context but the runtime are
 * dropped; the exception text and tags are scrubbed.
 */
export function scrubEvent<T extends Record<string, any>>(event: T): T | null {
  try {
    const e: Record<string, any> = structuredClone(event);

    delete e.request;
    delete e.breadcrumbs;
    delete e.extra;
    delete e.threads;
    delete e.debug_meta;
    delete e.modules;

    const id = safeUserId(e.user?.id);
    if (id) e.user = { id }; else delete e.user;

    e.server_name = "pgride";

    const runtime = e.contexts?.runtime;
    if (runtime && typeof runtime === "object") e.contexts = { runtime: { name: runtime.name, version: runtime.version } };
    else delete e.contexts;

    e.tags = safeTags(e.tags);

    if (typeof e.message === "string") e.message = scrubText(e.message);
    if (e.logentry && typeof e.logentry === "object") {
      if (typeof e.logentry.message === "string") e.logentry.message = scrubText(e.logentry.message);
      if (typeof e.logentry.formatted === "string") e.logentry.formatted = scrubText(e.logentry.formatted);
      delete e.logentry.params;
    }

    if (Array.isArray(e.exception?.values)) {
      for (const v of e.exception.values) {
        if (typeof v.value === "string") v.value = scrubText(v.value);
        if (typeof v.type === "string") v.type = scrubText(v.type, 100);
        const frames = v.stacktrace?.frames;
        if (Array.isArray(frames)) {
          v.stacktrace.frames = frames.map((f: Record<string, any>) => {
            const kept: Record<string, any> = {};
            for (const k of FRAME_KEYS) if (f[k] !== undefined) kept[k] = f[k];
            return kept;
          });
        }
      }
    }
    return e as T;
  } catch {
    return null;
  }
}
