import { Resend } from "resend";

const FROM_ADDRESS = process.env.RESEND_FROM || "noreply@pgride.app";
const FROM_NAME = "PG Ride";

// Resolve the app URL: explicit APP_URL > Railway auto-domain
const APP_URL = (
  process.env.APP_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "")
).replace(/\/$/, "");

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!resend) {
    console.log(`[EMAIL — not sent, RESEND_API_KEY not set]\nTo: ${to}\nSubject: ${subject}`);
    return;
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await resend.emails.send({ from: `${FROM_NAME} <${FROM_ADDRESS}>`, to, subject, html });
      return;
    } catch (err) {
      if (attempt === 2) {
        console.error(`[EMAIL] Failed to send to ${to} after 2 attempts:`, err);
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
  const balance = parseFloat(user.virtualCardBalance || "20.00").toFixed(2);

  await sendEmail(
    user.email,
    "Your PG Ride account is approved — welcome! 🎉",
    baseTemplate(`
      <p>Hi ${name},</p>
      <p>Great news — your PG Ride account has been approved by our team! You can now log in and start booking rides.</p>
      <div class="card">
        <div class="card-row">
          <span class="card-label">Virtual PG Card Balance</span>
          <span class="card-value highlight">$${balance}</span>
        </div>
        <div class="card-row">
          <span class="card-label">Welcome Promo Rides</span>
          <span class="card-value">${user.promoRidesRemaining ?? 4} rides × $5 off each</span>
        </div>
      </div>
      <p>Your first 4 rides each come with a $5 discount automatically — no code needed. Just open the app and book!</p>
      <a href="${APP_URL}" class="btn">Open PG Ride</a>
      <p style="font-size:13px; color:#6b7280; margin-top:8px;">No surge pricing · Community-owned · PG County only</p>
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
      <p>Thanks for signing up for PG Ride, Prince George's County's community-owned rideshare!</p>
      <p>Your account is currently <strong>pending approval</strong> by our team. We typically review new accounts within 24 hours. You'll receive another email as soon as you're approved and ready to ride.</p>
      <div class="card">
        <div class="card-row">
          <span class="card-label">What happens next?</span>
        </div>
        <p style="font-size:14px; color:#374151; margin:8px 0 0;">Our team reviews your account to keep the PG Ride community safe. Once approved, you'll get $20 in Virtual PG Card credit and 4 rides with $5 off each.</p>
      </div>
      <p>Questions? Reply to this email and we'll help you out.</p>
    `)
  );
}
