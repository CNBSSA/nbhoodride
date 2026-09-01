import { describe, expect, it } from "vitest";

// Mirrors normalizeFromAddress in server/emailService.ts. The header builder
// wraps FROM_ADDRESS in "Name <addr>", so a display-name value pasted into
// RESEND_FROM must be reduced to the bare address or the header is malformed.
function normalizeFromAddress(raw: string): string {
  const value = raw.trim();
  const angled = value.match(/<([^>]+)>/);
  return (angled ? angled[1] : value).trim();
}

describe("normalizeFromAddress", () => {
  it("passes a bare address through", () => {
    expect(normalizeFromAddress("noreply@peoplegoverned.com")).toBe("noreply@peoplegoverned.com");
  });

  it("extracts the address from a display-name value", () => {
    expect(normalizeFromAddress("PG Ride <noreply@peoplegoverned.com>")).toBe("noreply@peoplegoverned.com");
  });

  it("tolerates stray whitespace and newlines from a pasted variable", () => {
    expect(normalizeFromAddress("  noreply@peoplegoverned.com \n")).toBe("noreply@peoplegoverned.com");
    expect(normalizeFromAddress(" PG Ride < noreply@peoplegoverned.com > ")).toBe("noreply@peoplegoverned.com");
  });
});
