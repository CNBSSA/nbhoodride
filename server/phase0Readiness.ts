import { pool } from "./db";
import { resolveAppUrl } from "./appUrl";
import { checkVapidPublicKey } from "@shared/vapidKey";
import { getEmailConfigSummary } from "./emailService";

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
    const canonical = new Set([
      "pgride.com",
      "www.pgride.com",
      "pgride.app",
      "www.pgride.app",
      "peoplegoverned.com",
      "www.peoplegoverned.com",
    ]);
    return canonical.has(host);
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

  // Reports the SENDER too, not just the key: the usual cause of silently
  // failing email is RESEND_FROM being unset, which falls back to a domain
  // that cannot be verified, so every send is rejected by the provider.
  const emailCfg = getEmailConfigSummary();
  const emailReady = emailCfg.apiKeyPresent && !emailCfg.usingUnverifiedDefault;
  checks.push({
    id: "0.5-email",
    label: "Transactional email (Resend)",
    status: emailReady ? "pass" : emailCfg.apiKeyPresent ? "fail" : "warn",
    owner: "track_b",
    detail: !emailCfg.apiKeyPresent
      ? "RESEND_API_KEY missing — signups see success but no verification email is sent"
      : emailCfg.usingUnverifiedDefault
        ? `RESEND_FROM is not set, so mail is sent from ${emailCfg.from} — that domain has no DNS and cannot be verified, so every send is rejected. Set RESEND_FROM to an address on your verified domain.`
        : `Sending as ${emailCfg.from}`,
  });

  const twilioReady =
    envPresent("TWILIO_ACCOUNT_SID") &&
    envPresent("TWILIO_AUTH_TOKEN") &&
    envPresent("TWILIO_PHONE_NUMBER");
  checks.push({
    id: "0.5-twilio",
    label: "Emergency SMS (Twilio)",
    status: twilioReady ? "pass" : "warn",
    owner: "track_b",
    detail: twilioReady
      ? "Server can text emergency contacts during SOS"
      : "Twilio not configured — SOS still supports 911, calls, and your phone's SMS app",
  });

  checks.push({
    id: "0.5-sms-optout",
    label: "SMS opt-out webhook (TCPA)",
    status: twilioReady ? "warn" : "warn",
    owner: "track_b",
    detail: twilioReady
      ? "Point the Twilio number's inbound webhook at /api/webhooks/twilio/sms so STOP is recorded, and complete A2P 10DLC registration before texting riders"
      : "Configure Twilio first; then point its inbound webhook at /api/webhooks/twilio/sms",
  });

  const assistantReady = envPresent("ANTHROPIC_API_KEY");
  checks.push({
    id: "0.5-assistant",
    label: "AI assistant (Anthropic)",
    status: assistantReady ? "pass" : "warn",
    owner: "track_b",
    detail: assistantReady
      ? "PG Ride Assistant can answer rider questions"
      : "ANTHROPIC_API_KEY missing — assistant chat falls back to contact options",
  });

  // Validate the key's shape, not just its presence: a truncated or
  // wrong-half VAPID key is present-but-useless and previously only surfaced
  // as a rider seeing "Couldn't enable notifications".
  const vapidCheck = checkVapidPublicKey(process.env.VAPID_PUBLIC_KEY);
  const pushReady = vapidCheck.valid && envPresent("VAPID_PRIVATE_KEY");
  checks.push({
    id: "0.5-push",
    label: "Push notifications (VAPID)",
    status: pushReady ? "pass" : "warn",
    owner: "track_b",
    detail: pushReady
      ? "Riders and drivers can receive ride alerts"
      : vapidCheck.valid
        ? "VAPID_PRIVATE_KEY missing — push disabled"
        : `Push disabled — ${vapidCheck.error}`,
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
    label: "Custom domain (peoplegoverned.com / pgride.com / pgride.app)",
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
