import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { csrfMiddleware } from "./csrfProtection";
import { resolveAppUrl } from "./appUrl";

// Ensure crashes are always visible in Railway logs
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION — process will exit:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION — process will exit:', reason);
  process.exit(1);
});

// Startup env-var sanity check. Fails fast on missing essentials in production
// and warns loudly on missing-but-recoverable ones. Same RESEND warning lives
// in emailService.ts; we surface a consolidated banner here too.
function checkEnv() {
  const isProd = process.env.NODE_ENV === "production";
  const required: string[] = ["DATABASE_URL", "SESSION_SECRET"];
  // PUBLIC_APP_URL is satisfied by any of the sources resolveAppUrl accepts
  // (PUBLIC_APP_URL, APP_URL, or Railway's auto-set RAILWAY_PUBLIC_DOMAIN).
  const recommendedInProd: { name: string; why: string; ok?: () => boolean }[] = [
    { name: "ALLOWED_ORIGINS", why: "without it, CORS is fully disabled — browser clients on a different origin can't reach the API" },
    { name: "PUBLIC_APP_URL", why: "email/share links will fall back to req.host which can be wrong behind Railway's proxy", ok: () => resolveAppUrl() !== "" },
    { name: "RESEND_API_KEY", why: "all transactional email (verification, approvals, receipts) will fail" },
    { name: "RESEND_FROM", why: "Resend will reject sends without a verified sender" },
  ];

  const missingRequired = required.filter((k) => !process.env[k]);
  if (missingRequired.length > 0) {
    console.error(`[startup] Missing required env vars: ${missingRequired.join(", ")}. The app cannot start safely.`);
    if (isProd) process.exit(1);
  }

  if (isProd) {
    const missingRecommended = recommendedInProd.filter((k) => (k.ok ? !k.ok() : !process.env[k.name]));
    if (missingRecommended.length > 0) {
      console.warn("\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      console.warn("[startup] Production env vars MISSING — features will silently degrade:");
      for (const { name, why } of missingRecommended) {
        console.warn(`  - ${name}: ${why}`);
      }
      console.warn("Set these in Railway → Variables.");
      console.warn("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n");
    }
  }
}
checkEnv();

const app = express();

// CRITICAL: Health check endpoint MUST be first for deployment health checks
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use(helmet({ contentSecurityPolicy: false }));

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [];
app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : false, credentials: true }));

// Raw body for Stripe & Checkr webhook signature verification (must precede express.json)
app.use('/api/webhooks', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// CSRF: issues a token cookie on safe requests, validates X-CSRF-Token on
// mutating /api/* (except webhooks). Mounted after body parsing so the JSON
// 403 response can be written cleanly.
app.use(csrfMiddleware);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    console.error("Unhandled error:", err.stack || err);
  });

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
