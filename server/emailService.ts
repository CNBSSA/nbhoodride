import nodemailer, { type Transporter } from "nodemailer";
import { resolveAppUrl } from "./appUrl";
import { featureFlags } from "./featureFlags";

/**
 * Outbound email leaves through Gmail SMTP (work order of 2026-09-28,
 * Chairman-approved: Resend retired). Nodemailer talks to smtp.gmail.com on
 * port 587 with STARTTLS, signed in with the account's 16-character app
 * password. Configuration comes only from the environment; the password is
 * never logged or reported.
 *
 *   SMTP_HOST   default smtp.gmail.com
 *   SMTP_PORT   default 587
 *   SMTP_USER   the Gmail account (default thrynovainsights@gmail.com)
 *   SMTP_PASS   the app password — required; without it nothing is sent
 *   EMAIL_FROM  the From address (default: the account itself)
 *
 * Gmail sends only as the signed-in account (or a send-as address verified in
 * Gmail's own settings): a From address on any other domain is rewritten by
 * Google to the account, so the default and the diagnostic both keep it there.
 */

/**
 * Bare sender address. EMAIL_FROM is often pasted in display-name form
 * ("PG Ride <noreply@example.com>"), which the header builder below would
 * wrap a second time into "PG Ride <PG Ride <noreply@…>>" — malformed, and
 * rejected by the server with an error about the from address. Extract the
 * address so either form works.
 */
function normalizeFromAddress(raw: string): string {
  const value = raw.trim();
  const angled = value.match(/<([^>]+)>/);
  return (angled ? angled[1] : value).trim();
}

const SMTP_HOST = (process.env.SMTP_HOST || "smtp.gmail.com").trim();
const SMTP_PORT = Number.parseInt(process.env.SMTP_PORT || "587", 10) || 587;
const SMTP_USER = (process.env.SMTP_USER || "thrynovainsights@gmail.com").trim();
const SMTP_PASS = process.env.SMTP_PASS?.trim() || "";
const FROM_ADDRESS = normalizeFromAddress(process.env.EMAIL_FROM || SMTP_USER);
/**
 * Where a reply goes. Several templates say "reply to this email"; without
 * this every reply lands in the sending account's inbox. Optional; the same
 * bare-address normalisation as EMAIL_FROM.
 */
const REPLY_TO = process.env.EMAIL_REPLY_TO?.trim() ? normalizeFromAddress(process.env.EMAIL_REPLY_TO) : "";

/**
 * Gmail's own daily sending limits (500 messages a day for a personal
 * account, 2,000 for Workspace). Counted per process per UTC day — an
 * honest floor, not the whole picture across restarts — so the admin card
 * and the readiness report can say how close the day is.
 */
export const GMAIL_DAILY_LIMIT_HINT = 500;
let sentDay = ""; let sentToday = 0;
function countSent(): void {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== sentDay) { sentDay = day; sentToday = 0; }
  sentToday += 1;
}
const FROM_NAME = "PG Ride";

/**
 * Non-secret view of the email configuration, for the admin diagnostic and the
 * readiness report. Never exposes the password.
 *
 * `fromMismatch` is the trap this exists to catch: Gmail only sends as the
 * account itself (or a send-as address verified in Gmail), so an EMAIL_FROM on
 * another domain is silently rewritten by Google — mail still goes out, but not
 * from the address the operator thinks, and replies land elsewhere.
 */
export function getEmailConfigSummary() {
  const fromDomain = FROM_ADDRESS.includes("@") ? FROM_ADDRESS.split("@")[1] : "";
  return {
    transport: "smtp" as const,
    host: SMTP_HOST,
    port: SMTP_PORT,
    user: SMTP_USER,
    userPresent: Boolean(SMTP_USER),
    passwordPresent: Boolean(SMTP_PASS),
    from: FROM_ADDRESS,
    fromDomain,
    fromMismatch: FROM_ADDRESS.toLowerCase() !== SMTP_USER.toLowerCase(),
    replyTo: REPLY_TO || null,
    sentToday: new Date().toISOString().slice(0, 10) === sentDay ? sentToday : 0,
    dailyLimitHint: GMAIL_DAILY_LIMIT_HINT,
  };
}

