import { describe, it, expect } from "vitest";
import { isUniqueViolation } from "./pgErrors";

describe("isUniqueViolation", () => {
  it("matches a raw pg error with top-level code 23505 (pre-0.44 shape)", () => {
    expect(isUniqueViolation({ code: "23505", message: "duplicate key value" })).toBe(true);
  });

  it("matches a drizzle-orm >=0.44 wrapped error (code under .cause)", () => {
    // This is the exact shape that silently broke idempotency after the
    // drizzle-orm 0.45 upgrade: the wrapper's own code is undefined and the
    // pg fields live on .cause.
    const wrapped = {
      code: undefined,
      message: 'Failed query: insert into "processed_webhook_events" ...',
      cause: { code: "23505", message: 'duplicate key value violates unique constraint "..._unique"' },
    };
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it("matches on message text when no code is present", () => {
    expect(isUniqueViolation({ cause: { message: "violates unique constraint" } })).toBe(true);
  });

  it("does NOT match unrelated errors", () => {
    expect(isUniqueViolation({ code: "23503", message: "foreign key violation" })).toBe(false);
    expect(isUniqueViolation({ message: "connection refused" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
  });
});
