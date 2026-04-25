import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

// Replit Auth is optional — only active when REPL_ID is present (i.e. running
// on Replit). On Railway, RAILWAY_PUBLIC_DOMAIN is set but REPL_ID is not, so
// this flag stays false and the app falls back to email/password auth, avoiding
// the "clientId must be a non-empty string" crash from openid-client.
//
// RAILWAY_PUBLIC_DOMAIN is Railway's built-in variable for the service's public
// domain. REPLIT_DOMAINS is kept as a fallback for Replit-hosted deployments.
const REPLIT_AUTH_ENABLED =
  (!!process.env.RAILWAY_PUBLIC_DOMAIN || !!process.env.REPLIT_DOMAINS) && !!process.env.REPL_ID;

// openid-client and openid-client/passport are Replit-specific packages that
// validate REPLIT_DOMAINS at import time. We load them lazily so they are only
// required when Replit/Railway OIDC auth is actually in use.
let _oidcClient: typeof import("openid-client") | null = null;
let _oidcStrategy: typeof import("openid-client/passport") | null = null;

async function getOidcClient() {
  if (!_oidcClient) {
    _oidcClient = await import("openid-client");
  }
  return _oidcClient;
}

async function getOidcStrategy() {
  if (!_oidcStrategy) {
    _oidcStrategy = await import("openid-client/passport");
  }
  return _oidcStrategy;
}

const getOidcConfig = memoize(
  async () => {
    const client = await getOidcClient();
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(user: any, tokens: any) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(claims: any) {
  await storage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

// Resolve the list of domains to register OIDC strategies for.
// Prefer RAILWAY_PUBLIC_DOMAIN (Railway's built-in variable); fall back to the
// comma-separated REPLIT_DOMAINS list for Replit-hosted deployments.
function getAuthDomains(): string[] {
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return [process.env.RAILWAY_PUBLIC_DOMAIN];
  }
  if (process.env.REPLIT_DOMAINS) {
    return process.env.REPLIT_DOMAINS.split(",");
  }
  return [];
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  if (!REPLIT_AUTH_ENABLED) {
    // Not on Replit/Railway — OIDC routes are skipped. Email/password auth handles everything.
    passport.serializeUser((user: Express.User, cb) => cb(null, user));
    passport.deserializeUser((user: Express.User, cb) => cb(null, user));
    return;
  }

  // Lazily load openid-client packages only when OIDC auth is active.
  const client = await getOidcClient();
  const { Strategy } = await getOidcStrategy();

  const config = await getOidcConfig();

  const verify = async (tokens: any, verified: passport.AuthenticateCallback) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  for (const domain of getAuthDomains()) {
    const strategy = new Strategy(
      {
        name: `replitauth:${domain}`,
        config,
        scope: "openid email profile offline_access",
        callbackURL: `https://${domain}/api/callback`,
      },
      verify,
    );
    passport.use(strategy);
  }

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    passport.authenticate(`replitauth:${req.hostname}`, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req: any, res, next) => {
  const session = req.session as any;
  if (session?.userId || session?.testUserId) {
    return next();
  }

  const user = req.user as any;

  if (!req.isAuthenticated || !req.isAuthenticated() || !user?.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const client = await getOidcClient();
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
