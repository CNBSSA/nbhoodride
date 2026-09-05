import { Resend } from "resend";
import { resolveAppUrl } from "./appUrl";
import { featureFlags } from "./featureFlags";

/**
 * Bare sender address. RESEND_FROM is often pasted in display-name form
 * ("PG Ride <noreply@example.com>"), which the header builder below would
 * wrap a second time into "PG Ride <PG Ride <noreply@…>>" — malformed, and
 * rejected by the provider with an error about the from address. Extract the
 * address so either form works.
 */
function normalizeFromAddress(raw: string): string {
  const value = raw.trim();
  const angled = value.match(/<([^>]+)>/);
  return (angled ? angled[1] : value).trim();
}

const FROM_ADDRESS = normalizeFromAddress(process.env.RESEND_FROM || "noreply@pgride.app");
const FROM_NAME = "PG Ride";

/**
 * Non-secret view of the email configuration, for the admin diagnostic and the
 * readiness report. Never exposes the API key itself.
 *
 * `usingUnverifiedDefault` is the trap this exists to catch: when RESEND_FROM
 * is unset the sender falls back to noreply@pgride.app, a domain with no DNS
 * and therefore no possible Resend verification — so every send fails with a
 * domain error that is invisible unless someone reads the server logs.
 */
export function getEmailConfigSummary() {
  const fromDomain = FROM_ADDRESS.includes("@") ? FROM_ADDRESS.split("@")[1] : "";
  return {
    apiKeyPresent: Boolean(process.env.RESEND_API_KEY?.trim()),
    from: FROM_ADDRESS,
    fromDomain,
    usingUnverifiedDefault: !process.env.RESEND_FROM?.trim(),
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
    // Resend puts the useful part (e.g. "The domain is not verified") in
    // message/name; surface it verbatim rather than a generic failure.
    const parts = [err?.name, err?.message, err?.error?.message].filter(Boolean);
    return { ok: false, error: parts.join(": ").slice(0, 300) || "Unknown email error" };
  }
}

const APP_URL = resolveAppUrl();

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// Loud startup warning if email isn't configured. In production this is
// almost always a misconfiguration (signup flow advertises "check your email"
// but nothing goes out). In dev/test we log once and move on.
if (!resend) {
  const msg =
    "[EMAIL] RESEND_API_KEY is not set. Outbound email will fail. " +
    "Set RESEND_API_KEY (and RESEND_FROM) in Railway → Variables.";
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

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email service is not configured. RESEND_API_KEY is missing.");
    this.name = "EmailNotConfiguredError";
  }
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!resend) {
    // In production, fail loudly so the calling route surfaces the issue
    // instead of silently succeeding while the user waits for an email that
    // will never arrive. In dev, keep the old log-and-no-op behaviour so
    // local development without a Resend key still works.
    if (process.env.NODE_ENV === "production") {
      console.error(`[EMAIL] Refusing to send (RESEND_API_KEY missing): to=${to} subject=${subject}`);
      throw new EmailNotConfiguredError();
    }
    console.log(`[EMAIL — not sent in dev, RESEND_API_KEY not set]\nTo: ${to}\nSubject: ${subject}`);
    return;
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      // The Resend SDK does NOT throw on API errors — it resolves with
      // { data: null, error }. Awaiting it and moving on therefore counted
      // every rejected send (unverified sender domain, bad key, rate limit)
      // as a success: no retry, no log, and the caller told the user their
      // email was on its way. Inspect the payload and throw so the existing
      // retry and error handling actually apply.
      const response = await resend.emails.send({
        from: `${FROM_NAME} <${FROM_ADDRESS}>`,
        to,
        subject,
        html,
      });
      if (response?.error) {
        const { name, message } = response.error as { name?: string; message?: string };
        throw new Error(`Resend rejected the message (${name ?? "error"}): ${message ?? "no detail"}`);
      }
      return;
    } catch (err) {
      if (attempt === 2) {
        console.error(`[EMAIL] Failed to send to ${to} after 2 attempts:`, err);
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
  const name = user.firstName || "there";
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
  const name = user.firstName || "there";
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
  const name = user.firstName || "there";

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
  const name = firstName || "there";
  const resetUrl = `${appUrl}/reset-password?token=${resetToken}`;

  await sendEmail(
    email,
    "Reset your PG Ride password",
    baseTemplate(`
      <p>Hi ${name},</p>
      <p>We received a request to reset the password for your PG Ride account. Click the button below to choose a new password:</p>
      <a href="${resetUrl}" class="btn">Reset My Password</a>
      <p>This link expires in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email — your account is secure.</p>
      <p style="font-size:13px; color:#6b7280;">If the button above doesn't work, copy and paste this link into your browser:<br/>
      <a href="${resetUrl}" style="color:#2563eb; word-break:break-all;">${resetUrl}</a></p>
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

  const name = params.riderFirstName || "there";
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
          <span class="card-value">${params.driverName}</span>
        </div>
        ${params.driverPhone ? `<div class="card-row">
          <span class="card-label">Driver Phone</span>
          <span class="card-value">${params.driverPhone}</span>
        </div>` : ""}
        ${params.vehicleDescription ? `<div class="card-row">
          <span class="card-label">Vehicle</span>
          <span class="card-value">${params.vehicleDescription}</span>
        </div>` : ""}
        <div class="card-row">
          <span class="card-label">Pickup</span>
          <span class="card-value">${params.pickupAddress || "Your location"}</span>
        </div>
        <div class="card-row">
          <span class="card-label">Destination</span>
          <span class="card-value">${params.destinationAddress || "—"}</span>
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

  const name = params.riderFirstName || "there";
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
          <span class="card-value">${params.driverName}</span>
        </div>
        <div class="card-row">
          <span class="card-label">From</span>
          <span class="card-value">${params.pickupAddress || "Pickup location"}</span>
        </div>
        <div class="card-row">
          <span class="card-label">To</span>
          <span class="card-value">${params.destinationAddress || "Destination"}</span>
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
      <p>Charged to your Virtual PG Card. You can add funds anytime from your Profile page.</p>
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
  const name = user.firstName || "there";

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
  const name = params.firstName || "there";
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
  const name = firstName || "there";
  await sendEmail(
    email,
    `Seat confirmed: ${run.circuitName} — ${run.runTime}`,
    baseTemplate(`
      <p>Hi ${name},</p>
      <p>Booking is closed and your seat is <strong>confirmed</strong>.</p>
      <div class="card">
        <div class="card-row"><span class="card-label">Circuit</span> ${run.circuitName}</div>
        <div class="card-row"><span class="card-label">Departs</span> ${run.runTime}</div>
        <div class="card-row"><span class="card-label">Pickup</span> ${run.pickupAddress}</div>
        <div class="card-row"><span class="card-label">Driver</span> ${run.driverName ?? "Being confirmed — you'll be notified"}</div>
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
