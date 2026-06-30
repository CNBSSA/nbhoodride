/** F2 — Off-chain SHA-256 provenance for share certificates (no on-chain v1). */

import { createHash } from "crypto";

export const CERTIFICATE_PAYLOAD_VERSION = "v1";

export interface CertificateProvenancePayload {
  certificateNumber: string;
  ownerId: string;
  sharePercentage: string | null;
  issuedAt: string;
  status: string;
  payloadVersion: string;
}

export function buildCertificatePayload(cert: {
  certificateNumber: string;
  ownerId: string;
  sharePercentage?: string | null;
  issuedAt?: Date | string | null;
  status?: string | null;
}): CertificateProvenancePayload {
  const issuedAt =
    cert.issuedAt instanceof Date
      ? cert.issuedAt.toISOString()
      : cert.issuedAt ?? new Date().toISOString();

  return {
    certificateNumber: cert.certificateNumber,
    ownerId: cert.ownerId,
    sharePercentage: cert.sharePercentage ?? null,
    issuedAt,
    status: cert.status ?? "active",
    payloadVersion: CERTIFICATE_PAYLOAD_VERSION,
  };
}

function canonicalJson(obj: Record<string, unknown>): string {
  const sorted = Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = obj[key];
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

export function hashCertificatePayload(payload: CertificateProvenancePayload): string {
  return createHash("sha256").update(canonicalJson(payload as unknown as Record<string, unknown>)).digest("hex");
}
