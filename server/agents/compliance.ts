import {
  complianceStatusFromExpiry,
  type ComplianceStatus,
  type TaxCompliancePath,
} from "@shared/compliancePolicy";
import { deliverUserNotification } from "../notificationService";
import type { IStorage } from "../storage";

const DEFAULT_TAX_PATH: TaxCompliancePath =
  (process.env.TAX_COMPLIANCE_PATH as TaxCompliancePath) || "path_b_tax1099";

/** E2 — Scan one driver for W-9 / document compliance. */
export async function scanDriverCompliance(
  storage: IStorage,
  driverId: string,
): Promise<{ alerts: number; blocked: boolean }> {
  const profile = await storage.getDriverProfile(driverId);
  if (!profile) return { alerts: 0, blocked: false };

  let alerts = 0;
  let blocked = false;

  const licenseStatus: ComplianceStatus = profile.licenseImageUrl
    ? "on_file"
    : "missing";
  await storage.upsertComplianceRecord({
    driverId,
    recordType: "license",
    status: licenseStatus,
    taxCompliancePath: DEFAULT_TAX_PATH,
  });
  if (licenseStatus === "missing") {
    alerts++;
    blocked = true;
  }

  const insuranceStatus: ComplianceStatus = profile.insuranceImageUrl
    ? "on_file"
    : "missing";
  await storage.upsertComplianceRecord({
    driverId,
    recordType: "insurance",
    status: insuranceStatus,
    taxCompliancePath: DEFAULT_TAX_PATH,
  });
  if (insuranceStatus === "missing") alerts++;

  const w9Status: ComplianceStatus = "missing";
  await storage.upsertComplianceRecord({
    driverId,
    recordType: "w9",
    status: w9Status,
    taxCompliancePath: DEFAULT_TAX_PATH,
    metadata: { note: "W-9 collection pending — see MASTER_PLAN §15 Path A/B/C" },
  });
  if (w9Status === "missing") alerts++;

  const bgExpiry = profile.updatedAt
    ? new Date(new Date(profile.updatedAt).getTime() + 365 * 24 * 60 * 60 * 1000)
    : null;
  const bgStatus = complianceStatusFromExpiry(bgExpiry);
  await storage.upsertComplianceRecord({
    driverId,
    recordType: "background_check",
    status: bgStatus,
    expiresAt: bgExpiry ?? undefined,
    taxCompliancePath: DEFAULT_TAX_PATH,
    metadata: {
      checkrCandidateId: profile.checkrCandidateId,
      checkrReportId: profile.checkrReportId,
    },
  });
  if (bgStatus === "expiring_soon" || bgStatus === "expired") {
    alerts++;
    if (bgStatus === "expired") blocked = true;
  }

  if (alerts > 0) {
    await deliverUserNotification(driverId, {
      type: "compliance_alert",
      title: "Action needed: driver documents",
      body: `You have ${alerts} compliance item(s) to review. Open Profile → Documents.`,
      url: "/profile",
    });
    await storage.createAgentAuditLog({
      agent: "compliance",
      action: "compliance_scan",
      userId: driverId,
      reasoning: `${alerts} alert(s); blocked=${blocked}`,
      metadata: { alerts, taxPath: DEFAULT_TAX_PATH },
    });
  }

  return { alerts, blocked };
}

export async function runComplianceScan(storage: IStorage): Promise<number> {
  const drivers = await storage.getAllDriverProfiles();
  let totalAlerts = 0;
  for (const d of drivers) {
    const { alerts } = await scanDriverCompliance(storage, d.userId);
    totalAlerts += alerts;
  }
  return totalAlerts;
}