/**
 * Send a real email and report exactly what happened. Used by the admin
 * "send test email" button so a misconfiguration is diagnosable in ten
 * seconds instead of by reading deploy logs.
 */
export async function sendTestEmail(to: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await sendEmail(
      to,
      "PG Ride email test",
      baseTemplate(`
        <p>This is a test message from your PG Ride admin dashboard.</p>
        <p>If you are reading this, outbound email is working: verification emails,
        ride receipts, approval notices and announcements will all reach your riders.</p>
      `),
    );
    return { ok: true };
  } catch (err: any) {
    // Nodemailer puts the useful part (e.g. "Invalid login: 535-5.7.8
    // Username and Password not accepted") in message, with the SMTP
    // response beside it; surface it verbatim rather than a generic failure.
    const parts = [err?.name, err?.message, err?.response].filter(Boolean);
    return { ok: false, error: parts.join(": ").slice(0, 300) || "Unknown email error" };
  }
}

const APP_URL = resolveAppUrl();

// One transport for the process; null when there is no password to sign in
// with. Short timeouts: a mail server that does not answer must not hold a
// signup or an invitation for minutes (Nodemailer's defaults are two).
const transporter: Transporter | null = SMTP_PASS
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: false,
      requireTLS: true,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      // Pooled: an announcement to every rider used to open one connection
      // per message at once, which Gmail answers with "too many concurrent
      // SMTP connections". A few connections, reused, and a cap per
      // connection Gmail is comfortable with.
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
  : null;

// Loud startup warning if email isn't configured. In production this is
// almost always a misconfiguration (signup flow advertises "check your email"
// but nothing goes out). In dev/test we log once and move on.
if (!transporter) {
  const msg =
    "[EMAIL] SMTP_PASS is not set. Outbound email will fail. " +
    "Set SMTP_PASS (the Gmail app password; and SMTP_USER / EMAIL_FROM if not the default account) in Railway → Variables.";
  if (process.env.NODE_ENV === "production") {
    console.error(`\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n${msg}\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n`);
  } else {
    console.warn(msg);
  }
}

// Defang user-controlled strings before embedding them in email HTML. Rider
// name/phone, incident type and free-text description all originate from
// untrusted input, so they must never reach an admin inbox as raw markup.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Where a failed send is reported beyond the log (reliability audit
 * 2026-09-29: every user-facing email failure was swallowed to console.error,
 * so an approval notice or a reset link that never left was invisible to the
 * operator). The server registers a recorder that pages ops and writes a
 * reliability_events row; this module stays free of the database and of
 * Telegram so it can be unit-tested with Nodemailer stubbed.
 */
export type EmailFailureRecorder = (event: { to: string; subject: string; reason: string; attempts: number }) => void;
let failureRecorder: EmailFailureRecorder | null = null;
export function setEmailFailureRecorder(fn: EmailFailureRecorder | null): void {
  failureRecorder = fn;
}
function reportEmailFailure(to: string, subject: string, err: unknown, attempts: number): void {
  const reason = String((err as any)?.message ?? err).slice(0, 300);
  try {
    failureRecorder?.({ to, subject, reason, attempts });
  } catch (recorderErr) {
    console.error("[EMAIL] failure recorder threw:", recorderErr);
  }
}

/**
 * Retry only a send that never got as far as handing the message over:
 * a connection, greeting, TLS or sign-in failure. Once DATA was sent, a
 * timeout waiting for the final 250 may mean the server accepted it, and
 * sending again would deliver the reset link or receipt twice.
 */
