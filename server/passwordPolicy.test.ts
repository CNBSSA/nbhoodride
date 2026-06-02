// AH-064 seed test #1 — password policy.
//
// Pure-function test. No DB, no fixtures, runs in milliseconds. Demonstrates
// the test infrastructure works and pins the policy to ensure the client-side
// live checklist (Signup.tsx) can't drift from the server gate.

import { describe, it, expect } from "vitest";
import { validatePasswordComplexity } from "./passwordPolicy";

describe("validatePasswordComplexity", () => {
  it("rejects passwords shorter than 8 characters", () => {
    const r = validatePasswordComplexity("Ab1!");
    expect(r.valid).toBe(false);
    expect(r.feedback).toContain("at least 8 characters");
  });

  it("rejects passwords without an uppercase letter", () => {
    const r = validatePasswordComplexity("abcdefg1!");
    expect(r.valid).toBe(false);
    expect(r.feedback).toContain("at least 1 uppercase letter (A-Z)");
  });

  it("rejects passwords without a lowercase letter", () => {
    const r = validatePasswordComplexity("ABCDEFG1!");
    expect(r.valid).toBe(false);
    expect(r.feedback).toContain("at least 1 lowercase letter (a-z)");
  });

  it("rejects passwords without a digit", () => {
    const r = validatePasswordComplexity("Abcdefgh!");
    expect(r.valid).toBe(false);
    expect(r.feedback).toContain("at least 1 number (0-9)");
  });

  it("rejects passwords without a special character", () => {
    const r = validatePasswordComplexity("Abcdefg1");
    expect(r.valid).toBe(false);
    expect(r.feedback).toContain("at least 1 special character (!@#$%^&* etc.)");
  });

  it("accepts a password that meets all rules", () => {
    const r = validatePasswordComplexity("CorrectHorse1!");
    expect(r.valid).toBe(true);
    expect(r.feedback).toEqual([]);
  });

  it("accumulates multiple failures rather than short-circuiting", () => {
    const r = validatePasswordComplexity("abc"); // missing length, upper, digit, special
    expect(r.valid).toBe(false);
    expect(r.feedback.length).toBeGreaterThanOrEqual(4);
  });

  it("accepts each documented special character", () => {
    // Spot-check a few — the server regex must match the client regex in
    // Signup.tsx; if a special char gets accepted here but not in the live
    // checklist, signup looks broken to the user.
    for (const ch of ["!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "+", "-", "=", "[", "]", "{", "}", ";", ":", "'", '"', "\\", "|", ",", ".", "<", ">", "/", "?"]) {
      const r = validatePasswordComplexity(`Aa1${ch}xxxx`);
      expect(r.valid, `expected ${ch} to be accepted as a special character`).toBe(true);
    }
  });
});
