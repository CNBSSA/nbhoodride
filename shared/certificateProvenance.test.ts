import { describe, expect, it } from "vitest";
import {
  buildCertificatePayload,
  hashCertificatePayload,
} from "./certificateProvenance";

describe("certificateProvenance", () => {
  it("produces stable SHA-256 for same payload", () => {
    const payload = buildCertificatePayload({
      certificateNumber: "PGR-001",
      ownerId: "user-1",
      sharePercentage: "2.5000",
      issuedAt: "2026-01-15T12:00:00.000Z",
      status: "active",
    });
    const hash1 = hashCertificatePayload(payload);
    const hash2 = hashCertificatePayload(payload);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes hash when certificate fields change", () => {
    const base = buildCertificatePayload({
      certificateNumber: "PGR-001",
      ownerId: "user-1",
      sharePercentage: "2.5000",
      issuedAt: "2026-01-15T12:00:00.000Z",
      status: "active",
    });
    const altered = { ...base, sharePercentage: "3.0000" };
    expect(hashCertificatePayload(base)).not.toBe(hashCertificatePayload(altered));
  });
});
