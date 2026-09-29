import { describe, it, expect } from "vitest";
import { hashResetToken, looksHashed } from "./resetTokens";

describe("a reset token at rest", () => {
  it("is stored as its SHA-256, never as itself", () => {
    const h = hashResetToken("Rz-dmXMyGh96ntBMH4jtBSE34EeQt-tG");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("Rz-dmX");
    expect(hashResetToken("Rz-dmXMyGh96ntBMH4jtBSE34EeQt-tG")).toBe(h);
    expect(hashResetToken("Rz-dmXMyGh96ntBMH4jtBSE34EeQt-tH")).not.toBe(h);
  });
  it("tells a hash from a plain token left by the code before it", () => {
    expect(looksHashed(hashResetToken("x"))).toBe(true);
    expect(looksHashed("Rz-dmXMyGh96ntBMH4jtBSE34EeQt-tG")).toBe(false);
    expect(looksHashed(null)).toBe(false);
  });
});
