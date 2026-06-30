import {
  buildCertificatePayload,
  hashCertificatePayload,
} from "@shared/certificateProvenance";
import type { IStorage } from "../storage";

/** F2 — Record SHA-256 provenance hash for a share certificate. */
export async function recordCertificateProvenance(
  storage: IStorage,
  certificateId: string,
): Promise<{ contentHash: string; algorithm: string }> {
  const cert = await storage.getShareCertificateById(certificateId);
  if (!cert) {
    throw new Error("Certificate not found");
  }

  const payload = buildCertificatePayload({
    certificateNumber: cert.certificateNumber,
    ownerId: cert.ownerId,
    sharePercentage: cert.sharePercentage,
    issuedAt: cert.issuedAt,
    status: cert.status,
  });
  const contentHash = hashCertificatePayload(payload);

  await storage.upsertCertificateProvenance({
    certificateId,
    contentHash,
    algorithm: "sha256",
    payloadVersion: payload.payloadVersion,
  });

  await storage.createAgentAuditLog({
    agent: "certificate_provenance",
    action: "hash_recorded",
    userId: cert.ownerId,
    reasoning: `SHA-256 provenance recorded for ${cert.certificateNumber}`,
    metadata: { certificateId, contentHash: contentHash.slice(0, 16) + "…" },
  });

  return { contentHash, algorithm: "sha256" };
}

export async function recordAllActiveCertificateHashes(storage: IStorage): Promise<number> {
  const certs = await storage.getShareCertificates();
  let count = 0;
  for (const cert of certs) {
    await recordCertificateProvenance(storage, cert.id);
    count += 1;
  }
  return count;
}
