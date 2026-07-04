import { pool } from "./db";
import { resolveAppUrl } from "./appUrl";

export type Phase0CheckStatus = "pass" | "warn" | "fail";

export interface Phase0Check {
  id: string;
  label: string;
  status: Phase0CheckStatus;
  owner: "track_a" | "track_b" | "both";
  detail?: string;
}

export interface Phase0ReadinessReport {
  phase: 0;
  /** True when all required checks are pass (warnings allowed). */
  ready: boolean;
  checkedAt: string;
  appUrl: string;
  checks: Phase0Check[];
}

function envPresent(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

async function pingDatabase(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

async function superAdminBootstrapped(): Promise<"missing_email" | "not_found" | "not_admin" | "ready"> {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim();
  if (!email) return "missing_email";
  try {
    const result = await pool.query<{ is_super_admin: boolean; is_admin: boolean }>(
      "SELECT is_super_admin, is_admin FROM users WHERE lower(email) = lower($1) LIMIT 1",
      [email],
    );
    const row = result.rows[0];
    if (!row) return "not_found";
    if (!row.is_super_admin && !row.is_admin) return "not_admin";
    return "ready";
  } catch {
    return "not_found";
  }
}

function customDomainConfigured(appUrl: string): boolean {
  if (!appUrl) return false;
  try {
    const host = new URL(appUrl).hostname.toLowerCase();
    return host === "pgride.com" || host === "www.pgride.com" || host === "pgride.app" || host === "www.pgride.app";
  } catch {
    return false;
  }
}

/** Non-secret Phase 0 readiness derived from env + light DB probes. */
export async function getPhase0Readiness(): Promise<Phase0ReadinessReport> {
  const checks: Phase0Check[] = [];
  const appUrl = resolveAppUrl();

  const dbOk = await pingDatabase();
  checks.push({
    id: "0.1-database",
    label: "PostgreSQL reachable",
    status: dbOk ? "pass" : "fail",
    owner: "track_b",
    detail: dbOk ? undefined : "DATABASE_URL connection failed",
  });

  checks.push({
    id: "0.1-session",
    label: "SESSION_SECRET configured",
    status: envPresent("SESSION_SECRET") ? "pass" : "fail",
    owner: "track_b",
  });

  if (!appUrl) {
    checks.push({
      id: "0.2-public-url",
      label: "PUBLIC_APP_URL (or APP_URL / RAILWAY_PUBLIC_DOMAIN)",
      status: "fail",
      owner: "track_b",
      detail: "Set PUBLIC_APP_URL to your canonical HTTPS URL",
    });
  } else if (appUrl.includes("up.railway.app")) {
    checks.push({
      id: "0.2-public-url",
      label: "PUBLIC_APP_URL (or APP_URL / RAILWAY_PUBLIC_DOMAIN)",
      status: "warn",
      owner: "track_b",
      detail: `Using Railway default (${appUrl}). Set custom domain before marketing.`,
    });
  } else {
    checks.push({
      id: "0.2-public-url",
      label: "PUBLIC_APP_URL (or APP_URL / RAILWAY_PUBLIC_DOMAIN)",
      status: "pass",
      owner: "track_b",
      detail: appUrl,
    });
  }

  const adminState = await superAdminBootstrapped();
  if (adminState === "missing_email") {
    checks.push({
      id: "0.3-super-admin",
      label: "Super admin bootstrapped",
      status: "fail",
      owner: "track_b",
      detail: "Set SUPER_ADMIN_EMAIL, then visit /admin/setup",
    });
  } else if (adminState === "not_found") {
    checks.push({
      id: "0.3-super-admin",
      label: "Super admin bootstrapped",
      status: "fail",
      owner: "track_b",
      detail: "Visit /admin/setup with SUPER_ADMIN_SETUP_TOKEN",
    });
  } else if (adminState === "not_admin") {
    checks.push({
      id: "0.3-super-admin",
      label: "Super admin bootstrapped",
      status: "warn",
      owner: "track_b",
      detail: "SUPER_ADMIN_EMAIL user exists but is not admin — complete /admin/setup",
    });
  } else {
    checks.push({
      id: "0.3-super-admin",
      label: "Super admin bootstrapped",
      status: "pass",
      owner: "track_b",
    });
  }

  checks.push({
    id: "0.4-legal",
    label: "Privacy + Terms routes (verify externally)",
    status: "warn",
    owner: "track_a",
    detail: "Run npm run smoke:production — SPA serves /privacy and /terms",
  });

  const stripeReady =
    envPresent("STRIPE_SECRET_KEY") &&
    envPresent("VITE_STRIPE_PUBLIC_KEY") &&
    envPresent("STRIPE_WEBHOOK_SECRET");
  checks.push({
    id: "0.5-stripe",
    label: "Stripe payments wired",
    status: stripeReady ? "pass" : "warn",
    owner: "track_b",
    detail: stripeReady
      ? "Card top-up and ride auth available"
      : "Optional for cash/virtual-only launch — set Stripe keys before marketing card payments",
  });

  checks.push({
    id: "0.6-smoke",
    label: "End-to-end ride smoke test",
    status: "warn",
    owner: "both",
    detail: "Manual: signup → admin approve → book → accept → complete → receipt",
  });

  checks.push({
    id: "0.7-domain",
    label: "Custom domain (pgride.com / pgride.app)",
    status: customDomainConfigured(appUrl) ? "pass" : "warn",
    owner: "track_b",
    detail: customDomainConfigured(appUrl)
      ? appUrl
      : "DNS not on custom domain yet — recommended before store marketing",
  });

  const requiredIds = new Set(["0.1-database", "0.1-session", "0.2-public-url", "0.3-super-admin"]);
  const ready = checks
    .filter((c) => requiredIds.has(c.id))
    .every((c) => c.status !== "fail");

  return {
    phase: 0,
    ready,
    checkedAt: new Date().toISOString(),
    appUrl,
    checks,
  };
}
