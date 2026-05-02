import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { db } from "./db";
import { setupAuth, isAuthenticated, getSession } from "./replitAuth";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { ObjectPermission } from "./objectAcl";
import { z } from "zod";
import { nanoid } from "nanoid";
import twilio from "twilio";
import { stripeService, stripe } from "./stripeService";
import bcrypt from "bcrypt";
import Anthropic from "@anthropic-ai/sdk";
import rateLimit from "express-rate-limit";
import { getCountyFromCoords, driverCoversCounty } from "./countyService";
import {
  sendAccountApprovedEmail,
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
  sendRideAcceptedEmail,
  sendRideReceiptEmail,
  sendSignupPendingEmail,
} from "./emailService";
import { sendPushToSubscriptions } from "./pushService";
import { tryMatchSharedRide, getSharedGroupRides, getMyActiveSharedGroup } from "./sharedRideService";
import {
  insertDriverProfileSchema,
  insertVehicleSchema,
  insertRideSchema,
  insertDisputeSchema,
  insertEmergencyIncidentSchema,
} from "@shared/schema";

// Lazy Anthropic client — instantiated on first use so the server starts
// successfully even when ANTHROPIC_API_KEY is not yet configured.
let _anthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return _anthropic;
}

// Extend Express session type to include testUserId and regular userId
declare module "express-session" {
  interface SessionData {
    testUserId?: string;
    userId?: string;
  }
}

// ── Ride state machine ──────────────────────────────────────────────────────
// Maps each status to the set of statuses it is allowed to transition into.
const VALID_RIDE_TRANSITIONS: Record<string, string[]> = {
  pending:        ["accepted", "cancelled"],
  accepted:       ["driver_arriving", "cancelled"],
  driver_arriving:["in_progress", "cancelled"],
  in_progress:    ["completed", "cancelled"],
  completed:      [],   // terminal
  cancelled:      [],   // terminal
};

function isValidRideTransition(from: string, to: string): boolean {
  return VALID_RIDE_TRANSITIONS[from]?.includes(to) ?? false;
}
// ────────────────────────────────────────────────────────────────────────────

async function ensureSuperAdminSetup() {
  try {
    const setupToken = process.env.SUPER_ADMIN_SETUP_TOKEN;
    if (!setupToken) return;

    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'thrynovainsights@gmail.com';
    const existing = await storage.getUserByEmail(superAdminEmail);
    if (existing && !existing.isSuperAdmin) {
      await storage.adminUpdateUser(existing.id, { isSuperAdmin: true, isAdmin: true, isApproved: true, isVerified: true });
      console.log('Super Admin account activated for existing user');
    }
  } catch (error) {
    console.error('Super admin auto-setup check failed:', error);
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Rate limiting
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests, please try again later." },
    // NOTE: No skip for /api/admin — all endpoints are rate-limited
  });

  const aiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 AI messages per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many AI requests. Please slow down." },
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20, // 20 login/signup attempts per 15 min
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many authentication attempts. Please try again later." },
  });

  app.use('/api', generalLimiter);
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/email-login', authLimiter);
  app.use('/api/auth/signup', authLimiter);
  app.use('/api/auth/forgot-password', authLimiter);
  app.use('/api/auth/reset-password', authLimiter);
  app.use('/api/auth/verify-email', authLimiter);
  app.use('/api/auth/resend-verification', authLimiter);
  app.use('/api/auth/test-login', authLimiter);
  app.use('/api/admin/setup-super-admin', authLimiter);
  app.use('/api/ai', aiLimiter);

  // Auth middleware
  await setupAuth(app);

  // Ensure super admin account is properly configured on startup
  await ensureSuperAdminSetup();

  // Email/Password Authentication Routes
  // POST /api/auth/signup - Register new user

  // GET /admin/setup - HTML form for resetting the super admin password from a browser
  app.get('/admin/setup', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Super Admin Setup</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 2rem;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.4);
    }
    h1 {
      font-size: 1.4rem;
      font-weight: 700;
      margin-bottom: 0.4rem;
      color: #f1f5f9;
    }
    p.subtitle {
      font-size: 0.85rem;
      color: #94a3b8;
      margin-bottom: 1.75rem;
    }
    label {
      display: block;
      font-size: 0.8rem;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.4rem;
    }
    input[type="password"] {
      width: 100%;
      padding: 0.65rem 0.85rem;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      color: #f1f5f9;
      font-size: 1rem;
      margin-bottom: 1.1rem;
      outline: none;
      transition: border-color 0.15s;
    }
    input[type="password"]:focus { border-color: #6366f1; }
    button {
      width: 100%;
      padding: 0.75rem;
      background: #6366f1;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
      margin-top: 0.25rem;
    }
    button:hover { background: #4f46e5; }
    button:disabled { background: #475569; cursor: not-allowed; }
    #msg {
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-size: 0.9rem;
      display: none;
    }
    #msg.success { background: #14532d; color: #86efac; border: 1px solid #166534; }
    #msg.error   { background: #450a0a; color: #fca5a5; border: 1px solid #7f1d1d; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔐 Super Admin Setup</h1>
    <p class="subtitle">Reset the super admin password using your setup token.</p>
    <form id="setupForm">
      <label for="token">Setup Token</label>
      <input type="password" id="token" name="token" placeholder="Enter setup token" autocomplete="off" required />
      <label for="password">New Password</label>
      <input type="password" id="password" name="password" placeholder="Min. 8 characters" autocomplete="new-password" required minlength="8" />
      <button type="submit" id="submitBtn">Reset Password</button>
    </form>
    <div id="msg"></div>
  </div>
  <script>
    document.getElementById('setupForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('submitBtn');
      const msg = document.getElementById('msg');
      const token = document.getElementById('token').value.trim();
      const password = document.getElementById('password').value;
      btn.disabled = true;
      btn.textContent = 'Resetting…';
      msg.style.display = 'none';
      msg.className = '';
      try {
        const res = await fetch('/api/admin/setup-super-admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password })
        });
        const data = await res.json();
        msg.style.display = 'block';
        if (res.ok) {
          msg.className = 'success';
          msg.textContent = '✓ ' + (data.message || 'Password reset successfully.');
          document.getElementById('setupForm').reset();
        } else {
          msg.className = 'error';
          msg.textContent = '✗ ' + (data.message || 'Something went wrong.');
        }
      } catch (err) {
        msg.style.display = 'block';
        msg.className = 'error';
        msg.textContent = '✗ Network error — please try again.';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Reset Password';
      }
    });
  </script>
