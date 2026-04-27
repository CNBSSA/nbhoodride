import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

// Ensure crashes are always visible in Railway logs
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION — process will exit:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION — process will exit:', reason);
  process.exit(1);
});

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