export function isRetryableSmtpError(err: unknown): boolean {
  const e = err as { command?: string; code?: string } | null;
  const command = e?.command ?? "";
  if (command === "DATA") return false;
  if (["CONN", "EHLO", "HELO", "STARTTLS", "AUTH"].includes(command)) return true;
  return ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNREFUSED", "ECONNRESET", "EDNS", "EAI_AGAIN"].includes(e?.code ?? "");
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email service is not configured. SMTP_PASS (the Gmail app password) is missing.");
    this.name = "EmailNotConfiguredError";
  }
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!transporter) {
    // In production, fail loudly so the calling route surfaces the issue
    // instead of silently succeeding while the user waits for an email that
    // will never arrive. In dev, keep the old log-and-no-op behaviour so
    // local development without an SMTP password still works.
    if (process.env.NODE_ENV === "production") {
      console.error(`[EMAIL] Refusing to send (SMTP_PASS missing): to=${to} subject=${subject}`);
      const notConfigured = new EmailNotConfiguredError();
      reportEmailFailure(to, subject, notConfigured, 0);
      throw notConfigured;
    }
    console.log(`[EMAIL — not sent in dev, SMTP_PASS not set]\nTo: ${to}\nSubject: ${subject}`);
    return;
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      // Nodemailer rejects on any SMTP failure (refused login, refused
      // recipient, connection lost), so the retry and the error handling
      // below apply to every rejected send.
      await transporter.sendMail({
        from: `${FROM_NAME} <${FROM_ADDRESS}>`,
        ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
        to,
        subject,
        html,
      });
      countSent();
      return;
    } catch (err) {
      if (attempt === 2 || !isRetryableSmtpError(err)) {
        console.error(`[EMAIL] Failed to send to ${to} (attempt ${attempt}, ${isRetryableSmtpError(err) ? "retried" : "not retried"}):`, err);
        reportEmailFailure(to, subject, err, attempt);
        // Bubble the failure up so endpoints can decide whether to mark the
        // request as a soft success (fire-and-forget) or a hard failure.
        throw err;
      } else {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
}

function baseTemplate(content: string): string {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      body { margin: 0; padding: 0; background: #f4f6f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .wrapper { max-width: 580px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
      .header { background: linear-gradient(135deg, #1e40af, #2563eb); padding: 28px 32px; text-align: center; }
      .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: -0.3px; }
      .header p { margin: 4px 0 0; color: #bfdbfe; font-size: 13px; }
      .body { padding: 32px; }
      .body p { color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 16px; }
      .card { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 20px 24px; margin: 20px 0; }
      .card-row { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 8px; color: #374151; }
      .card-row:last-child { margin-bottom: 0; }
      .card-label { color: #6b7280; }
      .card-value { font-weight: 600; color: #111827; }
      .highlight { color: #16a34a; font-weight: 700; font-size: 24px; }
      .btn { display: inline-block; background: #2563eb; color: #ffffff !important; text-decoration: none; padding: 13px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 16px 0 8px; }
      .footer { padding: 20px 32px; border-top: 1px solid #e5e7eb; text-align: center; }
      .footer p { color: #9ca3af; font-size: 12px; margin: 0; line-height: 1.6; }
      .footer a { color: #6b7280; text-decoration: none; }
      .badge { display: inline-block; background: #dcfce7; color: #15803d; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 20px; }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="header">
        <h1>🚗 PG Ride</h1>
        <p>Prince George's County Community Rideshare</p>
      </div>
      <div class="body">
        ${content}
      </div>
      <div class="footer">
        <p>PG Ride · Prince George's County, Maryland<br/>
        <a href="${APP_URL}/terms">Terms of Service</a> &nbsp;·&nbsp;
        <a href="${APP_URL}/privacy">Privacy Policy</a></p>
        <p style="margin-top:8px;">You're receiving this because you have a PG Ride account.</p>
      </div>
    </div>
  </body>
  </html>`;
}

// 1. Account approved
export async function sendAccountApprovedEmail(user: {
  email: string | null;
  firstName: string | null;
  virtualCardBalance?: string | null;
  promoRidesRemaining?: number | null;
}): Promise<void> {
  if (!user.email) return;
  const name = escapeHtml(user.firstName || "there");
  const promoRides = user.promoRidesRemaining ?? 4;

  // Only promise a wallet balance when the wallet is actually enabled. In
  // card-only mode no balance is granted at signup, so advertising one would
  // promise new riders money that does not exist. The $5 promo rides are real
  // in BOTH modes (the discount is applied to the card fare), so they stay.
  const balanceRow = featureFlags.walletEnabled
    ? `
        <div class="card-row">
          <span class="card-label">Virtual PG Card Balance</span>
          <span class="card-value highlight">$${parseFloat(user.virtualCardBalance || "20.00").toFixed(2)}</span>
        </div>`
    : "";

  await sendEmail(
    user.email,
    "Your PG Ride account is approved — welcome! 🎉",
    baseTemplate(`
      <p>Hi ${name},</p>
      <p>Great news — your PG Ride account has been approved by our team! You can now log in and start booking rides.</p>
      <div class="card">${balanceRow}
        <div class="card-row">
          <span class="card-label">Welcome Promo Rides</span>
          <span class="card-value">${promoRides} rides × $5 off each</span>
        </div>
      </div>
      <p>Your first ${promoRides} rides each come with a $5 discount automatically — no code needed. Just open the app and book!</p>
      <a href="${APP_URL}" class="btn">Open PG Ride</a>
      <p style="font-size:13px; color:#6b7280; margin-top:8px;">No surge pricing · Local drivers · Prince George's County</p>
    `)
  );
}

// 1c. Signup rejected — sent when an admin rejects a pending signup with a
// reason. Account is also marked is_suspended on the server side; this email
// is the user-facing explanation.
export async function sendSignupRejectedEmail(user: {
  email: string | null;
  firstName: string | null;
  reason: string;
}): Promise<void> {
  if (!user.email) return;
  const name = escapeHtml(user.firstName || "there");
  // Defang the admin-supplied reason — user-controlled string, must not be
  // injected as raw HTML.
  const escapedReason = user.reason
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  await sendEmail(
    user.email,
    "Update on your PG Ride application",
    baseTemplate(`
      <p>Hi ${name},</p>
      <p>Thanks for your interest in PG Ride. Unfortunately we're not able to approve your account at this time.</p>
      <div class="card" style="background:#fef2f2; border-color:#fecaca;">
        <div class="card-row">
          <span class="card-label">Reason from our team</span>
        </div>
        <p style="color:#374151; font-size:14px; line-height:1.6; margin: 8px 0 0;">${escapedReason}</p>
      </div>
      <p>If you believe this was a mistake or you'd like to provide additional information, please reply to this email or contact our support team.</p>
      <p style="font-size:13px; color:#6b7280; margin-top:8px;">PG Ride · Prince George's County, Maryland</p>
    `)
  );
}

// 1b. Driver approved — sent when admin transitions driver_profile.approval_status
// to "approved" (post-background-check, post-document-review).
export async function sendDriverApprovedEmail(user: {
  email: string | null;
  firstName: string | null;
}): Promise<void> {
  if (!user.email) return;
  const name = escapeHtml(user.firstName || "there");

  await sendEmail(
    user.email,
    "You're cleared to drive on PG Ride 🚗",
    baseTemplate(`
      <p>Hi ${name},</p>
      <p>Your PG Ride driver application has been approved! You can now go online and start accepting ride requests in your service area.</p>
      <div class="card">
        <div class="card-row">
          <span class="card-label">Status</span>
          <span class="card-value"><span class="badge">Approved</span></span>
        </div>
        <div class="card-row">
          <span class="card-label">Next step</span>
          <span class="card-value">Open the app, toggle "Online", pick your counties</span>
        </div>
      </div>
      <p>A few quick reminders before your first ride:</p>
      <ul style="color:#374151; font-size:14px; line-height:1.6; padding-left:20px;">
        <li>Keep your license, insurance, and registration current — we'll prompt you to re-upload before they expire.</li>
        <li>Earnings credit to your driver wallet after each ride; cash out anytime via the Payouts screen.</li>
        <li>Drive safely and follow community guidelines — your rating affects how often you get matched.</li>
      </ul>
      <a href="${APP_URL}" class="btn">Open PG Ride</a>
      <p style="font-size:13px; color:#6b7280; margin-top:8px;">Welcome to the team — drive safe.</p>
    `)
  );
}

// 2. Password reset
export async function sendPasswordResetEmail(
  email: string,
  firstName: string | null,
  resetToken: string,
  appUrl: string
): Promise<void> {
  const name = escapeHtml(firstName || "there");
  const resetUrl = `${appUrl}/reset-password?token=${resetToken}`;

  await sendEmail(
    email,
    "Reset your PG Ride password",
    baseTemplate(`
      <p>Hi ${name},</p>
      <p>We received a request to reset the password for your PG Ride account. Click the button below to choose a new password:</p>
      <a href="${escapeHtml(resetUrl)}" class="btn">Reset My Password</a>
      <p>This link expires in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email — your account is secure.</p>
      <p style="font-size:13px; color:#6b7280;">If the button above doesn't work, copy and paste this link into your browser:<br/>
      <a href="${escapeHtml(resetUrl)}" style="color:#2563eb; word-break:break-all;">${escapeHtml(resetUrl)}</a></p>
    `)
  );
}

/**
 * An owner invited this email to their organization (shared/invitations.ts).
 * A booking account's people are invited to book; a fleet's driver (fleet
 * slice 3) is invited to drive, and is told that PG Ride still approves every
 * driver itself, how the fare is shared, and that tips are theirs. Until
 * 2026-09-30 a fleet's driver was told they had been invited "to book rides".
 */
export async function sendOrganizationInviteEmail(params: {
  email: string; organizationName: string; inviterName: string | null; link: string; days: number; role?: string;
}): Promise<void> {
  const org = escapeHtml(params.organizationName);
  const who = params.inviterName ? `${escapeHtml(params.inviterName)} at ${org}` : org;
  const link = escapeHtml(params.link);
  const asDriver = params.role === "driver";
  const subject = asDriver
    ? `${params.organizationName} invited you to drive for their fleet on PG Ride`
    : `${params.organizationName} invited you to book rides on PG Ride`;
  const intro = asDriver
    ? `<p>${who} has invited you to drive one of <strong>${org}</strong>'s cars on PG Ride.</p>
      <p>PG Ride checks and approves every driver itself, so after you accept you finish PG Ride's driver application (your licence) and PG Ride reviews it. Once you are approved, ${org} can give you one of its cars. On rides in a fleet's car your 85% of each fare is shared 75% to you and 25% to the fleet, and every tip is yours.</p>`
    : `<p>${who} has invited you to book rides and deliveries for <strong>${org}</strong> on PG Ride. Set up your sign-in and you land straight in their booking desk:</p>`;
  await sendEmail(
    params.email,
    subject,
    baseTemplate(`
      <p>Hi,</p>
      ${intro}
      <a href="${link}" class="btn">${asDriver ? `Drive for ${org}` : `Join ${org}`}</a>
      <p>This link is for this email address only and expires in <strong>${params.days} days</strong>. If you were not expecting it, you can ignore this email.</p>
      <p style="font-size:13px; color:#6b7280;">If the button above doesn't work, copy and paste this link into your browser:<br/>
      <a href="${link}" style="color:#2563eb; word-break:break-all;">${link}</a></p>
    `)
  );
}

// 3. Ride accepted by driver
export async function sendRideAcceptedEmail(params: {
  riderEmail: string | null;
  riderFirstName: string | null;
  driverName: string;
  driverPhone?: string | null;
  vehicleDescription?: string;
  pickupAddress: string | null;
  destinationAddress: string | null;
  estimatedFare: string | null;
  promoDiscount?: string | null;
}): Promise<void> {
  if (!params.riderEmail) return;

  const name = escapeHtml(params.riderFirstName || "there");
  const fare = parseFloat(params.estimatedFare || "0");
  const promo = parseFloat(params.promoDiscount || "0");
  const finalFare = Math.max(0, fare - promo);

  await sendEmail(
    params.riderEmail,
    `${params.driverName} is on the way! 🚗`,
    baseTemplate(`
      <p>Hi ${name},</p>
      <p>Your driver has accepted your ride request and is heading to your pickup location.</p>
      <div class="card">
        <div class="card-row">
          <span class="card-label">Driver</span>
          <span class="card-value">${escapeHtml(params.driverName)}</span>
        </div>
        ${params.driverPhone ? `<div class="card-row">
          <span class="card-label">Driver Phone</span>
          <span class="card-value">${escapeHtml(params.driverPhone)}</span>
        </div>` : ""}
        ${params.vehicleDescription ? `<div class="card-row">
          <span class="card-label">Vehicle</span>
          <span class="card-value">${escapeHtml(params.vehicleDescription)}</span>
        </div>` : ""}
        <div class="card-row">
          <span class="card-label">Pickup</span>
          <span class="card-value">${escapeHtml(params.pickupAddress || "Your location")}</span>
        </div>
        <div class="card-row">
          <span class="card-label">Destination</span>
          <span class="card-value">${escapeHtml(params.destinationAddress || "—")}</span>
        </div>
        ${promo > 0 ? `<div class="card-row">
          <span class="card-label">PG Welcome Credit</span>
          <span class="card-value" style="color:#16a34a;">-$${promo.toFixed(2)}</span>
        </div>` : ""}
        <div class="card-row">
          <span class="card-label">Estimated Fare</span>
          <span class="card-value">$${finalFare.toFixed(2)}</span>
        </div>
      </div>
      <p>Open the app to track your driver in real time and use the SOS button if you ever need emergency help.</p>
      <a href="${APP_URL}" class="btn">Track My Ride</a>
    `)
  );
}

// 4. Ride completed — receipt
export async function sendRideReceiptEmail(params: {
  riderEmail: string | null;
  riderFirstName: string | null;
  driverName: string;
  pickupAddress: string | null;
  destinationAddress: string | null;
  actualFare: string | null;
  promoDiscountApplied?: string | null;
  completedAt: Date | null;
}): Promise<void> {
  if (!params.riderEmail) return;

  const name = escapeHtml(params.riderFirstName || "there");
  const fare = parseFloat(params.actualFare || "0");
  const promo = parseFloat(params.promoDiscountApplied || "0");
  const charged = Math.max(0, fare - promo);
  const dateStr = params.completedAt
    ? new Date(params.completedAt).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })
    : "Just now";

  await sendEmail(
    params.riderEmail,
    `Your PG Ride receipt — $${charged.toFixed(2)}`,
    baseTemplate(`
      <p>Hi ${name},</p>
      <p>Thanks for riding with PG Ride! Here's your receipt.</p>
      <div class="card">
        <div class="card-row">
          <span class="card-label">Date</span>
          <span class="card-value">${dateStr}</span>
        </div>
        <div class="card-row">
          <span class="card-label">Driver</span>
          <span class="card-value">${escapeHtml(params.driverName)}</span>
        </div>
        <div class="card-row">
          <span class="card-label">From</span>
          <span class="card-value">${escapeHtml(params.pickupAddress || "Pickup location")}</span>
        </div>
        <div class="card-row">
          <span class="card-label">To</span>
          <span class="card-value">${escapeHtml(params.destinationAddress || "Destination")}</span>
        </div>
        <div style="border-top: 1px solid #bbf7d0; margin: 12px 0;"></div>
        <div class="card-row">
          <span class="card-label">Ride fare</span>
          <span class="card-value">$${fare.toFixed(2)}</span>
        </div>
        ${promo > 0 ? `<div class="card-row">
          <span class="card-label">PG Welcome Credit</span>
          <span class="card-value" style="color:#16a34a;">-$${promo.toFixed(2)}</span>
        </div>` : ""}
        <div class="card-row">
          <span class="card-label" style="font-weight:700;">Total charged</span>
          <span class="card-value highlight">$${charged.toFixed(2)}</span>
        </div>
      </div>
      <p>Charged to the card on file for your account. You can update it anytime from your Profile page.</p>
      <a href="${APP_URL}" class="btn">Leave a Rating</a>
    `)
  );
}

// 5. New signup — pending approval notice
export async function sendSignupPendingEmail(user: {
  email: string | null;
  firstName: string | null;
}): Promise<void> {
  if (!user.email) return;
  const name = escapeHtml(user.firstName || "there");

  await sendEmail(
    user.email,
    "Welcome to PG Ride — your account is pending approval",
    baseTemplate(`
      <p>Hi ${name},</p>
      <p>Thanks for signing up for PG Ride, ridesharing built for Prince George's County!</p>
      <p>Your account is currently <strong>pending approval</strong> by our team. We typically review new accounts within 24 hours. You'll receive another email as soon as you're approved and ready to ride.</p>
      <div class="card">
        <div class="card-row">
          <span class="card-label">What happens next?</span>
        </div>
        <p style="font-size:14px; color:#374151; margin:8px 0 0;">Our team reviews your account to keep the PG Ride community safe.${
          featureFlags.walletEnabled
            ? " Once approved, you'll get $20 in Virtual PG Card credit and 4 rides with $5 off each."
            : " Once approved, your first 4 rides each come with $5 off."
        }</p>
      </div>
      <p>Questions? Reply to this email and we'll help you out.</p>
    `)
  );
}

/**
 * Operational announcement from the PG Ride team. Title and body are admin
 * free text, so both are escaped — an announcement must never be able to
 * inject markup into the email.
 */
export async function sendAnnouncementEmail(params: {
  email: string;
  firstName: string | null;
  title: string;
  body: string;
}): Promise<void> {
  const name = escapeHtml(params.firstName || "there");
  const title = escapeHtml(params.title);
  // Preserve the admin's line breaks without allowing any other markup.
  const body = escapeHtml(params.body).replace(/\n/g, "<br>");

  await sendEmail(
    params.email,
    title,
    baseTemplate(`
      <p>Hi ${escapeHtml(name)},</p>
      <div class="card">
        <div class="card-row"><span class="card-label">${title}</span></div>
        <p style="font-size:14px; color:#374151; margin:8px 0 0;">${body}</p>
      </div>
      <p style="font-size:13px;color:#6b7280;">This is a service message from PG Ride about your account or our service.</p>
    `)
  );
}

export async function sendCircuitReminderEmail(
  email: string,
  firstName: string | null,
  run: {
    circuitName: string;
    runTime: string;
    pickupAddress: string;
    driverName: string | null;
  },
): Promise<void> {
  const name = escapeHtml(firstName || "there");
  await sendEmail(
    email,
    `Seat confirmed: ${run.circuitName} — ${run.runTime}`,
    baseTemplate(`
      <p>Hi ${name},</p>
      <p>Booking is closed and your seat is <strong>confirmed</strong>.</p>
      <div class="card">
        <div class="card-row"><span class="card-label">Circuit</span> ${escapeHtml(run.circuitName)}</div>
        <div class="card-row"><span class="card-label">Departs</span> ${escapeHtml(run.runTime)}</div>
        <div class="card-row"><span class="card-label">Pickup</span> ${escapeHtml(run.pickupAddress)}</div>
        <div class="card-row"><span class="card-label">Driver</span> ${escapeHtml(run.driverName ?? "Being confirmed — you'll be notified")}</div>
      </div>
      <p>Please be at the pickup point about 5 minutes early. Guaranteed seat, fixed fare, no surge.</p>
    `),
  );
}

// SOS / emergency alert to on-call admins. This is the non-WebSocket fallback
// for the durable SOS admin surface: it must reach staff even when no admin
// dashboard tab is open (e.g. a 2am incident). Best-effort per recipient —
// a single send failure never blocks the others or the incident record.
export async function sendEmergencyAdminAlertEmail(
  recipients: { email: string; firstName: string | null }[],
  incident: {
    incidentType: string;
    riderName: string | null;
    riderPhone: string | null;
    description: string | null;
    location: { lat: number; lng: number } | null;
    shareToken: string | null;
    createdAt: Date | string | null;
  },
): Promise<{ sent: number; failed: number }> {
  if (recipients.length === 0) return { sent: 0, failed: 0 };

  // Coordinates come from untrusted request JSON — coerce to finite numbers so
  // they can only ever be plain digits in the maps URL, never injected markup.
  const lat = Number(incident.location?.lat);
  const lng = Number(incident.location?.lng);
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lng);
  const mapsLink = hasLoc ? `https://maps.google.com/?q=${lat},${lng}` : null;
  // shareToken is a server-generated nanoid, but encode defensively anyway.
  const shareUrl = incident.shareToken ? `${APP_URL}/emergency/${encodeURIComponent(incident.shareToken)}` : null;
  const adminUrl = `${APP_URL}/admin`;
  const when = incident.createdAt ? new Date(incident.createdAt).toUTCString() : "just now";

  const type = escapeHtml(incident.incidentType);
  const rider = escapeHtml(incident.riderName ?? "Unknown");
  const phone = incident.riderPhone ? escapeHtml(incident.riderPhone) : null;
  const details = incident.description ? escapeHtml(incident.description) : null;

  const content = `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:20px 24px;margin:0 0 20px;">
      <p style="margin:0 0 12px;color:#b91c1c;font-size:20px;font-weight:700;">🚨 SOS / Emergency Alert</p>
      <div style="font-size:14px;color:#374151;line-height:1.9;">
        <div><strong>Type:</strong> ${type}</div>
        <div><strong>Rider:</strong> ${rider}${phone ? ` — ${phone}` : ""}</div>
        ${details ? `<div><strong>Details:</strong> ${details}</div>` : ""}
        <div><strong>Time:</strong> ${when}</div>
        ${mapsLink ? `<div><strong>Location:</strong> <a href="${mapsLink}">${mapsLink}</a></div>` : `<div><strong>Location:</strong> Not available</div>`}
      </div>
    </div>
    <p>A rider has triggered an emergency alert. Open the admin dashboard to acknowledge and coordinate a response.</p>
    <p style="text-align:center;">
      <a class="btn" style="background:#dc2626;" href="${adminUrl}">Open Admin Dashboard</a>
      ${shareUrl ? `&nbsp;<a class="btn" style="background:#374151;" href="${shareUrl}">Live Location</a>` : ""}
    </p>
    <p style="color:#6b7280;font-size:13px;">If you can't reach the rider, escalate to 911.</p>
  `;

  // Subject is plain text (no HTML), but collapse newlines to avoid header
  // oddities and keep it single-line.
  const subjectRider = incident.riderName ? ` — ${incident.riderName}` : "";
  const subject = `🚨 PG Ride SOS: ${incident.incidentType}${subjectRider}`.replace(/[\r\n]+/g, " ");
  const html = baseTemplate(content);

  let sent = 0;
  let failed = 0;
  for (const r of recipients) {
    try {
      await sendEmail(r.email, subject, html);
      sent++;
    } catch (err) {
      failed++;
      console.error(`[EMAIL] Failed to send SOS admin alert to ${r.email}:`, err);
    }
  }
  return { sent, failed };
}
