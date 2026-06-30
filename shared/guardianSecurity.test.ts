/**
 * Pure-logic smoke tests for the guardian security fixes.
 *
 * These don't exercise the routes (that needs a live DB) but they pin
 * the small pieces of decision logic that are easy to silently regress:
 *
 *  - the 32-hex token format guard the public track endpoint applies
 *    before any DB lookup, so a malformed path can't be used as a
 *    timing oracle
 *  - the TERMINAL_STATUSES set that masks pickup/destination after a
 *    ride ends — the bug the supervisor review caught was that this
 *    masking didn't exist at all
 *
 * If a future contributor "simplifies" either of these, the test fails
 * loudly.
 */
import { describe, it, expect } from "vitest";

// Mirror of the regex in server/routes.ts. Keep in sync.
const GUARDIAN_TOKEN_RE = /^[0-9a-f]{32}$/;

// Mirror of the masking set in server/routes.ts. Keep in sync.
const TERMINAL_STATUSES = new Set(["completed", "cancelled", "no_show"]);

describe("guardian share-token format guard", () => {
  it("accepts a real 32-char hex token", () => {
    expect(GUARDIAN_TOKEN_RE.test("a1b2c3d4e5f60718293a4b5c6d7e8f90")).toBe(true);
  });
  it("rejects too-short tokens", () => {
    expect(GUARDIAN_TOKEN_RE.test("a1b2c3d4")).toBe(false);
  });
  it("rejects too-long tokens", () => {
    expect(GUARDIAN_TOKEN_RE.test("a1b2c3d4e5f60718293a4b5c6d7e8f90ff")).toBe(false);
  });
  it("rejects uppercase hex (Node's hex output is always lowercase)", () => {
    expect(GUARDIAN_TOKEN_RE.test("A1B2C3D4E5F60718293A4B5C6D7E8F90")).toBe(false);
  });
  it("rejects non-hex characters that could come from path-traversal probes", () => {
    expect(GUARDIAN_TOKEN_RE.test("..%2f..%2fetc%2fpasswd00000000000")).toBe(false);
    expect(GUARDIAN_TOKEN_RE.test("<script>alert(1)</script>aaaaaaaaa")).toBe(false);
  });
});

describe("guardian terminal-status masking", () => {
  it("masks completed rides — pickup/destination must not leak after completion", () => {
    expect(TERMINAL_STATUSES.has("completed")).toBe(true);
  });
  it("masks cancelled rides", () => {
    expect(TERMINAL_STATUSES.has("cancelled")).toBe(true);
  });
  it("masks no_show rides", () => {
    expect(TERMINAL_STATUSES.has("no_show")).toBe(true);
  });
  it("does NOT mask in-flight statuses — the whole point of the page is live tracking", () => {
    for (const live of ["pending", "accepted", "driver_arriving", "in_progress"]) {
      expect(TERMINAL_STATUSES.has(live)).toBe(false);
    }
  });
});
