/**
 * Postgres error classification that survives ORM error-wrapping.
 *
 * drizzle-orm >=0.44 wraps driver errors in a `DrizzleQueryError` whose own
 * `.code`/`.message` do NOT carry the pg fields — those move under `.cause`.
 * A top-level-only check (`err.code === "23505"`) silently stopped matching
 * after the 0.45 upgrade, which broke the webhook/topup idempotency guard
 * (it rethrew on a duplicate instead of returning "already seen"). Classify
 * from both the error itself and its `.cause` so this can't regress again.
 */

const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  const msg = `${String(e?.message ?? "")} ${String(e?.cause?.message ?? "")}`;
  return code === UNIQUE_VIOLATION || /unique|duplicate key/i.test(msg);
}