</body>
</html>`);
  });

  // Super admin setup - requires setup token and user-provided password
  app.post('/api/admin/setup-super-admin', async (req, res) => {
    try {
      const setupToken = process.env.SUPER_ADMIN_SETUP_TOKEN;
      if (!setupToken) {
        return res.status(403).json({ message: "Setup not available" });
      }

      const setupSchema = z.object({
        token: z.string().min(1),
        password: z.string().min(1, "Password is required"),
      });
      const { token, password } = setupSchema.parse(req.body);

      if (token !== setupToken) {
        return res.status(403).json({ message: "Invalid setup token" });
      }

      // Enforce complexity for super admin password too
      const { valid: pwValid, feedback: pwFeedback } = validatePasswordComplexity(password);
      if (!pwValid) {
        return res.status(400).json({ message: `Password must contain: ${pwFeedback.join(", ")}.` });
      }

      const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'thrynovainsights@gmail.com';
    const existing = await storage.getUserByEmail(superAdminEmail);
      if (existing) {
        if (!existing.isSuperAdmin) {
          const hashedPassword = await bcrypt.hash(password, 12);
          await storage.adminUpdateUser(existing.id, { isSuperAdmin: true, isAdmin: true, isApproved: true, isVerified: true });
          await storage.updatePassword(existing.id, hashedPassword);
          return res.json({ message: "Existing account upgraded to Super Admin" });
        }
        return res.json({ message: "Super Admin already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      await storage.createUser({
        email: 'thrynovainsights@gmail.com',
        password: hashedPassword,
        firstName: 'Super',
        lastName: 'Admin',
        isSuperAdmin: true,
        isAdmin: true,
        isApproved: true,
        isVerified: true,
        virtualCardBalance: "1000.00"
      });
      res.json({ message: "Super Admin created successfully" });
    } catch (error: any) {
      console.error("Setup error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Setup failed" });
    }
  });

  // ── Password complexity helper ──────────────────────────────────────────────
  function validatePasswordComplexity(password: string): { valid: boolean; feedback: string[] } {
    const feedback: string[] = [];
    if (password.length < 8) feedback.push("at least 8 characters");
    if (!/[A-Z]/.test(password)) feedback.push("at least 1 uppercase letter (A-Z)");
    if (!/[a-z]/.test(password)) feedback.push("at least 1 lowercase letter (a-z)");
    if (!/[0-9]/.test(password)) feedback.push("at least 1 number (0-9)");
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) feedback.push("at least 1 special character (!@#$%^&* etc.)");
    return { valid: feedback.length === 0, feedback };
  }

  // ── Disposable email domain blocklist ──────────────────────────────────────
  const DISPOSABLE_EMAIL_DOMAINS = new Set([
    "mailinator.com", "guerrillamail.com", "tempmail.com", "throwaway.email",
    "yopmail.com", "sharklasers.com", "guerrillamailblock.com", "grr.la",
    "guerrillamail.info", "guerrillamail.biz", "guerrillamail.de", "guerrillamail.net",
    "guerrillamail.org", "spam4.me", "trashmail.com", "trashmail.me", "trashmail.net",
    "dispostable.com", "mailnull.com", "spamgourmet.com", "spamgourmet.net",
    "spamgourmet.org", "maildrop.cc", "discard.email", "fakeinbox.com",
    "tempinbox.com", "getairmail.com", "filzmail.com", "throwam.com",
    "tempr.email", "discard.email", "spamhereplease.com", "spamthisplease.com",
    "10minutemail.com", "10minutemail.net", "10minutemail.org",
    "20minutemail.com", "mytrashmail.com", "mailnesia.com",
  ]);

  function isDisposableEmail(email: string): boolean {
    const domain = email.split("@")[1]?.toLowerCase();
    return domain ? DISPOSABLE_EMAIL_DOMAINS.has(domain) : false;
  }

  // ── Phone normalizer ───────────────────────────────────────────────────────
  function normalizePhone(raw: string): string {
    // Strip everything except digits
    const digits = raw.replace(/\D/g, "");
    // Accept 10-digit US numbers or 11-digit with leading 1
    if (digits.length === 11 && digits.startsWith("1")) {
      return `+1${digits.slice(1)}`;
    }
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    return raw; // return as-is if unrecognised — validation will catch it
  }

  app.post('/api/auth/signup', async (req, res) => {
    const ip = req.ip ?? "unknown";
    try {
      const signupSchema = z.object({
        email: z.string().email("Invalid email address"),
        password: z.string().min(1, "Password is required"),
        firstName: z.string().min(1, "First name is required").max(50, "First name too long"),
        lastName: z.string().min(1, "Last name is required").max(50, "Last name too long"),
        phone: z.string().optional(),
        termsAccepted: z.boolean().refine(v => v === true, {
          message: "You must accept the Terms of Service to register",
        }),
        privacyAccepted: z.boolean().refine(v => v === true, {
          message: "You must accept the Privacy Policy to register",
        }),
      });

      const { email, password, firstName, lastName, phone, termsAccepted, privacyAccepted } =
        signupSchema.parse(req.body);

      // ── Password complexity ──────────────────────────────────────────────
      const { valid: passwordValid, feedback: passwordFeedback } = validatePasswordComplexity(password);
      if (!passwordValid) {
        console.log(`[AUDIT] signup_failed ip=${ip} email=${email} reason=weak_password`);
        return res.status(400).json({
          message: `Password must contain: ${passwordFeedback.join(", ")}.`,
          passwordRequirements: {
            minLength: 8,
            requireUppercase: true,
            requireLowercase: true,
            requireNumber: true,
            requireSpecialChar: true,
            missing: passwordFeedback,
          },
        });
      }

      // ── Disposable email check ───────────────────────────────────────────
      if (isDisposableEmail(email)) {
        console.log(`[AUDIT] signup_failed ip=${ip} email=${email} reason=disposable_email`);
        return res.status(400).json({ message: "Please use a permanent email address. Temporary/disposable email addresses are not accepted." });
      }

      // ── Phone validation & normalisation ────────────────────────────────
      let normalizedPhone: string | undefined;
      if (phone && phone.trim() !== "") {
        const digits = phone.replace(/\D/g, "");
        const validLength =
          (digits.length === 10) ||
          (digits.length === 11 && digits.startsWith("1"));
        if (!validLength) {
          return res.status(400).json({ message: "Phone number must be a valid 10-digit US number (e.g. 301-555-1234)." });
        }
        normalizedPhone = normalizePhone(phone);
      }

      // ── Case-insensitive duplicate email check ───────────────────────────
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        // Don't reveal whether the account exists — generic message
        console.log(`[AUDIT] signup_failed ip=${ip} email=${email} reason=duplicate_email`);
        return res.status(400).json({ message: "An account with this email address already exists. Please log in or use a different email." });
      }

      // ── Hash password ────────────────────────────────────────────────────
      const hashedPassword = await bcrypt.hash(password, 12);

      // ── Consent timestamps ───────────────────────────────────────────────
      const now = new Date();

      const user = await storage.createUser({
        email: email.toLowerCase(),
        password: hashedPassword,
        firstName,
        lastName,
        phone: normalizedPhone,
        isApproved: false,
        virtualCardBalance: "20.00",
        promoRidesRemaining: 4,
        termsAcceptedAt: termsAccepted ? now : undefined,
        privacyAcceptedAt: privacyAccepted ? now : undefined,
        registrationCompletedAt: now,
      });

      // ── Email verification token ─────────────────────────────────────────
      const verificationToken = nanoid(40);
      const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      await storage.setEmailVerificationToken(user.id, verificationToken, verificationExpiry);

      // ── Audit log ────────────────────────────────────────────────────────
      console.log(`[AUDIT] signup_success ip=${ip} userId=${user.id} email=${user.email}`);

      // ── Emails (fire-and-forget) ─────────────────────────────────────────
      sendEmailVerificationEmail(user.email!, user.firstName, verificationToken).catch(console.error);
      sendSignupPendingEmail({ email: user.email, firstName: user.firstName }).catch(console.error);

      res.json({
        message: "Account created! Please check your email to verify your address. Your account will also need administrator approval before you can log in.",
        pendingApproval: true,
        emailVerificationSent: true,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
      });
    } catch (error) {
      console.error("Signup error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.log(`[AUDIT] signup_error ip=${ip} error=${String(error)}`);
      res.status(500).json({ message: "Signup failed" });
    }
  });

  // POST /api/auth/verify-email - Verify email address with token
  app.post('/api/auth/verify-email', async (req, res) => {
    try {
      const schema = z.object({ token: z.string().min(1, "Verification token is required") });
      const { token } = schema.parse(req.body);

      const user = await storage.getUserByVerificationToken(token);
      if (!user) {
        return res.status(400).json({ message: "Invalid or expired verification link. Please request a new one." });
      }

      await storage.markEmailVerified(user.id);
      console.log(`[AUDIT] email_verified userId=${user.id} email=${user.email}`);

      res.json({
        message: "Email verified successfully! Your account is now pending administrator approval.",
        emailVerified: true,
      });
    } catch (error) {
      console.error("Email verification error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Email verification failed" });
    }
  });

  // POST /api/auth/resend-verification - Resend email verification
  app.post('/api/auth/resend-verification', authLimiter, async (req, res) => {
    try {
      const schema = z.object({ email: z.string().email("Invalid email address") });
      const { email } = schema.parse(req.body);

      const user = await storage.getUserByEmail(email);
      // Always return success to avoid revealing whether the email exists
      if (!user || user.emailVerifiedAt) {
        return res.json({ message: "If the email exists and is unverified, a new verification link has been sent." });
      }

      const verificationToken = nanoid(40);
      const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await storage.setEmailVerificationToken(user.id, verificationToken, verificationExpiry);
      sendEmailVerificationEmail(user.email!, user.firstName, verificationToken).catch(console.error);

      res.json({ message: "If the email exists and is unverified, a new verification link has been sent." });
    } catch (error) {
      console.error("Resend verification error:", error);
      res.status(500).json({ message: "Failed to resend verification email" });
    }
  });

  // POST /api/auth/email-login - Login with email and password
  app.post('/api/auth/email-login', async (req, res) => {
    const ip = req.ip ?? "unknown";
    try {
      const loginSchema = z.object({
        email: z.string().email("Invalid email address"),
        password: z.string().min(1, "Password is required")
      });

      const { email, password } = loginSchema.parse(req.body);

      // Find user by email (case-insensitive)
      const user = await storage.getUserByEmail(email);
      if (!user || !user.password) {
        console.log(`[AUDIT] login_failed ip=${ip} email=${email} reason=user_not_found`);
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        console.log(`[AUDIT] login_failed ip=${ip} userId=${user.id} email=${email} reason=wrong_password`);
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Check if suspended
      if (user.isSuspended) {
        console.log(`[AUDIT] login_failed ip=${ip} userId=${user.id} email=${email} reason=suspended`);
        return res.status(403).json({ message: "Your account has been suspended. Please contact support." });
      }

      // Check if user is approved (admins and super admins skip this check)
      if (!user.isApproved && !user.isAdmin && !user.isSuperAdmin) {
        console.log(`[AUDIT] login_failed ip=${ip} userId=${user.id} email=${email} reason=pending_approval`);
        return res.status(403).json({ message: "Your account is pending approval by an administrator. Please check back later." });
      }

      // Set session and record last login
      req.session.userId = user.id;
      storage.updateLastLogin(user.id).catch(console.error);

      console.log(`[AUDIT] login_success ip=${ip} userId=${user.id} email=${email}`);

      res.json({ 
        message: "Login successful",
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          virtualCardBalance: user.virtualCardBalance,
          isDriver: user.isDriver
        }
      });
    } catch (error) {
      console.error("Login error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.log(`[AUDIT] login_error ip=${ip} error=${String(error)}`);
      res.status(500).json({ message: "Login failed" });
    }
  });

  // POST /api/auth/forgot-password - Request password reset
  app.post('/api/auth/forgot-password', async (req, res) => {
    try {
      const forgotPasswordSchema = z.object({
        email: z.string().email("Invalid email address")
      });

      const { email } = forgotPasswordSchema.parse(req.body);

      // Find user by email
      const user = await storage.getUserByEmail(email);
      if (!user) {
        // Don't reveal that user doesn't exist for security
        return res.json({ message: "If the email exists, a password reset link will be sent" });
      }

      // Generate reset token
      const resetToken = nanoid(32);
      const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      // Save reset token
      await storage.setPasswordResetToken(email, resetToken, resetExpiry);

      const appUrl = process.env.APP_URL || `https://${req.get('host')}`;
      sendPasswordResetEmail(email, user.firstName, resetToken, appUrl).catch(console.error);

      res.json({ 
        message: "If the email exists, a password reset link will be sent",
      });
    } catch (error) {
      console.error("Forgot password error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Password reset request failed" });
    }
  });

  // POST /api/auth/reset-password - Reset password with token
  app.post('/api/auth/reset-password', async (req, res) => {
    try {
      const resetPasswordSchema = z.object({
        token: z.string().min(1, "Reset token is required"),
        newPassword: z.string().min(1, "New password is required")
      });

      const { token, newPassword } = resetPasswordSchema.parse(req.body);

      // Enforce password complexity on reset
      const { valid: passwordValid, feedback: passwordFeedback } = validatePasswordComplexity(newPassword);
      if (!passwordValid) {
        return res.status(400).json({
          message: `Password must contain: ${passwordFeedback.join(", ")}.`,
          passwordRequirements: { missing: passwordFeedback },
        });
      }

      // Find user by reset token
      const user = await storage.getUserByResetToken(token);
      if (!user) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      // Update password and clear reset token
      await storage.updatePassword(user.id, hashedPassword);
      console.log(`[AUDIT] password_reset userId=${user.id} email=${user.email}`);

      res.json({ message: "Password reset successful" });
    } catch (error) {
      console.error("Reset password error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Password reset failed" });
    }
  });

  // POST /api/auth/logout - Logout user
  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ message: "Logout successful" });
    });
  });

  // Test authentication route for test riders - EXPLICITLY DISABLED BY DEFAULT
  // Only enable when ENABLE_TEST_LOGIN environment variable is explicitly set to 'true'
  // This ensures the endpoint is NEVER available in production unless explicitly configured
  // Test login endpoint — requires both ENABLE_TEST_LOGIN=true AND TEST_PASSWORD env var to be set.
  // Real user emails and passwords must NEVER be hardcoded here. Configure via environment only.
  if (process.env.ENABLE_TEST_LOGIN === 'true' && process.env.NODE_ENV !== 'production' && process.env.TEST_PASSWORD) {
    const TEST_PASSWORD = process.env.TEST_PASSWORD;
    // TEST_USER_IDS: comma-separated list of real user IDs from the database, e.g. "uuid1,uuid2"
    const testUserIds = (process.env.TEST_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

    console.log('⚠️  WARNING: Test login endpoint is ENABLED. Only for local development!');

    app.post('/api/auth/test-login', async (req, res) => {
      try {
        const { userId, password } = req.body;
        if (!userId || password !== TEST_PASSWORD) {
          return res.status(401).json({ message: "Invalid credentials" });
        }
        if (!testUserIds.includes(userId)) {
          return res.status(403).json({ message: "User not in test allow-list" });
        }
        const user = await storage.getUser(userId);
        if (!user) return res.status(404).json({ message: "User not found" });
        req.session.testUserId = userId;
        res.json({ message: "Login successful", user: { ...user, driverProfile: null } });
      } catch (error) {
        console.error("Test login error:", error);
        res.status(500).json({ message: "Login failed" });
      }
    });
  } else {
    console.log('✅ Test login endpoint is DISABLED (production safe)');
  }

  // Auth routes
  app.get('/api/auth/user', async (req: any, res) => {
    try {
      // Check for session-based userId first (email/password auth)
      const sessionUserId = req.session?.userId;
      // Then check for test user session
      const testUserId = req.session?.testUserId;
      let userId: string;
      
      if (sessionUserId) {
        userId = sessionUserId;
      } else if (testUserId) {
        userId = testUserId;
      } else if (req.isAuthenticated() && req.user?.claims?.sub) {
        userId = req.user.claims.sub;
      } else {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Get driver profile if user is a driver
      let driverProfile = null;
      if (user.isDriver) {
        driverProfile = await storage.getDriverProfile(userId);
      }
      
      res.json({ ...user, driverProfile });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Object storage routes for driver documents
  app.get("/objects/:objectPath(*)", isAuthenticated, async (req: any, res) => {
    const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
    const objectStorageService = new ObjectStorageService();
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      const canAccess = await objectStorageService.canAccessObjectEntity({
        objectFile,
        userId: userId,
        requestedPermission: ObjectPermission.READ,
      });
      if (!canAccess) {
        return res.sendStatus(401);
      }
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error checking object access:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      return res.sendStatus(500);
    }
  });

  app.post("/api/objects/upload", isAuthenticated, async (req, res) => {
    const objectStorageService = new ObjectStorageService();
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    res.json({ uploadURL });
  });

  // Driver profile routes
  app.post('/api/driver/profile', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;

      // ── Enhanced driver registration validation ──────────────────────────
      const currentYear = new Date().getFullYear();
      const driverRegistrationSchema = z.object({
        // License
        licenseNumber: z.string()
          .min(1, "Driver's license number is required")
          .regex(/^[A-Z0-9\-]{4,20}$/i, "License number must be 4–20 alphanumeric characters"),
        licenseImageUrl: z.string().min(1, "License document upload is required"),
        // Insurance
        insuranceImageUrl: z.string().min(1, "Insurance document upload is required"),
        // Vehicle — at least one vehicle must be provided
        vehicle: z.object({
          make: z.string().min(1, "Vehicle make is required").max(50),
          model: z.string().min(1, "Vehicle model is required").max(50),
          year: z.number()
            .int("Vehicle year must be a whole number")
            .min(1990, "Vehicle must be 1990 or newer")
            .max(currentYear + 1, `Vehicle year cannot exceed ${currentYear + 1}`),
          color: z.string().min(1, "Vehicle color is required").max(30),
          licensePlate: z.string()
            .min(1, "License plate is required")
            .regex(/^[A-Z0-9\- ]{2,10}$/i, "License plate must be 2–10 alphanumeric characters"),
        }).optional(),
      }).passthrough(); // allow other insertDriverProfileSchema fields through

      const validatedDriverData = driverRegistrationSchema.parse(req.body);

      const profileData = insertDriverProfileSchema.parse({
        ...req.body,
        userId
      });
      
      const profile = await storage.createDriverProfile(profileData);

      // Create vehicle record if vehicle data was provided
      if (validatedDriverData.vehicle) {
        const vehicleData = insertVehicleSchema.parse({
          ...validatedDriverData.vehicle,
          driverProfileId: profile.id,
        });
        await storage.createVehicle(vehicleData);
      }
      
      // Update user to mark as driver
      await storage.upsertUser({ id: userId, isDriver: true });

      console.log(`[AUDIT] driver_profile_created userId=${userId} licenseNumber=${validatedDriverData.licenseNumber}`);
      
      res.json(profile);
    } catch (error) {
      console.error("Error creating driver profile:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(400).json({ message: "Failed to create driver profile" });
    }
  });

  app.put('/api/driver/profile', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const updates = req.body;
      
      const profile = await storage.updateDriverProfile(userId, updates);
      res.json(profile);
    } catch (error) {
      console.error("Error updating driver profile:", error);
      res.status(400).json({ message: "Failed to update driver profile" });
    }
  });

  // County preference endpoints
  app.get('/api/driver/counties', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const profile = await storage.getDriverProfile(userId);
      res.json({ acceptedCounties: profile?.acceptedCounties ?? [] });
    } catch (error) {
      console.error("Error fetching driver counties:", error);
      res.status(500).json({ message: "Failed to fetch county preferences" });
    }
  });

  app.put('/api/driver/counties', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { acceptedCounties } = req.body;
      if (!Array.isArray(acceptedCounties)) {
        return res.status(400).json({ message: "acceptedCounties must be an array" });
      }
      const profile = await storage.updateDriverProfile(userId, { acceptedCounties });
      // Refresh in-memory county cache so current WS session uses the new preferences immediately
      driverCountyCache.set(userId, profile.acceptedCounties ?? []);
      res.json({ acceptedCounties: profile.acceptedCounties ?? [] });
    } catch (error) {
      console.error("Error updating driver counties:", error);
      res.status(400).json({ message: "Failed to update county preferences" });
    }
  });

  app.post('/api/driver/toggle-status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { isOnline, dailyCounties } = req.body;

      await storage.toggleDriverOnlineStatus(userId, isOnline);

      if (isOnline && Array.isArray(dailyCounties)) {
        // Start daily session with the counties the driver selected
        await storage.startDriverDailySession(userId, dailyCounties);
        driverCountyCache.set(userId, dailyCounties);
      } else if (!isOnline) {
        // End daily session when driver goes offline
        await storage.endDriverDailySession(userId);
        driverCountyCache.delete(userId);
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error toggling driver status:", error);
      res.status(500).json({ message: "Failed to update status" });
    }
  });

  app.get('/api/driver/daily-session', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const session = await storage.getDriverDailySession(userId);
      res.json(session ?? { dailyCounties: null, dailySessionStart: null });
    } catch (error) {
      console.error("Error fetching daily session:", error);
      res.status(500).json({ message: "Failed to fetch daily session" });
    }
  });

  app.post('/api/driver/location', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { lat, lng, rideId } = req.body;
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return res.status(400).json({ message: "lat and lng must be numbers" });
      }
      await storage.updateDriverLocation(userId, { lat, lng });
      // Broadcast to rider of active ride (if provided)
      if (rideId) {
        const ride = await storage.getRide(rideId);
        if (ride?.riderId && activeConnections.has(ride.riderId)) {
          const riderWs = activeConnections.get(ride.riderId)!;
          if (riderWs.readyState === WebSocket.OPEN) {
            riderWs.send(JSON.stringify({ type: 'driver_location', rideId, lat, lng }));
          }
        }
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating driver location:", error);
      res.status(500).json({ message: "Failed to update location" });
    }
  });

  // Driver ride management endpoints
  app.get('/api/driver/pending-rides', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const rides = await storage.getPendingRidesForDriver(userId);
      res.json(rides);
    } catch (error) {
      console.error("Error fetching pending rides:", error);
      res.status(500).json({ message: "Failed to fetch pending rides" });
    }
  });

  app.post('/api/driver/rides/:rideId/accept', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;
      
      const ride = await storage.acceptRide(rideId, userId);
      const rider = await storage.getUser(ride.riderId);

      if (ride.paymentMethod === 'card') {
        {
        const rawFare = parseFloat(ride.estimatedFare || "0");

        // Apply $5 promo discount if rider has promo rides remaining
        const promoRemaining = rider?.promoRidesRemaining ?? 0;
        const promoDiscount = promoRemaining > 0 ? Math.min(5, rawFare) : 0;
        const chargeAmount = Math.max(0, rawFare - promoDiscount);

        try {
          if (chargeAmount > 0) {
            await storage.deductVirtualCardBalance(ride.riderId, chargeAmount);
          }
          // Consume one promo ride and record discount applied
          if (promoDiscount > 0 && rider) {
            await storage.consumePromoRide(ride.riderId, promoDiscount, rideId);
          }
          await storage.setRidePaymentAuthorization(rideId, `virtual-${rideId}`);
        } catch (error: any) {
          console.error("Failed to authorize virtual card payment:", error);
          try {
            const { db: dbInstance } = await import("./db");
            const { rides: ridesTable } = await import("@shared/schema");
            const { eq, and } = await import("drizzle-orm");
            await dbInstance.update(ridesTable)
              .set({ status: "pending", acceptedAt: null, updatedAt: new Date() })
              .where(and(eq(ridesTable.id, rideId), eq(ridesTable.status, "accepted")));
          } catch (revertError) {
            console.error("Failed to revert ride status after payment failure:", revertError);
          }
          return res.status(402).json({ message: "Payment authorization failed. Please try a different payment method." });
        }
        } // end card block
      }

      const driverUser = await storage.getUser(userId);
      const rideAcceptedMessage = {
        type: 'ride_accepted',
        rideId: ride.id,
        driverId: userId,
        riderId: ride.riderId,
        driverName: driverUser ? `${driverUser.firstName} ${driverUser.lastName?.[0] || ''}.` : 'Your driver',
      };
      
      // Send to driver
      if (activeConnections.has(userId)) {
        const driverWs = activeConnections.get(userId);
        if (driverWs && driverWs.readyState === WebSocket.OPEN) {
          driverWs.send(JSON.stringify(rideAcceptedMessage));
        }
      }
      
      // Send to rider
      if (activeConnections.has(ride.riderId)) {
        const riderWs = activeConnections.get(ride.riderId);
        if (riderWs && riderWs.readyState === WebSocket.OPEN) {
          riderWs.send(JSON.stringify(rideAcceptedMessage));
        }
      }

      // Send ride-accepted email to rider
      if (rider) {
        sendRideAcceptedEmail({
          riderEmail: rider.email,
          riderFirstName: rider.firstName,
          driverName: rideAcceptedMessage.driverName,
          driverPhone: driverUser?.phone,
          pickupAddress: (ride.pickupLocation as any)?.address ?? null,
          destinationAddress: (ride.destinationLocation as any)?.address ?? null,
          estimatedFare: ride.estimatedFare,
          promoDiscount: ride.promoDiscountApplied,
        }).catch(console.error);

        // Push notification to rider
        storage.getPushSubscriptionsByUser(ride.riderId).then((subs) =>
          sendPushToSubscriptions(subs, {
            title: "Driver On The Way! 🚗",
            body: `${rideAcceptedMessage.driverName} accepted your ride. They'll pick you up soon.`,
            tag: "ride-accepted",
            url: "/",
          }, (ep) => storage.deletePushSubscription(ep))
        ).catch(console.error);
      }

      res.json(ride);
    } catch (error) {
      console.error("Error accepting ride:", error);
      if (error instanceof Error) {
        res.status(400).json({ message: error.message });
      } else {
        res.status(500).json({ message: "Failed to accept ride" });
      }
    }
  });

  app.post('/api/driver/rides/:rideId/decline', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;
      
      await storage.declineRide(rideId, userId);
      
      // Get the ride to access riderId for targeted messaging
      const ride = await storage.getRide(rideId);
      if (ride) {
        // Send targeted WebSocket messages to driver and rider only
        const rideDeclinedMessage = {
          type: 'ride_declined',
          rideId,
          driverId: userId,
          riderId: ride.riderId
        };
        
        // Send to driver
        if (activeConnections.has(userId)) {
          const driverWs = activeConnections.get(userId);
          if (driverWs && driverWs.readyState === WebSocket.OPEN) {
            driverWs.send(JSON.stringify(rideDeclinedMessage));
          }
        }
        
        // Send to rider
        if (activeConnections.has(ride.riderId)) {
          const riderWs = activeConnections.get(ride.riderId);
          if (riderWs && riderWs.readyState === WebSocket.OPEN) {
            riderWs.send(JSON.stringify(rideDeclinedMessage));
          }
        }
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error declining ride:", error);
      if (error instanceof Error) {
        res.status(400).json({ message: error.message });
      } else {
        res.status(500).json({ message: "Failed to decline ride" });
      }
    }
  });

  // Driver ride status update endpoints
  app.post('/api/driver/rides/:rideId/start', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;
      
      const ride = await storage.startRide(rideId, userId);
      
      // Send targeted WebSocket messages to driver and rider only
      const rideStartedMessage = {
        type: 'ride_started',
        rideId: ride.id,
        driverId: userId,
        riderId: ride.riderId,
        status: 'in_progress'
      };
      
      // Send to driver
      if (activeConnections.has(userId)) {
        const driverWs = activeConnections.get(userId);
        if (driverWs && driverWs.readyState === WebSocket.OPEN) {
          driverWs.send(JSON.stringify(rideStartedMessage));
        }
      }
      
      // Send to rider
      if (activeConnections.has(ride.riderId)) {
        const riderWs = activeConnections.get(ride.riderId);
        if (riderWs && riderWs.readyState === WebSocket.OPEN) {
          riderWs.send(JSON.stringify(rideStartedMessage));
        }
      }
      
      res.json(ride);
    } catch (error) {
      console.error("Error starting ride:", error);
      if (error instanceof Error) {
        res.status(400).json({ message: error.message });
      } else {
        res.status(500).json({ message: "Failed to start ride" });
      }
    }
  });

  // Track GPS waypoint during active ride
  app.post('/api/driver/rides/:rideId/track-location', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;
      
      // Validate waypoint
      const waypointSchema = z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180)
      });
      
      const { lat, lng } = waypointSchema.parse(req.body);
      
      await storage.addRouteWaypoint(rideId, userId, { lat, lng });
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error tracking location:", error);
      if (error instanceof Error) {
        res.status(400).json({ message: error.message });
      } else {
        res.status(500).json({ message: "Failed to track location" });
      }
    }
  });

  // Get real-time ride stats (distance, duration, estimated fare)
  app.get('/api/driver/rides/:rideId/stats', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;
      
      const stats = await storage.getRideStats(rideId, userId);
      
      res.json(stats);
    } catch (error) {
      console.error("Error getting ride stats:", error);
      if (error instanceof Error) {
        res.status(400).json({ message: error.message });
      } else {
        res.status(500).json({ message: "Failed to get ride stats" });
      }
    }
  });

  app.post('/api/driver/rides/:rideId/complete', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;
      
      // Validate request body - actualFare is now optional to allow automatic calculation
      const completeRideSchema = z.object({
        actualFare: z.number().positive("Actual fare must be a positive number").optional(),
        tipAmount: z.number().min(0).optional()
      });
      
      const { actualFare, tipAmount } = completeRideSchema.parse(req.body);
      
      const ride = await storage.completeRide(rideId, userId, actualFare);
      
      // If ride uses card payment, process virtual card payment inside a transaction
      if (ride.paymentMethod === 'card' && ride.stripePaymentIntentId) {
        try {
          const estimatedFare = parseFloat(ride.estimatedFare || "0");
          const finalFare = actualFare ?? parseFloat(ride.actualFare || "0");
          const totalAmount = finalFare + (tipAmount || 0);
          const priceDifference = finalFare - estimatedFare;

          await db.transaction(async (tx) => {
            // If actual fare is less than estimated, refund the difference
            if (priceDifference < 0) {
              await storage.addVirtualCardBalance(ride.riderId, Math.abs(priceDifference));
            }
            // If actual fare is more than estimated, deduct the difference
            else if (priceDifference > 0) {
              await storage.deductVirtualCardBalance(ride.riderId, priceDifference);
            }

            // If there's a tip, deduct it from rider
            if (tipAmount && tipAmount > 0) {
              await storage.deductVirtualCardBalance(ride.riderId, tipAmount);
            }

            // Credit driver
            if (ride.driverId && totalAmount > 0) {
              await storage.addVirtualCardBalance(ride.driverId, totalAmount);
            }

            await storage.captureRidePayment(rideId, actualFare, tipAmount);
          });

          console.log(`Virtual card payment processed successfully for ride ${rideId}: actual $${finalFare}, tip $${tipAmount || 0}`);
        } catch (error: any) {
          console.error("Failed to process virtual card payment:", error);
          throw new Error("Payment processing failed. Please try again.");
        }
      }
      
      // Track driver hours for ownership qualification
      if (ride.startedAt && ride.driverId) {
        try {
          const startTime = new Date(ride.startedAt).getTime();
          const endTime = new Date().getTime();
          const rideDurationMinutes = Math.round((endTime - startTime) / (1000 * 60));
          if (rideDurationMinutes > 0) {
            await storage.addDriverMinutes(ride.driverId, rideDurationMinutes);
          }
        } catch (err) {
          console.error("Failed to track driver hours:", err);
        }
      }

      // Send targeted WebSocket messages to driver and rider only
      const rideCompletedMessage = {
        type: 'ride_completed',
        rideId: ride.id,
        driverId: userId,
        riderId: ride.riderId,
        status: 'completed',
        actualFare: ride.actualFare,
        estimatedFare: ride.estimatedFare,
      };
      
      // Send to driver
      if (activeConnections.has(userId)) {
        const driverWs = activeConnections.get(userId);
        if (driverWs && driverWs.readyState === WebSocket.OPEN) {
          driverWs.send(JSON.stringify(rideCompletedMessage));
        }
      }
      
      // Send to rider
      if (activeConnections.has(ride.riderId)) {
        const riderWs = activeConnections.get(ride.riderId);
        if (riderWs && riderWs.readyState === WebSocket.OPEN) {
          riderWs.send(JSON.stringify(rideCompletedMessage));
        }
      }

      // Send receipt email to rider
      try {
        const [riderForEmail, driverForEmail] = await Promise.all([
          storage.getUser(ride.riderId),
          ride.driverId ? storage.getUser(ride.driverId) : null,
        ]);
        if (riderForEmail) {
          sendRideReceiptEmail({
            riderEmail: riderForEmail.email,
            riderFirstName: riderForEmail.firstName,
            driverName: driverForEmail
              ? `${driverForEmail.firstName || ''} ${driverForEmail.lastName?.[0] || ''}.`.trim()
              : 'Your driver',
            pickupAddress: (ride.pickupLocation as any)?.address ?? null,
            destinationAddress: (ride.destinationLocation as any)?.address ?? null,
            actualFare: ride.actualFare,
            promoDiscountApplied: ride.promoDiscountApplied,
            completedAt: ride.completedAt,
          }).catch(console.error);

          // Push notification — ride complete
          const fare = parseFloat(ride.actualFare || ride.estimatedFare || '0');
          storage.getPushSubscriptionsByUser(ride.riderId).then((subs) =>
            sendPushToSubscriptions(subs, {
              title: "Ride Complete! ✅",
              body: `Thanks for riding with PG Ride. Total: $${fare.toFixed(2)}.`,
              tag: "ride-completed",
              url: "/",
            }, (ep) => storage.deletePushSubscription(ep))
          ).catch(console.error);
        }
      } catch (emailErr) {
        console.error("Failed to send receipt email:", emailErr);
      }

      res.json(ride);
    } catch (error) {
      console.error("Error completing ride:", error);
      if (error instanceof Error) {
        res.status(400).json({ message: error.message });
      } else {
        res.status(500).json({ message: "Failed to complete ride" });
      }
    }
  });

  app.get('/api/driver/active-rides', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const rides = await storage.getActiveRidesForDriver(userId);
      res.json(rides);
    } catch (error) {
      console.error("Error fetching active rides:", error);
      res.status(500).json({ message: "Failed to fetch active rides" });
    }
  });

  // Driver earnings endpoints
  app.get('/api/driver/earnings/:period', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { period } = req.params;
      
      if (!['today', 'week', 'month'].includes(period)) {
        return res.status(400).json({ message: "Invalid period. Use 'today', 'week', or 'month'" });
      }
      
      const earnings = await storage.getDriverEarnings(userId, period as 'today' | 'week' | 'month');
      res.json(earnings);
    } catch (error) {
      console.error("Error fetching driver earnings:", error);
      res.status(500).json({ message: "Failed to fetch earnings" });
    }
  });

  app.get('/api/driver/rides/:period', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { period } = req.params;
      
      if (!['today', 'week', 'month'].includes(period)) {
        return res.status(400).json({ message: "Invalid period. Use 'today', 'week', or 'month'" });
      }
      
      const rides = await storage.getDriverRides(userId, period as 'today' | 'week' | 'month');
      res.json(rides);
    } catch (error) {
      console.error("Error fetching driver rides:", error);
      res.status(500).json({ message: "Failed to fetch rides" });
    }
  });

  // Vehicle routes
  app.get('/api/vehicles', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const driverProfile = await storage.getDriverProfile(userId);
      if (!driverProfile) {
        return res.json([]);
      }
      const vehicleList = await storage.getVehiclesByDriverId(driverProfile.id);
      res.json(vehicleList);
    } catch (error) {
      console.error("Error getting vehicles:", error);
      res.status(500).json({ message: "Failed to get vehicles" });
    }
  });

  app.post('/api/vehicles', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const driverProfile = await storage.getDriverProfile(userId);
      
      if (!driverProfile) {
        return res.status(400).json({ message: "Driver profile required" });
      }
      
      const vehicleData = insertVehicleSchema.parse({
        ...req.body,
        driverProfileId: driverProfile.id
      });
      
      const vehicle = await storage.createVehicle(vehicleData);
      res.json(vehicle);
    } catch (error) {
      console.error("Error creating vehicle:", error);
      res.status(400).json({ message: "Failed to create vehicle" });
    }
  });

  // Handle vehicle photo uploads (must be before :vehicleId route to avoid being shadowed)
  app.put("/api/vehicles/photos", isAuthenticated, async (req: any, res) => {
    if (!req.body.photoURL || !req.body.vehicleId) {
      return res.status(400).json({ error: "photoURL and vehicleId are required" });
    }

    const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;

    try {
      const objectStorageService = new ObjectStorageService();
      const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(
        req.body.photoURL,
        {
          owner: userId,
          visibility: "private", // Vehicle photos should be private
        },
      );

      // Update vehicle photos array
      const vehicle = await storage.updateVehicle(req.body.vehicleId, {
        photos: req.body.photos || []
      });

      res.status(200).json({
        objectPath: objectPath,
        vehicle: vehicle,
      });
    } catch (error) {
      console.error("Error setting vehicle photo:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.put('/api/vehicles/:vehicleId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { vehicleId } = req.params;
      const updates = req.body;

      // SECURITY: Ensure the vehicle belongs to this driver before updating
      const driverProfile = await storage.getDriverProfile(userId);
      if (!driverProfile) {
        return res.status(403).json({ message: "Driver profile required" });
      }
      const existingVehicles = await storage.getVehiclesByDriverId(driverProfile.id);
      const owns = existingVehicles.some((v: any) => v.id === vehicleId);
      if (!owns) {
        return res.status(403).json({ message: "Not authorized to update this vehicle" });
      }
      
      const vehicle = await storage.updateVehicle(vehicleId, updates);
      res.json(vehicle);
    } catch (error) {
      console.error("Error updating vehicle:", error);
      res.status(400).json({ message: "Failed to update vehicle" });
    }
  });

  // Reverse geocoding - convert coordinates to address
  app.get('/api/geocode/reverse', isAuthenticated, async (req: any, res) => {
    try {
      const { lat, lng } = req.query;
      if (!lat || !lng) {
        return res.status(400).json({ message: "lat and lng required" });
      }
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`,
        { headers: { 'User-Agent': 'PGRide-Community-Rideshare/1.0' } }
      );
      if (!response.ok) {
        return res.status(502).json({ message: "Geocoding service unavailable" });
      }
      const data = await response.json() as any;
      const addr = data.address || {};
      const parts: string[] = [];
      if (addr.house_number && addr.road) {
        parts.push(`${addr.house_number} ${addr.road}`);
      } else if (addr.road) {
        parts.push(addr.road);
      }
      const city = addr.city || addr.town || addr.village || addr.suburb || addr.hamlet || '';
      const state = addr.state ? (addr.state.length > 2 ? (addr.state === 'Maryland' ? 'MD' : addr.state.substring(0, 2).toUpperCase()) : addr.state) : '';
      const postcode = addr.postcode || '';
      if (city) parts.push(city);
      if (state && postcode) {
        parts.push(`${state} ${postcode}`);
      } else if (state) {
        parts.push(state);
      }
      const address = parts.length > 0 ? parts.join(', ') : data.display_name || 'Unknown location';
      res.json({ address, lat: parseFloat(lat as string), lng: parseFloat(lng as string) });
    } catch (error) {
      console.error("Reverse geocoding error:", error);
      res.status(500).json({ message: "Failed to get address" });
    }
  });

  // Ride routes
  app.get('/api/rides/nearby-drivers', isAuthenticated, async (req: any, res) => {
    try {
      const { lat, lng, radius = 10 } = req.query;
      
      if (!lat || !lng) {
        return res.status(400).json({ message: "Location required" });
      }
      
      const drivers = await storage.getNearbyDrivers(
        { lat: parseFloat(lat), lng: parseFloat(lng) },
        parseFloat(radius)
      );
      
      res.json(drivers);
    } catch (error) {
      console.error("Error fetching nearby drivers:", error);
      res.status(500).json({ message: "Failed to fetch drivers" });
    }
  });

  // Search drivers by phone number
  app.get('/api/drivers/search', isAuthenticated, async (req: any, res) => {
    try {
      const { phone } = req.query;
      
      if (!phone) {
        return res.status(400).json({ message: "Phone number required" });
      }
      
      const drivers = await storage.searchDriversByPhone(phone as string);
      
      res.json(drivers);
    } catch (error) {
      console.error("Error searching drivers:", error);
      res.status(500).json({ message: "Failed to search drivers" });
    }
  });

  app.post('/api/rides', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      
      // SECURITY: Enforce virtual card as the only payment method
      if (req.body.paymentMethod && req.body.paymentMethod !== 'card') {
        return res.status(400).json({ message: "Only virtual card payment is supported" });
      }
      
      // Convert numeric fare to string for decimal field
      const bodyData = { 
        ...req.body,
        paymentMethod: 'card' // Force virtual card payment
      };
      if (typeof bodyData.estimatedFare === 'number') {
        bodyData.estimatedFare = bodyData.estimatedFare.toString();
      }
      
      const dataToValidate = {
        ...bodyData,
        riderId: userId
      };
      
      const rideData = insertRideSchema.parse(dataToValidate);
      
      const ride = await storage.createRide(rideData);

      // Attempt shared-ride matching if the rider opted in
      let matchResult = { matched: false, groupId: undefined as string | undefined, discountAmount: undefined as number | undefined };
      if (ride.wantsSharedRide) {
        try {
          matchResult = await tryMatchSharedRide(ride.id) as typeof matchResult;
        } catch (matchErr) {
          console.error("Shared ride matching error (non-fatal):", matchErr);
        }
      }

      const riderUser = await storage.getUser(userId);
      const isScheduledFuture = ride.scheduledAt && new Date(ride.scheduledAt) > new Date();

      // Determine pickup county for driver-county filtering (non-blocking)
      let pickupCounty: string | null = null;
      try {
        const loc = ride.pickupLocation as { lat: number; lng: number; address: string };
        pickupCounty = await getCountyFromCoords(loc.lat, loc.lng);
        if (pickupCounty) {
          await storage.updateRideCounty(ride.id, pickupCounty);
        }
      } catch {
        // County detection is best-effort; never block ride creation
      }

      if (isScheduledFuture && !ride.driverId) {
        // Open scheduled ride — broadcast to drivers who cover the pickup county
        const payload = JSON.stringify({
          type: 'new_scheduled_ride',
          rideId: ride.id,
          riderId: userId,
          riderName: riderUser ? `${riderUser.firstName} ${riderUser.lastName?.[0] || ''}.` : 'Rider',
          riderRating: riderUser?.rating || '5.0',
          pickupAddress: ride.pickupLocation?.address || '',
          destinationAddress: ride.destinationLocation?.address || '',
          estimatedFare: ride.estimatedFare,
          scheduledAt: ride.scheduledAt,
          pickupInstructions: ride.pickupInstructions || '',
          pickupCounty: pickupCounty || '',
        });
        activeConnections.forEach((ws, driverId) => {
          const counties = driverCountyCache.get(driverId) ?? [];
          if (driverCoversCounty(counties, pickupCounty) && ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
          }
        });
      } else if (ride.driverId && activeConnections.has(ride.driverId)) {
        // Specific driver chosen — notify only them
        const driverWs = activeConnections.get(ride.driverId);
        if (driverWs && driverWs.readyState === WebSocket.OPEN) {
          driverWs.send(JSON.stringify({
            type: isScheduledFuture ? 'new_scheduled_ride' : 'new_ride_request',
            rideId: ride.id,
            riderId: userId,
            riderName: riderUser ? `${riderUser.firstName} ${riderUser.lastName?.[0] || ''}.` : 'Rider',
            riderRating: riderUser?.rating || '5.0',
            pickupAddress: ride.pickupLocation?.address || '',
            destinationAddress: ride.destinationLocation?.address || '',
            estimatedFare: ride.estimatedFare,
            scheduledAt: ride.scheduledAt,
            pickupInstructions: ride.pickupInstructions || '',
          }));
        }
        // Also push — catches the case where the driver's app is closed
        storage.getPushSubscriptionsByUser(ride.driverId).then((subs) =>
          sendPushToSubscriptions(subs, {
            title: isScheduledFuture ? "New Scheduled Ride 📅" : "New Ride Request! 🚗",
            body: `${riderUser?.firstName || 'A rider'} needs a ride from ${ride.pickupLocation?.address?.split(',')[0] || 'nearby'}`,
            tag: "new-ride-request",
            url: "/",
          }, (ep) => storage.deletePushSubscription(ep))
        ).catch(console.error);
      }

      res.json({ ...ride, sharedMatch: matchResult });
    } catch (error) {
      console.error("Error creating ride:", error);
      if (error instanceof z.ZodError) {
        console.error("Zod validation errors:", JSON.stringify(error.errors, null, 2));
      }
      res.status(400).json({ message: "Failed to create ride" });
    }
  });

  app.put('/api/rides/:rideId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;

      const ride = await storage.getRide(rideId);
      if (!ride) {
        return res.status(404).json({ message: "Ride not found" });
      }
      if (ride.riderId !== userId && ride.driverId !== userId) {
        return res.status(403).json({ message: "Not authorized to update this ride" });
      }

      // SECURITY: Whitelist fields that riders/drivers are allowed to update
      const RIDER_ALLOWED_FIELDS = ['status', 'pickupInstructions', 'wantsSharedRide'];
      const DRIVER_ALLOWED_FIELDS = ['status', 'pickupInstructions'];
      const isRider = ride.riderId === userId;
      const allowedFields = isRider ? RIDER_ALLOWED_FIELDS : DRIVER_ALLOWED_FIELDS;
      const updates: Record<string, any> = {};
      for (const key of allowedFields) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      // Enforce state machine if caller is trying to change status
      if (updates.status && updates.status !== ride.status) {
        if (!isValidRideTransition(ride.status ?? "", updates.status)) {
          return res.status(400).json({
            message: `Invalid status transition: ${ride.status} → ${updates.status}`,
          });
        }
      }

      const updatedRide = await storage.updateRide(rideId, updates);
      res.json(updatedRide);
    } catch (error) {
      console.error("Error updating ride:", error);
      res.status(400).json({ message: "Failed to update ride" });
    }
  });

  app.post('/api/rides/:rideId/cancel', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;
      const { reason, driverTraveledDistance, driverTraveledTime } = req.body;
      
      const ride = await storage.getRide(rideId);
      
      if (!ride) {
        return res.status(404).json({ message: "Ride not found" });
      }

      // Verify user is authorized to cancel (rider or driver)
      if (ride.riderId !== userId && ride.driverId !== userId) {
        return res.status(403).json({ message: "Unauthorized to cancel this ride" });
      }

      // Calculate cancellation fee for card payments
      let cancellationFee = 0;
      
      if (ride.paymentMethod === 'card' && ride.status === 'accepted' && ride.stripePaymentIntentId) {
        // Smart cancellation fee logic: BOTH conditions must be met
        const distance = driverTraveledDistance || 0;
        const time = driverTraveledTime || 0;
        
        // $5.00 fee if driver traveled >= 3mi AND >= 5min
        if (distance >= 3 && time >= 5) {
          cancellationFee = 5.00;
        }
        // $3.50 fee if driver traveled >= 1.5mi AND >= 3min
        else if (distance >= 1.5 && time >= 3) {
          cancellationFee = 3.50;
        }

        const estimatedFare = parseFloat(ride.estimatedFare || "0");
        
        console.log(`Processing cancellation for ride ${rideId}: Est. fare: $${estimatedFare}, Fee: $${cancellationFee}`);

        // Apply cancellation fee if applicable
        if (cancellationFee > 0) {
          // Refund the estimated fare minus the cancellation fee to the rider
          const refundAmount = estimatedFare - cancellationFee;
          if (refundAmount > 0) {
            await storage.addVirtualCardBalance(ride.riderId, refundAmount);
            console.log(`Refunded $${refundAmount} to rider after $${cancellationFee} cancellation fee`);
          }
          
          // Add the cancellation fee to the driver's balance
          if (ride.driverId) {
            await storage.addVirtualCardBalance(ride.driverId, cancellationFee);
            console.log(`Added $${cancellationFee} cancellation fee to driver's balance`);
          }
          
          await storage.cancelRideWithFee(
            rideId, 
            cancellationFee, 
            reason || "Ride cancelled", 
            driverTraveledDistance,
            driverTraveledTime
          );
        } else {
          // No fee - refund the full estimated fare to the rider
          await storage.addVirtualCardBalance(ride.riderId, estimatedFare);
          console.log(`Refunded full $${estimatedFare} to rider (no cancellation fee)`);
          
          await storage.updateRide(rideId, { 
            status: "cancelled",
            cancellationReason: reason || "Ride cancelled",
            paymentStatus: "cancelled"
          });
        }
      } else {
        // No card payment or not applicable for fee
        await storage.updateRide(rideId, { 
          status: "cancelled",
          cancellationReason: reason || "Ride cancelled"
        });
      }

      const updatedRide = await storage.getRide(rideId);
      
      // Send WebSocket notification
      const cancelMessage = {
        type: 'ride_cancelled',
        rideId: ride.id,
        cancellationFee
      };
      
      if (activeConnections.has(ride.riderId)) {
        const riderWs = activeConnections.get(ride.riderId);
        if (riderWs && riderWs.readyState === WebSocket.OPEN) {
          riderWs.send(JSON.stringify(cancelMessage));
        }
      }
      
      if (ride.driverId && activeConnections.has(ride.driverId)) {
        const driverWs = activeConnections.get(ride.driverId);
        if (driverWs && driverWs.readyState === WebSocket.OPEN) {
          driverWs.send(JSON.stringify(cancelMessage));
        }
      }

      res.json({ success: true, ride: updatedRide, cancellationFee });
    } catch (error: any) {
      console.error("Error cancelling ride:", error);
      res.status(500).json({ message: "Failed to cancel ride. Please try again." });
    }
  });

  app.get('/api/rides', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { limit } = req.query;
      
      const rides = await storage.getRidesByUser(userId, limit ? parseInt(limit) : undefined);
      res.json(rides);
    } catch (error) {
      console.error("Error fetching rides:", error);
      res.status(500).json({ message: "Failed to fetch rides" });
    }
  });

  app.get('/api/rides/active', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const activeRides = await storage.getActiveRides(userId);
      const ridesWithDetails = await Promise.all(activeRides.map(async (ride) => {
        let driver = null;
        let rider = null;
        if (ride.driverId) {
          const driverUser = await storage.getUser(ride.driverId);
          if (driverUser) {
            const driverProfile = await storage.getDriverProfile(ride.driverId);
            const driverVehicles = driverProfile ? await storage.getVehiclesByDriverId(driverProfile.id) : [];
            driver = {
              firstName: driverUser.firstName,
              lastName: driverUser.lastName,
              rating: driverUser.rating,
              phone: driverUser.phone,
              profileImageUrl: driverUser.profileImageUrl,
              vehicle: driverVehicles[0] ? `${driverVehicles[0].year} ${driverVehicles[0].make} ${driverVehicles[0].model} - ${driverVehicles[0].color}` : null,
              licensePlate: driverVehicles[0]?.licensePlate || null,
            };
          }
        }
        if (ride.riderId) {
          const riderUser = await storage.getUser(ride.riderId);
          if (riderUser) {
            rider = {
              firstName: riderUser.firstName,
              lastName: riderUser.lastName,
              rating: riderUser.rating,
            };
          }
        }
        return { ...ride, driver, rider };
      }));
      res.json(ridesWithDetails);
    } catch (error) {
      console.error("Error fetching active rides:", error);
      res.status(500).json({ message: "Failed to fetch active rides" });
    }
  });

  // Get scheduled rides for the current rider (includes driver info if claimed)
  app.get('/api/rides/scheduled', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const rides = await storage.getScheduledRidesWithDriver(userId);
      res.json(rides);
    } catch (error) {
      console.error("Error fetching scheduled rides:", error);
      res.status(500).json({ message: "Failed to fetch scheduled rides" });
    }
  });

  // Get open scheduled rides for drivers to claim + their already-claimed upcoming rides
  app.get('/api/driver/scheduled-rides', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const profile = await storage.getDriverProfile(userId);
      const driverCounties = profile?.acceptedCounties ?? [];
      const [open, mine] = await Promise.all([
        storage.getOpenScheduledRides(driverCounties.length > 0 ? driverCounties : undefined),
        storage.getDriverUpcomingRides(userId),
      ]);
      res.json({ open, mine });
    } catch (error) {
      console.error("Error fetching driver scheduled rides:", error);
      res.status(500).json({ message: "Failed to fetch scheduled rides" });
    }
  });

  // Driver claims an open scheduled ride
  app.post('/api/driver/rides/:rideId/claim', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;

      const ride = await storage.claimScheduledRide(rideId, userId);

      // Notify the rider their scheduled ride has been claimed
      if (activeConnections.has(ride.riderId)) {
        const riderWs = activeConnections.get(ride.riderId);
        if (riderWs && riderWs.readyState === WebSocket.OPEN) {
          const driverUser = await storage.getUser(userId);
          riderWs.send(JSON.stringify({
            type: 'scheduled_ride_claimed',
            rideId: ride.id,
            driverName: driverUser ? `${driverUser.firstName} ${driverUser.lastName?.[0] || ''}.` : 'A driver',
            scheduledAt: ride.scheduledAt,
          }));
        }
      }

      // Let all other drivers know this ride is taken (so they remove it from open list)
      const takenPayload = JSON.stringify({ type: 'scheduled_ride_taken', rideId: ride.id });
      activeConnections.forEach((ws, connUserId) => {
        if (connUserId !== userId && ws.readyState === WebSocket.OPEN) ws.send(takenPayload);
      });

      res.json(ride);
    } catch (error: any) {
      console.error("Error claiming scheduled ride:", error);
      res.status(409).json({ message: "This ride is no longer available." });
    }
  });

  // Rating and Payment routes (must come before parameterized /api/rides/:rideId route)
  app.get('/api/rides/for-rating', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const rides = await storage.getRidesForRating(userId);
      res.json(rides);
    } catch (error) {
      console.error("Error fetching rides for rating:", error);
      res.status(500).json({ message: "Failed to fetch rides for rating" });
    }
  });

  app.get('/api/rides/awaiting-payment', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const rides = await storage.getRidesAwaitingPayment(userId);
      res.json(rides);
    } catch (error) {
      console.error("Error fetching rides awaiting payment:", error);
      res.status(500).json({ message: "Failed to fetch rides awaiting payment" });
    }
  });

  app.get('/api/rides/:rideId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;
      const ride = await storage.getRide(rideId);
      
      if (!ride) {
        return res.status(404).json({ message: "Ride not found" });
      }

      // SECURITY: Only the rider, driver, or an admin may view a ride
      const user = await storage.getUser(userId);
      const isParticipant = ride.riderId === userId || ride.driverId === userId;
      const isAdmin = user?.isAdmin || user?.isSuperAdmin;
      if (!isParticipant && !isAdmin) {
        return res.status(403).json({ message: "Not authorized to view this ride" });
      }
      
      res.json(ride);
    } catch (error) {
      console.error("Error fetching ride:", error);
      res.status(500).json({ message: "Failed to fetch ride" });
    }
  });

  app.post('/api/rides/:rideId/rating', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;
      
      // Validate rating data
      const ratingSchema = z.object({
        rating: z.number().min(1).max(5),
        review: z.string().optional()
      });
      
      const { rating, review } = ratingSchema.parse(req.body);
      
      // Get ride and check authorization
      const ride = await storage.getRide(rideId);
      if (!ride) {
        return res.status(404).json({ message: "Ride not found" });
      }
      
      // Check if user is authorized to rate this ride
      if (ride.riderId !== userId && ride.driverId !== userId) {
        return res.status(403).json({ message: "Unauthorized to rate this ride" });
      }
      
      // Check if rating already exists to prevent double-rating
      const isRider = ride.riderId === userId;
      const existingRating = isRider ? ride.driverRating : ride.riderRating;
      
      if (existingRating !== null) {
        return res.status(409).json({ message: "You have already rated this ride" });
      }
      
      await storage.updateRideRating(rideId, userId, rating, review);
      
      // Update the OTHER party's overall rating (not the rater's rating)
      const ratedUserId = isRider ? ride.driverId : ride.riderId;
      if (ratedUserId) {
        await storage.updateUserRating(ratedUserId);
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error submitting rating:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid rating data" });
      } else {
        res.status(500).json({ message: "Failed to submit rating" });
      }
    }
  });

  // Payment confirmation route
  app.post('/api/rides/:rideId/confirm-payment', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;
      
      // Validate payment confirmation data
      const paymentSchema = z.object({
        tipAmount: z.number().min(0).optional()
      });
      
      const { tipAmount } = paymentSchema.parse(req.body);
      
      const updatedRide = await storage.confirmCashPayment(rideId, userId, tipAmount);
      
      res.json({ success: true, ride: updatedRide });
    } catch (error) {
      console.error("Error confirming payment:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid payment data" });
      } else if (error instanceof Error && error.message.includes("not found")) {
        res.status(404).json({ message: error.message });
      } else if (error instanceof Error && (error.message.includes("Only the driver") || error.message.includes("already been confirmed"))) {
        res.status(400).json({ message: error.message });
      } else {
        res.status(500).json({ message: "Failed to confirm payment" });
      }
    }
  });

  // Stripe card payment routes
  app.post('/api/payment/setup-card', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const { paymentMethodId } = req.body;
      
      if (!paymentMethodId) {
        return res.status(400).json({ message: "Payment method ID required" });
      }

      let customerId = user.stripeCustomerId;
      
      if (!customerId) {
        customerId = await stripeService.createOrGetCustomer(
          userId,
          user.email || '',
          `${user.firstName || ''} ${user.lastName || ''}`
        );
        await storage.updateUserStripeInfo(userId, customerId);
      }

      await stripeService.attachPaymentMethod(paymentMethodId, customerId);
      await stripeService.setDefaultPaymentMethod(customerId, paymentMethodId);
      await storage.updateUserStripeInfo(userId, customerId, paymentMethodId);

      res.json({ success: true, customerId, paymentMethodId });
    } catch (error: any) {
      console.error("Error setting up card:", error);
      res.status(500).json({ message: "Failed to set up payment method. Please try again." });
    }
  });

  app.get('/api/payment/methods', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({
        hasPaymentMethod: !!user.stripePaymentMethodId,
        stripeCustomerId: user.stripeCustomerId,
        stripePaymentMethodId: user.stripePaymentMethodId
      });
    } catch (error: any) {
      console.error("Error fetching payment methods:", error);
      res.status(500).json({ message: "Failed to fetch payment methods" });
    }
  });

  // Virtual PG Card top-up routes
  app.post('/api/virtual-card/topup/create-intent', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const { amount } = req.body;
      if (!amount || typeof amount !== 'number' || amount < 5 || amount > 500) {
        return res.status(400).json({ message: "Amount must be between $5 and $500" });
      }

      // Ensure customer exists in Stripe
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        customerId = await stripeService.createOrGetCustomer(
          userId,
          user.email || '',
          `${user.firstName || ''} ${user.lastName || ''}`
        );
        await storage.updateUserStripeInfo(userId, customerId);
      }

      // Create a PaymentIntent (confirm: false so client confirms with card details)
      const Stripe = await import("stripe");
      const stripeInstance = new Stripe.default(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2025-09-30.clover" as any });
      const intent = await stripeInstance.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: "usd",
        customer: customerId,
        metadata: { userId, topupAmount: amount.toString(), type: "virtual_card_topup" },
        automatic_payment_methods: { enabled: true },
      });

      res.json({ clientSecret: intent.client_secret, amount });
    } catch (error: any) {
      console.error("Error creating top-up intent:", error);
      res.status(500).json({ message: "Failed to create payment. Please try again." });
    }
  });

  app.post('/api/virtual-card/topup/confirm', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { paymentIntentId } = req.body;
      if (!paymentIntentId) return res.status(400).json({ message: "paymentIntentId required" });

      const Stripe = await import("stripe");
      const stripeInstance = new Stripe.default(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2025-09-30.clover" as any });
      const intent = await stripeInstance.paymentIntents.retrieve(paymentIntentId);

      if (intent.metadata?.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      if (intent.status !== "succeeded") {
        return res.status(400).json({ message: `Payment not completed (status: ${intent.status})` });
      }

      const topupAmount = parseFloat(intent.metadata?.topupAmount || "0");
      if (topupAmount <= 0) return res.status(400).json({ message: "Invalid top-up amount" });

      const updatedUser = await storage.addVirtualCardBalance(userId, topupAmount);
      res.json({ success: true, newBalance: updatedUser.virtualCardBalance });
    } catch (error: any) {
      console.error("Error confirming top-up:", error);
      res.status(500).json({ message: "Failed to confirm top-up. Please try again." });
    }
  });

  app.get('/api/virtual-card/balance', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const balance = await storage.getVirtualCardBalance(userId);
      const user = await storage.getUser(userId);
      res.json({ balance, promoRidesRemaining: user?.promoRidesRemaining ?? 0 });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get balance" });
    }
  });

  // Dispute routes
  app.post('/api/disputes', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const disputeData = insertDisputeSchema.parse({
        ...req.body,
        reporterId: userId
      });
      
      const dispute = await storage.createDispute(disputeData);
      res.json(dispute);
    } catch (error) {
      console.error("Error creating dispute:", error);
      res.status(400).json({ message: "Failed to create dispute" });
    }
  });

  app.get('/api/disputes/ride/:rideId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;

      // SECURITY: Only rider or driver of the ride, or an admin, may see its disputes
      const ride = await storage.getRide(rideId);
      if (ride) {
        const user = await storage.getUser(userId);
        const isParticipant = ride.riderId === userId || ride.driverId === userId;
        const isAdmin = user?.isAdmin || user?.isSuperAdmin;
        if (!isParticipant && !isAdmin) {
          return res.status(403).json({ message: "Not authorized to view disputes for this ride" });
        }
      }

      const disputes = await storage.getDisputesByRide(rideId);
      res.json(disputes);
    } catch (error) {
      console.error("Error fetching disputes:", error);
      res.status(500).json({ message: "Failed to fetch disputes" });
    }
  });

  // Emergency contact management routes
  app.put('/api/user/emergency-contact', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { emergencyContact } = req.body;
      
      if (!emergencyContact || typeof emergencyContact !== 'string') {
        return res.status(400).json({ message: "Valid emergency contact phone number required" });
      }
      
      const updatedUser = await storage.updateUserEmergencyContact(userId, emergencyContact);
      res.json({ success: true, user: updatedUser });
    } catch (error) {
      console.error("Error updating emergency contact:", error);
      res.status(500).json({ message: "Failed to update emergency contact" });
    }
  });

  app.post('/api/emergency/test', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { type } = req.body;
      
      if (!type || !['sms', 'call'].includes(type)) {
        return res.status(400).json({ message: "Type (sms/call) required" });
      }

      // Security: Only allow testing with user's own emergency contact
      const user = await storage.getUser(userId);
      if (!user?.emergencyContact) {
        return res.status(400).json({ message: "Please set an emergency contact first" });
      }
      
      const phoneNumber = user.emergencyContact;

      // Initialize Twilio (check if secrets are available)
      const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
      const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
      const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

      if (!twilioAccountSid || !twilioAuthToken || !twilioPhoneNumber) {
        return res.status(500).json({ message: "Twilio credentials not configured" });
      }

      const client = twilio(twilioAccountSid, twilioAuthToken);

      if (type === 'sms') {
        await client.messages.create({
          body: "Test message from PG Ride: Your emergency contact is set up correctly! 🚗",
          from: twilioPhoneNumber,
          to: phoneNumber
        });
      } else if (type === 'call') {
        await client.calls.create({
          twiml: '<Response><Say>Hello! This is a test call from PG Ride. Your emergency contact is set up correctly. Thank you!</Say></Response>',
          from: twilioPhoneNumber,
          to: phoneNumber
        });
      }

      res.json({ success: true, message: `Test ${type} sent successfully` });
    } catch (error) {
      console.error(`Error sending test ${req.body.type}:`, error);
      res.status(500).json({ message: `Failed to send test ${req.body.type}` });
    }
  });

  // Enhanced emergency routes
  app.post('/api/emergency/start', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { incidentType, rideId, location, description } = req.body;
      
      // Generate a unique share token for live location sharing
      const shareToken = nanoid(12);
      
      const incidentData = {
        userId,
        rideId,
        incidentType,
        location,
        description: description || `Emergency incident: ${incidentType}`,
        shareToken,
        emergencyContactAlerted: false
      };
      
      const incident = await storage.createEmergencyIncidentWithSharing(incidentData);
      
      let smsDeliveryStatus = "skipped";
      
      // Send SMS alert to emergency contact if available
      const user = await storage.getUser(userId);
      if (user?.emergencyContact) {
        try {
          const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
          const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
          const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

          if (twilioAccountSid && twilioAuthToken && twilioPhoneNumber) {
            const client = twilio(twilioAccountSid, twilioAuthToken);
            
            const locationText = location 
              ? `Location: https://maps.google.com/?q=${location.lat},${location.lng}`
              : "Location: Not available";
            
            const shareUrl = `${req.protocol}://${req.get('host')}/emergency/${shareToken}`;
            
            await client.messages.create({
              body: `🚨 EMERGENCY ALERT from ${user.firstName || 'PG Ride user'}\n\n${description}\n\n${locationText}\n\nLive tracking: ${shareUrl}\n\nReply STOP to opt out.`,
              from: twilioPhoneNumber,
              to: user.emergencyContact
            });
            
            // Update incident to mark emergency contact as alerted
            await storage.updateEmergencyIncident(incident.id, { emergencyContactAlerted: true });
            smsDeliveryStatus = "sent";
          } else {
            console.log("Twilio credentials not configured - emergency alert logged without SMS delivery");
            smsDeliveryStatus = "credentials_missing";
          }
        } catch (twilioError) {
          console.error("Failed to send emergency SMS:", twilioError);
          smsDeliveryStatus = "failed";
        }
      }
      
      // Send emergency alert via WebSocket to admins only (not all users)
      const connEntries = Array.from(activeConnections.entries());
      for (const [connUserId, connWs] of connEntries) {
        if (connWs.readyState === WebSocket.OPEN) {
          try {
            const connUser = await storage.getUser(connUserId);
            if (connUser?.isAdmin || connUser?.isSuperAdmin) {
              connWs.send(JSON.stringify({
                type: 'emergency_alert',
                incident,
                userId
              }));
            }
          } catch {}
        }
      }
      
      res.json({ 
        success: true, 
        incident,
        shareUrl: `/emergency/${shareToken}`
      });
    } catch (error) {
      console.error("Error starting emergency incident:", error);
      res.status(500).json({ message: "Failed to start emergency incident" });
    }
  });

  app.put('/api/emergency/:incidentId/location', isAuthenticated, async (req: any, res) => {
    try {
      const { incidentId } = req.params;
      const { location } = req.body;
      
      if (!location || location.lat === undefined || location.lng === undefined) {
        return res.status(400).json({ message: "Valid location coordinates required" });
      }
      const chkLat = typeof location.lat === 'number' ? location.lat : parseFloat(location.lat);
      const chkLng = typeof location.lng === 'number' ? location.lng : parseFloat(location.lng);
      if (!Number.isFinite(chkLat) || chkLat < -90 || chkLat > 90 ||
          !Number.isFinite(chkLng) || chkLng < -180 || chkLng > 180) {
        return res.status(400).json({ message: "Invalid coordinate values" });
      }
      
      const updatedIncident = await storage.updateEmergencyIncidentLocation(incidentId, { lat: chkLat, lng: chkLng });
      
      // Broadcast location update via WebSocket
      broadcast({
        type: 'emergency_location_update',
        incidentId,
        location
      });
      
      res.json({ success: true, incident: updatedIncident });
    } catch (error) {
      console.error("Error updating emergency location:", error);
      res.status(500).json({ message: "Failed to update emergency location" });
    }
  });

  // Legacy emergency route for backward compatibility
  app.post('/api/emergency', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const incidentData = insertEmergencyIncidentSchema.parse({
        ...req.body,
        userId
      });
      
      const incident = await storage.createEmergencyIncident(incidentData);
      res.json(incident);
    } catch (error) {
      console.error("Error creating emergency incident:", error);
      res.status(400).json({ message: "Failed to create emergency incident" });
    }
  });

  // Fare calculation endpoint
  app.post('/api/rides/calculate-fare', isAuthenticated, async (req: any, res) => {
    try {
      const { distance, duration, driverId } = req.body;
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      
      if (!distance || !duration) {
        return res.status(400).json({ message: "Distance and duration required" });
      }

      const SUGGESTED = { minimumFare: 7.65, baseFare: 4.00, perMinuteRate: 0.29, perMileRate: 0.90, surgeAdjustment: 0 };
      let rates = SUGGESTED;

      if (driverId) {
        const rateCard = await storage.getDriverRateCard(driverId);
        if (rateCard && !rateCard.useSuggested) {
          rates = {
            minimumFare: parseFloat(rateCard.minimumFare || "7.65"),
            baseFare: parseFloat(rateCard.baseFare || "4.00"),
            perMinuteRate: parseFloat(rateCard.perMinuteRate || "0.2900"),
            perMileRate: parseFloat(rateCard.perMileRate || "0.9000"),
            surgeAdjustment: parseFloat(rateCard.surgeAdjustment || "0.00"),
          };
        }
      }

      const baseFare = rates.baseFare;
      const timeCharge = rates.perMinuteRate * duration;
      const distanceCharge = rates.perMileRate * distance;
      const surgeAdjustment = rates.surgeAdjustment;
      const subtotal = baseFare + timeCharge + distanceCharge + surgeAdjustment;
      const total = Math.max(rates.minimumFare, Math.min(100, subtotal));
      
      // Check if rider has promo rides remaining
      let promoDiscount = 0;
      let promoRidesRemaining = 0;
      if (userId) {
        try {
          const rider = await storage.getUser(userId);
          promoRidesRemaining = rider?.promoRidesRemaining ?? 0;
          if (promoRidesRemaining > 0) {
            promoDiscount = Math.min(5, total);
          }
        } catch { /* non-critical */ }
      }

      res.json({
        baseFare: parseFloat(baseFare.toFixed(2)),
        timeCharge: parseFloat(timeCharge.toFixed(2)),
        distanceCharge: parseFloat(distanceCharge.toFixed(2)),
        surgeAdjustment: parseFloat(surgeAdjustment.toFixed(2)),
        subtotal: parseFloat(subtotal.toFixed(2)),
        total: parseFloat(total.toFixed(2)),
        promoDiscount: parseFloat(promoDiscount.toFixed(2)),
        promoRidesRemaining,
        totalAfterPromo: parseFloat(Math.max(0, total - promoDiscount).toFixed(2)),
        rates: {
          minimumFare: rates.minimumFare,
          baseFare: rates.baseFare,
          perMinuteRate: rates.perMinuteRate,
          perMileRate: rates.perMileRate,
          surgeAdjustment: rates.surgeAdjustment,
        },
        formula: `Base $${rates.baseFare.toFixed(2)} + ($${rates.perMinuteRate}/min × ${duration} min) + ($${rates.perMileRate}/mi × ${distance} mi)`
      });
    } catch (error) {
      console.error("Error calculating fare:", error);
      res.status(500).json({ message: "Failed to calculate fare" });
    }
  });

  // Driver rate card endpoints
  app.get('/api/driver/rate-card', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;

      const card = await storage.getDriverRateCard(userId);
      if (!card) {
        return res.json({
          driverId: userId,
          minimumFare: "7.65",
          baseFare: "4.00",
          perMinuteRate: "0.2900",
          perMileRate: "0.9000",
          surgeAdjustment: "0.00",
          useSuggested: true,
        });
      }
      res.json(card);
    } catch (error) {
      console.error("Error fetching rate card:", error);
      res.status(500).json({ message: "Failed to fetch rate card" });
    }
  });

  app.put('/api/driver/rate-card', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;

      const { minimumFare, baseFare, perMinuteRate, perMileRate, surgeAdjustment, useSuggested } = req.body;

      const updateData: any = {};
      if (minimumFare !== undefined) updateData.minimumFare = String(minimumFare);
      if (baseFare !== undefined) updateData.baseFare = String(baseFare);
      if (perMinuteRate !== undefined) updateData.perMinuteRate = String(perMinuteRate);
      if (perMileRate !== undefined) updateData.perMileRate = String(perMileRate);
      if (surgeAdjustment !== undefined) updateData.surgeAdjustment = String(surgeAdjustment);
      if (useSuggested !== undefined) updateData.useSuggested = useSuggested;

      const card = await storage.upsertDriverRateCard(userId, updateData);
      res.json(card);
    } catch (error) {
      console.error("Error updating rate card:", error);
      res.status(500).json({ message: "Failed to update rate card" });
    }
  });

  // Get a specific driver's rate card (public, used for fare estimation)
  app.get('/api/driver/:driverId/rate-card', async (req: any, res) => {
    try {
      const { driverId } = req.params;
      const card = await storage.getDriverRateCard(driverId);
      const SUGGESTED = { minimumFare: "7.65", baseFare: "4.00", perMinuteRate: "0.2900", perMileRate: "0.9000", surgeAdjustment: "0.00", useSuggested: true };
      res.json(card || { driverId, ...SUGGESTED });
    } catch (error) {
      console.error("Error fetching driver rate card:", error);
      res.status(500).json({ message: "Failed to fetch driver rate card" });
    }
  });

  // JSON API endpoint for emergency incident data (no auth required)
  app.get('/api/emergency/incident/:token', async (req: any, res) => {
    try {
      const { token } = req.params;
      const incident = await storage.getEmergencyIncidentByToken(token);
      
      if (!incident) {
        return res.status(404).json({ message: "Emergency incident not found" });
      }
      
      res.json(incident);
    } catch (error) {
      console.error("Error fetching emergency incident:", error);
      res.status(500).json({ message: "Failed to fetch emergency incident" });
    }
  });

  // Update emergency incident location (authenticated)
  app.post('/api/emergency/update-location', isAuthenticated, async (req: any, res) => {
    try {
      const { lat, lng, incidentId } = req.body;
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;

      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (lat === undefined || lng === undefined) {
        return res.status(400).json({ message: "Location coordinates required" });
      }
      const numLat = typeof lat === 'number' ? lat : parseFloat(lat);
      const numLng = typeof lng === 'number' ? lng : parseFloat(lng);
      if (!Number.isFinite(numLat) || numLat < -90 || numLat > 90 ||
          !Number.isFinite(numLng) || numLng < -180 || numLng > 180) {
        return res.status(400).json({ message: "Invalid coordinate values" });
      }

      // Get active emergency incident for user
      const activeIncidents = await storage.getActiveEmergencyIncidents();
      const userIncident = activeIncidents.find(incident => incident.userId === userId);
      
      if (!userIncident) {
        return res.status(404).json({ message: "No active emergency incident found" });
      }

      // Update incident location
      const updatedIncident = await storage.updateEmergencyIncidentLocation(userIncident.id, { lat, lng });
      
      // Broadcast location update via WebSocket
      broadcast({
        type: 'emergency_location_update',
        incidentId: userIncident.id,
        location: { lat, lng }
      });

      res.json({ success: true, incident: updatedIncident });
    } catch (error) {
      console.error("Error updating emergency location:", error);
      res.status(500).json({ message: "Failed to update emergency location" });
    }
  });

  // Emergency tracking is handled by the React SPA at /emergency/:token
  // The React EmergencyTracking component fetches data via /api/emergency/incident/:token

  // ============================================================
  // ADMIN ROUTES
  // ============================================================

  const SUPER_ADMIN_EMAIL = 'thrynovainsights@gmail.com';

  const isAdminOrSessionAuth = async (req: any, res: any, next: any) => {
    const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUser(userId);
    if (!user?.isAdmin && !user?.isSuperAdmin) return res.status(403).json({ message: "Admin access required" });
    req.adminUser = user;
    next();
  };

  const isSuperAdminAuth = async (req: any, res: any, next: any) => {
    const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUser(userId);
    if (!user?.isSuperAdmin || user.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ message: "Super admin access required" });
    req.adminUser = user;
    next();
  };

  const sessionOrOidcAuth = async (req: any, res: any, next: any) => {
    const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    next();
  };

  // Create admin account (super admin only)
  app.post('/api/admin/create-admin', isSuperAdminAuth, async (req: any, res) => {
    try {
      const createAdminSchema = z.object({
        email: z.string().email(),
        password: z.string().min(1, "Password is required"),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
      });
      const { email, password, firstName, lastName } = createAdminSchema.parse(req.body);

      if (email === SUPER_ADMIN_EMAIL) {
        return res.status(400).json({ message: "Cannot create another super admin account" });
      }

      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(400).json({ message: "Email already registered" });
      }

      const { valid: pwValid, feedback: pwFeedback } = validatePasswordComplexity(password);
      if (!pwValid) {
        return res.status(400).json({ message: `Password must contain: ${pwFeedback.join(", ")}.` });
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        firstName,
        lastName,
        isAdmin: true,
        isApproved: true,
        isVerified: true,
        approvedBy: req.adminUser.id,
      });

      await storage.logAdminAction(req.adminUser.id, 'create_admin', 'user', user.id, { email });
      res.json({ message: "Admin account created", user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName } });
    } catch (error: any) {
      console.error("Error creating admin:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Failed to create admin account" });
    }
  });

  // Approve user (admin or super admin)
  app.post('/api/admin/users/:userId/approve', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const adminId = req.adminUser.id;
      const targetUser = await storage.getUser(userId);
      if (!targetUser) return res.status(404).json({ message: "User not found" });
      if (targetUser.isApproved) return res.status(400).json({ message: "User already approved" });

      const user = await storage.adminUpdateUser(userId, { isApproved: true, approvedBy: adminId });
      await storage.logAdminAction(adminId, 'approve_user', 'user', userId, { email: targetUser.email });
      sendAccountApprovedEmail({
        email: user.email,
        firstName: user.firstName,
        virtualCardBalance: user.virtualCardBalance,
        promoRidesRemaining: user.promoRidesRemaining,
      }).catch(console.error);
      res.json(user);
    } catch (error) {
      console.error("Error approving user:", error);
      res.status(500).json({ message: "Failed to approve user" });
    }
  });

  // Revoke user approval (admin or super admin)
  app.post('/api/admin/users/:userId/revoke-approval', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const adminId = req.adminUser.id;
      const targetUser = await storage.getUser(userId);
      if (!targetUser) return res.status(404).json({ message: "User not found" });

      if (targetUser.isSuperAdmin) return res.status(403).json({ message: "Cannot revoke super admin" });
      if (targetUser.isAdmin && !req.adminUser.isSuperAdmin) return res.status(403).json({ message: "Only super admin can revoke other admins" });

      const user = await storage.adminUpdateUser(userId, { isApproved: false });
      await storage.logAdminAction(adminId, 'revoke_approval', 'user', userId, { email: targetUser.email });
      res.json(user);
    } catch (error) {
      console.error("Error revoking approval:", error);
      res.status(500).json({ message: "Failed to revoke approval" });
    }
  });

  // Promote user to admin (super admin only)
  app.post('/api/admin/users/:userId/make-admin', isSuperAdminAuth, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const targetUser = await storage.getUser(userId);
      if (!targetUser) return res.status(404).json({ message: "User not found" });
      if (targetUser.email === SUPER_ADMIN_EMAIL) return res.status(400).json({ message: "User is already super admin" });

      const user = await storage.adminUpdateUser(userId, { isAdmin: true, isApproved: true, approvedBy: req.adminUser.id });
      await storage.logAdminAction(req.adminUser.id, 'promote_to_admin', 'user', userId, { email: targetUser.email });
      res.json(user);
    } catch (error) {
      console.error("Error promoting user:", error);
      res.status(500).json({ message: "Failed to promote user" });
    }
  });

  // Demote admin (super admin only)
  app.post('/api/admin/users/:userId/remove-admin', isSuperAdminAuth, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const targetUser = await storage.getUser(userId);
      if (!targetUser) return res.status(404).json({ message: "User not found" });
      if (targetUser.email === SUPER_ADMIN_EMAIL) return res.status(400).json({ message: "Cannot demote super admin" });

      const user = await storage.adminUpdateUser(userId, { isAdmin: false });
      await storage.logAdminAction(req.adminUser.id, 'demote_admin', 'user', userId, { email: targetUser.email });
      res.json(user);
    } catch (error) {
      console.error("Error demoting admin:", error);
      res.status(500).json({ message: "Failed to demote admin" });
    }
  });

  // Delete user (admin or super admin, but admins can't delete other admins)
  app.delete('/api/admin/users/:userId', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const adminId = req.adminUser.id;
      const targetUser = await storage.getUser(userId);
      if (!targetUser) return res.status(404).json({ message: "User not found" });

      if (targetUser.isSuperAdmin) return res.status(403).json({ message: "Cannot delete super admin" });
      if (targetUser.isAdmin && !req.adminUser.isSuperAdmin) {
        return res.status(403).json({ message: "Only super admin can delete other admins" });
      }
      if (userId === adminId) return res.status(400).json({ message: "Cannot delete yourself" });

      await storage.deleteUser(userId);
      await storage.logAdminAction(adminId, 'delete_user', 'user', userId, { email: targetUser.email });
      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // Dashboard stats
  app.get('/api/admin/dashboard', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  });

  // All users
  app.get('/api/admin/users', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const { limit = 100, offset = 0 } = req.query;
      const allUsers = await storage.getAllUsers(parseInt(limit), parseInt(offset));
      res.json(allUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Update user (admin actions)
  app.patch('/api/admin/users/:userId', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const adminId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { userId } = req.params;
      const updates = req.body;

      const allowedFields = ['isApproved', 'isSuspended', 'isDriver', 'isVerified', 'firstName', 'lastName', 'phone', 'emergencyContact'];
      const sanitizedUpdates: Record<string, any> = {};
      for (const key of allowedFields) {
        if (updates[key] !== undefined) {
          sanitizedUpdates[key] = updates[key];
        }
      }

      if (Object.keys(sanitizedUpdates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      const targetUser = await storage.getUser(userId);
      if (targetUser?.isSuperAdmin) {
        return res.status(403).json({ message: "Cannot modify super admin via this endpoint" });
      }

      const user = await storage.adminUpdateUser(userId, sanitizedUpdates);
      await storage.logAdminAction(adminId, 'update_user', 'user', userId, sanitizedUpdates);
      res.json(user);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // All drivers
  app.get('/api/admin/drivers', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const drivers = await storage.getAllDrivers();
      res.json(drivers);
    } catch (error) {
      console.error("Error fetching drivers:", error);
      res.status(500).json({ message: "Failed to fetch drivers" });
    }
  });

  // Update driver profile (approve, suspend, verify)
  app.patch('/api/admin/drivers/:userId', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const adminId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { userId } = req.params;
      // SECURITY: Whitelist fields that admins may update on a driver profile
      const DRIVER_PROFILE_ALLOWED = ['approvalStatus', 'isOnline', 'isVerifiedNeighbor', 'verificationNotes', 'backgroundCheckStatus', 'licenseNumber', 'licenseExpiry', 'insuranceProvider', 'insuranceExpiry'];
      const rawUpdates = req.body;
      const updates: Record<string, any> = {};
      for (const key of DRIVER_PROFILE_ALLOWED) {
        if (rawUpdates[key] !== undefined) updates[key] = rawUpdates[key];
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      // If admin sets approvalStatus → approved AND Checkr is configured, trigger background check
      if (updates.approvalStatus === 'approved' && process.env.CHECKR_API_KEY) {
        const targetUser = await storage.getUser(userId);
        if (targetUser) {
          try {
            const authHeader = `Basic ${Buffer.from(process.env.CHECKR_API_KEY + ':').toString('base64')}`;
            const candidateRes = await fetch('https://api.checkr.com/v1/candidates', {
              method: 'POST',
              headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: targetUser.email, first_name: targetUser.firstName, last_name: targetUser.lastName }),
            });
            if (candidateRes.ok) {
              const candidate = await candidateRes.json() as any;
              const reportRes = await fetch('https://api.checkr.com/v1/reports', {
                method: 'POST',
                headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ candidate_id: candidate.id, package: 'tasker_standard' }),
              });
              if (reportRes.ok) {
                const report = await reportRes.json() as any;
                await storage.adminUpdateDriverProfile(userId, {
                  checkrCandidateId: candidate.id,
                  checkrReportId: report.id,
                  approvalStatus: 'background_check_pending',
                } as any);
                await storage.logAdminAction(adminId, 'initiate_background_check', 'driver_profile', userId, { candidateId: candidate.id });
                return res.json({ message: 'Background check initiated', approvalStatus: 'background_check_pending' });
              }
            }
          } catch (checkrErr) {
            console.error('Checkr API error (falling through to manual approval):', checkrErr);
          }
        }
      }

      const profile = await storage.adminUpdateDriverProfile(userId, updates);
      await storage.logAdminAction(adminId, 'update_driver', 'driver_profile', userId, updates);
      res.json(profile);
    } catch (error) {
      console.error("Error updating driver:", error);
      res.status(500).json({ message: "Failed to update driver" });
    }
  });

  app.delete('/api/admin/drivers/:userId', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const adminId = req.adminUser?.id || req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { userId } = req.params;
      const targetUser = await storage.getUser(userId);
      if (!targetUser) return res.status(404).json({ message: "User not found" });

      const driverProfile = await storage.getDriverProfile(userId);
      if (!driverProfile) return res.status(404).json({ message: "Driver profile not found" });

      await storage.deleteDriverProfile(userId);
      if (adminId) {
        await storage.logAdminAction(adminId, 'delete_driver_profile', 'driver_profile', userId, { email: targetUser.email });
      }
      res.json({ message: "Driver profile deleted successfully" });
    } catch (error) {
      console.error("Error deleting driver profile:", error);
      res.status(500).json({ message: "Failed to delete driver profile" });
    }
  });

  // All rides
  app.get('/api/admin/rides', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const { limit = 100, offset = 0 } = req.query;
      const allRides = await storage.getAllRides(parseInt(limit), parseInt(offset));
      res.json(allRides);
    } catch (error) {
      console.error("Error fetching rides:", error);
      res.status(500).json({ message: "Failed to fetch rides" });
    }
  });

  // All disputes
  app.get('/api/admin/disputes', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const allDisputes = await storage.getAllDisputes();
      res.json(allDisputes);
    } catch (error) {
      console.error("Error fetching disputes:", error);
      res.status(500).json({ message: "Failed to fetch disputes" });
    }
  });

  // Resolve dispute
  app.patch('/api/admin/disputes/:disputeId', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const adminId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { disputeId } = req.params;
      const { resolution, refundAmount } = req.body;
      const parsedRefund = refundAmount ? parseFloat(refundAmount) : undefined;
      if (parsedRefund !== undefined && (!Number.isFinite(parsedRefund) || parsedRefund < 0)) {
        return res.status(400).json({ message: "Invalid refund amount" });
      }
      const dispute = await storage.adminResolveDispute(disputeId, resolution, adminId, parsedRefund);
      await storage.logAdminAction(adminId, 'resolve_dispute', 'dispute', disputeId, { resolution, refundAmount: parsedRefund });
      res.json(dispute);
    } catch (error) {
      console.error("Error resolving dispute:", error);
      res.status(500).json({ message: "Failed to resolve dispute" });
    }
  });

  // ── RIDE GROUPS: MODE 3 (MULTI-STOP) & MODE 4 (SHARED SCHEDULE) ────────────

  // Helper: generate a unique PG-XXXXXX code
  const generateScheduleCode = async (): Promise<string> => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let attempt = 0; attempt < 20; attempt++) {
      const suffix = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
      const code = `PG-${suffix}`;
      const existing = await storage.getRideGroupByCode(code);
      if (!existing) return code;
    }
    throw new Error("Could not generate unique schedule code");
  };

  // POST /api/rides/multi-stop — Mode 3: organizer pays for full route
  app.post('/api/rides/multi-stop', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { pickupLocation, destinationLocation, pickupStops, driverId, estimatedFare, pickupInstructions } = req.body;

      if (!pickupLocation || !destinationLocation || !estimatedFare) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      // Create a ride group first
      const group = await storage.createRideGroup({
        organizerId: userId,
        groupType: "multi_stop",
        sharedDestination: destinationLocation,
        maxSlots: 1,
        filledSlots: 1,
        status: "open",
      });

      // Create the ride linked to the group
      const ride = await storage.createRide({
        riderId: userId,
        driverId: driverId || null,
        pickupLocation,
        destinationLocation,
        pickupStops: pickupStops || [],
        pickupInstructions,
        estimatedFare: String(estimatedFare),
        paymentMethod: "card",
        rideType: "multi_stop",
        groupId: group.id,
      });

      res.json({ ...ride, group });
    } catch (error) {
      console.error("Error creating multi-stop ride:", error);
      res.status(500).json({ message: "Failed to create multi-stop ride" });
    }
  });

  // POST /api/rides/create-shared-schedule — Mode 4: organizer books and gets a code
  app.post('/api/rides/create-shared-schedule', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { pickupLocation, destinationLocation, driverId, estimatedFare, pickupInstructions, scheduledAt } = req.body;

      if (!pickupLocation || !destinationLocation || !estimatedFare) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const scheduleCode = await generateScheduleCode();

      // Create the group
      const group = await storage.createRideGroup({
        scheduleCode,
        organizerId: userId,
        groupType: "shared_schedule",
        maxSlots: 3,
        filledSlots: 1,
        status: "open",
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      });

      // Create organizer's ride linked to the group
      const ride = await storage.createRide({
        riderId: userId,
        driverId: driverId || null,
        pickupLocation,
        destinationLocation,
        pickupInstructions,
        estimatedFare: String(estimatedFare),
        originalFare: String(estimatedFare),
        paymentMethod: "card",
        rideType: "shared_schedule",
        groupId: group.id,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      });

      res.json({ ...ride, group, scheduleCode });
    } catch (error) {
      console.error("Error creating shared schedule:", error);
      res.status(500).json({ message: "Failed to create shared schedule" });
    }
  });

  // GET /api/rides/schedule/:code — preview a group before joining
  app.get('/api/rides/schedule/:code', isAuthenticated, async (_req: any, res) => {
    try {
      const code = _req.params.code.toUpperCase();
      const group = await storage.getRideGroupByCode(code);
      if (!group) return res.status(404).json({ message: "Schedule not found" });
      if (group.status !== "open") return res.status(410).json({ message: "This schedule is no longer open" });
      // Check expiry: if scheduledAt is set and > 1 hr in the past, consider expired
      if (group.scheduledAt && new Date(group.scheduledAt).getTime() < Date.now() - 3600000) {
        await storage.updateRideGroup(group.id, { status: "cancelled" });
        return res.status(410).json({ message: "This schedule has expired" });
      }
      res.json({
        groupId: group.id,
        scheduleCode: group.scheduleCode,
        groupType: group.groupType,
        filledSlots: group.filledSlots,
        maxSlots: group.maxSlots,
        scheduledAt: group.scheduledAt,
      });
    } catch (error) {
      console.error("Error previewing schedule:", error);
      res.status(500).json({ message: "Failed to load schedule" });
    }
  });

  // POST /api/rides/join-schedule — Mode 4: joiner enters code and books their own ride
  app.post('/api/rides/join-schedule', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { scheduleCode, pickupLocation, destinationLocation, paymentMethod } = req.body;

      if (!scheduleCode || !pickupLocation || !destinationLocation) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const group = await storage.getRideGroupByCode(scheduleCode.toUpperCase());
      if (!group) return res.status(404).json({ message: "Schedule code not found" });
      if (group.status !== "open") return res.status(410).json({ message: "This schedule is no longer accepting riders" });
      if ((group.filledSlots ?? 0) >= (group.maxSlots ?? 3)) return res.status(409).json({ message: "This schedule is full" });

      // Estimate fare for the joiner's route
      const { lat: pLat, lng: pLng } = pickupLocation;
      const { lat: dLat, lng: dLng } = destinationLocation;
      const R = 3958.8;
      const dLatR = ((dLat - pLat) * Math.PI) / 180;
      const dLngR = ((dLng - pLng) * Math.PI) / 180;
      const a = Math.sin(dLatR / 2) ** 2 + Math.cos((pLat * Math.PI) / 180) * Math.cos((dLat * Math.PI) / 180) * Math.sin(dLngR / 2) ** 2;
      const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.3;
      const duration = Math.round((dist / 25) * 60);
      const fullFare = Math.max(5, 2.5 + dist * 1.5 + duration * 0.3);
      const discountedFare = fullFare * 0.7;

      // Create the joiner's ride
      const ride = await storage.createRide({
        riderId: userId,
        driverId: group.driverId || null,
        pickupLocation,
        destinationLocation,
        estimatedFare: discountedFare.toFixed(2),
        originalFare: fullFare.toFixed(2),
        groupDiscountAmount: (fullFare * 0.3).toFixed(2),
        paymentMethod: paymentMethod || "card",
        rideType: "shared_schedule",
        groupId: group.id,
      });

      // Increment filled slots
      const newFilledSlots = (group.filledSlots ?? 1) + 1;
      await storage.updateRideGroup(group.id, { filledSlots: newFilledSlots });

      // Apply 30% discount to ALL rides in the group (including organizer) if first joiner
      if (newFilledSlots === 2 && !group.discountActive) {
        await storage.applyGroupDiscount(group.id, 30);
      }

      // Close group if full
      if (newFilledSlots >= (group.maxSlots ?? 3)) {
        await storage.updateRideGroup(group.id, { status: "active" });
      }

      res.json({ ...ride, scheduleCode, discountApplied: true });
    } catch (error) {
      console.error("Error joining schedule:", error);
      res.status(500).json({ message: "Failed to join schedule" });
    }
  });

  // ── SHARED RIDES ────────────────────────────────────────────────────────────

  // Rider: get details of the shared group their active ride belongs to
  app.get('/api/shared-rides/my-group', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const group = await getMyActiveSharedGroup(userId);
      res.json(group);
    } catch (error) {
      console.error("Error fetching shared group:", error);
      res.status(500).json({ message: "Failed to fetch shared group" });
    }
  });

  // ── PUSH NOTIFICATIONS ──────────────────────────────────────────────────────

  // Expose VAPID public key so the frontend can subscribe
  app.get('/api/push/vapid-key', (_req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || "" });
  });

  // Save a new push subscription for the current user
  app.post('/api/push/subscribe', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { endpoint, p256dh, auth } = req.body;
      if (!endpoint || !p256dh || !auth) return res.status(400).json({ message: "Missing subscription fields" });
      const sub = await storage.savePushSubscription(userId, { endpoint, p256dh, auth });
      res.json(sub);
    } catch (error) {
      console.error("Error saving push subscription:", error);
      res.status(500).json({ message: "Failed to save subscription" });
    }
  });

  // Remove a push subscription
  app.post('/api/push/unsubscribe', isAuthenticated, async (req: any, res) => {
    try {
      const { endpoint } = req.body;
      if (!endpoint) return res.status(400).json({ message: "Missing endpoint" });
      await storage.deletePushSubscription(endpoint);
      res.json({ success: true });
    } catch (error) {
      console.error("Error removing push subscription:", error);
      res.status(500).json({ message: "Failed to remove subscription" });
    }
  });

  // ── PAYOUT REQUESTS ─────────────────────────────────────────────────────────

  // Driver: list own payout requests
  app.get('/api/driver/payout-requests', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const requests = await storage.getDriverPayoutRequests(userId);
      res.json(requests);
    } catch (error) {
      console.error("Error fetching payout requests:", error);
      res.status(500).json({ message: "Failed to fetch payout requests" });
    }
  });

  // Driver: submit new payout request
  app.post('/api/driver/payout-requests', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const { amount, payoutMethod, payoutDetails } = req.body;
      if (!amount || !payoutMethod || !payoutDetails) {
        return res.status(400).json({ message: "amount, payoutMethod, and payoutDetails are required" });
      }
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount) || numAmount < 5) {
        return res.status(400).json({ message: "Minimum payout amount is $5.00" });
      }
      const balance = parseFloat(user.virtualCardBalance || '0');
      if (numAmount > balance) {
        return res.status(400).json({ message: "Payout amount exceeds available balance" });
      }

      // Deduct balance immediately and create request
      await storage.deductVirtualCardBalance(userId, numAmount);
      const request = await storage.createPayoutRequest({
        driverId: userId,
        amount: numAmount.toFixed(2),
        payoutMethod,
        payoutDetails,
      });
      res.json(request);
    } catch (error) {
      console.error("Error creating payout request:", error);
      res.status(500).json({ message: "Failed to submit payout request" });
    }
  });

  // Admin: list all payout requests
  app.get('/api/admin/payout-requests', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const requests = await storage.getAllPayoutRequests();
      res.json(requests);
    } catch (error) {
      console.error("Error fetching payout requests:", error);
      res.status(500).json({ message: "Failed to fetch payout requests" });
    }
  });

  // Admin: update payout request status
  app.patch('/api/admin/payout-requests/:id', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const adminId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { id } = req.params;
      const { status, adminNote } = req.body;
      if (!['processing', 'paid', 'rejected'].includes(status)) {
        return res.status(400).json({ message: "status must be processing, paid, or rejected" });
      }
      // If rejecting, refund the balance
      if (status === 'rejected') {
        const existing = (await storage.getDriverPayoutRequests('')); // lazy approach — get all then filter
        const allRequests = await storage.getAllPayoutRequests();
        const request = allRequests.find(r => r.id === id);
        if (request && request.status === 'pending') {
          await storage.addVirtualCardBalance(request.driverId, parseFloat(request.amount));
        }
      }
      const updated = await storage.updatePayoutRequest(id, { status, adminNote, processedBy: adminId });
      await storage.logAdminAction(adminId, `payout_${status}`, 'payout_request', id, { adminNote });
      res.json(updated);
    } catch (error) {
      console.error("Error updating payout request:", error);
      res.status(500).json({ message: "Failed to update payout request" });
    }
  });

  // Financial summary
  app.get('/api/admin/finances', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const { year } = req.query;
      const summary = await storage.getFinancialSummary(year ? parseInt(year) : undefined);
      res.json(summary);
    } catch (error) {
      console.error("Error fetching financial summary:", error);
      res.status(500).json({ message: "Failed to fetch financial summary" });
    }
  });

  // Ownership management
  app.get('/api/admin/ownership', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const owners = await storage.getAllOwners();
      const allRecords = await storage.getAllOwnershipRecords();
      const certificates = await storage.getShareCertificates();
      const rebalanceLog = await storage.getRebalanceLog();
      res.json({ owners, allRecords, certificates, rebalanceLog });
    } catch (error) {
      console.error("Error fetching ownership data:", error);
      res.status(500).json({ message: "Failed to fetch ownership data" });
    }
  });

  // Recalculate ownership
  app.post('/api/admin/ownership/recalculate', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const adminId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const result = await storage.recalculateOwnership();
      await storage.logAdminAction(adminId, 'recalculate_ownership', 'ownership', undefined, result);
      res.json(result);
    } catch (error) {
      console.error("Error recalculating ownership:", error);
      res.status(500).json({ message: "Failed to recalculate ownership" });
    }
  });

  // Update driver ownership record (background check, adverse record)
  app.patch('/api/admin/ownership/:driverId', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const adminId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { driverId } = req.params;
      const updates = req.body;

      const ownership = await storage.getOrCreateOwnership(driverId);
      const updatedFields: any = { updatedAt: new Date() };
      if (updates.backgroundCheckStatus !== undefined) updatedFields.backgroundCheckStatus = updates.backgroundCheckStatus;
      if (updates.hasAdverseRecord !== undefined) updatedFields.hasAdverseRecord = updates.hasAdverseRecord;
      if (updates.violationNotes !== undefined) updatedFields.violationNotes = updates.violationNotes;
      if (updates.backgroundCheckDate !== undefined) updatedFields.backgroundCheckDate = new Date(updates.backgroundCheckDate);

      const { db: dbInstance } = await import("./db");
      const { driverOwnership } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      await dbInstance.update(driverOwnership).set(updatedFields).where(eq(driverOwnership.id, ownership.id));

      await storage.logAdminAction(adminId, 'update_ownership', 'ownership', driverId, updates);
      const updated = await storage.getDriverOwnershipStatus(driverId);
      res.json(updated);
    } catch (error) {
      console.error("Error updating ownership:", error);
      res.status(500).json({ message: "Failed to update ownership" });
    }
  });

  // Profit declarations
  app.get('/api/admin/profits', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const declarations = await storage.getProfitDeclarations();
      res.json(declarations);
    } catch (error) {
      console.error("Error fetching profit declarations:", error);
      res.status(500).json({ message: "Failed to fetch profit declarations" });
    }
  });

  app.post('/api/admin/profits', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const adminId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      // SECURITY: Validate profit declaration fields
      const profitSchema = z.object({
        totalRevenue: z.number().min(0, "Revenue must be non-negative"),
        totalExpenses: z.number().min(0, "Expenses must be non-negative"),
        netProfit: z.number(),
        distributionPercentage: z.number().min(0).max(100).optional(),
        notes: z.string().max(1000).optional(),
        periodStart: z.string().optional(),
        periodEnd: z.string().optional(),
      });
      const parsed = profitSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      const data = { ...parsed.data, declaredBy: adminId };
      const declaration = await storage.createProfitDeclaration(data);
      await storage.logAdminAction(adminId, 'create_profit_declaration', 'profit_declaration', declaration.id, data);
      res.json(declaration);
    } catch (error) {
      console.error("Error creating profit declaration:", error);
      res.status(500).json({ message: "Failed to create profit declaration" });
    }
  });

  app.post('/api/admin/profits/:id/declare', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const adminId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const declaration = await storage.declareProfitDistribution(req.params.id);
      await storage.logAdminAction(adminId, 'declare_profit', 'profit_declaration', req.params.id);
      res.json(declaration);
    } catch (error: any) {
      console.error("Error declaring profit:", error);
      res.status(400).json({ message: "Failed to declare profit. Please check your input." });
    }
  });

  app.post('/api/admin/profits/:id/distribute', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const adminId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const distributions = await storage.distributeProfits(req.params.id);
      await storage.logAdminAction(adminId, 'distribute_profit', 'profit_declaration', req.params.id);
      res.json(distributions);
    } catch (error: any) {
      console.error("Error distributing profit:", error);
      res.status(400).json({ message: "Failed to distribute profit. Please try again." });
    }
  });

  app.get('/api/admin/profits/:id/distributions', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const distributions = await storage.getProfitDistributions(req.params.id);
      res.json(distributions);
    } catch (error) {
      console.error("Error fetching distributions:", error);
      res.status(500).json({ message: "Failed to fetch distributions" });
    }
  });

  // Admin activity log
  app.get('/api/admin/activity-log', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const log = await storage.getAdminActivityLog();
      res.json(log);
    } catch (error) {
      console.error("Error fetching activity log:", error);
      res.status(500).json({ message: "Failed to fetch activity log" });
    }
  });

  // ============================================================
  // DRIVER OWNERSHIP STATUS (for drivers themselves)
  // ============================================================

  app.get('/api/driver/ownership', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const ownership = await storage.getOrCreateOwnership(userId);
      const weeklyHours = await storage.getDriverWeeklyHoursHistory(userId, 52);
      const certificates = await storage.getShareCertificates(userId);
      const profitHistory = await storage.getDriverProfitDistributions(userId);
      res.json({ ownership, weeklyHours, certificates, profitHistory });
    } catch (error) {
      console.error("Error fetching ownership status:", error);
      res.status(500).json({ message: "Failed to fetch ownership status" });
    }
  });

  // ============================================================
  // AI ASSISTANT CHAT ROUTES
  // ============================================================

  const BASE_SYSTEM_PROMPT = `You are PG Ride Assistant, a helpful AI assistant for the PG County Community Ride-Share Platform. You help riders and drivers with questions about:
- How to book rides, schedule rides, and find drivers
- Payment information (Virtual PG Card system, fare estimation)
- Driver registration and verification
- Safety features (SOS, emergency contacts, live tracking)
- Ride history, ratings, and disputes
- The cooperative ownership model for drivers
- General questions about the platform

Be friendly, concise, and helpful. Keep responses brief but informative.`;

  async function buildPersonalizedPrompt(userId: string): Promise<string> {
    try {
      const user = await storage.getUser(userId);
      if (!user) return BASE_SYSTEM_PROMPT;

      const recentRides = await storage.getRidesByUser(userId, 5);
      const completedRides = recentRides.filter(r => r.status === 'completed');
      const activeRides = recentRides.filter(r => ['pending', 'accepted', 'driver_arriving', 'in_progress'].includes(r.status || ''));

      let context = BASE_SYSTEM_PROMPT + `\n\n--- USER CONTEXT (use this to personalize your responses) ---`;
      context += `\nUser: ${user.firstName || 'Unknown'} ${user.lastName || ''}`;
      context += `\nRole: ${user.isDriver ? 'Driver' : 'Rider'}`;
      context += `\nRating: ${user.rating || '5.00'}/5`;
      context += `\nTotal Rides: ${user.totalRides || 0}`;
      context += `\nVirtual Card Balance: $${user.virtualCardBalance || '0.00'}`;

      if (activeRides.length > 0) {
        context += `\nActive Rides: ${activeRides.length} (statuses: ${activeRides.map(r => r.status).join(', ')})`;
      }

      if (completedRides.length > 0) {
        const avgFare = completedRides.reduce((sum, r) => sum + parseFloat(r.actualFare?.toString() || '0'), 0) / completedRides.length;
        context += `\nRecent Completed Rides: ${completedRides.length}`;
        context += `\nAvg Fare: $${avgFare.toFixed(2)}`;
      }

      if (user.isDriver) {
        const profile = await storage.getDriverProfile(userId);
        if (profile) {
          context += `\nDriver Status: ${profile.isOnline ? 'Online' : 'Offline'}`;
          context += `\nVerified Neighbor: ${profile.isVerifiedNeighbor ? 'Yes' : 'No'}`;
          context += `\nApproval: ${profile.approvalStatus}`;
        }
      }

      context += `\n--- END USER CONTEXT ---`;
      context += `\nUse this context to give personalized, relevant answers. Reference their actual data when helpful (e.g., balance, ride count). Don't repeat this context back verbatim.`;

      return context;
    } catch {
      return BASE_SYSTEM_PROMPT;
    }
  }

  app.get('/api/ai/conversations', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const convos = await storage.getConversationsByUser(userId);
      res.json(convos);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  app.post('/api/ai/conversations', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { title } = req.body;
      const conversation = await storage.createConversation(userId, title || "New Chat");
      res.json(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ message: "Failed to create conversation" });
    }
  });

  app.get('/api/ai/conversations/:id/messages', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { id } = req.params;
      const convo = await storage.getConversation(id, userId);
      if (!convo) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      const messages = await storage.getChatMessages(id);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  app.delete('/api/ai/conversations/:id', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { id } = req.params;
      await storage.deleteConversation(id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({ message: "Failed to delete conversation" });
    }
  });

  app.post('/api/ai/conversations/:id/messages', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { id } = req.params;
      const { content } = req.body;

      if (!content || typeof content !== 'string') {
        return res.status(400).json({ message: "Message content is required" });
      }

      const convo = await storage.getConversation(id, userId);
      if (!convo) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      await storage.createChatMessage(id, "user", content);

      const existingMessages = await storage.getChatMessages(id);
      const personalizedPrompt = await buildPersonalizedPrompt(userId);
      const chatHistory: Array<{role: "system" | "user" | "assistant", content: string}> = [
        { role: "system", content: personalizedPrompt },
        ...existingMessages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ];

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Anthropic separates the system prompt from the conversation messages.
      const systemPrompt = chatHistory.find((m) => m.role === "system")?.content ?? "";
      const anthropicMessages = chatHistory
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const anthropicStream = getAnthropicClient().messages.stream({
        model: "claude-opus-4-5",
        system: systemPrompt,
        messages: anthropicMessages,
        max_tokens: 1024,
      });

      let fullResponse = "";

      for await (const chunk of anthropicStream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          const delta = chunk.delta.text;
          fullResponse += delta;
          res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
        }
      }

      await storage.createChatMessage(id, "assistant", fullResponse);

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Error sending AI message:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "Failed to get AI response" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ message: "Failed to send message" });
      }
    }
  });

  // ============================================================
  // ANALYTICS & SELF-LEARNING ROUTES
  // ============================================================

  app.post('/api/analytics/events', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { eventType, eventCategory, eventData, sessionId } = req.body;
      if (!eventType || !eventCategory) {
        return res.status(400).json({ message: "eventType and eventCategory are required" });
      }
      const event = await storage.trackEvent({ userId, eventType, eventCategory, eventData, sessionId });
      res.json(event);
    } catch (error) {
      console.error("Error tracking event:", error);
      res.status(500).json({ message: "Failed to track event" });
    }
  });

  app.post('/api/ai/feedback', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { messageId, conversationId, rating, reason } = req.body;
      if (!messageId || !conversationId || !rating) {
        return res.status(400).json({ message: "messageId, conversationId, and rating are required" });
      }
      const feedback = await storage.submitAiFeedback({ messageId, conversationId, userId, rating, reason });
      res.json(feedback);
    } catch (error) {
      console.error("Error submitting feedback:", error);
      res.status(500).json({ message: "Failed to submit feedback" });
    }
  });

  app.get('/api/faq', async (req, res) => {
    try {
      const entries = await storage.getFaqEntries(true);
      res.json(entries);
    } catch (error) {
      console.error("Error fetching FAQs:", error);
      res.status(500).json({ message: "Failed to fetch FAQs" });
    }
  });

  app.get('/api/driver/scorecard', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const scorecard = await storage.upsertDriverScorecard(userId);
      res.json(scorecard);
    } catch (error) {
      console.error("Error fetching scorecard:", error);
      res.status(500).json({ message: "Failed to fetch scorecard" });
    }
  });

  app.get('/api/driver/optimal-hours', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const hours = await storage.getDriverOptimalHours(userId);
      res.json(hours);
    } catch (error) {
      console.error("Error fetching optimal hours:", error);
      res.status(500).json({ message: "Failed to fetch optimal hours" });
    }
  });

  app.get('/api/demand-heatmap', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const hourOfDay = req.query.hour ? parseInt(req.query.hour) : undefined;
      const dayOfWeek = req.query.day ? parseInt(req.query.day) : undefined;
      const data = await storage.getDemandHeatmap(hourOfDay, dayOfWeek);
      res.json(data);
    } catch (error) {
      console.error("Error fetching demand heatmap:", error);
      res.status(500).json({ message: "Failed to fetch demand data" });
    }
  });

  // Admin analytics routes
  app.get('/api/admin/analytics/events', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const days = parseInt(req.query.days || '7');
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const stats = await storage.getEventStats(startDate, new Date());
      res.json(stats);
    } catch (error) {
      console.error("Error fetching event stats:", error);
      res.status(500).json({ message: "Failed to fetch event stats" });
    }
  });

  app.get('/api/admin/analytics/ai-feedback', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const stats = await storage.getAiFeedbackStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching AI feedback stats:", error);
      res.status(500).json({ message: "Failed to fetch AI feedback stats" });
    }
  });

  app.get('/api/admin/analytics/conversion', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const days = parseInt(req.query.days || '30');
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const metrics = await storage.getConversionMetrics(startDate, new Date());
      res.json(metrics);
    } catch (error) {
      console.error("Error fetching conversion metrics:", error);
      res.status(500).json({ message: "Failed to fetch conversion metrics" });
    }
  });

  app.get('/api/admin/analytics/insights', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const insights = await storage.getPlatformInsights();
      res.json(insights);
    } catch (error) {
      console.error("Error fetching insights:", error);
      res.status(500).json({ message: "Failed to fetch insights" });
    }
  });

  app.post('/api/admin/analytics/insights/:id/read', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      await storage.markInsightRead(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error marking insight read:", error);
      res.status(500).json({ message: "Failed to mark insight" });
    }
  });

  app.get('/api/admin/analytics/safety-alerts', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const alerts = await storage.getActiveSafetyAlerts();
      res.json(alerts);
    } catch (error) {
      console.error("Error fetching safety alerts:", error);
      res.status(500).json({ message: "Failed to fetch safety alerts" });
    }
  });

  app.post('/api/admin/analytics/safety-alerts/:id/resolve', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const alert = await storage.resolveSafetyAlert(req.params.id, userId);
      res.json(alert);
    } catch (error) {
      console.error("Error resolving safety alert:", error);
      res.status(500).json({ message: "Failed to resolve alert" });
    }
  });

  app.get('/api/admin/analytics/scorecards', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const scorecards = await storage.getAllDriverScorecards();
      res.json(scorecards);
    } catch (error) {
      console.error("Error fetching scorecards:", error);
      res.status(500).json({ message: "Failed to fetch scorecards" });
    }
  });

  app.get('/api/admin/faq', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const entries = await storage.getFaqEntries(false);
      res.json(entries);
    } catch (error) {
      console.error("Error fetching FAQs:", error);
      res.status(500).json({ message: "Failed to fetch FAQs" });
    }
  });

  app.post('/api/admin/faq', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const { question, answer, category } = req.body;
      const entry = await storage.createFaqEntry({ question, answer, category });
      res.json(entry);
    } catch (error) {
      console.error("Error creating FAQ:", error);
      res.status(500).json({ message: "Failed to create FAQ" });
    }
  });

  app.patch('/api/admin/faq/:id', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const entry = await storage.updateFaqEntry(req.params.id, req.body);
      res.json(entry);
    } catch (error) {
      console.error("Error updating FAQ:", error);
      res.status(500).json({ message: "Failed to update FAQ" });
    }
  });

  app.post('/api/admin/analytics/generate-demand-heatmap', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const allRides = await storage.getAllCompletedRides();
      const completedRides = allRides.filter(r => r.pickupLocation);
      let processed = 0;
      for (const ride of completedRides) {
        const pickup = ride.pickupLocation as any;
        if (!pickup?.lat || !pickup?.lng) continue;
        const gridLat = (Math.round(pickup.lat * 100) / 100).toFixed(6);
        const gridLng = (Math.round(pickup.lng * 100) / 100).toFixed(6);
        const d = new Date(ride.createdAt || new Date());
        await storage.upsertDemandHeatmap({
          gridLat, gridLng,
          hourOfDay: d.getHours(),
          dayOfWeek: d.getDay(),
          rideCount: 1,
          avgFare: ride.actualFare?.toString(),
        });
        processed++;
      }
      res.json({ processed, message: `Generated heatmap from ${processed} rides` });
    } catch (error) {
      console.error("Error generating heatmap:", error);
      res.status(500).json({ message: "Failed to generate heatmap" });
    }
  });

  app.post('/api/admin/analytics/refresh-scorecards', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const allDrivers = await storage.getAllDriverProfiles();
      const scorecards = [];
      for (const driver of allDrivers) {
        const scorecard = await storage.upsertDriverScorecard(driver.userId);
        scorecards.push(scorecard);
      }
      res.json({ count: scorecards.length, scorecards });
    } catch (error) {
      console.error("Error refreshing scorecards:", error);
      res.status(500).json({ message: "Failed to refresh scorecards" });
    }
  });

  app.post('/api/admin/analytics/detect-safety-patterns', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const alerts: any[] = [];
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const allDriverProfiles = await storage.getAllDriverProfiles();
      for (const driver of allDriverProfiles) {
        const scorecard = await storage.getDriverScorecard(driver.userId);
        if (scorecard) {
          if (parseFloat(scorecard.completionRate?.toString() || '100') < 50 && (scorecard.totalRidesCompleted || 0) + (scorecard.totalRidesCancelled || 0) >= 5) {
            const alert = await storage.createSafetyAlert({
              alertType: 'low_completion_rate',
              severity: 'warning',
              targetUserId: driver.userId,
              title: `Low completion rate: ${scorecard.completionRate}%`,
              description: `Driver has completed only ${scorecard.totalRidesCompleted} of ${(scorecard.totalRidesCompleted || 0) + (scorecard.totalRidesCancelled || 0)} rides`,
              data: { completionRate: scorecard.completionRate, totalRides: (scorecard.totalRidesCompleted || 0) + (scorecard.totalRidesCancelled || 0) },
            });
            alerts.push(alert);
          }
          if ((scorecard.disputeCount || 0) >= 3) {
            const alert = await storage.createSafetyAlert({
              alertType: 'high_dispute_count',
              severity: 'critical',
              targetUserId: driver.userId,
              title: `High dispute count: ${scorecard.disputeCount} disputes`,
              description: `Driver has ${scorecard.disputeCount} reported disputes`,
              data: { disputeCount: scorecard.disputeCount },
            });
            alerts.push(alert);
          }
          if ((scorecard.sosCount || 0) >= 2) {
            const alert = await storage.createSafetyAlert({
              alertType: 'multiple_sos',
              severity: 'critical',
              targetUserId: driver.userId,
              title: `Multiple SOS incidents: ${scorecard.sosCount}`,
              description: `Driver involved in ${scorecard.sosCount} SOS/emergency incidents`,
              data: { sosCount: scorecard.sosCount },
            });
            alerts.push(alert);
          }
          if (parseFloat(scorecard.avgRating?.toString() || '5') < 3.0 && (scorecard.totalRidesCompleted || 0) >= 5) {
            const alert = await storage.createSafetyAlert({
              alertType: 'low_rating',
              severity: 'warning',
              targetUserId: driver.userId,
              title: `Low driver rating: ${scorecard.avgRating}`,
              description: `Driver average rating is below 3.0 with ${scorecard.totalRidesCompleted} completed rides`,
              data: { avgRating: scorecard.avgRating, totalRides: scorecard.totalRidesCompleted },
            });
            alerts.push(alert);
          }
        }
      }
      res.json({ alertsGenerated: alerts.length, alerts });
    } catch (error) {
      console.error("Error detecting safety patterns:", error);
      res.status(500).json({ message: "Failed to detect safety patterns" });
    }
  });

  app.post('/api/admin/analytics/generate-faq', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const recentMessages = await storage.getEventsByType('ai_chat_message', 200);
      const allConvos = await storage.getPlatformInsights(0);
      
      const faqPrompt = `Based on a ride-share platform's AI assistant conversations, generate 5-8 frequently asked questions with clear, helpful answers. Focus on common user questions about rides, payments, safety, and the platform. Format as JSON array: [{"question": "...", "answer": "...", "category": "rides|payments|safety|platform|drivers"}]`;

      const response = await getAnthropicClient().messages.create({
        model: "claude-opus-4-5",
        system: faqPrompt,
        messages: [{ role: "user", content: "Generate the FAQ list now." }],
        max_tokens: 2048,
      });

      const content = (response.content[0]?.type === "text" ? response.content[0].text : null) || '{"faqs":[]}';
      const parsed = JSON.parse(content);
      const faqs = parsed.faqs || parsed;

      const created = [];
      for (const faq of (Array.isArray(faqs) ? faqs : [])) {
        if (faq.question && faq.answer && faq.category) {
          const entry = await storage.createFaqEntry({ question: faq.question, answer: faq.answer, category: faq.category });
          created.push(entry);
        }
      }
      res.json({ generated: created.length, faqs: created });
    } catch (error) {
      console.error("Error generating FAQs:", error);
      res.status(500).json({ message: "Failed to generate FAQs" });
    }
  });

  // ── STRIPE WEBHOOK ──────────────────────────────────────────────────────────
  app.post('/api/webhooks/stripe', async (req: any, res) => {
    if (!stripe) return res.status(503).json({ message: 'Stripe not configured' });
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('STRIPE_WEBHOOK_SECRET not set — cannot verify webhook');
      return res.status(500).json({ message: 'Webhook not configured' });
    }
    let event: any;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'] as string, webhookSecret);
    } catch (err: any) {
      console.error('Stripe webhook signature invalid:', err.message);
      return res.status(400).json({ message: `Webhook error: ${err.message}` });
    }
    try {
      switch (event.type) {
        case 'payment_intent.succeeded': {
          const pi = event.data.object as any;
          const rideId = pi.metadata?.rideId;
          if (rideId) {
            const ride = await storage.getRide(rideId);
            if (ride && ride.paymentStatus !== 'paid_card') {
              await storage.updateRide(rideId, { paymentStatus: 'paid_card' });
            }
          }
          break;
        }
        case 'payment_intent.payment_failed': {
          const pi = event.data.object as any;
          const rideId = pi.metadata?.rideId;
          if (rideId) {
            const ride = await storage.getRide(rideId);
            if (ride && ride.status === 'accepted') {
              await storage.updateRide(rideId, { status: 'cancelled', cancellationReason: 'Payment failed', paymentStatus: 'cancelled' });
            }
          }
          break;
        }
        default: break;
      }
      res.json({ received: true });
    } catch (err) {
      console.error('Stripe webhook handler error:', err);
      res.status(500).json({ message: 'Webhook handler error' });
    }
  });

  // ── CHECKR WEBHOOK ──────────────────────────────────────────────────────────
  app.post('/api/webhooks/checkr', async (req: any, res) => {
    const webhookSecret = process.env.CHECKR_WEBHOOK_SECRET;
    if (webhookSecret) {
      const crypto = await import('crypto');
      const sig = req.headers['x-checkr-signature'] as string;
      const expected = crypto.createHmac('sha256', webhookSecret).update(req.body).digest('hex');
      if (sig !== expected) return res.status(400).json({ message: 'Invalid signature' });
    }
    let event: any;
    try { event = JSON.parse(req.body.toString()); } catch { return res.status(400).json({ message: 'Invalid JSON' }); }

    if (event.type === 'report.completed') {
      const report = event.data?.object;
      if (report?.id) {
        const profiles = await storage.getAllDriverProfiles();
        const profile = profiles.find((p: any) => (p as any).checkrReportId === report.id);
        if (profile) {
          if (report.result === 'clear') {
            await storage.adminUpdateDriverProfile(profile.userId, { approvalStatus: 'approved' } as any);
            await storage.adminUpdateUser(profile.userId, { isApproved: true });
            const user = await storage.getUser(profile.userId);
            if (user) sendAccountApprovedEmail(user).catch(console.error);
          } else {
            await storage.adminUpdateDriverProfile(profile.userId, { approvalStatus: 'rejected' } as any);
            await storage.createSafetyAlert({
              alertType: 'background_check_failed', severity: 'high', targetUserId: profile.userId,
              title: 'Driver background check returned non-clear result',
              description: `Checkr report ${report.id} result: ${report.result}`,
              data: { reportId: report.id, result: report.result },
            });
          }
        }
      }
    }
    res.json({ received: true });
  });
  // ───────────────────────────────────────────────────────────────────────────

  const httpServer = createServer(app);

  // WebSocket server for real-time communication
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  const activeConnections = new Map<string, WebSocket>();

  // County preferences per connected driver (userId → acceptedCounties[])
  // Empty array = accepts all Maryland counties. Cached at join time.
  const driverCountyCache = new Map<string, string[]>();

  // Map to track authenticated userId per WebSocket connection
  const wsAuthenticatedUsers = new WeakMap<WebSocket, string>();
  
  // Session middleware initialised once — avoids leaking a new pg.Pool per WS connection
  const wsSessionMiddleware = getSession();

  wss.on('error', (err) => {
    console.error('WebSocket server error (non-fatal):', err);
  });

  wss.on('connection', (ws, req) => {
    console.log('WebSocket connection established');
    
    // Reuse the single session middleware instance initialised above
    const fakeRes = { on: () => {}, end: () => {}, setHeader: () => {}, getHeader: () => '' } as any;
    wsSessionMiddleware(req as any, fakeRes, () => {
      const session = (req as any).session;
      const authenticatedUserId = session?.userId || session?.testUserId;
      if (authenticatedUserId) {
        wsAuthenticatedUsers.set(ws, authenticatedUserId);
      }
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        switch (message.type) {
          case 'join':
            if (message.userId && typeof message.userId === 'string') {
              // If we have an authenticated session, only allow joining as that user
              const authUserId = wsAuthenticatedUsers.get(ws);
              if (authUserId && authUserId !== message.userId) {
                ws.send(JSON.stringify({ type: 'error', message: 'User ID mismatch' }));
                break;
              }
              // Reject suspended users before adding to active connections
              storage.getUser(message.userId).then(user => {
                if (!user || user.isSuspended) {
                  ws.send(JSON.stringify({ type: 'error', message: 'Account suspended' }));
                  ws.close();
                  return;
                }
                activeConnections.set(message.userId, ws);
                // Cache driver county preferences for filtered broadcasting
                // Use daily session counties if active, otherwise fall back to permanent prefs
                if (user.isDriver) {
                  storage.getDriverProfile(message.userId).then(async profile => {
                    const session = await storage.getDriverDailySession(message.userId).catch(() => null);
                    const counties = (session?.dailyCounties?.length ? session.dailyCounties : null)
                      ?? profile?.acceptedCounties
                      ?? [];
                    driverCountyCache.set(message.userId, counties);
                  }).catch(() => driverCountyCache.set(message.userId, []));
                }
              }).catch(() => {
                ws.send(JSON.stringify({ type: 'error', message: 'Authentication failed' }));
                ws.close();
              });
            }
            break;
            
          case 'location_update':
            if (message.userId && message.location) {
              const { lat, lng } = message.location;
              // Persist location (skip if HTTP POST already handled it for this tick)
              storage.updateDriverLocation(message.userId, { lat, lng }).catch((err: any) => {
                console.error('Failed to persist driver location from WebSocket:', err);
              });
              // Forward to rider of the active ride
              if (message.rideId) {
                storage.getRide(message.rideId).then(ride => {
                  if (ride?.riderId && activeConnections.has(ride.riderId)) {
                    const riderWs = activeConnections.get(ride.riderId)!;
                    if (riderWs.readyState === WebSocket.OPEN) {
                      riderWs.send(JSON.stringify({ type: 'driver_location', rideId: message.rideId, lat, lng }));
                    }
                  }
                }).catch(() => {});
              }
            }
            break;
            
          case 'ride_status':
            // Ride status updates
            if (message.targetUserId && activeConnections.has(message.targetUserId)) {
              const targetWs = activeConnections.get(message.targetUserId);
              if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(JSON.stringify({
                  type: 'ride_status_update',
                  rideId: message.rideId,
                  status: message.status,
                  message: message.message
                }));
              }
            }
            break;
            
          case 'emergency':
            // Emergency alert - notify all relevant parties
            broadcast({
              type: 'emergency_alert',
              userId: message.userId,
              location: message.location,
              incident: message.incident
            });
            break;
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });
    
    ws.on('close', () => {
      // Remove from active connections and clear county cache
      for (const [userId, connection] of Array.from(activeConnections.entries())) {
        if (connection === ws) {
          activeConnections.delete(userId);
          driverCountyCache.delete(userId);

          // Fix 2: if this driver had a claimed scheduled ride within 2h, unclaim and re-broadcast
          storage.getClaimedScheduledRidesForDriver(userId, 120).then(async (claimedRides) => {
            for (const ride of claimedRides) {
              try {
                const unclaimed = await storage.unclaimScheduledRide(ride.id);
                if (!unclaimed) continue;

                // Tell the rider their driver dropped off
                if (ride.riderId && activeConnections.has(ride.riderId)) {
                  const riderWs = activeConnections.get(ride.riderId);
                  if (riderWs?.readyState === WebSocket.OPEN) {
                    riderWs.send(JSON.stringify({
                      type: 'scheduled_ride_driver_dropped',
                      rideId: ride.id,
                      message: 'Your driver went offline. We\'re finding you a new one right away.',
                    }));
                  }
                }

                // Re-broadcast to all online drivers who cover the pickup county
                const rebroadcast = JSON.stringify({
                  type: 'new_scheduled_ride',
                  rideId: ride.id,
                  riderId: ride.riderId,
                  riderName: 'Rider',
                  pickupAddress: (ride.pickupLocation as any)?.address || '',
                  destinationAddress: (ride.destinationLocation as any)?.address || '',
                  estimatedFare: ride.estimatedFare,
                  scheduledAt: ride.scheduledAt,
                  pickupCounty: ride.pickupCounty || '',
                  urgent: true,
                  urgentReason: 'driver_dropped',
                });
                activeConnections.forEach((driverWs, driverId) => {
                  if (driverId === userId) return;
                  const counties = driverCountyCache.get(driverId) ?? [];
                  if (driverCoversCounty(counties, ride.pickupCounty) && driverWs.readyState === WebSocket.OPEN) {
                    driverWs.send(rebroadcast);
                  }
                });
              } catch { /* non-fatal */ }
            }
          }).catch(() => {});

          break;
        }
      }
    });
  });
  
  function broadcast(message: any) {
    const messageStr = JSON.stringify(message);
    activeConnections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    });
  }

  // ── Scheduled ride monitor: fires every minute ──
  // Handles: 30-min reminders, T-60/15/5 escalations, midnight county cleanup
  setInterval(async () => {
    try {
      const { db: dbInst } = await import("./db");
      const { rides: ridesT, driverProfiles: dp } = await import("@shared/schema");
      const { and: _and, isNotNull: _isNotNull, isNull: _isNull, gte: _gte, lte: _lte, sql: _sql } = await import("drizzle-orm");

      const now = new Date();

      // ── Midnight cleanup ──
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        await dbInst.update(dp).set({ dailyCounties: null, dailySessionStart: null });
        driverCountyCache.clear();
      }

      // Helper: fetch unclaimed scheduled rides in a time window (minutes from now)
      const unclaimedInWindow = async (minFrom: number, minTo: number) => {
        return await dbInst
          .select()
          .from(ridesT)
          .where(
            _and(
              _isNotNull(ridesT.scheduledAt),
              _gte(ridesT.scheduledAt, new Date(now.getTime() + minFrom * 60 * 1000)),
              _lte(ridesT.scheduledAt, new Date(now.getTime() + minTo   * 60 * 1000)),
              _isNull(ridesT.driverId),
              _sql`${ridesT.status} = 'pending'`
            )
          );
      };

      // Helper: fetch ALL scheduled rides (claimed or not) in a time window
      const allInWindow = async (minFrom: number, minTo: number) => {
        return await dbInst
          .select()
          .from(ridesT)
          .where(
            _and(
              _isNotNull(ridesT.scheduledAt),
              _gte(ridesT.scheduledAt, new Date(now.getTime() + minFrom * 60 * 1000)),
              _lte(ridesT.scheduledAt, new Date(now.getTime() + minTo   * 60 * 1000)),
              _sql`${ridesT.status} IN ('pending', 'accepted')`
            )
          );
      };

      // ── T-60 min: re-broadcast unclaimed rides to all online drivers (urgency = medium) ──
      const at60 = await unclaimedInWindow(58, 62);
      for (const ride of at60) {
        const payload = JSON.stringify({
          type: 'new_scheduled_ride',
          rideId: ride.id,
          riderId: ride.riderId,
          riderName: 'Rider',
          pickupAddress: (ride.pickupLocation as any)?.address || '',
          destinationAddress: (ride.destinationLocation as any)?.address || '',
          estimatedFare: ride.estimatedFare,
          scheduledAt: ride.scheduledAt,
          pickupCounty: ride.pickupCounty || '',
          urgent: true,
          urgentReason: 'no_driver_60min',
        });
        activeConnections.forEach((ws, driverId) => {
          const counties = driverCountyCache.get(driverId) ?? [];
          if (driverCoversCounty(counties, ride.pickupCounty) && ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
          }
        });
      }

      // ── T-15 min: re-broadcast unclaimed + warn rider ──
      const at15 = await unclaimedInWindow(13, 17);
      for (const ride of at15) {
        const payload = JSON.stringify({
          type: 'new_scheduled_ride',
          rideId: ride.id,
          riderId: ride.riderId,
          riderName: 'Rider',
          pickupAddress: (ride.pickupLocation as any)?.address || '',
          destinationAddress: (ride.destinationLocation as any)?.address || '',
          estimatedFare: ride.estimatedFare,
          scheduledAt: ride.scheduledAt,
          pickupCounty: ride.pickupCounty || '',
          urgent: true,
          urgentReason: 'no_driver_15min',
        });
        activeConnections.forEach((ws, driverId) => {
          const counties = driverCountyCache.get(driverId) ?? [];
          if (driverCoversCounty(counties, ride.pickupCounty) && ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
          }
        });
        // Warn the rider
        if (ride.riderId && activeConnections.has(ride.riderId)) {
          const riderWs = activeConnections.get(ride.riderId);
          if (riderWs?.readyState === WebSocket.OPEN) {
            riderWs.send(JSON.stringify({
              type: 'scheduled_ride_at_risk',
              rideId: ride.id,
              message: 'No driver has claimed your ride yet. We\'re urgently notifying available drivers.',
              minutesAway: 15,
            }));
          }
        }
      }

      // ── T-5 min: last-chance alert to rider if still unclaimed ──
      const at5 = await unclaimedInWindow(3, 7);
      for (const ride of at5) {
        if (ride.riderId && activeConnections.has(ride.riderId)) {
          const riderWs = activeConnections.get(ride.riderId);
          if (riderWs?.readyState === WebSocket.OPEN) {
            riderWs.send(JSON.stringify({
              type: 'scheduled_ride_no_driver',
              rideId: ride.id,
              message: 'We haven\'t found a driver yet. You can cancel this ride with no charge.',
              minutesAway: 5,
            }));
          }
        }
      }

      // ── T-30 min: standard reminder to rider + driver ──
      const at30 = await allInWindow(28, 32);
      for (const ride of at30) {
        const formattedTime = ride.scheduledAt
          ? new Date(ride.scheduledAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
          : '';
        const reminderMsg = JSON.stringify({
          type: 'ride_reminder',
          rideId: ride.id,
          scheduledAt: ride.scheduledAt,
          message: `Your ride is in 30 minutes at ${formattedTime}`,
          pickupAddress: (ride.pickupLocation as any)?.address || '',
          destinationAddress: (ride.destinationLocation as any)?.address || '',
        });
        if (ride.riderId && activeConnections.has(ride.riderId)) {
          const riderWs = activeConnections.get(ride.riderId);
          if (riderWs?.readyState === WebSocket.OPEN) riderWs.send(reminderMsg);
        }
        if (ride.driverId && activeConnections.has(ride.driverId)) {
          const driverWs = activeConnections.get(ride.driverId);
          if (driverWs?.readyState === WebSocket.OPEN) driverWs.send(reminderMsg);
        }
      }
    } catch (err) {
      console.error("Scheduled ride monitor error:", err);
    }
  }, 60 * 1000);

  return httpServer;
}
